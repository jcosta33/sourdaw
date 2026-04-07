/// Tauri IPC commands for the Unified Sampler Suite.
///
/// Exposes sample loading, playback control, analysis, and waveform
/// peak retrieval to the React frontend.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use daw_dsp::sampler::analysis::bpm::estimate_bpm;
use daw_dsp::sampler::analysis::loop_points::{detect_loop_points, LoopPointConfig};
use daw_dsp::sampler::analysis::onset::{
    detect_complex_domain, detect_hfc, detect_superflux, OnsetConfig,
};
use daw_dsp::sampler::analysis::peaks::{flatten_level, generate_mipmap, generate_mipmap_stereo};
use daw_dsp::sampler::analysis::pitch::detect_pitch;
use daw_dsp::sampler::engine::SamplerEngine;
use daw_dsp::sampler::sample::SampleData;
use daw_dsp::sampler::types::{SamplerCommand, SamplerMode, SamplerParam};
use serde::{Deserialize, Serialize};
use tauri::State;

// ── Sampler State ──────────────────────────────────────────────────────

/// Managed state for sampler instances.
pub struct SamplerState {
    pub engines: Arc<Mutex<HashMap<String, SamplerEngine>>>,
}

impl Default for SamplerState {
    fn default() -> Self {
        Self {
            engines: Arc::new(Mutex::new(HashMap::new())),
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
pub struct MeteringResult {
    pub peak_left: f32,
    pub peak_right: f32,
    pub active_voices: u8,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoopPointDetectionResult {
    pub start_frame: u32,
    pub end_frame: u32,
    pub crossfade_length: u32,
    pub quality: f32,
}

// ── Commands ───────────────────────────────────────────────────────────

/// Create a new sampler engine instance.
#[tauri::command]
pub async fn create_sampler(
    instance_id: String,
    sample_rate: f32,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let engine = SamplerEngine::new(sample_rate);
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    engines.insert(instance_id, engine);
    Ok(())
}

/// Destroy a sampler engine instance.
#[tauri::command]
pub async fn destroy_sampler(
    instance_id: String,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    engines.remove(&instance_id);
    Ok(())
}

/// Load a sample from disk into a sampler instance.
///
/// Decodes the audio file, runs pitch and BPM analysis, and returns metadata.
#[tauri::command]
pub async fn load_sample(
    instance_id: String,
    file_path: String,
    state: State<'_, SamplerState>,
) -> Result<SampleLoadResult, String> {
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

    // Add to engine.
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    let sample_id = engine.add_sample(sample_data);
    engine.set_active_sample(sample_id);

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

/// Trigger a note on the sampler.
#[tauri::command]
pub async fn sampler_note_on(
    instance_id: String,
    note: u8,
    velocity: u8,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    engine.handle_command(SamplerCommand::NoteOn { note, velocity });
    Ok(())
}

/// Release a note on the sampler.
#[tauri::command]
pub async fn sampler_note_off(
    instance_id: String,
    note: u8,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    engine.handle_command(SamplerCommand::NoteOff { note });
    Ok(())
}

/// Set a sampler parameter.
#[tauri::command]
pub async fn set_sampler_param(
    instance_id: String,
    param: String,
    value: f32,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let param_enum = parse_sampler_param(&param)?;

    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    engine.handle_command(SamplerCommand::SetParam {
        param: param_enum,
        value,
    });
    Ok(())
}

/// Set the sampler operating mode.
#[tauri::command]
pub async fn set_sampler_mode(
    instance_id: String,
    mode: String,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let mode_enum = match mode.as_str() {
        "quick" => SamplerMode::Quick,
        "drum" => SamplerMode::Drum,
        "slice" => SamplerMode::Slice,
        "warp" => SamplerMode::Warp,
        "record" => SamplerMode::Record,
        _ => return Err(format!("Unknown sampler mode: {mode}")),
    };

    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    engine.handle_command(SamplerCommand::SetMode(mode_enum));
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
    level: usize,
    channel: Option<u8>,
    state: State<'_, SamplerState>,
) -> Result<tauri::ipc::Response, String> {
    let engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    let pool = engine.sample_pool();
    let sample_id = engine
        .active_sample_id()
        .ok_or_else(|| "No sample loaded".to_string())?;
    let sample = pool
        .get(sample_id)
        .ok_or_else(|| "Active sample not found in pool".to_string())?;

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
    algorithm: String,
    state: State<'_, SamplerState>,
) -> Result<OnsetDetectionResult, String> {
    let engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    let active_id = engine
        .active_sample_id()
        .ok_or_else(|| "No sample loaded".to_string())?;
    let sample = engine
        .sample_pool()
        .get(active_id)
        .ok_or_else(|| "Active sample not found in pool".to_string())?;

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
    state: State<'_, SamplerState>,
) -> Result<PitchDetectionResult, String> {
    let engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    let active_id = engine
        .active_sample_id()
        .ok_or_else(|| "No sample loaded".to_string())?;
    let sample = engine
        .sample_pool()
        .get(active_id)
        .ok_or_else(|| "Active sample not found in pool".to_string())?;

    let result = detect_pitch(&sample.left, sample.meta.sample_rate as f32);

    Ok(PitchDetectionResult {
        frequency_hz: result.frequency_hz,
        midi_note: result.midi_note,
        confidence: result.confidence,
    })
}

/// Get current metering values (peak levels and active voice count).
#[tauri::command]
pub async fn get_sampler_metering(
    instance_id: String,
    state: State<'_, SamplerState>,
) -> Result<MeteringResult, String> {
    let engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    Ok(MeteringResult {
        peak_left: engine.read_peak_left(),
        peak_right: engine.read_peak_right(),
        active_voices: engine.read_active_voice_count(),
    })
}

/// Stop all sounds immediately.
#[tauri::command]
pub async fn sampler_all_sound_off(
    instance_id: String,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    engine.handle_command(SamplerCommand::AllSoundOff);
    Ok(())
}

/// Get the current playback position (frame index) of the active voice.
#[tauri::command]
pub async fn get_sampler_position(
    instance_id: String,
    state: State<'_, SamplerState>,
) -> Result<u64, String> {
    let engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    Ok(engine.read_playback_position())
}

/// Detect optimal loop points using zero-crossing analysis.
#[tauri::command]
pub async fn detect_smart_loop_points(
    instance_id: String,
    state: State<'_, SamplerState>,
) -> Result<Option<LoopPointDetectionResult>, String> {
    let engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    let active_id = engine
        .active_sample_id()
        .ok_or_else(|| "No sample loaded".to_string())?;
    let sample = engine
        .sample_pool()
        .get(active_id)
        .ok_or_else(|| "Active sample not found in pool".to_string())?;

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
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    engine.handle_command(SamplerCommand::ArmRecording {
        threshold,
        target_pad,
        max_duration_secs,
    });
    Ok(())
}

/// Stop recording and commit the buffer.
#[tauri::command]
pub async fn stop_recording(
    instance_id: String,
    state: State<'_, SamplerState>,
) -> Result<(), String> {
    let mut engines = state
        .engines
        .lock()
        .map_err(|err| format!("Failed to lock sampler state: {err}"))?;
    let engine = engines
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Sampler instance '{instance_id}' not found"))?;

    engine.handle_command(SamplerCommand::StopRecording);
    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────

fn parse_sampler_param(name: &str) -> Result<SamplerParam, String> {
    match name {
        "masterGain" => Ok(SamplerParam::MasterGain),
        "attack" => Ok(SamplerParam::Attack),
        "hold" => Ok(SamplerParam::Hold),
        "decay" => Ok(SamplerParam::Decay),
        "sustain" => Ok(SamplerParam::Sustain),
        "release" => Ok(SamplerParam::Release),
        "filterCutoff" => Ok(SamplerParam::FilterCutoff),
        "filterResonance" => Ok(SamplerParam::FilterResonance),
        "filterType" => Ok(SamplerParam::FilterType),
        "loopMode" => Ok(SamplerParam::LoopMode),
        "loopStart" => Ok(SamplerParam::LoopStart),
        "loopEnd" => Ok(SamplerParam::LoopEnd),
        "loopCrossfade" => Ok(SamplerParam::LoopCrossfade),
        "playbackMode" => Ok(SamplerParam::PlaybackMode),
        "rootNote" => Ok(SamplerParam::RootNote),
        "tune" => Ok(SamplerParam::Tune),
        "pan" => Ok(SamplerParam::Pan),
        "stackCount" => Ok(SamplerParam::StackCount),
        "detuneSpread" => Ok(SamplerParam::DetuneSpread),
        "stackSpread" => Ok(SamplerParam::StackSpread),
        _ => Err(format!("Unknown sampler parameter: {name}")),
    }
}

fn classify_sample(
    samples: &[f32],
    sample_rate: u32,
    pitch_result: &daw_dsp::sampler::analysis::pitch::PitchResult,
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
