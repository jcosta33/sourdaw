use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{oneshot, Mutex};

use super::model_download;

// ── Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub command: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_bars: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub beats_per_bar: Option<u32>,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SidecarMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(rename = "requestId", default)]
    request_id: String,
    #[serde(default)]
    progress: f64,
    #[serde(rename = "wavPath", default)]
    wav_path: String,
    #[serde(default)]
    error: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    duration: f64,
    #[serde(rename = "sampleRate", default)]
    sample_rate: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioGenProgress {
    pub request_id: String,
    pub progress: f64,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioGenResult {
    pub wav_path: String,
    pub duration_seconds: f64,
    pub sample_rate: u32,
}

// ── Managed State ────────────────────────────────────────────────────────

pub struct AudioGenState {
    child: Arc<Mutex<Option<CommandChild>>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<AudioGenResult, String>>>>>,
    running: Arc<Mutex<bool>>,
}

impl Default for AudioGenState {
    fn default() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
        }
    }
}

// ── Commands ─────────────────────────────────────────────────────────────

/// Start the audio generation sidecar process.
/// The sidecar is a bundled Python binary that runs Stable Audio Open.
#[tauri::command]
pub async fn start_audio_gen_sidecar(app: AppHandle) -> Result<(), String> {
    let state: tauri::State<'_, AudioGenState> = app.state();

    if *state.running.lock().await {
        return Ok(());
    }

    let model_dir = model_download::model_dir()?;

    // Try bundled sidecar first, fall back to PATH
    let sidecar_result = app
        .shell()
        .sidecar("audio-sidecar")
        .map_err(|e| format!("Sidecar setup: {e}"))
        .and_then(|cmd| {
            cmd.args(["--model-dir", model_dir.to_str().unwrap_or("/tmp")])
                .spawn()
                .map_err(|e| format!("Sidecar spawn: {e}"))
        });

    let (mut rx, child) = match sidecar_result {
        Ok(result) => {
            eprintln!("[Audio Gen] Started bundled sidecar");
            result
        }
        Err(_) => {
            // Fall back to running the Python script directly
            eprintln!("[Audio Gen] Bundled sidecar not found, trying Python script...");
            let sidecar_dir = std::env::current_dir().unwrap_or_default().join("sidecar");
            let script_path = sidecar_dir.join("audio_gen.py");

            app.shell()
                .command("python3")
                .args([
                    script_path.to_str().unwrap_or("sidecar/audio_gen.py"),
                    "--model-dir",
                    model_dir.to_str().unwrap_or("/tmp"),
                ])
                .spawn()
                .map_err(|e| {
                    format!(
                        "Audio generation sidecar not available. \
                         Install Python 3 and run: pip install -r sidecar/requirements.txt. Error: {e}"
                    )
                })?
        }
    };

    *state.child.lock().await = Some(child);
    *state.running.lock().await = true;

    let pending = state.pending.clone();
    let running = state.running.clone();
    let app_handle = app.clone();

    // Background task: read stdout/stderr, dispatch to pending requests
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                    if line.is_empty() {
                        continue;
                    }

                    match serde_json::from_str::<SidecarMessage>(&line) {
                        Ok(msg) => match msg.msg_type.as_str() {
                            "progress" => {
                                let _ = app_handle.emit(
                                    "audio-gen-progress",
                                    AudioGenProgress {
                                        request_id: msg.request_id,
                                        progress: msg.progress,
                                        message: msg.message,
                                    },
                                );
                            }
                            "result" => {
                                let mut map = pending.lock().await;
                                if let Some(tx) = map.remove(&msg.request_id) {
                                    let _ = tx.send(Ok(AudioGenResult {
                                        wav_path: msg.wav_path,
                                        duration_seconds: msg.duration,
                                        sample_rate: msg.sample_rate,
                                    }));
                                }
                            }
                            "error" => {
                                let mut map = pending.lock().await;
                                if let Some(tx) = map.remove(&msg.request_id) {
                                    let _ = tx.send(Err(msg.error));
                                }
                            }
                            "ready" | "loaded" => {
                                eprintln!("[Audio Gen] Sidecar: {}", msg.msg_type);
                                let _ = app_handle.emit("audio-gen-status", &msg.msg_type);
                            }
                            _ => {}
                        },
                        Err(_) => {
                            eprintln!("[Audio Gen stdout] {line}");
                        }
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprintln!("[Audio Gen stderr] {}", line.trim());
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[Audio Gen] Sidecar terminated: code={:?}", payload.code);
                    *running.lock().await = false;
                    let _ = app_handle.emit("audio-gen-terminated", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Generate an audio clip. Auto-starts sidecar if not running.
/// Returns the path to the generated WAV file.
#[tauri::command]
pub async fn generate_audio_clip(
    app: AppHandle,
    prompt: String,
    bpm: Option<f32>,
    key: Option<String>,
    duration_bars: Option<u32>,
    duration_seconds: Option<f32>,
) -> Result<AudioGenResult, String> {
    let state: tauri::State<'_, AudioGenState> = app.state();

    // Auto-start sidecar if needed
    if !*state.running.lock().await {
        start_audio_gen_sidecar(app.clone()).await?;
        // Wait for the "ready" message
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let request_id = uuid::Uuid::new_v4().to_string();
    let output_dir = model_download::model_dir()?
        .parent()
        .unwrap_or(std::path::Path::new("/tmp"))
        .join("generated");
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir: {e}"))?;

    let request = GenerateRequest {
        command: "generate".into(),
        request_id: request_id.clone(),
        prompt,
        bpm,
        key,
        duration_bars,
        duration_seconds,
        beats_per_bar: Some(4),
        output_dir: output_dir.to_string_lossy().into_owned(),
    };

    let (tx, rx) = oneshot::channel();
    state.pending.lock().await.insert(request_id.clone(), tx);

    // Write JSON request to sidecar stdin
    {
        let mut child_lock = state.child.lock().await;
        let child = child_lock
            .as_mut()
            .ok_or("Audio generation sidecar not running")?;
        let msg = serde_json::to_string(&request).map_err(|e| e.to_string())? + "\n";
        child
            .write(msg.as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {e}"))?;
    }

    // Await response with timeout
    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Response channel dropped".into()),
        Err(_) => {
            state.pending.lock().await.remove(&request_id);
            Err("Audio generation timed out after 120 seconds".into())
        }
    }
}

/// Stop the audio generation sidecar.
#[tauri::command]
pub async fn stop_audio_gen_sidecar(state: tauri::State<'_, AudioGenState>) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if let Some(ref mut child) = *guard {
        let _ = child.write(b"{\"command\":\"quit\"}\n");
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
    *state.running.lock().await = false;
    eprintln!("[Audio Gen] Sidecar stopped");
    Ok(())
}
