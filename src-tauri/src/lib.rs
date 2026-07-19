const _FRONTEND_TRACKER: &[u8] = include_bytes!("../../public/index.html");

use std::sync::Mutex;

struct PendingFile(Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = _FRONTEND_TRACKER;

    let pending = std::env::args().skip(1)
        .find(|a| !a.starts_with("--") && (a.contains('.') || std::path::Path::new(a).exists()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(PendingFile(Mutex::new(pending)))
        .invoke_handler(tauri::generate_handler![get_pending_file, http_request])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_pending_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut f| f.take())
}

#[derive(serde::Serialize)]
struct HttpResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
}

#[tauri::command]
fn http_request(url: String, method: Option<String>, headers: Option<Vec<(String, String)>>, body: Option<String>) -> Result<HttpResponse, String> {
    let method = method.as_deref().unwrap_or("GET");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(60))
        .build();
    let mut req = match method {
        "POST" => agent.post(&url),
        "PUT" => agent.put(&url),
        "DELETE" => agent.delete(&url),
        "PATCH" => agent.patch(&url),
        _ => agent.get(&url),
    };
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.set(&k, &v);
        }
    }
    let res = if let Some(b) = body {
        req.send_string(&b).map_err(|e| format!("请求失败: {}", e))?
    } else {
        req.call().map_err(|e| format!("请求失败: {}", e))?
    };
    let status = res.status();
    let status_text = res.status_text().to_string();
    let response_headers: Vec<(String, String)> = res.headers_names().iter()
        .map(|n| (n.clone(), res.header(n).unwrap_or("").to_string()))
        .collect();
    let body = res.into_string().map_err(|e| format!("读取响应失败: {}", e))?;
    Ok(HttpResponse { status, status_text, headers: response_headers, body })
}
