pub mod git;
pub mod history;
pub mod messages;
pub mod retry;
pub mod streaming;
pub mod tools;

use anyhow::Result;
use chrono::Utc;
use futures_util::StreamExt;
use std::sync::Arc;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

use crate::session::{AgentMode, AppState, OutputEntry, OutputType, TokenUsage};
use messages::{ContentBlock, Message, ToolResult};
use streaming::{ApiRequest, RoundUsage, StreamEvent, ANTHROPIC_API_VERSION};
use tools::{execute_tool_by_name, format_tool_command, format_tool_description, get_all_tools};

/// Maximum number of conversation messages before pruning kicks in.
/// Each API round adds ~2 messages (assistant + tool_results), so 100 messages
/// ≈ 50 rounds. Older messages are summarized into the system prompt.
const MAX_HISTORY_MESSAGES: usize = 100;

/// Maximum retries for transient API errors (429, 500, 502, 503, 529)
const MAX_RETRIES: u32 = 3;

// Re-export for lib.rs
pub use git::{git_clone, git_pull_in_workspace, git_push_in_workspace};

/// Attach the correct Anthropic auth header based on key prefix.
/// Direct API keys (`sk-ant-api03-`) use `x-api-key`.
/// OAuth access tokens (`sk-ant-oat01-`) use `Authorization: Bearer`.
pub fn with_anthropic_auth(builder: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    if key.starts_with("sk-ant-oat01-") {
        builder.header("Authorization", format!("Bearer {}", key))
    } else {
        builder.header("x-api-key", key)
    }
}

fn emit_output(app: &tauri::AppHandle, session_id: &str, entry: &OutputEntry) {
    let _ = app.emit(
        "session-output",
        serde_json::json!({
            "session_id": session_id,
            "entry": entry,
        }),
    );
}

