use serde::{Serialize, Deserialize};
use crate::session::AgentMode;

/// Non-secret configuration, stored as plaintext JSON on disk.
/// Secret fields (API keys) are stored in Stronghold encrypted storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub github_username: Option<String>,
    pub default_mode: AgentMode,
    #[serde(default = "default_effort")]
    pub default_effort: String,
    pub auto_push_on_complete: bool,
    pub notifications_enabled: bool,
    pub workspace_base_path: String,
    pub max_sessions: u32,
    pub model: String,
}

fn default_effort() -> String {
    "auto".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            github_username: None,
            default_mode: AgentMode::Plan,
            default_effort: "auto".to_string(),
            auto_push_on_complete: true,
            notifications_enabled: true,
            workspace_base_path: String::new(),
            max_sessions: 20,
            model: "claude-sonnet-4-20250514".to_string(),
        }
    }
}

/// Full config as seen by the frontend (includes secrets in transit over IPC).
/// Secrets are populated from Stronghold on read, saved to Stronghold on write.
/// This struct has the same JSON shape as the old AppConfig, so the frontend
/// TypeScript interface requires no changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullConfig {
    pub anthropic_api_key: Option<String>,
    pub github_pat: Option<String>,
    pub github_username: Option<String>,
    pub default_mode: AgentMode,
    #[serde(default = "default_effort")]
    pub default_effort: String,
    pub auto_push_on_complete: bool,
    pub notifications_enabled: bool,
    pub workspace_base_path: String,
    pub max_sessions: u32,
    pub model: String,
}

impl FullConfig {
    /// Merge non-secret config with secrets from Stronghold
    pub fn from_config_and_secrets(
        config: &AppConfig,
        api_key: Option<String>,
        pat: Option<String>,
    ) -> Self {
        Self {
            anthropic_api_key: api_key,
            github_pat: pat,
            github_username: config.github_username.clone(),
            default_mode: config.default_mode.clone(),
            default_effort: config.default_effort.clone(),
            auto_push_on_complete: config.auto_push_on_complete,
            notifications_enabled: config.notifications_enabled,
            workspace_base_path: config.workspace_base_path.clone(),
            max_sessions: config.max_sessions,
            model: config.model.clone(),
        }
    }

    /// Extract non-secret config (for JSON persistence)
    pub fn to_app_config(&self) -> AppConfig {
        AppConfig {
            github_username: self.github_username.clone(),
            default_mode: self.default_mode.clone(),
            default_effort: self.default_effort.clone(),
            auto_push_on_complete: self.auto_push_on_complete,
            notifications_enabled: self.notifications_enabled,
            workspace_base_path: self.workspace_base_path.clone(),
            max_sessions: self.max_sessions,
            model: self.model.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_config_roundtrip() {
        let config = AppConfig::default();
        let full = FullConfig::from_config_and_secrets(
            &config,
            Some("sk-ant-test".into()),
            Some("ghp_test".into()),
        );
        assert_eq!(full.anthropic_api_key, Some("sk-ant-test".into()));
        assert_eq!(full.github_pat, Some("ghp_test".into()));
        assert_eq!(full.model, "claude-sonnet-4-20250514");

        let back = full.to_app_config();
        assert_eq!(back.model, "claude-sonnet-4-20250514");
        // Secrets should not be in the non-secret config
        // (they don't exist on AppConfig at all)
    }

    #[test]
    fn full_config_with_no_secrets() {
        let config = AppConfig::default();
        let full = FullConfig::from_config_and_secrets(&config, None, None);
        assert!(full.anthropic_api_key.is_none());
        assert!(full.github_pat.is_none());
    }
}
