use serde::{Deserialize, Serialize};

/// Typed conversation message — replaces raw `serde_json::Value`.
/// Serializes to the exact JSON shape the Anthropic API expects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role")]
pub enum Message {
    #[serde(rename = "user")]
    User { content: UserContent },
    #[serde(rename = "assistant")]
    Assistant { content: Vec<ContentBlock> },
}

/// User message content — either plain text or tool results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    ToolResults(Vec<ToolResult>),
}

/// A content block in an assistant response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

/// A tool result sent back to the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    #[serde(rename = "type")]
    pub result_type: ToolResultType,
    pub tool_use_id: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ToolResultType {
    #[serde(rename = "tool_result")]
    ToolResult,
}

impl ToolResult {
    pub fn success(tool_use_id: String, content: String) -> Self {
        Self {
            result_type: ToolResultType::ToolResult,
            tool_use_id,
            content,
            is_error: None,
        }
    }

    pub fn error(tool_use_id: String, content: String) -> Self {
        Self {
            result_type: ToolResultType::ToolResult,
            tool_use_id,
            content,
            is_error: Some(true),
        }
    }
}

impl Message {
    pub fn user_text(text: String) -> Self {
        Message::User {
            content: UserContent::Text(text),
        }
    }

    pub fn user_tool_results(results: Vec<ToolResult>) -> Self {
        Message::User {
            content: UserContent::ToolResults(results),
        }
    }

    pub fn assistant(content: Vec<ContentBlock>) -> Self {
        Message::Assistant { content }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_text_message_serializes_correctly() {
        let msg = Message::user_text("hello".into());
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "user");
        assert_eq!(json["content"], "hello");
    }

    #[test]
    fn assistant_message_serializes_correctly() {
        let msg = Message::assistant(vec![
            ContentBlock::Text {
                text: "I'll help.".into(),
            },
            ContentBlock::ToolUse {
                id: "t1".into(),
                name: "file_read".into(),
                input: serde_json::json!({"path": "src/main.rs"}),
            },
        ]);
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "assistant");
        let content = json["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "I'll help.");
        assert_eq!(content[1]["type"], "tool_use");
        assert_eq!(content[1]["name"], "file_read");
    }

    #[test]
    fn tool_result_success_serializes_correctly() {
        let result = ToolResult::success("t1".into(), "file contents here".into());
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["type"], "tool_result");
        assert_eq!(json["tool_use_id"], "t1");
        assert_eq!(json["content"], "file contents here");
        assert!(json.get("is_error").is_none());
    }

    #[test]
    fn tool_result_error_serializes_correctly() {
        let result = ToolResult::error("t1".into(), "User denied this operation.".into());
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["type"], "tool_result");
        assert_eq!(json["is_error"], true);
    }

    #[test]
    fn user_tool_results_serializes_correctly() {
        let msg = Message::user_tool_results(vec![
            ToolResult::success("t1".into(), "ok".into()),
            ToolResult::error("t2".into(), "denied".into()),
        ]);
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "user");
        let content = json["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["tool_use_id"], "t1");
        assert_eq!(content[1]["is_error"], true);
    }

    #[test]
    fn user_text_message_roundtrips() {
        let msg = Message::user_text("test".into());
        let json_str = serde_json::to_string(&msg).unwrap();
        let back: Message = serde_json::from_str(&json_str).unwrap();
        match back {
            Message::User {
                content: UserContent::Text(t),
            } => assert_eq!(t, "test"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn assistant_message_roundtrips() {
        let msg = Message::assistant(vec![ContentBlock::Text { text: "hi".into() }]);
        let json_str = serde_json::to_string(&msg).unwrap();
        let back: Message = serde_json::from_str(&json_str).unwrap();
        match back {
            Message::Assistant { content } => {
                assert_eq!(content.len(), 1);
                match &content[0] {
                    ContentBlock::Text { text } => assert_eq!(text, "hi"),
                    _ => panic!("wrong block"),
                }
            }
            _ => panic!("wrong variant"),
        }
    }
}
