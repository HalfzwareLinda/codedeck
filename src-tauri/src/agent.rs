use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use crate::session::{AppState, OutputEntry, OutputType, AgentMode, TokenUsage};
use chrono::Utc;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use futures_util::StreamExt;

/// Maximum number of conversation messages before pruning kicks in.
/// Each API round adds ~2 messages (assistant + tool_results), so 100 messages
/// ≈ 50 rounds. Older messages are summarized into the system prompt.
const MAX_HISTORY_MESSAGES: usize = 100;

/// Maximum retries for transient API errors (429, 500, 502, 503, 529)
const MAX_RETRIES: u32 = 3;

/// Anthropic API version — single constant instead of hardcoded string
const ANTHROPIC_API_VERSION: &str = "2023-06-01";

/// Model used for conversation summarization — Haiku is fast and cheap
const SUMMARIZATION_MODEL: &str = "claude-haiku-4-5-20251001";

/// Max tokens for summarization response
const SUMMARIZATION_MAX_TOKENS: u32 = 2048;

#[derive(Debug, Serialize)]
struct ApiRequest {
    model: String,
    max_tokens: u32,
    stream: bool,
    system: String,
    messages: Vec<serde_json::Value>,
    tools: Vec<ToolDef>,
}

#[derive(Debug, Serialize)]
struct ToolDef {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

/// Streamed SSE event types from Anthropic API
#[derive(Debug, Deserialize)]
struct StreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[allow(dead_code)]
    index: Option<usize>,
    delta: Option<DeltaBlock>,
    content_block: Option<ContentBlockStart>,
    message: Option<MessageInfo>,
    usage: Option<UsageInfo>,
}

#[derive(Debug, Deserialize)]
struct DeltaBlock {
    #[allow(dead_code)]
    #[serde(rename = "type")]
    delta_type: Option<String>,
    text: Option<String>,
    partial_json: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContentBlockStart {
    #[serde(rename = "type")]
    block_type: String,
    id: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageInfo {
    usage: Option<UsageInfo>,
}

#[derive(Debug, Clone, Deserialize)]
struct UsageInfo {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

/// Tracks cumulative token counts for a single API round.
/// The Anthropic API sends cumulative values, not deltas:
/// - `message_start` has the initial input token count
/// - `message_delta` has the final cumulative output token count
#[derive(Debug, Default)]
struct RoundUsage {
    input_tokens: u64,
    output_tokens: u64,
}

impl RoundUsage {
    fn set_from_message_start(&mut self, usage: &UsageInfo) {
        self.input_tokens = usage.input_tokens.unwrap_or(0);
        self.output_tokens = usage.output_tokens.unwrap_or(0);
    }

    fn set_output_from_message_delta(&mut self, usage: &UsageInfo) {
        if let Some(out) = usage.output_tokens {
            self.output_tokens = out;
        }
    }

    /// Apply this round's usage to the running total
    fn apply_to(&self, total: &mut TokenUsage, model: &str) {
        total.add(self.input_tokens, self.output_tokens, model);
    }
}

fn get_tool_definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "file_read".into(),
            description: "Read the contents of a file. Returns the full file content.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to workspace, or absolute path" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "file_write".into(),
            description: "Write content to a file. Creates parent directories if needed.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path" },
                    "content": { "type": "string", "description": "Content to write" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDef {
            name: "file_edit".into(),
            description: "Edit a file by replacing the first occurrence of old_text with new_text.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path" },
                    "old_text": { "type": "string", "description": "Text to find" },
                    "new_text": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        },
        ToolDef {
            name: "bash_exec".into(),
            description: "Execute a shell command in the workspace directory. Use for commands that can't be done with other tools.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" },
                    "working_dir": { "type": "string", "description": "Working directory (optional, defaults to workspace)" }
                },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "grep".into(),
            description: "Search for a regex pattern in files. Returns matching lines with file paths and line numbers.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex pattern to search for" },
                    "path": { "type": "string", "description": "File or directory to search in (defaults to workspace root)" },
                    "include": { "type": "string", "description": "Glob pattern for files to include (e.g. '*.rs')" }
                },
                "required": ["pattern"]
            }),
        },
        ToolDef {
            name: "list_dir".into(),
            description: "List directory contents with file types.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Directory path" }
                },
                "required": ["path"]
            }),
        },
    ]
}

/// Resolve a path relative to the workspace, with security validation.
/// Uses pure-logic normalization (no filesystem I/O) so it works even when
/// the workspace is still being cloned or the target file doesn't exist yet.
fn resolve_path_safe(path: &str, workspace: &str) -> std::result::Result<String, String> {
    use std::path::{Component, PathBuf};

    let raw = if path.starts_with('/') {
        PathBuf::from(path)
    } else {
        PathBuf::from(workspace).join(path)
    };

    // Normalize: collapse `.`, `..`, strip redundant separators — no I/O
    let mut normalized = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("Access denied: path '{}' escapes root", path));
                }
            }
            Component::CurDir => {} // skip `.`
            other => normalized.push(other),
        }
    }

    // Normalize workspace the same way for consistent prefix check
    let mut ws_normalized = PathBuf::new();
    for component in PathBuf::from(workspace).components() {
        match component {
            Component::ParentDir => { ws_normalized.pop(); }
            Component::CurDir => {}
            other => ws_normalized.push(other),
        }
    }

    if !normalized.starts_with(&ws_normalized) {
        return Err(format!(
            "Access denied: path '{}' is outside the workspace boundary",
            path
        ));
    }

    Ok(normalized.to_string_lossy().to_string())
}