/// Emit cancellation message, save conversation, return Ok(()).
fn handle_cancellation(
    app: &tauri::AppHandle,
    session_id: &str,
    state: &AppState,
    history: &crate::session::ConversationHistory,
) -> Result<()> {
    let entry = OutputEntry {
        entry_type: OutputType::System,
        content: "Agent cancelled.".to_string(),
        timestamp: Utc::now(),
        metadata: None,
    };
    emit_output(app, session_id, &entry);
    state
        .persistence
        .save_conversation(session_id, history)
        .ok();
    Ok(())
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
    let mut history = state
        .persistence
        .load_conversation(session_id)
        .unwrap_or_default();

    // Add user message
    history
        .messages
        .push(serde_json::to_value(&Message::user_text(user_message)).unwrap());

    let registered_tools = get_all_tools();
    let tool_defs: Vec<streaming::ToolDef> =
        registered_tools.iter().map(|t| t.definition()).collect();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let mut total_usage = TokenUsage::default();

    loop {
        // Check for cancellation before each API round
        if cancel_token.is_cancelled() {
            return handle_cancellation(app, session_id, &state, &history);
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

            match history::summarize_conversation(
                &client,
                api_key,
                &pruned,
                history.summary.as_deref(),
                &cancel_token,
            )
            .await
            {
                Ok((summary_text, sum_input, sum_output)) => {
                    history.summary = Some(summary_text);
                    total_usage.add(sum_input, sum_output, history::SUMMARIZATION_MODEL);

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
                    eprintln!(
                        "Summarization failed, falling back to mechanical pruning: {}",
                        e
                    );
                    if let Some(fallback) = history::mechanical_prune_summary(&pruned) {
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

            state
                .persistence
                .save_conversation(session_id, &history)
                .ok();
        }

        // Prepend accumulated summary to system prompt if present
        let effective_system = if let Some(ref summary) = history.summary {
            format!(
                "{}\n\n--- Conversation context ---\n{}",
                system_prompt, summary
            )
        } else {
            system_prompt.clone()
        };

        let request = ApiRequest {
            model: model.to_string(),
            max_tokens: 8192,
            stream: true,
            system: effective_system,
            messages: history.messages.clone(),
            tools: tool_defs.clone(),
        };

        // Retry loop for transient API errors
        let mut retry_attempt = 0u32;
        let response = loop {
            if cancel_token.is_cancelled() {
                return handle_cancellation(app, session_id, &state, &history);
            }

            let resp = with_anthropic_auth(
                    client.post("https://api.anthropic.com/v1/messages"),
                    api_key,
                )
                .header("anthropic-version", ANTHROPIC_API_VERSION)
                .header("content-type", "application/json")
                .json(&request)
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => break r,
                Ok(r)
                    if retry::is_retryable_status(r.status().as_u16())
                        && retry_attempt < MAX_RETRIES =>
                {
                    let status = r.status();
                    let body = r.text().await.unwrap_or_default();
                    let delay = retry::backoff_delay(retry_attempt);
                    let entry = OutputEntry {
                        entry_type: OutputType::System,
                        content: format!(
                            "API error {} (retry {}/{}), waiting {}s...",
                            status,
                            retry_attempt + 1,
                            MAX_RETRIES,
                            delay.as_secs()
                        ),
                        timestamp: Utc::now(),
                        metadata: Some(
                            serde_json::json!({"error_body": &body[..body.len().min(200)]}),
                        ),
                    };
                    emit_output(app, session_id, &entry);
                    retry_attempt += 1;

                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = cancel_token.cancelled() => {
                            return handle_cancellation(app, session_id, &state, &history);
                        }
                    }
                }
                Ok(r) => {
                    let status = r.status();
                    let body = r.text().await?;
                    let entry = OutputEntry {
                        entry_type: OutputType::Error,
                        content: format!(
                            "API error ({}): {}",
                            status,
                            &body[..body.len().min(500)]
                        ),
                        timestamp: Utc::now(),
                        metadata: None,
                    };
                    emit_output(app, session_id, &entry);
                    return Err(anyhow::anyhow!("API error: {}", status));
                }
                Err(e) if retry_attempt < MAX_RETRIES => {
                    let delay = retry::backoff_delay(retry_attempt);
                    let entry = OutputEntry {
                        entry_type: OutputType::System,
                        content: format!(
                            "Network error (retry {}/{}): {}, waiting {}s...",
                            retry_attempt + 1,
                            MAX_RETRIES,
                            e,
                            delay.as_secs()
                        ),
                        timestamp: Utc::now(),
                        metadata: None,
                    };
                    emit_output(app, session_id, &entry);
                    retry_attempt += 1;

                    tokio::select! {
                        _ = tokio::time::sleep(delay) => {}
                        _ = cancel_token.cancelled() => {
                            return handle_cancellation(app, session_id, &state, &history);
                        }
                    }
                }
                Err(e) => {
                    return Err(anyhow::anyhow!(
                        "Network error after {} retries: {}",
                        MAX_RETRIES,
                        e
                    ));
                }
            }
        };

        // Parse streaming SSE response — process chunks as they arrive
        let mut current_text = String::new();
        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_json = String::new();
        let mut assistant_content: Vec<ContentBlock> = Vec::new();
        let mut tool_calls: Vec<(String, String, serde_json::Value)> = Vec::new();
        let mut line_buffer = String::new();

        let mut round_usage = RoundUsage::default();

        let mut byte_stream = response.bytes_stream();

        while let Some(chunk_result) = byte_stream.next().await {
            if cancel_token.is_cancelled() {
                return handle_cancellation(app, session_id, &state, &history);
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

            while let Some(newline_pos) = line_buffer.find('\n') {
                let line = line_buffer[..newline_pos].trim_end().to_string();
                line_buffer = line_buffer[newline_pos + 1..].to_string();

                if !line.starts_with("data: ") {
                    continue;
                }
                let data = &line[6..];
                if data == "[DONE]" {
                    break;
                }

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
                            assistant_content.push(ContentBlock::Text {
                                text: current_text.clone(),
                            });
                            current_text.clear();
                        }
                        if !current_tool_name.is_empty() {
                            let input: serde_json::Value = serde_json::from_str(&current_tool_json)
                                .unwrap_or(serde_json::Value::Object(Default::default()));
                            assistant_content.push(ContentBlock::ToolUse {
                                id: current_tool_id.clone(),
                                name: current_tool_name.clone(),
                                input: input.clone(),
                            });
                            tool_calls.push((
                                current_tool_id.clone(),
                                current_tool_name.clone(),
                                input,
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
            if !assistant_content.is_empty() {
                history
                    .messages
                    .push(serde_json::to_value(&Message::assistant(assistant_content)).unwrap());
            }
            break;
        }

        // Process tool calls
        let mut tool_results: Vec<ToolResult> = Vec::new();

        for (tool_id, tool_name, tool_input) in &tool_calls {
            if cancel_token.is_cancelled() {
                return handle_cancellation(app, session_id, &state, &history);
            }

            let description = format_tool_description(&registered_tools, tool_name, tool_input);
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
                    command: format_tool_command(&registered_tools, tool_name, tool_input),
                    timestamp: Utc::now(),
                };

                let (tx, rx) = tokio::sync::oneshot::channel::<bool>();

                {
                    let mut perms = state.permission_senders.lock().await;
                    perms.insert(perm_id.clone(), tx);
                }

                {
                    let sessions = state.sessions.lock().await;
                    if let Some(session_lock) = sessions.get(session_id) {
                        let mut s = session_lock.lock().await;
                        s.pending_permissions.push(perm.clone());
                        s.state = crate::session::SessionState::WaitingPermission;
                        let session_clone = s.clone();
                        let _ = app.emit(
                            "session-state",
                            serde_json::json!({
                                "session_id": session_id,
                                "state": "waiting_permission",
                                "session": session_clone,
                            }),
                        );
                    }
                }

                let _ = app.emit(
                    "permission-request",
                    serde_json::json!({
                        "session_id": session_id,
                        "request": perm,
                    }),
                );

                tokio::select! {
                    result = rx => {
                        match result {
                            Ok(allowed) => {
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
                                return Err(anyhow::anyhow!("Permission channel closed"));
                            }
                        }
                    }
                    _ = cancel_token.cancelled() => {
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
                        return handle_cancellation(app, session_id, &state, &history);
                    }
                }
            };

            if allowed {
                let result = tokio::select! {
                    r = execute_tool_by_name(&registered_tools, tool_name, tool_input, workspace_path) => r,
                    _ = cancel_token.cancelled() => {
                        return handle_cancellation(app, session_id, &state, &history);
                    }
                };
                let result_entry = OutputEntry {
                    entry_type: OutputType::Action,
                    content: format!("{}: {} chars output", tool_name, result.len()),
                    timestamp: Utc::now(),
                    metadata: Some(
                        serde_json::json!({"tool_type": tool_name, "result_preview": &result[..result.len().min(200)]}),
                    ),
                };
                emit_output(app, session_id, &result_entry);

                tool_results.push(ToolResult::success(tool_id.clone(), result));
            } else {
                let entry = OutputEntry {
                    entry_type: OutputType::System,
                    content: format!("Denied: {}", description),
                    timestamp: Utc::now(),
                    metadata: None,
                };
                emit_output(app, session_id, &entry);

                tool_results.push(ToolResult::error(
                    tool_id.clone(),
                    "User denied this operation.".into(),
                ));
            }
        }

        // Add to conversation history using typed messages
        history
            .messages
            .push(serde_json::to_value(&Message::assistant(assistant_content)).unwrap());
        history
            .messages
            .push(serde_json::to_value(&Message::user_tool_results(tool_results)).unwrap());

        // Persist conversation after each round
        state
            .persistence
            .save_conversation(session_id, &history)
            .ok();

        // Emit token usage update
        let _ = app.emit(
            "token-usage",
            serde_json::json!({
                "session_id": session_id,
                "usage": total_usage,
            }),
        );
    }

    // Save final conversation state
    state
        .persistence
        .save_conversation(session_id, &history)
        .ok();

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
