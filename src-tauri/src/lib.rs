// Force Cargo to recompile when frontend files change.
// Must be referenced inside run() so incremental compilation
// re-runs tauri::generate_context!() when index.html changes.
const _FRONTEND_TRACKER: &[u8] = include_bytes!("../../public/index.html");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = _FRONTEND_TRACKER;

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