async fn execute_tool(name: &str, input: &serde_json::Value, workspace: &str) -> String {
    match name {
        "file_read" => {
            let path = input["path"].as_str().unwrap_or("");
            let full_path = match resolve_path_safe(path, workspace) {
                Ok(p) => p,
                Err(e) => return e,
            };
            match std::fs::read_to_string(&full_path) {
                Ok(content) => {
                    let lines = content.lines().count();
                    if content.len() > 50_000 {
                        format!("{}\n\n... (truncated, {} lines total)", &content[..50_000], lines)
                    } else {
                        content
                    }
                }
                Err(e) => format!("Error reading file: {}", e),
            }
        }
        "file_write" => {
            let path = input["path"].as_str().unwrap_or("");
            let content = input["content"].as_str().unwrap_or("");
            let full_path = match resolve_path_safe(path, workspace) {
                Ok(p) => p,
                Err(e) => return e,
            };
            if let Some(parent) = std::path::Path::new(&full_path).parent() {
                std::fs::create_dir_all(parent).ok();
            }
            match std::fs::write(&full_path, content) {
                Ok(()) => format!("Written {} bytes to {}", content.len(), path),
                Err(e) => format!("Error writing file: {}", e),
            }
        }
        "file_edit" => {
            let path = input["path"].as_str().unwrap_or("");
            let old_text = input["old_text"].as_str().unwrap_or("");
            let new_text = input["new_text"].as_str().unwrap_or("");
            let full_path = match resolve_path_safe(path, workspace) {
                Ok(p) => p,
                Err(e) => return e,
            };
            match std::fs::read_to_string(&full_path) {
                Ok(content) => {
                    if content.contains(old_text) {
                        let new_content = content.replacen(old_text, new_text, 1);
                        match std::fs::write(&full_path, &new_content) {
                            Ok(()) => format!("Edited {}", path),
                            Err(e) => format!("Error writing file: {}", e),
                        }
                    } else {
                        format!("Text not found in {}", path)
                    }
                }
                Err(e) => format!("Error reading file: {}", e),
            }
        }
        "bash_exec" => {
            let command = input["command"].as_str().unwrap_or("");
            let working_dir = input["working_dir"].as_str().unwrap_or(workspace);

            match tokio::time::timeout(
                std::time::Duration::from_secs(30),
                tokio::process::Command::new("sh")
                    .arg("-c")
                    .arg(command)
                    .current_dir(working_dir)
                    .kill_on_drop(true) // clean up child process on cancellation
                    .output(),
            )
            .await
            {
                Ok(Ok(out)) => {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    let mut result = String::new();
                    if !stdout.is_empty() {
                        result.push_str(&stdout);
                    }
                    if !stderr.is_empty() {
                        if !result.is_empty() { result.push('\n'); }
                        result.push_str("STDERR: ");
                        result.push_str(&stderr);
                    }
                    if result.is_empty() {
                        result = format!("Exit code: {}", out.status.code().unwrap_or(-1));
                    }
                    if result.len() > 20_000 {
                        result.truncate(20_000);
                        result.push_str("\n... (truncated)");
                    }
                    result
                }
                Ok(Err(e)) => format!("Error executing command: {}", e),
                Err(_) => "Command timed out after 30 seconds".to_string(),
            }
        }
        "grep" => {
            let pattern_str = input["pattern"].as_str().unwrap_or("");
            let path = input["path"].as_str().unwrap_or(".");
            let include = input["include"].as_str();
            let full_path = match resolve_path_safe(path, workspace) {
                Ok(p) => p,
                Err(e) => return e,
            };

            let re = match regex::Regex::new(pattern_str) {
                Ok(r) => r,
                Err(e) => return format!("Invalid regex '{}': {}", pattern_str, e),
            };

            // Compile glob filter once before the walk loop
            let glob_matcher = if let Some(glob_pattern) = include {
                match globset::GlobBuilder::new(glob_pattern)
                    .literal_separator(false)
                    .build()
                {
                    Ok(g) => Some(g.compile_matcher()),
                    Err(e) => return format!("Invalid glob pattern '{}': {}", glob_pattern, e),
                }
            } else {
                None
            };

            let mut results = Vec::new();
            let walker = walkdir::WalkDir::new(&full_path)
                .max_depth(15)
                .into_iter()
                .filter_entry(|e| {
                    let name = e.file_name().to_string_lossy();
                    // Skip hidden dirs, node_modules, target, .git
                    !(e.file_type().is_dir()
                        && (name.starts_with('.')
                            || name == "node_modules"
                            || name == "target"))
                });

            for entry in walker.filter_map(|e| e.ok()) {
                if !entry.file_type().is_file() { continue; }

                // Apply include glob filter (supports *.rs, **/*.rs, *.{ts,tsx}, etc.)
                if let Some(ref matcher) = glob_matcher {
                    let rel_path = entry.path().strip_prefix(&full_path)
                        .unwrap_or(entry.path());
                    if !matcher.is_match(rel_path)
                        && !matcher.is_match(entry.file_name().to_string_lossy().as_ref())
                    {
                        continue;
                    }
                }

                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    for (i, line) in content.lines().enumerate() {
                        if re.is_match(line) {
                            results.push(format!(
                                "{}:{}: {}",
                                entry.path().display(),
                                i + 1,
                                line.trim()
                            ));
                            if results.len() >= 100 { break; }
                        }
                    }
                }
                if results.len() >= 100 { break; }
            }
            if results.is_empty() {
                format!("No matches found for '{}'", pattern_str)
            } else {
                let count = results.len();
                let mut out = results.join("\n");
                if count >= 100 {
                    out.push_str("\n... (limited to 100 matches)");
                }
                out
            }
        }
        "list_dir" => {
            let path = input["path"].as_str().unwrap_or(".");
            let full_path = match resolve_path_safe(path, workspace) {
                Ok(p) => p,
                Err(e) => return e,
            };
            match std::fs::read_dir(&full_path) {
                Ok(entries) => {
                    let mut items: Vec<String> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| {
                            let name = e.file_name().to_string_lossy().to_string();
                            let meta = e.metadata().ok();
                            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                format!("{}/", name)
                            } else {
                                format!("{} ({} bytes)", name, size)
                            }
                        })
                        .collect();
                    items.sort();
                    if items.is_empty() {
                        "(empty directory)".to_string()
                    } else {
                        items.join("\n")
                    }
                }
                Err(e) => format!("Error listing directory: {}", e),
            }
        }
        _ => format!("Unknown tool: {}", name),
    }
}

