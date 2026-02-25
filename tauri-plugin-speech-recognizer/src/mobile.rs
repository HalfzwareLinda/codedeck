use tauri::{
    plugin::{PluginHandle, PluginApi},
    AppHandle, Runtime,
};

use crate::models::{AvailabilityResponse, PermissionResponse, StartListeningRequest};

pub struct SpeechRecognizer<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> SpeechRecognizer<R> {
    pub fn is_available(&self) -> Result<AvailabilityResponse, String> {
        self.0
            .run_mobile_plugin::<AvailabilityResponse>("isAvailable", ())
            .map_err(|e| e.to_string())
    }

    pub fn start_listening(&self, language: Option<String>) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("startListening", StartListeningRequest { language })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn stop_listening(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("stopListening", ())
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn request_permission(&self) -> Result<PermissionResponse, String> {
        self.0
            .run_mobile_plugin::<PermissionResponse>("requestPermission", ())
            .map_err(|e| e.to_string())
    }
}

pub fn init<R: Runtime>(
    _app: &AppHandle<R>,
    api: PluginApi<R, ()>,
) -> Result<SpeechRecognizer<R>, Box<dyn std::error::Error>> {
    let handle = api.register_android_plugin("com.codedeck.speechrecognizer", "SpeechRecognizerPlugin")?;
    Ok(SpeechRecognizer(handle))
}
