use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::model_download;

// ── Managed state ───────────────────────────────────────────────────────

pub struct DictationState {
    ctx: Mutex<Option<Arc<WhisperContext>>>,
    stop_flag: Arc<AtomicBool>,
}

impl Default for DictationState {
    fn default() -> Self {
        Self {
            ctx: Mutex::new(None),
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }
}

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct AsrStatus {
    pub loaded: bool,
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DictationResult {
    pub text: String,
    pub duration_ms: u64,
}

// ── Commands ────────────────────────────────────────────────────────────

/// Load a Whisper GGML model from disk. Call once on startup or
/// lazily before the first dictation session.
#[tauri::command]
pub async fn load_whisper_model(
    model_path: String,
    state: tauri::State<'_, DictationState>,
) -> Result<AsrStatus, String> {
    let ctx = WhisperContext::new_with_params(
        &model_path,
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

    let name = std::path::Path::new(&model_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut guard = state.ctx.lock().map_err(|e| format!("Lock error: {e}"))?;
    *guard = Some(Arc::new(ctx));

    Ok(AsrStatus {
        loaded: true,
        model_name: Some(name),
    })
}

const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const WHISPER_MODEL_FILE: &str = "ggml-base.en.bin";

/// Ensure the Whisper model is downloaded and loaded.
/// Auto-downloads `ggml-base.en.bin` (~142MB) from HuggingFace on first use.
#[tauri::command]
pub async fn ensure_whisper_ready(
    state: tauri::State<'_, DictationState>,
) -> Result<AsrStatus, String> {
    // Check if already loaded
    {
        let guard = state.ctx.lock().map_err(|e| format!("Lock error: {e}"))?;
        if guard.is_some() {
            return Ok(AsrStatus {
                loaded: true,
                model_name: Some(WHISPER_MODEL_FILE.to_string()),
            });
        }
    }

    // Download model if needed
    let model_path = model_download::ensure_model(WHISPER_MODEL_FILE, WHISPER_MODEL_URL, None).await?;
    let model_path_str = model_path.to_string_lossy().to_string();

    // Load model
    let ctx = WhisperContext::new_with_params(
        &model_path_str,
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

    let mut guard = state.ctx.lock().map_err(|e| format!("Lock error: {e}"))?;
    *guard = Some(Arc::new(ctx));

    eprintln!("[Whisper] Model loaded: {}", WHISPER_MODEL_FILE);

    Ok(AsrStatus {
        loaded: true,
        model_name: Some(WHISPER_MODEL_FILE.to_string()),
    })
}

/// Start push-to-talk dictation.
///
/// Captures audio from the default microphone, records until `stop_dictation`
/// is called (or a 15-second safety timeout), resamples to 16 kHz mono,
/// runs Whisper inference, and emits a `dictation-result` event.
#[tauri::command]
pub async fn start_dictation(
    app: AppHandle,
    state: tauri::State<'_, DictationState>,
) -> Result<(), String> {
    let ctx = {
        let guard = state.ctx.lock().map_err(|e| format!("Lock error: {e}"))?;
        guard.clone().ok_or("Whisper model not loaded. Call load_whisper_model first.")?
    };

    // Reset stop flag
    state.stop_flag.store(false, Ordering::SeqCst);
    let stop = state.stop_flag.clone();

    tokio::task::spawn_blocking(move || {
        let record_result = record_mic(&stop);
        match record_result {
            Ok((samples, sample_rate, channels)) => {
                let start = std::time::Instant::now();

                // Convert to mono if stereo
                let mono = if channels > 1 {
                    to_mono(&samples, channels as usize)
                } else {
                    samples
                };

                // Resample to 16kHz
                let audio_16k = if sample_rate != 16000 {
                    match resample_to_16k(&mono, sample_rate) {
                        Ok(resampled) => resampled,
                        Err(e) => {
                            eprintln!("[Dictation] Resample error: {e}");
                            return;
                        }
                    }
                } else {
                    mono
                };

                // Run Whisper inference
                match transcribe(&ctx, &audio_16k) {
                    Ok(text) => {
                        let duration_ms = start.elapsed().as_millis() as u64;
                        if !text.is_empty() {
                            let _ = app.emit("dictation-result", DictationResult {
                                text,
                                duration_ms,
                            });
                        }
                    }
                    Err(e) => eprintln!("[Dictation] Transcription error: {e}"),
                }
            }
            Err(e) => eprintln!("[Dictation] Recording error: {e}"),
        }
    });

    Ok(())
}

/// Stop the current dictation recording.
#[tauri::command]
pub fn stop_dictation(
    state: tauri::State<'_, DictationState>,
) -> Result<(), String> {
    state.stop_flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// Check the current ASR engine status.
#[tauri::command]
pub async fn get_asr_status(
    state: tauri::State<'_, DictationState>,
) -> Result<AsrStatus, String> {
    let guard = state.ctx.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(AsrStatus {
        loaded: guard.is_some(),
        model_name: if guard.is_some() {
            Some("whisper".to_string())
        } else {
            None
        },
    })
}

// ── Internal helpers ────────────────────────────────────────────────────

/// Record audio from the default input device until the stop flag is set
/// or 15 seconds elapse. Returns (samples, sample_rate, channels).
fn record_mic(stop: &AtomicBool) -> Result<(Vec<f32>, u32, u16), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No microphone found")?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get mic config: {e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(
        sample_rate as usize * 15 * channels as usize,
    )));

    let buf_writer = buffer.clone();
    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = buf_writer.lock() {
                    buf.extend_from_slice(data);
                }
            },
            |e| eprintln!("[Dictation] Mic stream error: {e}"),
            None,
        )
        .map_err(|e| format!("Failed to build mic stream: {e}"))?;