fn emit_output(app: &tauri::AppHandle, session_id: &str, entry: &OutputEntry) {
    let _ = app.emit("session-output", serde_json::json!({
        "session_id": session_id,
        "entry": entry,
    }));
}

fn format_tool_description(name: &str, input: &serde_json::Value) -> String {
    match name {
        "file_read" => format!("Read: {}", input["path"].as_str().unwrap_or("?")),
        "file_write" => {
            let path = input["path"].as_str().unwrap_or("?");
            let len = input["content"].as_str().map(|s| s.len()).unwrap_or(0);
            format!("Write: {} ({} bytes)", path, len)
        }
        "file_edit" => format!("Edit: {}", input["path"].as_str().unwrap_or("?")),
        "bash_exec" => {
            let cmd = input["command"].as_str().unwrap_or("?");
            let truncated = if cmd.len() > 80 { &cmd[..80] } else { cmd };
            format!("Bash: `{}`", truncated)
        }
        "grep" => format!("Grep: '{}' in {}",
            input["pattern"].as_str().unwrap_or("?"),
            input["path"].as_str().unwrap_or(".")),
        "list_dir" => format!("List: {}", input["path"].as_str().unwrap_or(".")),
        _ => format!("{}: {:?}", name, input),
    }
}

fn format_tool_command(name: &str, input: &serde_json::Value) -> String {
    match name {
        "bash_exec" => input["command"].as_str().unwrap_or("").to_string(),
        "file_write" => format!("write {} ({} bytes)",
            input["path"].as_str().unwrap_or("?"),
            input["content"].as_str().map(|s| s.len()).unwrap_or(0)),
        "file_edit" => format!("edit {}",
            input["path"].as_str().unwrap_or("?")),
        "file_read" => format!("read {}",
            input["path"].as_str().unwrap_or("?")),
        "grep" => format!("grep '{}' in {}",
            input["pattern"].as_str().unwrap_or("?"),
            input["path"].as_str().unwrap_or(".")),
        "list_dir" => format!("ls {}",
            input["path"].as_str().unwrap_or(".")),
        _ => serde_json::to_string(input).unwrap_or_default(),
    }
}

