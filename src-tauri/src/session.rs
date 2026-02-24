use serde::{Serialize, Deserialize};
use chrono::{DateTime, Utc};
use std::path::PathBuf;
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

pub struct SessionManager {
    pub sessions: Vec<Session>,
    pub config: AppConfig,
    data_dir: PathBuf,
}

impl SessionManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            sessions: Vec::new(),
            config: AppConfig::default(),
            data_dir,
        }
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

        Ok(Self { sessions, config, data_dir })
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

        // Create workspace directory
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
        };

        self.sessions.push(session.clone());
        self.save()?;
        Ok(session)
    }

    pub fn delete_session(&mut self, session_id: &str) -> Result<()> {
        if let Some(pos) = self.sessions.iter().position(|s| s.id == session_id) {
            let session = self.sessions.remove(pos);
            // Remove workspace directory
            let path = std::path::Path::new(&session.workspace_path);
            if path.exists() {
                std::fs::remove_dir_all(path).ok();
            }
        }
        self.save()?;
        Ok(())
    }

    pub fn respond_permission(
        &mut self,
        session_id: &str,
        request_id: &str,
        _allow: bool,
    ) -> Result<()> {
        if let Some(session) = self.sessions.iter_mut().find(|s| s.id == session_id) {
            session.pending_permissions.retain(|p| p.id != request_id);
            if session.pending_permissions.is_empty() {
                session.state = SessionState::Running;
            }
        }
        self.save()?;
        Ok(())
    }
}