    stream.play().map_err(|e| format!("Failed to start mic: {e}"))?;

    // Poll the stop flag every 50ms, up to 15 seconds
    let max_iters = 15_000 / 50;
    for _ in 0..max_iters {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    drop(stream);

    let samples = buffer
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .clone();

    Ok((samples, sample_rate, channels))
}

/// Convert interleaved multi-channel audio to mono by averaging channels.
fn to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// Resample mono audio from `src_rate` to 16 kHz using rubato.
fn resample_to_16k(input: &[f32], src_rate: u32) -> Result<Vec<f32>, String> {
    if input.is_empty() {
        return Ok(vec![]);
    }

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = 16_000f64 / f64::from(src_rate);
    let chunk_size = 1024;

    let mut resampler = SincFixedIn::<f64>::new(
        ratio,
        2.0,
        params,
        chunk_size,
        1, // mono
    )
    .map_err(|e| format!("Failed to create resampler: {e}"))?;

    let mut output = Vec::with_capacity((input.len() as f64 * ratio) as usize + 1024);

    // Process in chunks
    let mut pos = 0;
    while pos < input.len() {
        let end = (pos + chunk_size).min(input.len());
        let mut chunk: Vec<f64> = input[pos..end].iter().map(|&s| s as f64).collect();

        // Pad last chunk if needed
        if chunk.len() < chunk_size {
            chunk.resize(chunk_size, 0.0);
        }

        let waves_in = vec![chunk];
        match resampler.process(&waves_in, None) {
            Ok(waves_out) => {
                for &s in &waves_out[0] {
                    output.push(s as f32);
                }
            }
            Err(e) => return Err(format!("Resample error: {e}")),
        }

        pos += chunk_size;
    }

    Ok(output)
}

/// Run Whisper inference on 16 kHz mono f32 audio.
fn transcribe(ctx: &WhisperContext, audio: &[f32]) -> Result<String, String> {
    let mut state = ctx.create_state().map_err(|e| format!("Whisper state error: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_timestamps(false);
    params.set_suppress_nst(true);

    state.full(params, audio).map_err(|e| format!("Whisper inference error: {e}"))?;

    // Use the iterator API (whisper-rs v0.15+)
    let text: String = state
        .as_iter()
        .map(|segment| segment.to_string())
        .collect::<Vec<_>>()
        .join(" ");

    Ok(text.trim().to_string())
}
