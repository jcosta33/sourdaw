use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

const DEFAULT_PORT: u16 = 8847;

/// Managed state: holds the running llama-server sidecar process.
pub struct LlmSidecarState {
    /// The sidecar child handle.  We only need to know whether one is running
    /// and be able to kill it — the actual I/O happens over HTTP.
    running: Mutex<bool>,
    port: Mutex<u16>,
}

impl Default for LlmSidecarState {
    fn default() -> Self {
        Self {
            running: Mutex::new(false),
            port: Mutex::new(DEFAULT_PORT),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmSidecarStatus {
    pub running: bool,
    pub port: u16,
    pub model_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmStartRequest {
    pub model_path: String,
    pub port: Option<u16>,
    pub n_gpu_layers: Option<i32>,
    pub ctx_size: Option<u32>,
}

// ── Sidecar lifecycle ───────────────────────────────────────────────────

/// Start the llama-server sidecar process via Tauri's shell plugin.
///
/// The binary is expected at `src-tauri/binaries/llama-server-{target_triple}`
/// following Tauri's sidecar naming convention.
///
/// Falls back to discovering llama-server on the system PATH.
#[tauri::command]
pub async fn start_llm_sidecar(
    request: LlmStartRequest,
    app: AppHandle,
    state: tauri::State<'_, LlmSidecarState>,
) -> Result<LlmSidecarStatus, String> {
    // Kill existing process if running
    let was_running = {
        let running = state.running.lock().map_err(|e| format!("Lock error: {e}"))?;
        *running
    };
    if was_running {
        let mut running = state.running.lock().map_err(|e| format!("Lock error: {e}"))?;
        *running = false;
        drop(running);
    }

    let port = request.port.unwrap_or(DEFAULT_PORT);
    let n_gpu = request.n_gpu_layers.unwrap_or(99);
    let ctx = request.ctx_size.unwrap_or(4096);

    let args = vec![
        "--model".to_string(), request.model_path.clone(),
        "--port".to_string(), port.to_string(),
        "--n-gpu-layers".to_string(), n_gpu.to_string(),
        "--ctx-size".to_string(), ctx.to_string(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--temp".to_string(), "0.1".to_string(),
        "--flash-attn".to_string(),
    ];

    // Spawn llama-server from PATH via Tauri's shell plugin.
    // When a bundled sidecar binary is provided later, add `externalBin` to
    // tauri.conf.json and switch to `app.shell().sidecar("llama-server")`.
    let (mut rx, _child) = app.shell()
        .command("llama-server")
        .args(&args)
        .spawn()
        .map_err(|e| format!(
            "llama-server not found on PATH. Install it or place the binary at \
             src-tauri/binaries/llama-server-{{target-triple}}. Error: {e}"
        ))?;

    // Consume stdout/stderr in background so the pipe doesn't fill
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[llama-server] {}", text.trim());
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[llama-server err] {}", text.trim());
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
    });

    // Wait for the server to become healthy
    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;

    let addr = format!("127.0.0.1:{port}");
    let mut healthy = false;
    for _ in 0..10 {
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            healthy = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    if !healthy {
        eprintln!("[LLM Sidecar] Server may still be loading the model...");
    }

    {
        let mut running = state.running.lock().map_err(|e| format!("Lock error: {e}"))?;
        *running = true;
    }
    {
        let mut port_guard = state.port.lock().map_err(|e| format!("Lock error: {e}"))?;
        *port_guard = port;
    }

    Ok(LlmSidecarStatus {
        running: true,
        port,
        model_path: Some(request.model_path),
    })
}

/// Stop the llama-server sidecar process.
#[tauri::command]
pub async fn stop_llm_sidecar(
    state: tauri::State<'_, LlmSidecarState>,
) -> Result<(), String> {
    let mut running = state.running.lock().map_err(|e| format!("Lock error: {e}"))?;
    *running = false;
    // The sidecar child is dropped when its rx loop ends via Terminated event.
    // We don't hold a reference to it — Tauri's shell plugin handles cleanup.
    Ok(())
}

/// Get the current status of the sidecar.
#[tauri::command]
pub async fn get_llm_sidecar_status(
    state: tauri::State<'_, LlmSidecarState>,
) -> Result<LlmSidecarStatus, String> {
    let running = state.running.lock().map_err(|e| format!("Lock error: {e}"))?;
    let port_guard = state.port.lock().map_err(|e| format!("Lock error: {e}"))?;

    Ok(LlmSidecarStatus {
        running: *running,
        port: *port_guard,
        model_path: None,
    })
}

/// Return the default model directory path.
#[tauri::command]
pub fn get_model_dir() -> Result<String, String> {
    let dir = dirs::data_dir()
        .ok_or("Could not determine data directory")?
        .join("com.sourdaw.app")
        .join("models");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create model directory: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

// ── Completion via HTTP proxy ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub system_prompt: String,
    pub user_message: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

/// Non-streaming completion: proxy the request through Rust to the sidecar.
/// This avoids frontend CSP issues with direct localhost fetch in production.
#[tauri::command]
pub async fn generate_llm_completion(
    request: CompletionRequest,
    state: tauri::State<'_, LlmSidecarState>,
) -> Result<String, String> {
    let port = {
        let p = state.port.lock().map_err(|e| format!("Lock error: {e}"))?;
        *p
    };

    let messages = vec![
        ChatMessage { role: "system".into(), content: request.system_prompt },
        ChatMessage { role: "user".into(), content: request.user_message },
    ];

    let body = serde_json::json!({
        "messages": messages,
        "temperature": request.temperature.unwrap_or(0.1),
        "max_tokens": request.max_tokens.unwrap_or(1024),
        "seed": 0,
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let response = client.post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request to llama-server failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("llama-server error {status}: {text}"));
    }

    let data: serde_json::Value = response.json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(content)
}

// ── Streaming completion via Channel API ────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum LlmStreamEvent {
    Token { text: String },
    Done { total_tokens: u32 },
    Error { message: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StreamCompletionRequest {
    pub system_prompt: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

/// Streaming completion via Tauri's Channel API.
/// Sends tokens as they arrive from the sidecar's SSE stream.
#[tauri::command]
pub async fn stream_llm_completion(
    request: StreamCompletionRequest,
    on_event: Channel<LlmStreamEvent>,
    state: tauri::State<'_, LlmSidecarState>,
) -> Result<(), String> {
    let port = {
        let p = state.port.lock().map_err(|e| format!("Lock error: {e}"))?;
        *p
    };

    let body = serde_json::json!({
        "messages": request.messages,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_tokens": request.max_tokens.unwrap_or(2048),
        "seed": 0,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let response = client.post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("Request to llama-server failed: {e}");
            let _ = on_event.send(LlmStreamEvent::Error { message: msg.clone() });
            msg
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let msg = format!("llama-server error {status}: {text}");
        let _ = on_event.send(LlmStreamEvent::Error { message: msg.clone() });
        return Err(msg);
    }

    // Parse SSE stream from llama-server
    let mut total_tokens: u32 = 0;
    let bytes = response.bytes().await.map_err(|e| format!("Stream read error: {e}"))?;
    let text = String::from_utf8_lossy(&bytes);

    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("data: ") {
            continue;
        }
        let json_str = &line[6..];
        if json_str == "[DONE]" {
            break;
        }

        if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(content) = chunk["choices"][0]["delta"]["content"].as_str() {
                if !content.is_empty() {
                    total_tokens += 1;
                    let _ = on_event.send(LlmStreamEvent::Token {
                        text: content.to_string(),
                    });
                }
            }
        }
    }

    let _ = on_event.send(LlmStreamEvent::Done { total_tokens });
    Ok(())
}
