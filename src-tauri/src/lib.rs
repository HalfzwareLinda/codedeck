mod session;
mod agent;
mod config;

use session::{SessionManager, SessionState, AgentMode};
use config::AppConfig;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{Manager, Emitter};

type SharedSessionManager = Arc<Mutex<SessionManager>>;

#[tauri::command]
async fn get_sessions(
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<Vec<session::Session>, String> {
    let mgr = manager.lock().await;
    Ok(mgr.sessions.clone())
}

#[tauri::command]
async fn create_session(
    name: String,
    group: String,
    repo_url: String,
    branch: String,
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<session::Session, String> {
    let mut mgr = manager.lock().await;
    mgr.create_session(name, group, repo_url, branch)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_session(
    session_id: String,
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.delete_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_message(
    session_id: String,
    text: String,
    app: tauri::AppHandle,
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<(), String> {
    let api_key = {
        let mgr = manager.lock().await;
        mgr.config.anthropic_api_key.clone()
    };

    let api_key = match api_key {
        Some(key) if !key.is_empty() => key,
        _ => {
            let entry = session::OutputEntry {
                entry_type: session::OutputType::Error,
                content: "No Anthropic API key configured. Go to Settings to add one.".into(),
                timestamp: chrono::Utc::now(),
                metadata: None,
            };
            let _ = app.emit("session-output", serde_json::json!({
                "session_id": session_id,
                "entry": entry,
            }));
            return Ok(());
        }
    };

    let model = {
        let mgr = manager.lock().await;
        mgr.config.model.clone()
    };

    let workspace_path = {
        let mgr = manager.lock().await;
        mgr.sessions.iter()
            .find(|s| s.id == session_id)
            .map(|s| s.workspace_path.clone())
            .unwrap_or_default()
    };

    let mode = {
        let mgr = manager.lock().await;
        mgr.sessions.iter()
            .find(|s| s.id == session_id)
            .map(|s| s.mode.clone())
            .unwrap_or(AgentMode::Plan)
    };

    // Update state to running
    {
        let mut mgr = manager.lock().await;
        if let Some(s) = mgr.sessions.iter_mut().find(|s| s.id == session_id) {
            s.state = SessionState::Running;
            let session_clone = s.clone();
            let _ = app.emit("session-state", serde_json::json!({
                "session_id": session_id,
                "state": "running",
                "session": session_clone,
            }));
        }
    }

    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    let manager_inner = manager.inner().clone();

    tokio::spawn(async move {
        let result = agent::run_agent(
            &session_id_clone,
            text,
            &api_key,
            &model,
            &workspace_path,
            &mode,
            &app_clone,
        ).await;

        let mut mgr = manager_inner.lock().await;
        if let Some(s) = mgr.sessions.iter_mut().find(|s| s.id == session_id_clone) {
            match result {
                Ok(()) => s.state = SessionState::Completed,
                Err(e) => s.state = SessionState::Error(e.to_string()),
            }
            let session_clone = s.clone();
            let _ = app_clone.emit("session-state", serde_json::json!({
                "session_id": session_id_clone,
                "state": format!("{:?}", session_clone.state),
                "session": session_clone,
            }));
        }
        let _ = mgr.save();
    });

    Ok(())
}

#[tauri::command]
async fn respond_permission(
    session_id: String,
    request_id: String,
    allow: bool,
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.respond_permission(&session_id, &request_id, allow)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_mode(
    session_id: String,
    mode: AgentMode,
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    if let Some(s) = mgr.sessions.iter_mut().find(|s| s.id == session_id) {
        s.mode = mode;
    }
    mgr.save().map_err(|e| e.to_string())
}

#[tauri::command]
async fn git_push(session_id: String) -> Result<String, String> {
    // Stub - will be implemented with GitHub API
    Ok(format!("Push not yet implemented for session {}", session_id))
}

#[tauri::command]
async fn git_pull(session_id: String) -> Result<String, String> {
    // Stub
    Ok(format!("Pull not yet implemented for session {}", session_id))
}

#[tauri::command]
async fn get_config(
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<AppConfig, String> {
    let mgr = manager.lock().await;
    Ok(mgr.config.clone())
}

#[tauri::command]
async fn update_config(
    config: AppConfig,
    manager: tauri::State<'_, SharedSessionManager>,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.config = config;
    mgr.save_config().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("failed to get data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let manager = SessionManager::load(data_dir.clone()).unwrap_or_else(|e| {
                eprintln!("Failed to load sessions: {}", e);
                SessionManager::new(data_dir)
            });
            app.manage(Arc::new(Mutex::new(manager)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            create_session,
            delete_session,
            send_message,
            respond_permission,
            set_mode,
            git_push,
            git_pull,
            get_config,
            update_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodeDeck");
}
