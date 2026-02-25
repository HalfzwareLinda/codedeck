const COMMANDS: &[&str] = &["start_listening", "stop_listening", "is_available", "request_permission"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
