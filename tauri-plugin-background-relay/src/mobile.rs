use tauri::{
    plugin::{PluginHandle, PluginApi},
    AppHandle, Runtime,
};

use crate::models::ServiceStatusResponse;

pub struct BackgroundRelay<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> BackgroundRelay<R> {
    pub fn start_service(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("startService", ())
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn stop_service(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("stopService", ())
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn is_running(&self) -> Result<ServiceStatusResponse, String> {
        self.0
            .run_mobile_plugin::<ServiceStatusResponse>("isRunning", ())
            .map_err(|e| e.to_string())
    }
}

pub fn init<R: Runtime>(
    _app: &AppHandle<R>,
    api: PluginApi<R, ()>,
) -> Result<BackgroundRelay<R>, Box<dyn std::error::Error>> {
    let handle = api.register_android_plugin("com.codedeck.backgroundrelay", "BackgroundRelayPlugin")?;
    Ok(BackgroundRelay(handle))
}