/// Mechanical fallback summary when API summarization fails.
/// Operates on already-drained messages (not on history directly).
fn mechanical_prune_summary(pruned: &[serde_json::Value]) -> Option<String> {
    let mut summary_parts: Vec<String> = Vec::new();
    for msg in pruned {
        let role = msg["role"].as_str().unwrap_or("unknown");
        match role {
            "user" => {
                if let Some(text) = msg["content"].as_str() {
                    let truncated = if text.len() > 200 { &text[..200] } else { text };
                    summary_parts.push(format!("User: {}", truncated));
                }
            }
            "assistant" => {
                if let Some(content) = msg["content"].as_array() {
                    for block in content {
                        if block["type"].as_str() == Some("text") {
                            if let Some(text) = block["text"].as_str() {
                                let truncated = if text.len() > 200 { &text[..200] } else { text };
                                summary_parts.push(format!("Assistant: {}", truncated));
                            }
                        } else if block["type"].as_str() == Some("tool_use") {
                            let name = block["name"].as_str().unwrap_or("?");
                            summary_parts.push(format!("Tool: {}", name));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if summary_parts.is_empty() {
        return None;
    }

    Some(format!(
        "\n\n--- Earlier conversation summary ({} messages pruned) ---\n{}",
        pruned.len(),
        summary_parts.join("\n")
    ))
}

/// Make a non-streaming API call to Claude Haiku to summarize pruned conversation messages.
/// Returns (summary_text, input_tokens, output_tokens) on success.
async fn summarize_conversation(
    client: &reqwest::Client,
    api_key: &str,
    messages_to_summarize: &[serde_json::Value],
    existing_summary: Option<&str>,
    cancel_token: &CancellationToken,
) -> Result<(String, u64, u64)> {
    // Build context from the messages being pruned
    let mut context = String::new();
    if let Some(prev) = existing_summary {
        context.push_str("Previous conversation summary:\n");
        context.push_str(prev);
        context.push_str("\n\n");
    }
    context.push_str("Recent messages to incorporate:\n");

    for msg in messages_to_summarize {
        let role = msg["role"].as_str().unwrap_or("unknown");
        match role {
            "user" => {
                if let Some(text) = msg["content"].as_str() {
                    let truncated = &text[..text.len().min(500)];
                    context.push_str(&format!("User: {}\n", truncated));
                } else if let Some(arr) = msg["content"].as_array() {
                    for item in arr {
                        if item["type"].as_str() == Some("tool_result") {
                            let content = item["content"].as_str().unwrap_or("");
                            let truncated = &content[..content.len().min(300)];
                            context.push_str(&format!("Tool result: {}\n", truncated));
                        }
                    }
                }
            }
            "assistant" => {
                if let Some(arr) = msg["content"].as_array() {
                    for block in arr {
                        if block["type"].as_str() == Some("text") {
                            let text = block["text"].as_str().unwrap_or("");
                            let truncated = &text[..text.len().min(500)];
                            context.push_str(&format!("Assistant: {}\n", truncated));
                        } else if block["type"].as_str() == Some("tool_use") {
                            let name = block["name"].as_str().unwrap_or("?");
                            let input = &block["input"];
                            let detail = match name {
                                "file_write" | "file_edit" | "file_read" =>
                                    format!(" ({})", input["path"].as_str().unwrap_or("?")),
                                "bash_exec" => {
                                    let cmd = input["command"].as_str().unwrap_or("?");
                                    format!(" (`{}`)", &cmd[..cmd.len().min(80)])
                                }
                                _ => String::new(),
                            };
                            context.push_str(&format!("Tool use: {}{}\n", name, detail));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let summarize_prompt = format!(
        "You are summarizing a coding session for context continuity. \
         Produce a concise summary (under 500 words) covering:\n\
         1. Key decisions made\n\
         2. Files created, modified, or read (with paths)\n\
         3. Current state of the task\n\
         4. Any errors encountered and how they were resolved\n\
         5. Pending work or next steps the user mentioned\n\n\
         Conversation to summarize:\n{}", context
    );

    let request_body = serde_json::json!({
        "model": SUMMARIZATION_MODEL,
        "max_tokens": SUMMARIZATION_MAX_TOKENS,
        "messages": [{"role": "user", "content": summarize_prompt}],
    });

    // Non-streaming API call with cancellation support
    let response = tokio::select! {
        resp = client.post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_API_VERSION)
            .header("content-type", "application/json")
            .json(&request_body)
            .send() => resp?,
        _ = cancel_token.cancelled() => {
            return Err(anyhow::anyhow!("Summarization cancelled"));
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "Summarization API error {}: {}",
            status,
            &body[..body.len().min(200)]
        ));
    }

    let body: serde_json::Value = response.json().await?;
    let summary_text = body["content"][0]["text"]
        .as_str()
        .unwrap_or("(summarization failed)")
        .to_string();
    let input_tokens = body["usage"]["input_tokens"].as_u64().unwrap_or(0);
    let output_tokens = body["usage"]["output_tokens"].as_u64().unwrap_or(0);

    Ok((summary_text, input_tokens, output_tokens))
}

/// Determine if an HTTP status code is retryable
fn is_retryable_status(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 529)
}

/// Calculate backoff delay for retry attempt (exponential with jitter)
fn backoff_delay(attempt: u32) -> std::time::Duration {
    let base_ms = 1000u64 * 2u64.pow(attempt); // 1s, 2s, 4s
    let jitter_ms = base_ms / 4; // ±25% jitter range
    std::time::Duration::from_millis(base_ms + jitter_ms)
}

/// Main agent loop with streaming, permission support, cancellation,
/// conversation pruning, and retry/backoff
pub async fn run_agent(
    session_id: &str,
    user_message: String,
    api_key: &str,
    model: &str,
    workspace_path: &str,
    mode: &AgentMode,
    app: &tauri::AppHandle,
    state: Arc<AppState>,
    cancel_token: CancellationToken,
) -> Result<()> {
    let system_prompt = format!(
        "You are a coding assistant working in: {}\n\
         Use tools to read files, write files, execute commands, and search code.\n\
         Be concise and helpful. Execute tasks step by step.\n\
         Always prefer using file_read/file_write/file_edit/grep/list_dir over bash_exec when possible.",
        workspace_path
    );

    // Load existing conversation
    let mut history = state.persistence.load_conversation(session_id).unwrap_or_default();

    // Add user message
    history.messages.push(serde_json::json!({
        "role": "user",
        "content": user_message,
    }));

    let tools = get_tool_definitions();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let mut total_usage = TokenUsage::default();

    loop {
        // Check for cancellation before each API round
        if cancel_token.is_cancelled() {
            let entry = OutputEntry {
                entry_type: OutputType::System,
                content: "Agent cancelled.".to_string(),
                timestamp: Utc::now(),
                metadata: None,
            };
            emit_output(app, session_id, &entry);
            break;
        }

        // Summarize history if it's gotten too long — uses Claude Haiku API
        if history.messages.len() > MAX_HISTORY_MESSAGES {
            let keep_count = 20;
            let prune_count = history.messages.len() - keep_count;
            let pruned: Vec<serde_json::Value> = history.messages.drain(..prune_count).collect();

            let entry = OutputEntry {
                entry_type: OutputType::System,
                content: "Summarizing conversation history...".to_string(),
                timestamp: Utc::now(),
                metadata: None,
            };
            emit_output(app, session_id, &entry);

            match summarize_conversation(
                &client,
                api_key,
                &pruned,
                history.summary.as_deref(),
                &cancel_token,
            ).await {
                Ok((summary_text, sum_input, sum_output)) => {
                    history.summary = Some(summary_text);
                    // Track summarization tokens with Haiku pricing
                    total_usage.add(sum_input, sum_output, SUMMARIZATION_MODEL);

                    let entry = OutputEntry {
                        entry_type: OutputType::System,
                        content: format!(
                            "Conversation summarized ({} messages pruned, {} summary tokens)",
                            prune_count, sum_output
                        ),
                        timestamp: Utc::now(),
                        metadata: None,
                    };
                    emit_output(app, session_id, &entry);
                }
                Err(e) => {
                    // Fallback to mechanical summary if API call fails
                    eprintln!("Summarization failed, falling back to mechanical pruning: {}", e);
                    if let Some(fallback) = mechanical_prune_summary(&pruned) {
                        let existing = history.summary.take().unwrap_or_default();
                        history.summary = Some(if existing.is_empty() {
                            fallback
                        } else {
                            format!("{}\n{}", existing, fallback)
                        });
                    }

                    let entry = OutputEntry {
                        entry_type: OutputType::System,
                        content: format!(
                            "Conversation pruned ({} messages, summarization unavailable)",
                            prune_count
                        ),
                        timestamp: Utc::now(),
                        metadata: None,
                    };
                    emit_output(app, session_id, &entry);
                }
            }

            state.persistence.save_conversation(session_id, &history).ok();
        }

        // Prepend accumulated summary to system prompt if present
        let effective_system = if let Some(ref summary) = history.summary {
            format!("{}\n\n--- Conversation context ---\n{}", system_prompt, summary)
        } else {
            system_prompt.clone()
        };

        let request = ApiRequest {
            model: model.to_string(),
            max_tokens: 8192,
            stream: true,
            system: effective_system,
            messages: history.messages.clone(),
            tools: tools.iter().map(|t| ToolDef {
                name: t.name.clone(),
                description: t.description.clone(),
                input_schema: t.input_schema.clone(),
            }).collect(),
        };

        // Retry loop for transient API errors (A4)
        let mut retry_attempt = 0u32;
        let response = loop {
            if cancel_token.is_cancelled() {
                let entry = OutputEntry {
                    entry_type: OutputType::System,
                    content: "Agent cancelled.".to_string(),
                    timestamp: Utc::now(),
                    metadata: None,
                };
                emit_output(app, session_id, &entry);
                state.persistence.save_conversation(session_id, &history).ok();
                return Ok(());
            }

            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", ANTHROPIC_API_VERSION)
                .header("content-type", "application/json")
                .json(&request)
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => break r,
                Ok(r) if is_retryable_status(r.status().as_u16()) && retry_attempt < MAX_RETRIES => {
                    let status = r.status();
                    let body = r.text().await.unwrap_or_default();
                    let delay = backoff_delay(retry_attempt);
                    let entry = OutputEntry {
                        entry_type: OutputType::System,
                        content: format!(
                            "API error {} (retry {}/{}), waiting {}s...",
                            status, retry_attempt + 1, MAX_RETRIES,
                            delay.as_secs()
                        ),
                        timestamp: Utc::now(),
                        metadata: Some(serde_json::json!({"error_body": &body[..body.len().min(200)]})),
                    };
                    emit_output(app, session_id, &entry);
                    retry_attempt += 1;

                    // Wait with cancellation support
                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = cancel_token.cancelled() => {
                            state.persistence.save_conversation(session_id, &history).ok();
                            return Ok(());
                        }
                    }
                }
                Ok(r) => {
                    // Non-retryable error or retries exhausted
                    let status = r.status();
                    let body = r.text().await?;
                    let entry = OutputEntry {
                        entry_type: OutputType::Error,
                        content: format!("API error ({}): {}", status, &body[..body.len().min(500)]),
                        timestamp: Utc::now(),
                        metadata: None,
                    };
                    emit_output(app, session_id, &entry);
                    return Err(anyhow::anyhow!("API error: {}", status));
                }
                Err(e) if retry_attempt < MAX_RETRIES => {
                    // Network error — retry
                    let delay = backoff_delay(retry_attempt);
                    let entry = OutputEntry {
                        entry_type: OutputType::System,
                        content: format!(
                            "Network error (retry {}/{}): {}, waiting {}s...",
                            retry_attempt + 1, MAX_RETRIES, e, delay.as_secs()
                        ),
                        timestamp: Utc::now(),
                        metadata: None,
                    };
                    emit_output(app, session_id, &entry);
                    retry_attempt += 1;

                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = cancel_token.cancelled() => {
                            state.persistence.save_conversation(session_id, &history).ok();
                            return Ok(());
                        }
                    }
                }
                Err(e) => {
                    return Err(anyhow::anyhow!("Network error after {} retries: {}", MAX_RETRIES, e));
                }
            }
        };

        // Parse streaming SSE response — process chunks as they arrive
        let mut current_text = String::new();
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_json = String::new();
        let mut assistant_content: Vec<serde_json::Value> = Vec::new();
        let mut tool_calls: Vec<(String, String, serde_json::Value)> = Vec::new(); // (id, name, input)
        let mut line_buffer = String::new();

        let mut round_usage = RoundUsage::default();

        let mut byte_stream = response.bytes_stream();

        while let Some(chunk_result) = byte_stream.next().await {
            // Check cancellation during streaming
            if cancel_token.is_cancelled() {
                let entry = OutputEntry {
                    entry_type: OutputType::System,
                    content: "Agent cancelled.".to_string(),
                    timestamp: Utc::now(),
                    metadata: None,
                };
                emit_output(app, session_id, &entry);
                state.persistence.save_conversation(session_id, &history).ok();
                return Ok(());
            }

            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Stream chunk error: {}", e);
                    break;
                }
            };

            let chunk_str = String::from_utf8_lossy(&chunk);
            line_buffer.push_str(&chunk_str);

            // Process complete lines from the buffer
            while let Some(newline_pos) = line_buffer.find('\n') {
                let line = line_buffer[..newline_pos].trim_end().to_string();
                line_buffer = line_buffer[newline_pos + 1..].to_string();

                if !line.starts_with("data: ") { continue; }
                let data = &line[6..];
                if data == "[DONE]" { break; }

                let event: StreamEvent = match serde_json::from_str(data) {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                match event.event_type.as_str() {
                    "message_start" => {
                        if let Some(msg) = &event.message {
                            if let Some(usage) = &msg.usage {
                                round_usage.set_from_message_start(usage);
                            }
                        }
                    }
                    "content_block_start" => {
                        if let Some(block) = &event.content_block {
                            match block.block_type.as_str() {
                                "text" => {
                                    current_text.clear();
                                }
                                "tool_use" => {
                                    current_tool_id = block.id.clone().unwrap_or_default();
                                    current_tool_name = block.name.clone().unwrap_or_default();
                                    current_tool_json.clear();
                                }
                                _ => {}
                            }
                        }
                    }
                    "content_block_delta" => {
                        if let Some(delta) = &event.delta {
                            if let Some(text) = &delta.text {
                                current_text.push_str(text);
                                // Stream text to frontend immediately (true streaming now)
                                let entry = OutputEntry {
                                    entry_type: OutputType::Message,
                                    content: text.clone(),
                                    timestamp: Utc::now(),
                                    metadata: Some(serde_json::json!({"streaming": true})),
                                };
                                emit_output(app, session_id, &entry);
                            }
                            if let Some(json) = &delta.partial_json {
                                current_tool_json.push_str(json);
                            }
                        }
                    }
                    "content_block_stop" => {
                        if !current_text.is_empty() {
                            assistant_content.push(serde_json::json!({
                                "type": "text",
                                "text": current_text.clone(),
                            }));
                            current_text.clear();
                        }
                        if !current_tool_name.is_empty() {
                            let input: serde_json::Value = serde_json::from_str(&current_tool_json)
                                .unwrap_or(serde_json::Value::Object(Default::default()));
                            assistant_content.push(serde_json::json!({
                                "type": "tool_use",
                                "id": current_tool_id,
                                "name": current_tool_name,
                                "input": input,
                            }));
                            tool_calls.push((
                                current_tool_id.clone(),
                                current_tool_name.clone(),
                                input.clone(),
                            ));
                            current_tool_name.clear();
                            current_tool_json.clear();
                        }
                    }
                    "message_delta" => {
                        if let Some(usage) = &event.usage {
                            round_usage.set_output_from_message_delta(usage);
                        }
                    }
                    _ => {}
                }
            }
        }

        // Send stream_end marker once after all content blocks are done
        let stream_end_entry = OutputEntry {
            entry_type: OutputType::System,
            content: "".to_string(),
            timestamp: Utc::now(),
            metadata: Some(serde_json::json!({"stream_end": true})),
        };
        emit_output(app, session_id, &stream_end_entry);

        // Apply this round's token usage
        round_usage.apply_to(&mut total_usage, model);

        // No tool calls = agent is done
        if tool_calls.is_empty() {
            // Still need to add the final assistant message to history
            if !assistant_content.is_empty() {
                history.messages.push(serde_json::json!({
                    "role": "assistant",
                    "content": assistant_content,
                }));
            }
            break;
        }

        // Process tool calls
        let mut tool_results: Vec<serde_json::Value> = Vec::new();

        for (tool_id, tool_name, tool_input) in &tool_calls {
            // Check cancellation between tool calls
            if cancel_token.is_cancelled() {
                let entry = OutputEntry {
                    entry_type: OutputType::System,
                    content: "Agent cancelled.".to_string(),
                    timestamp: Utc::now(),
                    metadata: None,
                };
                emit_output(app, session_id, &entry);
                state.persistence.save_conversation(session_id, &history).ok();
                return Ok(());
            }

            let description = format_tool_description(tool_name, tool_input);
            let entry = OutputEntry {
                entry_type: OutputType::Action,
                content: description.clone(),
                timestamp: Utc::now(),
                metadata: Some(serde_json::json!({"tool_type": tool_name})),
            };
            emit_output(app, session_id, &entry);

            let allowed = if *mode == AgentMode::Auto {
                true
            } else {
                // PLAN mode: create permission request and wait
                let perm_id = uuid::Uuid::new_v4().to_string();
                let perm = crate::session::PermissionRequest {
                    id: perm_id.clone(),
                    tool_type: tool_name.clone(),
                    description: description.clone(),
                    command: format_tool_command(tool_name, tool_input),
                    timestamp: Utc::now(),
                };

                let (tx, rx) = tokio::sync::oneshot::channel::<bool>();

                // Store sender in separate permission_senders map (no session lock needed)
                {
                    let mut perms = state.permission_senders.lock().await;
                    perms.insert(perm_id.clone(), tx);
                }

                // Update session state (per-session lock)
                {
                    let sessions = state.sessions.lock().await;
                    if let Some(session_lock) = sessions.get(session_id) {
                        let mut s = session_lock.lock().await;
                        s.pending_permissions.push(perm.clone());
                        s.state = crate::session::SessionState::WaitingPermission;
                        let session_clone = s.clone();
                        let _ = app.emit("session-state", serde_json::json!({
                            "session_id": session_id,
                            "state": "waiting_permission",
                            "session": session_clone,
                        }));
                    }
                }

                // Emit permission request to frontend
                let _ = app.emit("permission-request", serde_json::json!({
                    "session_id": session_id,
                    "request": perm,
                }));

                // Wait for user response or cancellation
                tokio::select! {
                    result = rx => {
                        match result {
                            Ok(allowed) => {
                                // Remove the permission from the session (per-session lock)
                                let sessions = state.sessions.lock().await;
                                if let Some(session_lock) = sessions.get(session_id) {
                                    let mut s = session_lock.lock().await;
                                    s.pending_permissions.retain(|p| p.id != perm_id);
                                    if s.pending_permissions.is_empty() {
                                        s.state = crate::session::SessionState::Running;
                                    }
                                }
                                allowed
                            }
                            Err(_) => {
                                // Channel dropped = session deleted or app closing
                                return Err(anyhow::anyhow!("Permission channel closed"));
                            }
                        }
                    }
                    _ = cancel_token.cancelled() => {
                        // Clean up permission state
                        {
                            let mut perms = state.permission_senders.lock().await;
                            perms.remove(&perm_id);
                        }
                        {
                            let sessions = state.sessions.lock().await;
                            if let Some(session_lock) = sessions.get(session_id) {
                                let mut s = session_lock.lock().await;
                                s.pending_permissions.retain(|p| p.id != perm_id);
                            }
                        }
                        let entry = OutputEntry {
                            entry_type: OutputType::System,
                            content: "Agent cancelled.".to_string(),
                            timestamp: Utc::now(),
                            metadata: None,
                        };
                        emit_output(app, session_id, &entry);
                        state.persistence.save_conversation(session_id, &history).ok();
                        return Ok(());
                    }
                }
            };

            if allowed {
                // Run tool execution with cancellation support
                let result = tokio::select! {
                    r = execute_tool(tool_name, tool_input, workspace_path) => r,
                    _ = cancel_token.cancelled() => {
                        let entry = OutputEntry {
                            entry_type: OutputType::System,
                            content: "Agent cancelled during tool execution.".to_string(),
                            timestamp: Utc::now(),
                            metadata: None,
                        };
                        emit_output(app, session_id, &entry);
                        state.persistence.save_conversation(session_id, &history).ok();
                        return Ok(());
                    }
                };
                let result_entry = OutputEntry {
                    entry_type: OutputType::Action,
                    content: format!("{}: {} chars output", tool_name, result.len()),
                    timestamp: Utc::now(),
                    metadata: Some(serde_json::json!({"tool_type": tool_name, "result_preview": &result[..result.len().min(200)]})),
                };
                emit_output(app, session_id, &result_entry);

                tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result,
                }));
            } else {
                let entry = OutputEntry {
                    entry_type: OutputType::System,
                    content: format!("Denied: {}", description),
                    timestamp: Utc::now(),
                    metadata: None,
                };
                emit_output(app, session_id, &entry);

                tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": "User denied this operation.",
                    "is_error": true,
                }));
            }
        }

        // Add to conversation history
        history.messages.push(serde_json::json!({
            "role": "assistant",
            "content": assistant_content,
        }));
        history.messages.push(serde_json::json!({
            "role": "user",
            "content": tool_results,
        }));

        // Persist conversation after each round
        state.persistence.save_conversation(session_id, &history).ok();

        // Emit token usage update
        let _ = app.emit("token-usage", serde_json::json!({
            "session_id": session_id,
            "usage": total_usage,
        }));
    }

    // Save final conversation state
    state.persistence.save_conversation(session_id, &history).ok();

    // Update token usage on session (per-session lock)
    {
        let sessions = state.sessions.lock().await;
        if let Some(session_lock) = sessions.get(session_id) {
            let mut s = session_lock.lock().await;
            s.token_usage.input_tokens += total_usage.input_tokens;
            s.token_usage.output_tokens += total_usage.output_tokens;
            s.token_usage.total_cost_usd += total_usage.total_cost_usd;
        }
    }
    state.save_sessions().await.ok();

    Ok(())
}

