// Force Cargo to recompile when frontend files change.
// Must be referenced inside run() so incremental compilation
// re-runs tauri::generate_context!() when index.html changes.
const _FRONTEND_TRACKER: &[u8] = include_bytes!("../../public/index.html");

use std::sync::Mutex;

struct PendingFile(Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = _FRONTEND_TRACKER;

    // Check command-line args for files opened via OS file association
    let pending = std::env::args().skip(1)
        .find(|a| !a.starts_with("--") && (a.contains('.') || std::path::Path::new(a).exists()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(PendingFile(Mutex::new(pending)))
        .invoke_handler(tauri::generate_handler![get_pending_file])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut f| f.take())
}
