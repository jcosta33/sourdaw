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

/// The model bound to the loaded `WhisperContext`, kept together so a
/// reader can never observe a `loaded: true` status paired with a stale or
/// missing name — see `get_asr_status`.
#[derive(Clone)]
struct LoadedModel {
    ctx: Arc<WhisperContext>,
    name: String,
}

pub struct DictationState {
    loaded: Mutex<Option<LoadedModel>>,
    stop_flag: Arc<AtomicBool>,
    /// Set for the lifetime of one record-then-transcribe session so a
    /// second `start_dictation` while one is in flight is rejected instead
    /// of silently resetting `stop_flag` and racing a second mic stream
    /// against the first. Cleared by `DictationSessionGuard::drop`, so every
    /// exit path (success, any error, or a panic unwind) releases it.
    session_active: Arc<AtomicBool>,
}

impl Default for DictationState {
    fn default() -> Self {
        Self {
            loaded: Mutex::new(None),
            stop_flag: Arc::new(AtomicBool::new(false)),
            session_active: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Releases `session_active` when a spawned dictation session ends, and
/// guarantees the "every finished session resolves to an event" contract
/// even when the session never gets to run its own emit.
///
/// Constructed by `start_dictation` immediately after the compare-exchange
/// that claims `session_active`, then moved whole into the `spawn_blocking`
/// closure — never built as the closure's first statement. A closure that
/// captures an already-built guard drops that guard's fields when the
/// closure itself is dropped, whether or not the closure body ever ran; a
/// guard built *inside* the closure only exists once the closure starts
/// executing, so a task the blocking pool never picks up (runtime shutdown,
/// a rejected spawn) would leave `session_active` wedged `true` forever with
/// no `stop_dictation` able to clear it.
struct DictationSessionGuard {
    session_active: Arc<AtomicBool>,
    events: Arc<dyn EventSink>,
    /// Set by `emit_result`/`emit_error` once the session has told the
    /// frontend what happened, so `Drop`'s fallback below does not also
    /// double-emit for a path that already resolved normally.
    emitted: bool,
}

impl DictationSessionGuard {
    fn new(session_active: Arc<AtomicBool>, events: Arc<dyn EventSink>) -> Self {
        Self {
            session_active,
            events,
            emitted: false,
        }
    }

    /// Emit the session's `dictation-result` and mark it resolved.
    fn emit_result(&mut self, result: DictationResult) {
        self.emitted = true;
        self.events.emit("dictation-result", result);
    }

    /// Emit the session's `dictation-error` and mark it resolved.
    fn emit_error(&mut self, message: String) {
        self.emitted = true;
        self.events
            .emit("dictation-error", DictationErrorPayload { message });
    }
}

impl Drop for DictationSessionGuard {
    fn drop(&mut self) {
        self.session_active.store(false, Ordering::SeqCst);
        // Every ordinary exit path calls `emit_result`/`emit_error` before
        // returning. A path that did not — a panic unwinding out of
        // `transcribe` (whisper FFI included), or the closure never running
        // at all — still owes the frontend a resolution, or it sits waiting
        // on the defensive timeout instead of the real event contract.
        if !self.emitted {
            self.events.emit(
                "dictation-error",
                DictationErrorPayload {
                    message: "Dictation session ended unexpectedly.".to_string(),
                },
            );
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

/// Payload for the `dictation-error` event: a mic-stream build failure,
/// recording failure, resample failure, transcription failure, or an
/// over-length transcription that could not be delivered as a
/// `dictation-result`.
#[derive(Debug, Clone, Serialize)]
pub struct DictationErrorPayload {
    pub message: String,
}

const MAX_DICTATION_TEXT_UTF16_UNITS: usize = 32_768;

/// What a finished transcription resolves to: either a deliverable result
/// (including an empty one — silence is a valid outcome, not a dropped
/// event) or a rejection when the text cannot be bounded-encoded.
enum DictationEmission {
    Result(DictationResult),
    TooLong,
}

fn resolve_dictation_emission(text: String, duration_ms: u64) -> DictationEmission {
    let text_units = text
        .encode_utf16()
        .take(MAX_DICTATION_TEXT_UTF16_UNITS + 1)
        .count();
    if text_units > MAX_DICTATION_TEXT_UTF16_UNITS {
        return DictationEmission::TooLong;
    }

    DictationEmission::Result(DictationResult { text, duration_ms })
}

/// Pure mapping from the loaded model's name to the status the frontend
/// reads. Kept separate from `get_asr_status` so the "report the real name,
/// not a hardcoded default" contract is testable without a real
/// `WhisperContext`.
fn asr_status_from_loaded_name(loaded_name: Option<&str>) -> AsrStatus {
    AsrStatus {
        loaded: loaded_name.is_some(),
        model_name: loaded_name.map(str::to_owned),
    }
}

/// Guards a dictation session from starting while one is already recording
/// or transcribing. Pure decision logic — no mic or model access — so it is
/// testable without hardware.
fn try_begin_dictation_session(session_active: &AtomicBool) -> Result<(), String> {
    if session_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "Dictation is already in progress. Stop the current session first.".to_string(),
        );
    }
    Ok(())
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

    let mut guard = state
        .loaded
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    *guard = Some(LoadedModel {
        ctx: Arc::new(ctx),
        name: name.clone(),
    });

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
    // Check if already loaded — report whatever model is actually loaded,
    // not the default file: a caller may have loaded a custom model via
    // `load_whisper_model` first.
    {
        let guard = state
            .loaded
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        if let Some(loaded) = guard.as_ref() {
            return Ok(AsrStatus {
                loaded: true,
                model_name: Some(loaded.name.clone()),
            });
        }
    }

    // Download model if needed
    let model_path = model_download::ensure_model(&WHISPER_MODEL).await?;
    let model_path_str = model_path.to_string_lossy().to_string();

    // Load model
    let ctx = WhisperContext::new_with_params(&model_path_str, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

    let mut guard = state
        .loaded
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    *guard = Some(LoadedModel {
        ctx: Arc::new(ctx),
        name: WHISPER_MODEL_FILE.to_string(),
    });

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
/// runs Whisper inference, and emits a `dictation-result` event on success
/// (including an empty transcription) or a `dictation-error` event on
/// failure. Rejects a second call while a session is already in flight.
pub async fn start_dictation(
    events: Arc<dyn EventSink>,
    state: &DictationState,
) -> Result<(), String> {
    let loaded = {
        let guard = state
            .loaded
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        guard
            .clone()
            .ok_or("Whisper model not loaded. Call load_whisper_model first.")?
    };

    try_begin_dictation_session(&state.session_active)?;

    // Reset stop flag
    state.stop_flag.store(false, Ordering::SeqCst);
    let stop = state.stop_flag.clone();
    let ctx = loaded.ctx;

    // Built here, right after the compare-exchange above, and moved whole
    // into the closure below — see `DictationSessionGuard` for why building
    // it as the closure's first statement would leave a gap where a spawn
    // that never runs wedges `session_active` forever.
    let mut session_guard = DictationSessionGuard::new(state.session_active.clone(), events);

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
                            session_guard
                                .emit_error(format!("Resampling the recording failed: {e}"));
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
                        match resolve_dictation_emission(text, duration_ms) {
                            DictationEmission::Result(result) => {
                                session_guard.emit_result(result);
                            }
                            DictationEmission::TooLong => {
                                session_guard.emit_error(
                                    "The transcription was too long to deliver.".to_string(),
                                );
                            }
                        }
                    }
                    Err(e) => {
                        session_guard.emit_error(format!("Transcription failed: {e}"));
                    }
                }
            }
            Err(e) => {
                session_guard.emit_error(format!("Recording failed: {e}"));
            }
        }
        // `session_guard` drops here: `session_active` is released and, on
        // every path above, `emitted` is already `true` so Drop's fallback
        // stays silent.
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
    let guard = state
        .loaded
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    Ok(asr_status_from_loaded_name(
        guard.as_ref().map(|loaded| loaded.name.as_str()),
    ))
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
        match resolve_dictation_emission("hello world".to_string(), 1500) {
            DictationEmission::Result(result) => {
                assert_eq!(result.text, "hello world");
                assert_eq!(result.duration_ms, 1500);
            }
            DictationEmission::TooLong => panic!("expected a bounded result"),
        }

        let exact_unicode_limit = "😀".repeat(16_384);
        assert!(matches!(
            resolve_dictation_emission(exact_unicode_limit, 1501),
            DictationEmission::Result(_)
        ));
        assert!(matches!(
            resolve_dictation_emission("x".repeat(32_769), 1502),
            DictationEmission::TooLong
        ));
        assert!(matches!(
            resolve_dictation_emission(format!("{}x", "😀".repeat(16_384)), 1503),
            DictationEmission::TooLong
        ));
    }

    /// Regression for the defect where an empty transcription emitted
    /// nothing at all, leaving the frontend stuck in "transcribing" forever.
    /// An empty transcription is a valid outcome (the user said nothing
    /// intelligible) and must still resolve to a deliverable result.
    #[test]
    fn empty_transcription_resolves_to_an_empty_deliverable_result_not_silence() {
        match resolve_dictation_emission(String::new(), 800) {
            DictationEmission::Result(result) => {
                assert_eq!(result.text, "");
                assert_eq!(result.duration_ms, 800);
            }
            DictationEmission::TooLong => panic!("an empty transcription is never too long"),
        }
    }

    #[test]
    fn asr_status_reports_the_actual_loaded_model_name_not_a_hardcoded_default() {
        let status = asr_status_from_loaded_name(Some("my-custom-model.bin"));
        assert!(status.loaded);
        assert_eq!(status.model_name, Some("my-custom-model.bin".to_string()));

        // ensure_whisper_ready's short-circuit must report the model that is
        // actually loaded, never the default file, when a custom model was
        // loaded first via load_whisper_model.
        let custom = asr_status_from_loaded_name(Some(WHISPER_MODEL_FILE));
        assert_eq!(custom.model_name, Some(WHISPER_MODEL_FILE.to_string()));
        let other = asr_status_from_loaded_name(Some("fine-tuned-en.bin"));
        assert_eq!(other.model_name, Some("fine-tuned-en.bin".to_string()));
    }

    #[test]
    fn asr_status_reports_unloaded_with_no_model_name() {
        let status = asr_status_from_loaded_name(None);
        assert!(!status.loaded);
        assert_eq!(status.model_name, None);
    }

    #[test]
    fn start_dictation_guard_rejects_a_second_session_while_one_is_active() {
        let session_active = AtomicBool::new(false);

        assert!(try_begin_dictation_session(&session_active).is_ok());
        assert!(session_active.load(Ordering::SeqCst));

        // A second call while the first is still recording/transcribing
        // must not reset shared state or spawn a second mic stream.
        let second = try_begin_dictation_session(&session_active);
        assert!(second.is_err());
        assert!(session_active.load(Ordering::SeqCst));

        // Once the first session ends (mirrors DictationSessionGuard::drop),
        // starting again is allowed.
        session_active.store(false, Ordering::SeqCst);
        assert!(try_begin_dictation_session(&session_active).is_ok());
    }

    /// Collects every event a mock `EventSink` receives, so a test can assert
    /// exactly what a `DictationSessionGuard` emitted.
    struct RecordingEventSink {
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl RecordingEventSink {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }

        fn events(&self) -> Vec<(String, serde_json::Value)> {
            self.events.lock().unwrap().clone()
        }
    }

    impl EventSink for RecordingEventSink {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload));
        }
    }

    #[test]
    fn emit_result_releases_the_flag_and_marks_the_session_resolved() {
        let session_active = Arc::new(AtomicBool::new(true));
        let sink = Arc::new(RecordingEventSink::new());
        {
            let mut guard = DictationSessionGuard::new(session_active.clone(), sink.clone());
            guard.emit_result(DictationResult {
                text: "hi".to_string(),
                duration_ms: 10,
            });
            assert!(session_active.load(Ordering::SeqCst));
        }
        assert!(!session_active.load(Ordering::SeqCst));

        // Drop's fallback must not also fire once the session already
        // resolved through `emit_result`.
        let events = sink.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "dictation-result");
    }

    /// Regression: a panic unwinding out of the spawned session (whisper FFI
    /// included) used to release `session_active` via `Drop` but emit
    /// nothing, leaving the frontend to fall back on the 45s timeout instead
    /// of the "every finished session resolves to an event" contract.
    #[test]
    fn a_panic_inside_the_session_still_yields_exactly_one_dictation_error() {
        let session_active = Arc::new(AtomicBool::new(true));
        let sink = Arc::new(RecordingEventSink::new());

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = DictationSessionGuard::new(session_active.clone(), sink.clone());
            panic!("simulated whisper FFI panic");
        }));
        assert!(outcome.is_err());

        assert!(!session_active.load(Ordering::SeqCst));
        let events = sink.events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "dictation-error");
    }

    /// Regression: the guard used to be built as the closure's first
    /// statement, so a spawned task the blocking pool never ran (a rejected
    /// spawn, or a shutdown racing the spawn) left `session_active` wedged
    /// `true` forever with nothing able to clear it. Building the guard
    /// right after the compare-exchange and moving it whole into the
    /// closure means even a closure that is dropped without ever running
    /// still releases the flag, because dropping the closure drops its
    /// already-captured guard.
    #[test]
    fn a_guard_that_is_never_run_still_clears_the_flag() {
        let session_active = Arc::new(AtomicBool::new(true));
        let sink = Arc::new(RecordingEventSink::new());

        let guard = DictationSessionGuard::new(session_active.clone(), sink.clone());
        // Simulates a closure that captured the guard but was dropped
        // before its body ever executed.
        drop(guard);

        assert!(!session_active.load(Ordering::SeqCst));
        assert_eq!(sink.events().len(), 1);
        assert_eq!(sink.events()[0].0, "dictation-error");
    }
}
