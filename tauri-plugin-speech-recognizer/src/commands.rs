use tauri::{AppHandle, Runtime};

use crate::models::{AvailabilityResponse, PermissionResponse};
use crate::SpeechRecognizerExt;

#[tauri::command]
pub async fn is_available<R: Runtime>(app: AppHandle<R>) -> Result<AvailabilityResponse, String> {
    app.speech_recognizer().is_available()
}

#[tauri::command]
pub async fn start_listening<R: Runtime>(
    app: AppHandle<R>,
    language: Option<String>,
) -> Result<(), String> {
    app.speech_recognizer().start_listening(language)
}

#[tauri::command]
pub async fn stop_listening<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.speech_recognizer().stop_listening()
}

#[tauri::command]
pub async fn request_permission<R: Runtime>(app: AppHandle<R>) -> Result<PermissionResponse, String> {
    app.speech_recognizer().request_permission()
}
