use crate::session::TokenUsage;
use serde::{Deserialize, Serialize};

/// Anthropic API version — single constant instead of hardcoded string
pub const ANTHROPIC_API_VERSION: &str = "2023-06-01";

/// API request body for Anthropic Messages API.
#[derive(Debug, Serialize)]
pub struct ApiRequest {
    pub model: String,
    pub max_tokens: u32,
    pub stream: bool,
    pub system: String,
    pub messages: Vec<serde_json::Value>,
    pub tools: Vec<ToolDef>,
}

/// Tool definition sent to the API.
#[derive(Debug, Clone, Serialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Streamed SSE event types from Anthropic API.
#[derive(Debug, Deserialize)]
pub struct StreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[allow(dead_code)]
    pub index: Option<usize>,
    pub delta: Option<DeltaBlock>,
    pub content_block: Option<ContentBlockStart>,
    pub message: Option<MessageInfo>,
    pub usage: Option<UsageInfo>,
}

#[derive(Debug, Deserialize)]
pub struct DeltaBlock {
    #[allow(dead_code)]
    #[serde(rename = "type")]
    pub delta_type: Option<String>,
    pub text: Option<String>,
    pub partial_json: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ContentBlockStart {
    #[serde(rename = "type")]
    pub block_type: String,
    pub id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MessageInfo {
    pub usage: Option<UsageInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UsageInfo {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// Tracks cumulative token counts for a single API round.
/// The Anthropic API sends cumulative values, not deltas:
/// - `message_start` has the initial input token count
/// - `message_delta` has the final cumulative output token count
#[derive(Debug, Default)]
pub struct RoundUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl RoundUsage {
    pub fn set_from_message_start(&mut self, usage: &UsageInfo) {
        self.input_tokens = usage.input_tokens.unwrap_or(0);
        self.output_tokens = usage.output_tokens.unwrap_or(0);
    }

    pub fn set_output_from_message_delta(&mut self, usage: &UsageInfo) {
        if let Some(out) = usage.output_tokens {
            self.output_tokens = out;
        }
    }

    /// Apply this round's usage to the running total
    pub fn apply_to(&self, total: &mut TokenUsage, model: &str) {
        total.add(self.input_tokens, self.output_tokens, model);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_usage_default_is_zero() {
        let ru = RoundUsage::default();
        assert_eq!(ru.input_tokens, 0);
        assert_eq!(ru.output_tokens, 0);
    }

    #[test]
    fn round_usage_set_from_message_start() {
        let mut ru = RoundUsage::default();
        let usage = UsageInfo {
            input_tokens: Some(500),
            output_tokens: Some(10),
        };
        ru.set_from_message_start(&usage);
        assert_eq!(ru.input_tokens, 500);
        assert_eq!(ru.output_tokens, 10);
    }

    #[test]
    fn round_usage_set_from_message_start_handles_none() {
        let mut ru = RoundUsage::default();
        let usage = UsageInfo {
            input_tokens: None,
            output_tokens: None,
        };
        ru.set_from_message_start(&usage);
        assert_eq!(ru.input_tokens, 0);
        assert_eq!(ru.output_tokens, 0);
    }

    #[test]
    fn round_usage_set_output_from_delta() {
        let mut ru = RoundUsage {
            input_tokens: 500,
            output_tokens: 10,
        };
        let usage = UsageInfo {
            input_tokens: None,
            output_tokens: Some(200),
        };
        ru.set_output_from_message_delta(&usage);
        assert_eq!(ru.input_tokens, 500); // unchanged
        assert_eq!(ru.output_tokens, 200); // cumulative replacement
    }

    #[test]
    fn round_usage_apply_to_sonnet_pricing() {
        let ru = RoundUsage {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
        };
        let mut total = TokenUsage::default();
        ru.apply_to(&mut total, "claude-sonnet-4-20250514");
        assert_eq!(total.input_tokens, 1_000_000);
        assert_eq!(total.output_tokens, 1_000_000);
        // sonnet: $3/1M input + $15/1M output = $18
        assert!((total.total_cost_usd - 18.0).abs() < 0.01);
    }
}
