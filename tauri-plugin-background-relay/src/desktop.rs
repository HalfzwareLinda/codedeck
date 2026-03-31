use tauri::{AppHandle, Runtime};

use crate::models::ServiceStatusResponse;

pub struct BackgroundRelay<R: Runtime>(AppHandle<R>);

impl<R: Runtime> BackgroundRelay<R> {
    pub fn start_service(&self) -> Result<(), String> {
        // No-op on desktop — WebSockets survive backgrounding fine
        Ok(())
    }

    pub fn stop_service(&self) -> Result<(), String> {
        Ok(())
    }

    pub fn is_running(&self) -> Result<ServiceStatusResponse, String> {
        Ok(ServiceStatusResponse { running: false })
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<BackgroundRelay<R>, Box<dyn std::error::Error>> {
    Ok(BackgroundRelay(app.clone()))
}
