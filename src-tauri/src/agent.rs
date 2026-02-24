use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use crate::session::{OutputEntry, OutputType, AgentMode, TokenUsage};
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::Mutex;

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

fn resolve_path(path: &str, workspace: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("{}/{}", workspace, path)
    }
}

async fn execute_tool(name: &str, input: &serde_json::Value, workspace: &str) -> String {
    match name {
        "file_read" => {
            let path = input["path"].as_str().unwrap_or("");
            let full_path = resolve_path(path, workspace);
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
            let full_path = resolve_path(path, workspace);
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
            let full_path = resolve_path(path, workspace);
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
            let full_path = resolve_path(path, workspace);

            let re = match regex::Regex::new(pattern_str) {
                Ok(r) => r,
                Err(e) => return format!("Invalid regex '{}': {}", pattern_str, e),
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

                // Apply include glob filter
                if let Some(glob_pattern) = include {
                    let file_name = entry.file_name().to_string_lossy();
                    // Simple glob: *.ext
                    if let Some(ext) = glob_pattern.strip_prefix("*.") {
                        if !file_name.ends_with(&format!(".{}", ext)) {
                            continue;
                        }
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
            let full_path = resolve_path(path, workspace);
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

/// Main agent loop with streaming and permission support
pub async fn run_agent(
    session_id: &str,
    user_message: String,
    api_key: &str,
    model: &str,
    workspace_path: &str,
    mode: &AgentMode,
    app: &tauri::AppHandle,
    manager: Arc<Mutex<crate::session::SessionManager>>,
) -> Result<()> {
    let system_prompt = format!(
        "You are a coding assistant working in: {}\n\
         Use tools to read files, write files, execute commands, and search code.\n\
         Be concise and helpful. Execute tasks step by step.\n\
         Always prefer using file_read/file_write/file_edit/grep/list_dir over bash_exec when possible.",
        workspace_path
    );

    // Load existing conversation
    let mut history = {
        let mgr = manager.lock().await;
        mgr.load_conversation(session_id).unwrap_or_default()
    };

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
        let request = ApiRequest {
            model: model.to_string(),
            max_tokens: 8192,
            stream: true,
            system: system_prompt.clone(),
            messages: history.messages.clone(),
            tools: tools.iter().map(|t| ToolDef {
                name: t.name.clone(),
                description: t.description.clone(),
                input_schema: t.input_schema.clone(),
            }).collect(),
        };

        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await?;
            let entry = OutputEntry {
                entry_type: OutputType::Error,
                content: format!("API error ({}): {}", status, &body[..body.len().min(500)]),
                timestamp: Utc::now(),
                metadata: None,
            };
            emit_output(app, session_id, &entry);
            return Err(anyhow::anyhow!("API error: {}", status));
        }

        // Parse streaming SSE response
        let mut current_text = String::new();
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_json = String::new();
        let mut assistant_content: Vec<serde_json::Value> = Vec::new();
        let mut tool_calls: Vec<(String, String, serde_json::Value)> = Vec::new(); // (id, name, input)

        let bytes = response.bytes().await?;
        let body = String::from_utf8_lossy(&bytes);

        for line in body.lines() {
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
                            total_usage.add(
                                usage.input_tokens.unwrap_or(0),
                                usage.output_tokens.unwrap_or(0),
                                model,
                            );
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
                            // Stream text to frontend immediately
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
                        // Send end-of-stream marker
                        let entry = OutputEntry {
                            entry_type: OutputType::System,
                            content: "".to_string(),
                            timestamp: Utc::now(),
                            metadata: Some(serde_json::json!({"stream_end": true})),
                        };
                        emit_output(app, session_id, &entry);
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
                        total_usage.add(
                            usage.input_tokens.unwrap_or(0),
                            usage.output_tokens.unwrap_or(0),
                            model,
                        );
                    }
                }
                _ => {}
            }
        }

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

                // Store the sender and update session state
                {
                    let mut mgr = manager.lock().await;
                    mgr.permission_senders.insert(perm_id.clone(), tx);
                    if let Some(s) = mgr.sessions.iter_mut().find(|s| s.id == session_id) {
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

                // Wait for user response
                match rx.await {
                    Ok(allowed) => {
                        // Remove the permission from the session
                        let mut mgr = manager.lock().await;
                        if let Some(s) = mgr.sessions.iter_mut().find(|s| s.id == session_id) {
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
            };

            if allowed {
                let result = execute_tool(tool_name, tool_input, workspace_path).await;
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
        {
            let mgr = manager.lock().await;
            mgr.save_conversation(session_id, &history).ok();
        }

        // Emit token usage update
        let _ = app.emit("token-usage", serde_json::json!({
            "session_id": session_id,
            "usage": total_usage,
        }));
    }

    // Save final conversation state
    {
        let mgr = manager.lock().await;
        mgr.save_conversation(session_id, &history).ok();
    }

    // Update token usage on session
    {
        let mut mgr = manager.lock().await;
        if let Some(s) = mgr.sessions.iter_mut().find(|s| s.id == session_id) {
            s.token_usage.input_tokens += total_usage.input_tokens;
            s.token_usage.output_tokens += total_usage.output_tokens;
            s.token_usage.total_cost_usd += total_usage.total_cost_usd;
        }
        mgr.save().ok();
    }

    Ok(())
}
