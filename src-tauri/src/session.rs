use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use std::collections::HashMap;
use anyhow::Result;
use crate::config::AppConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub group: String,
    pub repo_url: String,
    pub branch: String,
    pub workspace_path: String,
    pub state: SessionState,
    pub mode: AgentMode,
    pub created_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub pending_permissions: Vec<PermissionRequest>,
    pub git_sync_status: GitSyncStatus,
    pub token_usage: TokenUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_cost_usd: f64,
}

impl TokenUsage {
    pub fn add(&mut self, input: u64, output: u64, model: &str) {
        self.input_tokens += input;
        self.output_tokens += output;
        // Approximate pricing per 1M tokens
        let (input_rate, output_rate) = match model {
            m if m.contains("opus") => (15.0, 75.0),
            m if m.contains("sonnet") => (3.0, 15.0),
            m if m.contains("haiku") => (0.80, 4.0),
            _ => (3.0, 15.0), // default to sonnet pricing
        };
        self.total_cost_usd += (input as f64 / 1_000_000.0) * input_rate
            + (output as f64 / 1_000_000.0) * output_rate;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Idle,
    Running,
    WaitingPermission,
    Completed,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    Plan,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub id: String,
    pub tool_type: String,
    pub description: String,
    pub command: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputEntry {
    pub entry_type: OutputType,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputType {
    Action,
    Diff,
    Message,
    Error,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitSyncStatus {
    Synced,
    PendingPush,
    PushFailed(String),
    NeverPushed,
}

/// Stored conversation for persistence
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConversationHistory {
    pub messages: Vec<serde_json::Value>,
}

pub struct SessionManager {
    pub sessions: Vec<Session>,
    pub config: AppConfig,
    data_dir: PathBuf,
    /// Permission response channels: request_id -> oneshot sender
    pub permission_senders: HashMap<String, tokio::sync::oneshot::Sender<bool>>,
}

impl SessionManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            sessions: Vec::new(),
            config: AppConfig::default(),
            data_dir,
            permission_senders: HashMap::new(),
        }
    }

    #[allow(dead_code)]
    pub fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }

    pub fn load(data_dir: PathBuf) -> Result<Self> {
        let sessions_path = data_dir.join("sessions.json");
        let config_path = data_dir.join("config.json");

        let sessions = if sessions_path.exists() {
            let data = std::fs::read_to_string(&sessions_path)?;
            serde_json::from_str(&data)?
        } else {
            Vec::new()
        };

        let config = if config_path.exists() {
            let data = std::fs::read_to_string(&config_path)?;
            serde_json::from_str(&data)?
        } else {
            AppConfig::default()
        };

        Ok(Self {
            sessions,
            config,
            data_dir,
            permission_senders: HashMap::new(),
        })
    }

    pub fn save(&self) -> Result<()> {
        let sessions_path = self.data_dir.join("sessions.json");
        let data = serde_json::to_string_pretty(&self.sessions)?;
        std::fs::write(sessions_path, data)?;
        Ok(())
    }

    pub fn save_config(&self) -> Result<()> {
        let config_path = self.data_dir.join("config.json");
        let data = serde_json::to_string_pretty(&self.config)?;
        std::fs::write(config_path, data)?;
        Ok(())
    }

    pub fn save_conversation(&self, session_id: &str, history: &ConversationHistory) -> Result<()> {
        let history_dir = self.data_dir.join("history");
        std::fs::create_dir_all(&history_dir)?;
        let path = history_dir.join(format!("{}.json", session_id));
        let data = serde_json::to_string_pretty(history)?;
        std::fs::write(path, data)?;
        Ok(())
    }

    pub fn load_conversation(&self, session_id: &str) -> Result<ConversationHistory> {
        let path = self.data_dir.join("history").join(format!("{}.json", session_id));
        if path.exists() {
            let data = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&data)?)
        } else {
            Ok(ConversationHistory::default())
        }
    }

    pub fn create_session(
        &mut self,
        name: String,
        group: String,
        repo_url: String,
        branch: String,
    ) -> Result<Session> {
        let id = uuid::Uuid::new_v4().to_string();
        let workspace_path = self.data_dir
            .join("workspaces")
            .join(&id)
            .to_string_lossy()
            .to_string();
        std::fs::create_dir_all(&workspace_path)?;

        let session = Session {
            id,
            name,
            group,
            repo_url,
            branch,
            workspace_path,
            state: SessionState::Idle,
            mode: self.config.default_mode.clone(),
            created_at: Utc::now(),
            last_activity: Utc::now(),
            pending_permissions: Vec::new(),
            git_sync_status: GitSyncStatus::NeverPushed,
            token_usage: TokenUsage::default(),
        };

        self.sessions.push(session.clone());
        self.save()?;
        Ok(session)
    }

    pub fn delete_session(&mut self, session_id: &str) -> Result<()> {
        if let Some(pos) = self.sessions.iter().position(|s| s.id == session_id) {
            let session = self.sessions.remove(pos);
            let path = std::path::Path::new(&session.workspace_path);
            if path.exists() {
                std::fs::remove_dir_all(path).ok();
            }
            // Also remove conversation history
            let history_path = self.data_dir.join("history").join(format!("{}.json", session_id));
            if history_path.exists() {
                std::fs::remove_file(history_path).ok();
            }
        }
        self.save()?;
        Ok(())
    }
}
