/// Tauri IPC commands for the Unified Crumbs Suite.
///
/// Exposes sample loading, playback control, analysis, and waveform
/// peak retrieval to the React frontend.
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use crate::host::native_bridge::CrumbsPluginSlot;
use crate::state::AppState;
use daw_dsp::crumbs::analysis::bpm::estimate_bpm;
use daw_dsp::crumbs::analysis::loop_points::{detect_loop_points, LoopPointConfig};
use daw_dsp::crumbs::analysis::onset::{
    detect_complex_domain, detect_hfc, detect_superflux, OnsetConfig,
};
use daw_dsp::crumbs::analysis::peaks::{flatten_level, generate_mipmap, generate_mipmap_stereo};
use daw_dsp::crumbs::analysis::pitch::detect_pitch;
use daw_dsp::crumbs::engine::{CrumbsEngine, CrumbsMetering};
use daw_dsp::crumbs::sample::SampleData;
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsMode, CrumbsParam, SampleId};
use rtrb::Producer;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::filesystem;

// ── Crumbs State ──────────────────────────────────────────────────────

pub struct CrumbsInstanceData {
    pub command_tx: Producer<CrumbsCommand>,
    pub samples: HashMap<SampleId, Arc<SampleData>>,
    pub metering: Arc<CrumbsMetering>,
    pub engine_plugin_id: usize,
    pub next_sample_id: SampleId,
}

/// Managed state for crumbs instances.
pub struct CrumbsState {
    pub instances: Arc<Mutex<HashMap<String, CrumbsInstanceData>>>,
}

