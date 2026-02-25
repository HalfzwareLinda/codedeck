use anyhow::Result;
use tokio_util::sync::CancellationToken;

use super::streaming::ANTHROPIC_API_VERSION;

/// Model used for conversation summarization — Haiku is fast and cheap
pub const SUMMARIZATION_MODEL: &str = "claude-haiku-4-5-20251001";

/// Max tokens for summarization response
const SUMMARIZATION_MAX_TOKENS: u32 = 2048;

/// Mechanical fallback summary when API summarization fails.
/// Operates on already-drained messages (not on history directly).
pub fn mechanical_prune_summary(pruned: &[serde_json::Value]) -> Option<String> {
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
pub async fn summarize_conversation(
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
                                "file_write" | "file_edit" | "file_read" => {
                                    format!(" ({})", input["path"].as_str().unwrap_or("?"))
                                }
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
         Conversation to summarize:\n{}",
        context
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mechanical_prune_empty_messages_returns_none() {
        let pruned: Vec<serde_json::Value> = vec![];
        assert!(mechanical_prune_summary(&pruned).is_none());
    }

    #[test]
    fn mechanical_prune_summary_contains_user_messages() {
        let pruned: Vec<serde_json::Value> = (0..10)
            .map(|i| {
                serde_json::json!({
                    "role": "user", "content": format!("user message {}", i)
                })
            })
            .collect();
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
}
