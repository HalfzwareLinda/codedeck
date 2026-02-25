use tauri::{AppHandle, Runtime};

use crate::models::{AvailabilityResponse, PermissionResponse};

pub struct SpeechRecognizer<R: Runtime>(AppHandle<R>);

impl<R: Runtime> SpeechRecognizer<R> {
    pub fn is_available(&self) -> Result<AvailabilityResponse, String> {
        Ok(AvailabilityResponse { available: false })
    }

    pub fn start_listening(&self, _language: Option<String>) -> Result<(), String> {
        Err("Speech recognition is not available on desktop".into())
    }

    pub fn stop_listening(&self) -> Result<(), String> {
        Err("Speech recognition is not available on desktop".into())
    }

    pub fn request_permission(&self) -> Result<PermissionResponse, String> {
        Ok(PermissionResponse { granted: false })
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<SpeechRecognizer<R>, Box<dyn std::error::Error>> {
    Ok(SpeechRecognizer(app.clone()))
}