impl Default for CrumbsState {
    fn default() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

// ── IPC Types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SampleLoadResult {
    pub sample_id: u32,
    pub sample_rate: u32,
    pub channels: u32,
    pub frame_count: u32,
    pub duration_secs: f64,
    pub detected_root: Option<u8>,
    pub detected_bpm: Option<f32>,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OnsetDetectionResult {
    pub positions: Vec<u32>,
    pub algorithm: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PitchDetectionResult {
    pub frequency_hz: Option<f32>,
    pub midi_note: Option<u8>,
    pub confidence: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BpmDetectionResult {
    pub bpm: Option<f32>,
    pub confidence: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoopPointDetectionResult {
    pub start_frame: u32,
    pub end_frame: u32,
    pub crossfade_length: u32,
    pub quality: f32,
}

// ── Commands ───────────────────────────────────────────────────────────

/// Create a new crumbs engine instance.
#[tauri::command]
pub async fn create_crumbs(
    instance_id: String,
    sample_rate: f32,
    state: State<'_, CrumbsState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let (tx, rx) = rtrb::RingBuffer::new(128);
    let metering = Arc::new(CrumbsMetering::default());
    let engine = CrumbsEngine::with_metering(sample_rate, metering.clone());

    let mut engine_guard = app_state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {e}"))?;

    let engine_plugin_id = if let Some(ref mut engine_handle) = *engine_guard {
        // Reserve the id up front and register an audio bridge alongside the
        // slot (mirrors the CLAP path in plugins.rs): the bridge is the only
        // channel that carries real audio from the app into the native
        // engine — the slot feeds incoming bridge blocks to the engine's
        // record input before rendering, so without it armed recording can
        // only ever capture silence.
        let id = engine_handle.reserve_plugin_id();
        let (bridge, bridge_handle) = daw_engine::audio_bridge::create_audio_bridge(id);
        let slot = CrumbsPluginSlot {
            engine,
            command_rx: rx,
        };
        engine_handle.add_plugin_with_bridge(id, Box::new(slot), bridge)?;

        let mut bridges = app_state
            .audio_bridges
            .lock()
            .map_err(|e| format!("Failed to lock audio_bridges: {e}"))?;
        bridges.insert(id, bridge_handle);

        id
    } else {
        return Err("Native engine not running".to_string());
    };

    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;

    instances.insert(
        instance_id,
        CrumbsInstanceData {
            command_tx: tx,
            samples: HashMap::new(),
            metering,
            engine_plugin_id,
            next_sample_id: 1,
        },
    );
    Ok(())
}

/// Destroy a crumbs engine instance.
#[tauri::command]
pub async fn destroy_crumbs(
    instance_id: String,
    state: State<'_, CrumbsState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;

    if let Some(instance) = instances.remove(&instance_id) {
        let mut engine_guard = app_state
            .engine
            .lock()
            .map_err(|e| format!("Failed to lock engine: {e}"))?;
        if let Some(ref mut engine_handle) = *engine_guard {
            engine_handle.remove_plugin(instance.engine_plugin_id)?;
        }
        drop(engine_guard);
        // Drop the audio-bridge handle registered at create time (mirrors
        // the CLAP unload path) so no stale ring keeps accepting blocks.
        let mut bridges = app_state
            .audio_bridges
            .lock()
            .map_err(|e| format!("Failed to lock audio_bridges: {e}"))?;
        bridges.remove(&instance.engine_plugin_id);
    }
    Ok(())
}

/// Load a sample from disk into a crumbs instance.
///
/// Decodes the audio file, runs pitch and BPM analysis, and returns metadata.
#[tauri::command]
pub async fn load_sample(
    instance_id: String,
    file_path: String,
    state: State<'_, CrumbsState>,
) -> Result<SampleLoadResult, String> {
    let file_path = filesystem::resolve_existing_file_path(&file_path)?;
    let file_path = file_path.to_string_lossy().to_string();

    // Decode the audio file.
    let decoded = daw_io::decode_audio_file(&file_path)?;

    let sample_rate = decoded.sample_rate;
    let channels = decoded.channels;
    let samples_vec = decoded.samples;

    // Build SampleData from decoded channels.
    let sample_data = if channels >= 2 && samples_vec.len() >= 2 {
        SampleData::from_stereo(samples_vec[0].clone(), samples_vec[1].clone(), sample_rate)
    } else if !samples_vec.is_empty() {
        SampleData::from_mono(samples_vec[0].clone(), sample_rate)
    } else {
        return Err("No audio data in file".to_string());
    };

    let frame_count = sample_data.frame_count() as u32;
    let duration_secs = sample_data.meta.duration_secs;

    // Run pitch detection on mono mix.
    let mono_samples = &sample_data.left;
    let pitch_result = detect_pitch(mono_samples, sample_rate as f32);

    // Run BPM estimation.
    let bpm_result = estimate_bpm(mono_samples, sample_rate);

    // Determine category.
    let category = classify_sample(mono_samples, sample_rate, &pitch_result);

    // Wrap in Arc for sharing.
    let shared_data = Arc::new(sample_data);

    // Add to engine.
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    let sample_id = instance.next_sample_id;
    instance.next_sample_id += 1;

    // Store in Tauri state for analysis commands.
    instance.samples.insert(sample_id, shared_data.clone());

    // Send to engine via command queue.
    instance
        .command_tx
        .push(CrumbsCommand::AddSample {
            id: sample_id,
            data: shared_data,
        })
        .map_err(|_| "Command queue full")?;

    instance
        .command_tx
        .push(CrumbsCommand::SetActiveSample(sample_id))
        .map_err(|_| "Command queue full")?;

    Ok(SampleLoadResult {
        sample_id,
        sample_rate,
        channels,
        frame_count,
        duration_secs,
        detected_root: pitch_result.midi_note,
        detected_bpm: bpm_result.bpm,
        category,
    })
}

/// Trigger a note on the crumbs engine.
#[tauri::command]
pub async fn crumbs_note_on(
    instance_id: String,
    note: u8,
    velocity: u8,
    state: State<'_, CrumbsState>,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    instance
        .command_tx
        .push(CrumbsCommand::NoteOn { note, velocity })
        .map_err(|_| "Command queue full")?;
    Ok(())
}

/// Release a note on the crumbs engine.
#[tauri::command]
pub async fn crumbs_note_off(
    instance_id: String,
    note: u8,
    state: State<'_, CrumbsState>,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    instance
        .command_tx
        .push(CrumbsCommand::NoteOff { note })
        .map_err(|_| "Command queue full")?;
    Ok(())
}

/// Set a crumbs parameter.
#[tauri::command]
pub async fn set_crumbs_param(
    instance_id: String,
    param: String,
    value: f32,
    state: State<'_, CrumbsState>,
) -> Result<(), String> {
    let param_enum = parse_crumbs_param(&param)?;

    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    instance
        .command_tx
        .push(CrumbsCommand::SetParam {
            param: param_enum,
            value,
        })
        .map_err(|_| "Command queue full")?;
    Ok(())
}

/// Set the crumbs operating mode.
#[tauri::command]
pub async fn set_crumbs_mode(
    instance_id: String,
    mode: String,
    state: State<'_, CrumbsState>,
) -> Result<(), String> {
    let mode_enum = match mode.as_str() {
        "quick" => CrumbsMode::Quick,
        "drum" => CrumbsMode::Drum,
        "slice" => CrumbsMode::Slice,
        "warp" => CrumbsMode::Warp,
        "record" => CrumbsMode::Record,
        _ => return Err(format!("Unknown crumbs mode: {mode}")),
    };

    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    instance
        .command_tx
        .push(CrumbsCommand::SetMode(mode_enum))
        .map_err(|_| "Command queue full")?;
    Ok(())
}

/// Get waveform peaks for display as raw binary data.
///
/// The `level` parameter selects the mipmap level (0 = finest).
/// The `channel` parameter selects 0=left, 1=right, 2=both interleaved.
/// Returns raw f32 bytes via binary IPC for optimal transfer.
#[tauri::command]
pub async fn get_waveform_peaks(
    instance_id: String,
    sample_id: SampleId,
    level: usize,
    channel: Option<u8>,
    state: State<'_, CrumbsState>,
) -> Result<tauri::ipc::Response, String> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    let sample = instance
        .samples
        .get(&sample_id)
        .ok_or_else(|| format!("Sample {sample_id} not found"))?;

    let ch = channel.unwrap_or(0);

    let peaks = match ch {
        1 if !sample.right.is_empty() => {
            let mipmap = generate_mipmap(&sample.right);
            if level >= mipmap.levels.len() {
                return Err(format!(
                    "Mipmap level {level} out of range (max: {})",
                    mipmap.levels.len().saturating_sub(1)
                ));
            }
            flatten_level(&mipmap.levels[level])
        }
        2 if !sample.right.is_empty() => {
            let (mipmap_l, mipmap_r) = generate_mipmap_stereo(&sample.left, &sample.right);
            if level >= mipmap_l.levels.len() {
                return Err(format!(
                    "Mipmap level {level} out of range (max: {})",
                    mipmap_l.levels.len().saturating_sub(1)
                ));
            }
            let flat_l = flatten_level(&mipmap_l.levels[level]);
            let flat_r = flatten_level(&mipmap_r.levels[level]);
            // Interleave: [L_min0, L_max0, R_min0, R_max0, ...]
            let pair_count = flat_l.len().min(flat_r.len()) / 2;
            let mut interleaved = Vec::with_capacity(pair_count * 4);
            for i in 0..pair_count {
                interleaved.push(flat_l[i * 2]);
                interleaved.push(flat_l[i * 2 + 1]);
                interleaved.push(flat_r[i * 2]);
                interleaved.push(flat_r[i * 2 + 1]);
            }
            interleaved
        }
        _ => {
            let mipmap = generate_mipmap(&sample.left);
            if level >= mipmap.levels.len() {
                return Err(format!(
                    "Mipmap level {level} out of range (max: {})",
                    mipmap.levels.len().saturating_sub(1)
                ));
            }
            flatten_level(&mipmap.levels[level])
        }
    };

    // Convert f32 slice to raw bytes for binary IPC transfer.
    let bytes: Vec<u8> = peaks.iter().flat_map(|f| f.to_le_bytes()).collect();

    Ok(tauri::ipc::Response::new(bytes))
}

/// Run onset detection on the active sample.
#[tauri::command]
pub async fn detect_onsets(
    instance_id: String,
    sample_id: SampleId,
    algorithm: String,
    state: State<'_, CrumbsState>,
) -> Result<OnsetDetectionResult, String> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    let sample = instance
        .samples
        .get(&sample_id)
        .ok_or_else(|| format!("Sample {sample_id} not found"))?;

    let config = OnsetConfig {
        sample_rate: sample.meta.sample_rate,
        ..OnsetConfig::default()
    };

    let result = match algorithm.as_str() {
        "superflux" => detect_superflux(&sample.left, &config),
        "hfc" => detect_hfc(&sample.left, &config),
        "complex" => detect_complex_domain(&sample.left, &config),
        _ => return Err(format!("Unknown onset algorithm: {algorithm}")),
    };

    Ok(OnsetDetectionResult {
        positions: result.positions,
        algorithm,
    })
}

/// Run pitch detection on the active sample.
#[tauri::command]
pub async fn detect_sample_pitch(
    instance_id: String,
    sample_id: SampleId,
    state: State<'_, CrumbsState>,
) -> Result<PitchDetectionResult, String> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    let sample = instance
        .samples
        .get(&sample_id)
        .ok_or_else(|| format!("Sample {sample_id} not found"))?;

    let result = detect_pitch(&sample.left, sample.meta.sample_rate as f32);

    Ok(PitchDetectionResult {
        frequency_hz: result.frequency_hz,
        midi_note: result.midi_note,
        confidence: result.confidence,
    })
}

/// Stop all sounds immediately.
#[tauri::command]
pub async fn crumbs_all_sound_off(
    instance_id: String,
    state: State<'_, CrumbsState>,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    instance
        .command_tx
        .push(CrumbsCommand::AllSoundOff)
        .map_err(|_| "Command queue full")?;
    Ok(())
}

/// Get the current playback position (frame index) of the active voice.
#[tauri::command]
pub async fn get_crumbs_position(
    instance_id: String,
    state: State<'_, CrumbsState>,
) -> Result<u64, String> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    Ok(instance.metering.playback_position.load(Ordering::Relaxed))
}

