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
type SpeechRecognizerImpl<R> = mobile::SpeechRecognizer<R>;

#[cfg(not(mobile))]
type SpeechRecognizerImpl<R> = desktop::SpeechRecognizer<R>;

pub trait SpeechRecognizerExt<R: Runtime> {
    fn speech_recognizer(&self) -> &SpeechRecognizerImpl<R>;
}

impl<R: Runtime, T: Manager<R>> SpeechRecognizerExt<R> for T {
    fn speech_recognizer(&self) -> &SpeechRecognizerImpl<R> {
        self.state::<SpeechRecognizerImpl<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("speech-recognizer")
        .invoke_handler(tauri::generate_handler![
            commands::is_available,
            commands::start_listening,
            commands::stop_listening,
            commands::request_permission,
        ])
        .setup(|app, _api| {
            #[cfg(mobile)]
            {
                let sr = mobile::init(app, _api)?;
                app.manage(sr);
            }
            #[cfg(not(mobile))]
            {
                let sr = desktop::init(app)?;
                app.manage(sr);
            }
            Ok(())
        })
        .build()
}
