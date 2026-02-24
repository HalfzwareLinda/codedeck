use serde::{Serialize, Deserialize};
use crate::session::AgentMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub anthropic_api_key: Option<String>,
    pub github_pat: Option<String>,
    pub github_username: Option<String>,
    pub default_mode: AgentMode,
    pub auto_push_on_complete: bool,
    pub notifications_enabled: bool,
    pub workspace_base_path: String,
    pub max_sessions: u32,
    pub model: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            anthropic_api_key: None,
            github_pat: None,
            github_username: None,
            default_mode: AgentMode::Plan,
            auto_push_on_complete: true,
            notifications_enabled: true,
            workspace_base_path: String::new(),
            max_sessions: 20,
            model: "claude-sonnet-4-20250514".to_string(),
        }
    }
}