/// Clone a git repository into the workspace directory.
pub async fn git_clone(repo_url: &str, branch: &str, workspace_path: &str) -> Result<String> {
    if repo_url.is_empty() {
        return Ok("No repo URL provided, workspace is empty.".to_string());
    }

    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone");

    if !branch.is_empty() {
        cmd.arg("--branch").arg(branch);
    }

    cmd.arg("--depth").arg("1");
    cmd.arg(repo_url).arg(workspace_path);

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        cmd.output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Git clone timed out after 120 seconds"))?
    .map_err(|e| anyhow::anyhow!("Failed to run git clone: {}", e))?;

    if output.status.success() {
        Ok("Repository cloned successfully.".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(anyhow::anyhow!("Git clone failed: {}", stderr))
    }
}

/// Execute git push in the workspace directory.
pub async fn git_push_in_workspace(workspace_path: &str) -> Result<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        tokio::process::Command::new("git")
            .args(["push"])
            .current_dir(workspace_path)
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Git push timed out after 60 seconds"))?
    .map_err(|e| anyhow::anyhow!("Failed to run git push: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok(format!("{}{}", stdout, stderr))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(anyhow::anyhow!("Git push failed: {}", stderr))
    }
}

/// Execute git pull in the workspace directory.
pub async fn git_pull_in_workspace(workspace_path: &str) -> Result<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        tokio::process::Command::new("git")
            .args(["pull"])
            .current_dir(workspace_path)
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Git pull timed out after 60 seconds"))?
    .map_err(|e| anyhow::anyhow!("Failed to run git pull: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(anyhow::anyhow!("Git pull failed: {}", stderr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{ConversationHistory, TokenUsage};

    // --- resolve_path_safe tests ---

    #[test]
    fn resolve_path_safe_normal_relative() {
        let result = resolve_path_safe("src/main.rs", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/src/main.rs");
    }

    #[test]
    fn resolve_path_safe_dot_segments() {
        let result = resolve_path_safe("src/./main.rs", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/src/main.rs");
    }

    #[test]
    fn resolve_path_safe_traversal_blocked() {
        let result = resolve_path_safe("../../../etc/passwd", "/workspace/project");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_safe_traversal_via_subdirectory() {
        let result = resolve_path_safe("foo/../../..", "/workspace/project");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_safe_absolute_inside_workspace() {
        let result = resolve_path_safe("/workspace/project/src/lib.rs", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/src/lib.rs");
    }

    #[test]
    fn resolve_path_safe_absolute_outside_workspace() {
        let result = resolve_path_safe("/etc/passwd", "/workspace/project");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_safe_empty_path() {
        let result = resolve_path_safe("", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project");
    }

    #[test]
    fn resolve_path_safe_nested_parent_traversal() {
        // Allowed: go up within workspace
        let result = resolve_path_safe("src/../Cargo.toml", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/Cargo.toml");
    }

    // --- is_retryable_status tests ---

    #[test]
    fn retryable_status_codes() {
        assert!(is_retryable_status(429));
        assert!(is_retryable_status(500));
        assert!(is_retryable_status(502));
        assert!(is_retryable_status(503));
        assert!(is_retryable_status(529));
    }

    #[test]
    fn non_retryable_status_codes() {
        assert!(!is_retryable_status(200));
        assert!(!is_retryable_status(400));
        assert!(!is_retryable_status(401));
        assert!(!is_retryable_status(403));
        assert!(!is_retryable_status(404));
    }

    // --- backoff_delay tests ---

    #[test]
    fn backoff_delay_exponential() {
        let d0 = backoff_delay(0); // 1000 + 250 = 1250ms
        let d1 = backoff_delay(1); // 2000 + 500 = 2500ms
        let d2 = backoff_delay(2); // 4000 + 1000 = 5000ms
        assert_eq!(d0.as_millis(), 1250);
        assert_eq!(d1.as_millis(), 2500);
        assert_eq!(d2.as_millis(), 5000);
    }

    // --- RoundUsage tests ---

    #[test]
    fn round_usage_default_is_zero() {
        let ru = RoundUsage::default();
        assert_eq!(ru.input_tokens, 0);
        assert_eq!(ru.output_tokens, 0);
    }

    #[test]
    fn round_usage_set_from_message_start() {
        let mut ru = RoundUsage::default();
        let usage = UsageInfo { input_tokens: Some(500), output_tokens: Some(10) };
        ru.set_from_message_start(&usage);
        assert_eq!(ru.input_tokens, 500);
        assert_eq!(ru.output_tokens, 10);
    }

    #[test]
    fn round_usage_set_from_message_start_handles_none() {
        let mut ru = RoundUsage::default();
        let usage = UsageInfo { input_tokens: None, output_tokens: None };
        ru.set_from_message_start(&usage);
        assert_eq!(ru.input_tokens, 0);
        assert_eq!(ru.output_tokens, 0);
    }

    #[test]
    fn round_usage_set_output_from_delta() {
        let mut ru = RoundUsage { input_tokens: 500, output_tokens: 10 };
        let usage = UsageInfo { input_tokens: None, output_tokens: Some(200) };
        ru.set_output_from_message_delta(&usage);
        assert_eq!(ru.input_tokens, 500); // unchanged
        assert_eq!(ru.output_tokens, 200); // cumulative replacement
    }

    #[test]
    fn round_usage_apply_to_sonnet_pricing() {
        let ru = RoundUsage { input_tokens: 1_000_000, output_tokens: 1_000_000 };
        let mut total = TokenUsage::default();
        ru.apply_to(&mut total, "claude-sonnet-4-20250514");
        assert_eq!(total.input_tokens, 1_000_000);
        assert_eq!(total.output_tokens, 1_000_000);
        // sonnet: $3/1M input + $15/1M output = $18
        assert!((total.total_cost_usd - 18.0).abs() < 0.01);
    }

    // --- mechanical_prune_summary tests (fallback summarization) ---

    #[test]
    fn mechanical_prune_empty_messages_returns_none() {
        let pruned: Vec<serde_json::Value> = vec![];
        assert!(mechanical_prune_summary(&pruned).is_none());
    }

    #[test]
    fn mechanical_prune_summary_contains_user_messages() {
        let pruned: Vec<serde_json::Value> = (0..10).map(|i| serde_json::json!({
            "role": "user", "content": format!("user message {}", i)
        })).collect();
        let summary = mechanical_prune_summary(&pruned).unwrap();
        assert!(summary.contains("User: user message 0"));
        assert!(summary.contains("messages pruned"));
    }

    #[test]
    fn mechanical_prune_summary_includes_tool_names() {
        let pruned = vec![
            serde_json::json!({
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "t1", "name": "file_read", "input": {"path": "test.rs"}}
                ]
            }),
            serde_json::json!({
                "role": "user", "content": "thanks"
            }),
        ];
        let summary = mechanical_prune_summary(&pruned).unwrap();
        assert!(summary.contains("Tool: file_read"));
    }

    #[test]
    fn mechanical_prune_summary_truncates_long_messages() {
        let long_msg = "a".repeat(500);
        let pruned = vec![serde_json::json!({
            "role": "user", "content": long_msg
        })];
        let summary = mechanical_prune_summary(&pruned).unwrap();
        // User message should be truncated to 200 chars
        let user_line = summary.lines().find(|l| l.starts_with("User: ")).unwrap();
        assert!(user_line.len() <= 210); // "User: " + 200 chars
    }

    #[test]
    fn mechanical_prune_summary_includes_assistant_text() {
        let pruned = vec![serde_json::json!({
            "role": "assistant",
            "content": [
                {"type": "text", "text": "I found the issue in the code."}
            ]
        })];
        let summary = mechanical_prune_summary(&pruned).unwrap();
        assert!(summary.contains("Assistant: I found the issue"));
    }

    // --- format_tool_description tests ---

    #[test]
    fn format_tool_description_file_read() {
        let input = serde_json::json!({"path": "src/main.rs"});
        assert_eq!(format_tool_description("file_read", &input), "Read: src/main.rs");
    }

    #[test]
    fn format_tool_description_file_write() {
        let input = serde_json::json!({"path": "out.txt", "content": "hello world"});
        let desc = format_tool_description("file_write", &input);
        assert!(desc.contains("Write: out.txt"));
        assert!(desc.contains("11 bytes"));
    }

    #[test]
    fn format_tool_description_bash_truncates() {
        let long_cmd = "a".repeat(200);
        let input = serde_json::json!({"command": long_cmd});
        let desc = format_tool_description("bash_exec", &input);
        assert!(desc.starts_with("Bash: `"));
        // Should truncate to 80 chars
        assert!(desc.len() < 100);
    }

    #[test]
    fn format_tool_description_grep() {
        let input = serde_json::json!({"pattern": "TODO", "path": "src/"});
        assert_eq!(format_tool_description("grep", &input), "Grep: 'TODO' in src/");
    }

    #[test]
    fn format_tool_description_list_dir() {
        let input = serde_json::json!({"path": "."});
        assert_eq!(format_tool_description("list_dir", &input), "List: .");
    }
}
