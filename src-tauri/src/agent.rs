use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use crate::session::{OutputEntry, OutputType, AgentMode};
use chrono::Utc;

#[derive(Debug, Serialize)]
struct ApiRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<Message>,
    tools: Vec<ToolDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Message {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct ToolDef {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    content: Vec<ContentBlock>,
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

fn get_tool_definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "file_read".into(),
            description: "Read the contents of a file".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path to read" }
                },
                "required": ["path"]
            }),
        },
        ToolDef {
            name: "file_write".into(),
            description: "Write content to a file".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path to write" },
                    "content": { "type": "string", "description": "Content to write" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDef {
            name: "file_edit".into(),
            description: "Edit a file by replacing old text with new text".into(),
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
            description: "Execute a shell command".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Command to execute" },
                    "working_dir": { "type": "string", "description": "Working directory (optional)" }
                },
                "required": ["command"]
            }),
        },
        ToolDef {
            name: "grep".into(),
            description: "Search for a pattern in files".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Search pattern (regex)" },
                    "path": { "type": "string", "description": "Path to search in" },
                    "recursive": { "type": "boolean", "description": "Search recursively" }
                },
                "required": ["pattern"]
            }),
        },
        ToolDef {
            name: "list_dir".into(),
            description: "List directory contents".into(),
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

async fn execute_tool(name: &str, input: &serde_json::Value, workspace: &str) -> Result<String> {
    match name {
        "file_read" => {
            let path = input["path"].as_str().unwrap_or("");
            let full_path = if path.starts_with('/') {
                path.to_string()
            } else {
                format!("{}/{}", workspace, path)
            };
            match std::fs::read_to_string(&full_path) {
                Ok(content) => Ok(content),
                Err(e) => Ok(format!("Error reading file: {}", e)),
            }
        }
        "file_write" => {
            let path = input["path"].as_str().unwrap_or("");
            let content = input["content"].as_str().unwrap_or("");
            let full_path = if path.starts_with('/') {
                path.to_string()
            } else {
                format!("{}/{}", workspace, path)
            };
            if let Some(parent) = std::path::Path::new(&full_path).parent() {
                std::fs::create_dir_all(parent).ok();
            }
            match std::fs::write(&full_path, content) {
                Ok(()) => Ok(format!("Written {} bytes to {}", content.len(), path)),
                Err(e) => Ok(format!("Error writing file: {}", e)),
            }
        }
        "file_edit" => {
            let path = input["path"].as_str().unwrap_or("");
            let old_text = input["old_text"].as_str().unwrap_or("");
            let new_text = input["new_text"].as_str().unwrap_or("");
            let full_path = if path.starts_with('/') {
                path.to_string()
            } else {
                format!("{}/{}", workspace, path)
            };
            match std::fs::read_to_string(&full_path) {
                Ok(content) => {
                    if content.contains(old_text) {
                        let new_content = content.replacen(old_text, new_text, 1);
                        std::fs::write(&full_path, &new_content)?;
                        Ok(format!("Edited {}", path))
                    } else {
                        Ok(format!("Text not found in {}", path))
                    }
                }
                Err(e) => Ok(format!("Error reading file: {}", e)),
            }
        }
        "bash_exec" => {
            let command = input["command"].as_str().unwrap_or("");
            let working_dir = input["working_dir"]
                .as_str()
                .unwrap_or(workspace);

            let output = tokio::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .current_dir(working_dir)
                .output()
                .await;

            match output {
                Ok(out) => {
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
                        result = format!("Command completed with exit code {}", out.status.code().unwrap_or(-1));
                    }
                    // Truncate very long outputs
                    if result.len() > 10000 {
                        result.truncate(10000);
                        result.push_str("\n... (truncated)");
                    }
                    Ok(result)
                }
                Err(e) => Ok(format!("Error executing command: {}", e)),
            }
        }
        "grep" => {
            let pattern = input["pattern"].as_str().unwrap_or("");
            let path = input["path"].as_str().unwrap_or(".");
            let full_path = if path.starts_with('/') {
                path.to_string()
            } else {
                format!("{}/{}", workspace, path)
            };
            let recursive = input["recursive"].as_bool().unwrap_or(true);

            let mut results = Vec::new();
            let walker = walkdir::WalkDir::new(&full_path)
                .max_depth(if recursive { 10 } else { 1 });

            for entry in walker.into_iter().filter_map(|e| e.ok()) {
                if !entry.file_type().is_file() { continue; }
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    for (i, line) in content.lines().enumerate() {
                        if line.contains(pattern) {
                            results.push(format!(
                                "{}:{}: {}",
                                entry.path().display(),
                                i + 1,
                                line.trim()
                            ));
                            if results.len() >= 50 { break; }
                        }
                    }
                }
                if results.len() >= 50 { break; }
            }
            if results.is_empty() {
                Ok(format!("No matches found for '{}'", pattern))
            } else {
                Ok(results.join("\n"))
            }
        }
        "list_dir" => {
            let path = input["path"].as_str().unwrap_or(".");
            let full_path = if path.starts_with('/') {
                path.to_string()
            } else {
                format!("{}/{}", workspace, path)
            };
            match std::fs::read_dir(&full_path) {
                Ok(entries) => {
                    let mut items: Vec<String> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| {
                            let name = e.file_name().to_string_lossy().to_string();
                            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                format!("{}/", name)
                            } else {
                                name
                            }
                        })
                        .collect();
                    items.sort();
                    Ok(items.join("\n"))
                }
                Err(e) => Ok(format!("Error listing directory: {}", e)),
            }
        }
        _ => Ok(format!("Unknown tool: {}", name)),
    }
}