/// Detect optimal loop points using zero-crossing analysis.
#[tauri::command]
pub async fn detect_smart_loop_points(
    instance_id: String,
    sample_id: SampleId,
    state: State<'_, CrumbsState>,
) -> Result<Option<LoopPointDetectionResult>, String> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    let sample = instance
        .samples
        .get(&sample_id)
        .ok_or_else(|| format!("Sample {sample_id} not found"))?;

    let config = LoopPointConfig::default();
    let result = detect_loop_points(&sample.left, sample.meta.sample_rate, &config);

    Ok(result.map(|r| LoopPointDetectionResult {
        start_frame: r.start_frame,
        end_frame: r.end_frame,
        crossfade_length: r.crossfade_length,
        quality: r.quality,
    }))
}

/// Arm the recorder for threshold-triggered capture.
#[tauri::command]
pub async fn arm_recording(
    instance_id: String,
    threshold: f32,
    target_pad: u8,
    max_duration_secs: f32,
    state: State<'_, CrumbsState>,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    instance
        .command_tx
        .push(CrumbsCommand::ArmRecording {
            threshold,
            target_pad,
            max_duration_secs,
        })
        .map_err(|_| "Command queue full")?;
    Ok(())
}

/// Stop recording and commit the buffer.
#[tauri::command]
pub async fn stop_recording(
    instance_id: String,
    state: State<'_, CrumbsState>,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    instance
        .command_tx
        .push(CrumbsCommand::StopRecording)
        .map_err(|_| "Command queue full")?;
    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────

fn parse_crumbs_param(name: &str) -> Result<CrumbsParam, String> {
    match name {
        "masterGain" => Ok(CrumbsParam::MasterGain),
        "attack" => Ok(CrumbsParam::Attack),
        "hold" => Ok(CrumbsParam::Hold),
        "decay" => Ok(CrumbsParam::Decay),
        "sustain" => Ok(CrumbsParam::Sustain),
        "release" => Ok(CrumbsParam::Release),
        "filterCutoff" => Ok(CrumbsParam::FilterCutoff),
        "filterResonance" => Ok(CrumbsParam::FilterResonance),
        "filterType" => Ok(CrumbsParam::FilterType),
        "loopMode" => Ok(CrumbsParam::LoopMode),
        "loopStart" => Ok(CrumbsParam::LoopStart),
        "loopEnd" => Ok(CrumbsParam::LoopEnd),
        "loopCrossfade" => Ok(CrumbsParam::LoopCrossfade),
        "playbackMode" => Ok(CrumbsParam::PlaybackMode),
        "rootNote" => Ok(CrumbsParam::RootNote),
        "tune" => Ok(CrumbsParam::Tune),
        "pan" => Ok(CrumbsParam::Pan),
        "stackCount" => Ok(CrumbsParam::StackCount),
        "detuneSpread" => Ok(CrumbsParam::DetuneSpread),
        "stackSpread" => Ok(CrumbsParam::StackSpread),
        _ => Err(format!("Unknown crumbs parameter: {name}")),
    }
}

fn classify_sample(
    samples: &[f32],
    sample_rate: u32,
    pitch_result: &daw_dsp::crumbs::analysis::pitch::PitchResult,
) -> String {
    // Simple heuristic: short samples with no clear pitch are percussive,
    // samples with detected pitch are tonal, longer samples may be loops.
    let duration = samples.len() as f64 / sample_rate as f64;

    if duration < 2.0 && pitch_result.confidence < 0.5 {
        "percussive".to_string()
    } else if pitch_result.confidence >= 0.5 {
        "tonal".to_string()
    } else if duration >= 2.0 {
        "loop".to_string()
    } else {
        "unknown".to_string()
    }
}
