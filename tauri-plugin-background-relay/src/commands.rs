use tauri::{AppHandle, Runtime};

use crate::models::ServiceStatusResponse;
use crate::BackgroundRelayExt;

#[tauri::command]
pub async fn start_service<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.background_relay().start_service()
}

#[tauri::command]
pub async fn stop_service<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.background_relay().stop_service()
}

#[tauri::command]
pub async fn is_running<R: Runtime>(app: AppHandle<R>) -> Result<ServiceStatusResponse, String> {
    app.background_relay().is_running()
}