fn emit_output(app: &tauri::AppHandle, session_id: &str, entry: &OutputEntry) {
    let _ = app.emit("session-output", serde_json::json!({
        "session_id": session_id,
        "entry": entry,
    }));
}

pub async fn run_agent(
    session_id: &str,
    user_message: String,
    api_key: &str,
    model: &str,
    workspace_path: &str,
    mode: &AgentMode,
    app: &tauri::AppHandle,
) -> Result<()> {
    let system_prompt = format!(
        "You are a coding assistant working in: {}\n\
         Use tools to read files, write files, execute commands, search code.\n\
         Be concise and helpful. Execute tasks step by step.",
        workspace_path
    );

    let tools = get_tool_definitions();

    let mut messages: Vec<Message> = vec![
        Message {
            role: "user".into(),
            content: serde_json::Value::String(user_message),
        },
    ];

    let client = reqwest::Client::new();

    loop {
        let request = ApiRequest {
            model: model.to_string(),
            max_tokens: 8192,
            system: system_prompt.clone(),
            messages: messages.clone(),
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
        let body = response.text().await?;

        if !status.is_success() {
            let entry = OutputEntry {
                entry_type: OutputType::Error,
                content: format!("API error ({}): {}", status, &body[..body.len().min(500)]),
                timestamp: Utc::now(),
                metadata: None,
            };
            emit_output(app, session_id, &entry);
            return Err(anyhow::anyhow!("API error: {}", status));
        }

        let api_response: ApiResponse = serde_json::from_str(&body)?;
        let mut has_tool_use = false;
        let mut assistant_content: Vec<serde_json::Value> = Vec::new();
        let mut tool_results: Vec<serde_json::Value> = Vec::new();

        for block in &api_response.content {
            match block {
                ContentBlock::Text { text } => {
                    assistant_content.push(serde_json::json!({
                        "type": "text",
                        "text": text,
                    }));
                    let entry = OutputEntry {
                        entry_type: OutputType::Message,
                        content: text.clone(),
                        timestamp: Utc::now(),
                        metadata: None,
                    };
                    emit_output(app, session_id, &entry);
                }
                ContentBlock::ToolUse { id, name, input } => {
                    has_tool_use = true;
                    assistant_content.push(serde_json::json!({
                        "type": "tool_use",
                        "id": id,
                        "name": name,
                        "input": input,
                    }));

                    // Emit action
                    let description = format_tool_description(name, input);
                    let entry = OutputEntry {
                        entry_type: OutputType::Action,
                        content: description,
                        timestamp: Utc::now(),
                        metadata: Some(serde_json::json!({ "tool_type": name })),
                    };
                    emit_output(app, session_id, &entry);

                    // In Plan mode, we'd normally wait for permission
                    // For now, auto-execute (permission system needs bidirectional channel)
                    let _ = mode; // acknowledge mode parameter

                    let result = execute_tool(name, input, workspace_path).await?;

                    // Emit result
                    let result_entry = OutputEntry {
                        entry_type: OutputType::Action,
                        content: format!("Result: {} chars", result.len()),
                        timestamp: Utc::now(),
                        metadata: Some(serde_json::json!({ "tool_type": name })),
                    };
                    emit_output(app, session_id, &result_entry);

                    tool_results.push(serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": id,
                        "content": result,
                    }));
                }
            }
        }

        if !has_tool_use {
            break;
        }

        // Add assistant message and tool results to conversation
        messages.push(Message {
            role: "assistant".into(),
            content: serde_json::Value::Array(assistant_content),
        });
        messages.push(Message {
            role: "user".into(),
            content: serde_json::Value::Array(tool_results),
        });

        // Check stop reason
        if api_response.stop_reason.as_deref() == Some("end_turn") {
            break;
        }
    }

    Ok(())
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
