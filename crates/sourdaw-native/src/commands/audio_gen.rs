use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

use crate::events::{EventSink, EventSinkExt};
use crate::host::sidecar::{SidecarEvent, SidecarHost, SidecarProcess};

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
    child: Arc<Mutex<Option<Box<dyn SidecarProcess>>>>,
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
pub async fn start_audio_gen_sidecar(
    sidecar: Arc<dyn SidecarHost>,
    events: Arc<dyn EventSink>,
    state: &AudioGenState,
) -> Result<(), String> {
    if *state.running.lock().await {
        return Ok(());
    }

    let model_dir = model_download::model_dir()?;
    let (mut rx, child) = sidecar.spawn_audio_generation(&model_dir)?;

    *state.child.lock().await = Some(child);
    *state.running.lock().await = true;

    let pending = state.pending.clone();
    let running = state.running.clone();

    // Background task: read stdout/stderr, dispatch to pending requests
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                SidecarEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                    if line.is_empty() {
                        continue;
                    }

                    match serde_json::from_str::<SidecarMessage>(&line) {
                        Ok(msg) => match msg.msg_type.as_str() {
                            "progress" => {
                                events.emit(
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
                                events.emit("audio-gen-status", &msg.msg_type);
                            }
                            _ => {}
                        },
                        Err(_) => {
                            eprintln!("[Audio Gen stdout] {line}");
                        }
                    }
                }
                SidecarEvent::Stderr(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    eprintln!("[Audio Gen stderr] {}", line.trim());
                }
                SidecarEvent::Terminated(code) => {
                    eprintln!("[Audio Gen] Sidecar terminated: code={:?}", code);
                    *running.lock().await = false;
                    events.emit("audio-gen-terminated", code);
                    break;
                }
            }
        }
    });

    Ok(())
}

/// Generate an audio clip. Auto-starts sidecar if not running.
/// Returns the path to the generated WAV file.
pub async fn generate_audio_clip(
    sidecar: Arc<dyn SidecarHost>,
    events: Arc<dyn EventSink>,
    prompt: String,
    bpm: Option<f32>,
    key: Option<String>,
    duration_bars: Option<u32>,
    duration_seconds: Option<f32>,
    state: &AudioGenState,
) -> Result<AudioGenResult, String> {
    // Auto-start sidecar if needed
    if !*state.running.lock().await {
        start_audio_gen_sidecar(Arc::clone(&sidecar), events, state).await?;
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
pub async fn stop_audio_gen_sidecar(state: &AudioGenState) -> Result<(), String> {
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
