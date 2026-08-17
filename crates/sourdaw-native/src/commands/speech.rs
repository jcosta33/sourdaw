use crate::events::{EventSink, EventSinkExt};
use audioadapter_buffers::direct::SequentialSliceOfVecs;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{
    Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::{filesystem, model_download};

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

const MAX_DICTATION_TEXT_UTF16_UNITS: usize = 32_768;

fn build_dictation_result(text: String, duration_ms: u64) -> Option<DictationResult> {
    if text.is_empty() {
        return None;
    }

    let text_units = text
        .encode_utf16()
        .take(MAX_DICTATION_TEXT_UTF16_UNITS + 1)
        .count();
    if text_units > MAX_DICTATION_TEXT_UTF16_UNITS {
        return None;
    }

    Some(DictationResult { text, duration_ms })
}

// ── Commands ────────────────────────────────────────────────────────────

/// Load a Whisper GGML model from disk. Call once on startup or
/// lazily before the first dictation session.
pub async fn load_whisper_model(
    model_path: String,
    state: &DictationState,
) -> Result<AsrStatus, String> {
    let model_path = filesystem::resolve_existing_file_path(&model_path)?;
    let model_path_str = model_path.to_string_lossy().to_string();
    let ctx = WhisperContext::new_with_params(&model_path_str, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

    let name = model_path
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
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin";
const WHISPER_MODEL_FILE: &str = "ggml-base.en.bin";
const WHISPER_MODEL_SHA256: &str =
    "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002";
const WHISPER_MODEL_SIZE_BYTES: u64 = 147_964_211;
const WHISPER_MODEL: model_download::ModelDownload = model_download::ModelDownload {
    filename: WHISPER_MODEL_FILE,
    url: WHISPER_MODEL_URL,
    expected_sha256: WHISPER_MODEL_SHA256,
    expected_size_bytes: WHISPER_MODEL_SIZE_BYTES,
};

/// Ensure the Whisper model is downloaded and loaded.
/// Auto-downloads `ggml-base.en.bin` (~142MB) from HuggingFace on first use.
pub async fn ensure_whisper_ready(state: &DictationState) -> Result<AsrStatus, String> {
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
    let model_path = model_download::ensure_model(&WHISPER_MODEL).await?;
    let model_path_str = model_path.to_string_lossy().to_string();

    // Load model
    let ctx = WhisperContext::new_with_params(&model_path_str, WhisperContextParameters::default())
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
pub async fn start_dictation(
    events: Arc<dyn EventSink>,
    state: &DictationState,
) -> Result<(), String> {
    let ctx = {
        let guard = state.ctx.lock().map_err(|e| format!("Lock error: {e}"))?;
        guard
            .clone()
            .ok_or("Whisper model not loaded. Call load_whisper_model first.")?
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
                        if let Some(result) = build_dictation_result(text, duration_ms) {
                            events.emit("dictation-result", result);
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
pub fn stop_dictation(state: &DictationState) -> Result<(), String> {
    state.stop_flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// Check the current ASR engine status.
pub async fn get_asr_status(state: &DictationState) -> Result<AsrStatus, String> {
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
    let device = host.default_input_device().ok_or("No microphone found")?;

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get mic config: {e}"))?;

    let sample_rate = config.sample_rate();
    let channels = config.channels();
    let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(
        sample_rate as usize * 15 * channels as usize,
    )));

    let buf_writer = buffer.clone();
    let stream = device
        .build_input_stream(
            config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = buf_writer.lock() {
                    buf.extend_from_slice(data);
                }
            },
            |e| eprintln!("[Dictation] Mic stream error: {e}"),
            None,
        )
        .map_err(|e| format!("Failed to build mic stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start mic: {e}"))?;

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
        f_cutoff: Some(0.95),
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = 16_000f64 / f64::from(src_rate);

    let mut resampler = Async::<f64>::new_sinc(ratio, 2.0, &params, 1024, 1, FixedAsync::Input)
        .map_err(|e| format!("Failed to create resampler: {e}"))?;

    let input_f64: Vec<f64> = input.iter().map(|&s| s as f64).collect();
    let frames = input_f64.len();
    let channels = [input_f64];
    let adapter = SequentialSliceOfVecs::new(&channels, 1, frames)
        .map_err(|e| format!("Resampler buffer error: {e}"))?;

    let resampled = resampler
        .process_all(&adapter, frames, None)
        .map_err(|e| format!("Resample error: {e}"))?;

    Ok(resampled.take_data().iter().map(|&s| s as f32).collect())
}

/// Run Whisper inference on 16 kHz mono f32 audio.
fn transcribe(ctx: &WhisperContext, audio: &[f32]) -> Result<String, String> {
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Whisper state error: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_timestamps(false);
    params.set_suppress_nst(true);

    state
        .full(params, audio)
        .map_err(|e| format!("Whisper inference error: {e}"))?;

    // Use the iterator API (whisper-rs v0.15+)
    let text: String = state
        .as_iter()
        .map(|segment| segment.to_string())
        .collect::<Vec<_>>()
        .join(" ");

    Ok(text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dictation_event_source_boundary_admits_only_bounded_final_text() {
        let result = build_dictation_result("hello world".to_string(), 1500).unwrap();
        assert_eq!(result.text, "hello world");
        assert_eq!(result.duration_ms, 1500);

        let exact_unicode_limit = "😀".repeat(16_384);
        assert!(build_dictation_result(exact_unicode_limit, 1501).is_some());
        assert!(build_dictation_result("x".repeat(32_769), 1502).is_none());
        assert!(build_dictation_result(format!("{}x", "😀".repeat(16_384)), 1503).is_none());
        assert!(build_dictation_result(String::new(), 1504).is_none());
    }
}
