mod commands;
mod models;

#[cfg(mobile)]
mod mobile;

#[cfg(not(mobile))]
mod desktop;

pub use models::*;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(mobile)]
type BackgroundRelayImpl<R> = mobile::BackgroundRelay<R>;

#[cfg(not(mobile))]
type BackgroundRelayImpl<R> = desktop::BackgroundRelay<R>;

pub trait BackgroundRelayExt<R: Runtime> {
    fn background_relay(&self) -> &BackgroundRelayImpl<R>;
}

impl<R: Runtime, T: Manager<R>> BackgroundRelayExt<R> for T {
    fn background_relay(&self) -> &BackgroundRelayImpl<R> {
        self.state::<BackgroundRelayImpl<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("background-relay")
        .invoke_handler(tauri::generate_handler![
            commands::start_service,
            commands::stop_service,
            commands::is_running,
        ])
        .setup(|app, _api| {
            #[cfg(mobile)]
            {
                let br = mobile::init(app, _api)?;
                app.manage(br);
            }
            #[cfg(not(mobile))]
            {
                let br = desktop::init(app)?;
                app.manage(br);
            }
            Ok(())
        })
        .build()
}
