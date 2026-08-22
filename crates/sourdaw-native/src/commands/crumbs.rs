//! The Unified Crumbs Suite: sample loading, playback control, analysis, and
//! waveform peak retrieval.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use crate::host::native_bridge::{CrumbsPluginSlot, PendingRecordingCommit, RecordBufferPair};
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
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsParam, SampleId};
use daw_engine::audio_bridge::MAX_BLOCK_FRAMES;
use rtrb::Producer;
use serde::{Deserialize, Serialize};

use super::filesystem;

// ── Crumbs State ──────────────────────────────────────────────────────

pub struct CrumbsInstanceData {
    pub command_tx: Producer<CrumbsCommand>,
    pub samples: HashMap<SampleId, Arc<SampleData>>,
    pub metering: Arc<CrumbsMetering>,
    pub engine_plugin_id: usize,
    pub next_sample_id: SampleId,
    /// Receives committed takes from the audio thread (O(1) engine handoff,
    /// ledger #568); drained by drain_pending_recording_commits off-thread.
    pub commit_rx: rtrb::Consumer<PendingRecordingCommit>,
    /// Returns emptied record-buffer pairs to the audio thread for reuse.
    pub recycle_tx: Producer<RecordBufferPair>,
    /// Engine-mirror entries (AddSample + SetActiveSample) whose push hit a
    /// full command ring; retried at the top of every drain (PR #579
    /// review). Retries are idempotent: AddSample uses set() with the same
    /// id and data.
    pub pending_mirror: Vec<(SampleId, Arc<SampleData>)>,
}

/// Complete any recording commits the audio thread handed off (ledger
/// #568): clone the take into a SampleData HERE (off the RT thread), mirror
/// it into the engine pool through the command ring (AddSample +
/// SetActiveSample, same ownership pattern as load_sample), register it in
/// the command-side sample map, and recycle the emptied buffers. Called
/// from the recording and polling command handlers; a pending commit at
/// destroy time is simply dropped with the instance.
pub fn drain_pending_recording_commits(instance: &mut CrumbsInstanceData) {
    // Retry mirror pushes that previously hit a full command ring (oldest
    // first). Stop at the first still-full ring; later entries retry on the
    // next drain call.
    while let Some((id, sample)) = instance.pending_mirror.first() {
        let pushed = instance.command_tx.push(CrumbsCommand::AddSample {
            id: *id,
            data: Arc::clone(sample),
        });
        if pushed.is_err() {
            return;
        }
        let _ = instance
            .command_tx
            .push(CrumbsCommand::SetActiveSample(*id));
        instance.pending_mirror.remove(0);
    }

    while let Ok(commit) = instance.commit_rx.pop() {
        let PendingRecordingCommit {
            mut left,
            mut right,
            sample_rate,
        } = commit;
        let sample = Arc::new(SampleData::from_stereo(
            left.clone(),
            right.clone(),
            sample_rate,
        ));
        let id = instance.next_sample_id;
        instance.next_sample_id += 1;
        instance.samples.insert(id, Arc::clone(&sample));
        // Mirror into the engine. A full command ring must not lose the
        // mirror (the sample map above already holds the take): queue it in
        // pending_mirror, retried at the top of this drain.
        let pushed = instance.command_tx.push(CrumbsCommand::AddSample {
            id,
            data: Arc::clone(&sample),
        });
        match pushed {
            Ok(()) => {
                let _ = instance.command_tx.push(CrumbsCommand::SetActiveSample(id));
            }
            Err(_) => {
                instance.pending_mirror.push((id, sample));
            }
        }
        left.clear();
        right.clear();
        let _ = instance.recycle_tx.push((left, right));
    }
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
#[serde(rename_all = "camelCase")]
pub struct SampleLoadResult {
    pub sample_id: u32,
    pub sample_rate: u32,
    pub channels: u32,
    pub frame_count: u32,
    pub duration_secs: f64,
    pub detected_root: Option<u8>,
    pub detected_bpm: Option<f32>,
    pub category: String,
    pub decode_warning_count: u64,
    pub decode_warnings: Vec<String>,
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
pub async fn create_crumbs(
    instance_id: String,
    sample_rate: f32,
    state: &CrumbsState,
    app_state: &AppState,
) -> Result<(), String> {
    let (tx, rx) = rtrb::RingBuffer::new(128);
    // Commit-handoff rings (ledger #568): the engine hands committed takes
    // out in O(1); drain_pending_recording_commits completes them off the
    // audio thread and recycles the buffers.
    let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
    let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
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
        //
        // The capture slot takes a slot of the same shared effect table the
        // project's devices and its plugins fill, so refuse before the id is
        // reserved and the bridge is published. The audio thread's refusal is
        // a counter nothing here can read, and a capture slot refused there
        // leaves armed recording capturing silence with nothing saying why.
        engine_handle.ensure_effect_table_headroom(1)?;

        let id = engine_handle.reserve_plugin_id();
        let (bridge, bridge_handle) = daw_engine::audio_bridge::create_audio_bridge(id);
        let mut engine = engine;
        engine.enable_commit_handoff();
        let slot = CrumbsPluginSlot {
            engine,
            command_rx: rx,
            commit_tx,
            recycle_rx,
        };
        engine_handle.add_plugin_with_bridge(id, Box::new(slot), bridge)?;

        let mut feed = app_state
            .audio_bridges
            .lock()
            .map_err(|e| format!("Failed to lock audio_bridges: {e}"))?;
        feed.bridges.insert(id, bridge_handle);

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
            commit_rx,
            recycle_tx,
            pending_mirror: Vec::new(),
        },
    );
    Ok(())
}

/// Destroy a crumbs engine instance.
pub async fn destroy_crumbs(
    instance_id: String,
    state: &CrumbsState,
    app_state: &AppState,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;

    if let Some(instance) = instances.remove(&instance_id) {
        // Attempt the scheduler removal but never let its failure skip the
        // bridge-handle cleanup — a stale ring would keep accepting blocks
        // for a dead plugin (PR #564 review).
        let removal_result = (|app_state: &&AppState| -> Result<(), String> {
            let mut engine_guard = app_state
                .engine
                .lock()
                .map_err(|e| format!("Failed to lock engine: {e}"))?;
            if let Some(ref mut engine_handle) = *engine_guard {
                engine_handle.remove_plugin(instance.engine_plugin_id)?;
            }
            Ok(())
        })(&app_state);

        let mut feed = app_state
            .audio_bridges
            .lock()
            .map_err(|e| format!("Failed to lock audio_bridges: {e}"))?;
        feed.bridges.remove(&instance.engine_plugin_id);

        removal_result?;
    }
    Ok(())
}

/// Load a sample from disk into a crumbs instance.
///
/// Decodes the audio file, runs pitch and BPM analysis, and returns metadata.
pub async fn load_sample(
    instance_id: String,
    file_path: String,
    state: &CrumbsState,
) -> Result<SampleLoadResult, String> {
    let file_path = filesystem::resolve_existing_file_path(&file_path)?;
    let file_path = file_path.to_string_lossy().to_string();

    // Decode the audio file.
    let decoded = daw_io::decode_audio_file(&file_path)?;

    let sample_rate = decoded.sample_rate;
    let channels = decoded.channels;
    let decode_warning_count = decoded.decode_warning_count;
    let decode_warnings = decoded.decode_warnings;
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

    // Store in app state for analysis commands.
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
        decode_warning_count,
        decode_warnings,
    })
}

/// Trigger a note on the crumbs engine.
pub async fn crumbs_note_on(
    instance_id: String,
    note: u8,
    velocity: u8,
    state: &CrumbsState,
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
pub async fn crumbs_note_off(
    instance_id: String,
    note: u8,
    state: &CrumbsState,
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
pub async fn set_crumbs_param(
    instance_id: String,
    param: String,
    value: f32,
    state: &CrumbsState,
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
pub async fn set_crumbs_mode(
    instance_id: String,
    mode: String,
    state: &CrumbsState,
) -> Result<(), String> {
    // Shared with the wasm binding for the same reason as `parse_crumbs_param`.
    let mode_enum = daw_dsp::crumbs::types::parse_crumbs_mode(&mode)
        .ok_or_else(|| format!("Unknown crumbs mode: {mode}"))?;

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
/// Returns raw little-endian f32 bytes; the shell carries them as a byte
/// payload rather than as a JSON number array.
pub async fn get_waveform_peaks(
    instance_id: String,
    sample_id: SampleId,
    level: usize,
    channel: Option<u8>,
    state: &CrumbsState,
) -> Result<Vec<u8>, String> {
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

    // Convert f32 slice to raw bytes for binary transfer.
    let bytes: Vec<u8> = peaks.iter().flat_map(|f| f.to_le_bytes()).collect();

    Ok(bytes)
}

/// Run onset detection on the active sample.
pub async fn detect_onsets(
    instance_id: String,
    sample_id: SampleId,
    algorithm: String,
    state: &CrumbsState,
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
pub async fn detect_sample_pitch(
    instance_id: String,
    sample_id: SampleId,
    state: &CrumbsState,
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
pub async fn crumbs_all_sound_off(instance_id: String, state: &CrumbsState) -> Result<(), String> {
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
pub async fn get_crumbs_position(instance_id: String, state: &CrumbsState) -> Result<u64, String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    // The UI polls this during recording; draining here makes capacity
    // auto-commits visible without waiting for the next stop/arm gesture.
    drain_pending_recording_commits(instance);
    Ok(instance.metering.playback_position.load(Ordering::Relaxed))
}

/// Detect optimal loop points using zero-crossing analysis.
pub async fn detect_smart_loop_points(
    instance_id: String,
    sample_id: SampleId,
    state: &CrumbsState,
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
pub async fn arm_recording(
    instance_id: String,
    threshold: f32,
    target_pad: u8,
    max_duration_secs: f32,
    state: &CrumbsState,
) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    // Complete any in-flight commit first: this clones the take off-RT,
    // mirrors it into the engine, and recycles the record buffers so this
    // arm finds capacity.
    drain_pending_recording_commits(instance);
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
pub async fn stop_recording(instance_id: String, state: &CrumbsState) -> Result<(), String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    drain_pending_recording_commits(instance);
    instance
        .command_tx
        .push(CrumbsCommand::StopRecording)
        .map_err(|_| "Command queue full")?;
    Ok(())
}

/// Push one block of monitored input audio into every registered crumbs
/// record bridge — the record feed's producer, the counterpart of the CLAP
/// worklet relay (`process_plugin_audio`).
///
/// The feed carries the app's monitored input bus: the stereo stream input
/// monitoring plays, handed in once per render quantum as interleaved
/// little-endian f32 bytes (L0,R0,L1,R1,...) by the caller that owns that
/// bus. Every registered sampler hears the same block, because an armed pad
/// records exactly what the musician hears on the monitored input, and the
/// map holds only crumbs bridges. The audio thread pops the far end of each
/// ring through the scheduler and feeds the blocks to the engine's record
/// input before rendering, so without this push an armed capture records
/// silence end-to-end.
///
/// Real-time discipline mirrors the CLAP relay: the command runs on the
/// command side, takes exactly one lock (map and scratch live under it), and
/// touches each bridge only through its lock-free SPSC ring — the native
/// render callback never takes this lock. The scratch is preallocated and
/// refilled in place, so the path allocates nothing per block, and a block
/// larger than `MAX_BLOCK_FRAMES` is refused before the de-interleave.
///
/// A refused push means the input ring was full — a hole in the take, not a
/// dropped frame of monitoring — so it is counted in
/// `bridge_input_blocks_refused` rather than failing the caller, which is
/// already running behind when this happens.
///
/// The crumbs bridge is one-way by design: the sampler's audible output
/// travels the wasm device graph, not this ring. Processed blocks are popped
/// and dropped so the return ring cannot wedge at capacity and inflate the
/// drop counters for the whole session.
pub async fn feed_record_input(audio_bytes: Vec<u8>, app_state: &AppState) -> Result<(), String> {
    let mut feed = app_state
        .audio_bridges
        .lock()
        .map_err(|e| format!("Failed to lock audio_bridges: {e}"))?;

    // Interleaved stereo f32: two samples, four bytes each, per frame.
    const BYTES_PER_FRAME: usize = 2 * std::mem::size_of::<f32>();
    let frames = audio_bytes.len() / BYTES_PER_FRAME;

    if frames > MAX_BLOCK_FRAMES {
        state_refused_block(app_state);
        return Ok(());
    }

    // Split borrows so the scratch feeds every bridge without cloning: the
    // map and the scratch live under one lock but bind to distinct fields.
    let crate::state::CrumbsRecordFeed { bridges, scratch } = &mut *feed;
    scratch.left.clear();
    scratch.right.clear();
    for frame in audio_bytes.chunks_exact(BYTES_PER_FRAME) {
        scratch
            .left
            .push(f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]));
        scratch
            .right
            .push(f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]));
    }

    for bridge in bridges.values_mut() {
        if !bridge.push_input(&scratch.left, &scratch.right) {
            state_refused_block(app_state);
        }
        while bridge.pop_output().is_some() {}
    }
    Ok(())
}

/// Count one input block the record feed could not hand to a bridge.
fn state_refused_block(app_state: &AppState) {
    app_state
        .bridge_input_blocks_refused
        .fetch_add(1, Ordering::Relaxed);
}

// ── Helpers ────────────────────────────────────────────────────────────

/// The name table lives in `daw_dsp::crumbs::types` so this command and the
/// wasm `CrumbsInstance` binding cannot disagree about what `filterCutoff`
/// means; only the error shape is local to the IPC boundary.
fn parse_crumbs_param(name: &str) -> Result<CrumbsParam, String> {
    daw_dsp::crumbs::types::parse_crumbs_param(name)
        .ok_or_else(|| format!("Unknown crumbs parameter: {name}"))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the command-side instance pieces exactly as create_crumbs
    /// wires them, plus the slot-side ring endpoints so a test can simulate
    /// the audio thread handing a commit off.
    fn instance_with_rings() -> (
        CrumbsInstanceData,
        Producer<PendingRecordingCommit>,
        rtrb::Consumer<RecordBufferPair>,
        rtrb::Consumer<CrumbsCommand>,
    ) {
        let (tx, cmd_rx) = rtrb::RingBuffer::new(8);
        let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
        let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
        let instance = CrumbsInstanceData {
            command_tx: tx,
            samples: HashMap::new(),
            metering: Arc::new(CrumbsMetering::default()),
            engine_plugin_id: 0,
            next_sample_id: 1,
            commit_rx,
            recycle_tx,
            pending_mirror: Vec::new(),
        };
        (instance, commit_tx, recycle_rx, cmd_rx)
    }

    #[test]
    fn sample_load_result_serializes_decode_warnings_for_the_typescript_boundary() {
        let result = SampleLoadResult {
            sample_id: 1,
            sample_rate: 48_000,
            channels: 2,
            frame_count: 128,
            duration_secs: 128.0 / 48_000.0,
            detected_root: None,
            detected_bpm: None,
            category: "percussive".to_string(),
            decode_warning_count: 2,
            decode_warnings: vec!["corrupt frame".to_string(), "truncated frame".to_string()],
        };

        let json = serde_json::to_value(result).expect("serialize SampleLoadResult");

        assert_eq!(json["decodeWarningCount"], 2);
        assert_eq!(
            json["decodeWarnings"],
            serde_json::json!(["corrupt frame", "truncated frame"])
        );
        assert_eq!(json["sampleRate"], 48_000);
        assert!(json.get("decode_warning_count").is_none());
    }

    /// The drain completes a handed-off take off the RT thread: SampleData
    /// built with the right frames/content, engine mirror commands queued,
    /// emptied buffers recycled.
    #[test]
    fn drain_completes_commit_off_thread() {
        let (mut instance, mut commit_tx, mut recycle_rx, mut cmd_rx) = instance_with_rings();
        let frames = 512;
        commit_tx
            .push(PendingRecordingCommit {
                left: vec![0.5f32; frames],
                right: vec![0.25f32; frames],
                sample_rate: 48_000,
            })
            .unwrap();

        drain_pending_recording_commits(&mut instance);

        // Command-side sample map holds the take with exact content.
        let sample = instance.samples.get(&1).expect("take registered");
        assert_eq!(sample.meta.frame_count as usize, frames);
        assert!(sample.left.iter().all(|&s| (s - 0.5).abs() < 1.0e-6));
        assert!(sample.right.iter().all(|&s| (s - 0.25).abs() < 1.0e-6));
        assert_eq!(instance.next_sample_id, 2);

        // Engine mirror commands were queued (AddSample then
        // SetActiveSample); the engine consumes these on the audio thread.
        let mut mirrored = Vec::new();
        while let Ok(cmd) = cmd_rx.pop() {
            mirrored.push(cmd);
        }
        assert_eq!(mirrored.len(), 2);
        assert!(matches!(
            mirrored[0],
            CrumbsCommand::AddSample { id: 1, .. }
        ));
        assert!(matches!(mirrored[1], CrumbsCommand::SetActiveSample(1)));
        assert!(instance.pending_mirror.is_empty());

        // Emptied buffers with their capacity intact came back for reuse.
        let (buf_left, buf_right) = recycle_rx.pop().expect("buffers recycled");
        assert!(buf_left.is_empty());
        assert!(buf_right.is_empty());
        assert_eq!(buf_left.capacity(), frames);
        assert_eq!(buf_right.capacity(), frames);
    }

    /// PR #579 review (non-blocking): a mirror push that hits a full
    /// command ring must be parked and retried — not silently dropped.
    #[test]
    fn drain_retries_mirror_pushes_after_ring_full() {
        let (mut instance, mut commit_tx, _recycle_rx, mut cmd_rx) = instance_with_rings();

        // Saturate the command ring (capacity 8 in the helper).
        for _ in 0..8 {
            instance
                .command_tx
                .push(CrumbsCommand::AllNotesOff)
                .unwrap();
        }
        commit_tx
            .push(PendingRecordingCommit {
                left: vec![0.5f32; 64],
                right: vec![0.5f32; 64],
                sample_rate: 48_000,
            })
            .unwrap();

        drain_pending_recording_commits(&mut instance);
        assert_eq!(
            instance.pending_mirror.len(),
            1,
            "a full command ring must park the mirror, not drop it"
        );
        assert!(
            instance.samples.contains_key(&1),
            "the take is registered command-side even while the mirror waits"
        );

        // Still full: the parked entry waits without churn.
        drain_pending_recording_commits(&mut instance);
        assert_eq!(instance.pending_mirror.len(), 1);

        // Free the ring (as the audio thread would) and re-drain: the
        // parked mirror is delivered.
        while cmd_rx.pop().is_ok() {}
        drain_pending_recording_commits(&mut instance);
        assert!(
            instance.pending_mirror.is_empty(),
            "parked mirror must be delivered once the ring drains"
        );
        let mut saw_add = false;
        let mut saw_active = false;
        while let Ok(cmd) = cmd_rx.pop() {
            match cmd {
                CrumbsCommand::AddSample { id: 1, .. } => saw_add = true,
                CrumbsCommand::SetActiveSample(1) => saw_active = true,
                _ => {}
            }
        }
        assert!(saw_add && saw_active);
    }

    /// A commit still in flight when the instance is destroyed is dropped
    /// with the rings — no panic, no use-after-free surface.
    #[test]
    fn destroy_with_pending_commit_drops_take_cleanly() {
        let (instance, mut commit_tx, _recycle_rx, _cmd_rx) = instance_with_rings();
        commit_tx
            .push(PendingRecordingCommit {
                left: vec![0.5f32; 128],
                right: vec![0.5f32; 128],
                sample_rate: 48_000,
            })
            .unwrap();

        // Mirrors destroy_crumbs: the instance (and its ring endpoints) is
        // removed/dropped without draining.
        drop(instance);
    }

    /// Issue #2231 (live defect): the crumbs record feed had a consumer — the
    /// audio thread's bridge drain feeding the slot's record input — but no
    /// producer, so an armed capture recorded silence end-to-end. This drives
    /// the producer end to end: the `audio_bridges` registration
    /// `create_crumbs` performs, the real `feed_record_input` command, and
    /// the same `drain_process` pass the render callback runs per device
    /// period, joined to a real `CrumbsPluginSlot`. (`create_crumbs` itself
    /// cannot run here — it boots a real output device — so the test wires
    /// its seam by hand.) Remove the producer and the committed take holds
    /// silence instead of the input.
    #[test]
    fn record_feed_command_pushes_monitored_input_into_the_armed_take() {
        use daw_engine::audio_bridge::create_audio_bridge;
        use daw_engine::plugin_slot::NativePlugin;

        let app_state = AppState::default();
        let state = CrumbsState::default();

        // The seam create_crumbs wires in production: a scheduler slot
        // paired with a bridge, the handle registered in the shared record
        // feed under the reserved engine plugin id.
        let (command_tx, command_rx) = rtrb::RingBuffer::new(8);
        let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
        let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
        let mut engine = CrumbsEngine::new(48_000.0);
        engine.enable_commit_handoff();
        let mut slot = CrumbsPluginSlot {
            engine,
            command_rx,
            commit_tx,
            recycle_rx,
        };
        let instance = CrumbsInstanceData {
            command_tx,
            samples: HashMap::new(),
            metering: Arc::new(CrumbsMetering::default()),
            engine_plugin_id: 1000,
            next_sample_id: 1,
            commit_rx,
            recycle_tx,
            pending_mirror: Vec::new(),
        };
        let (mut bridge, bridge_handle) = create_audio_bridge(1000);
        app_state
            .audio_bridges
            .lock()
            .unwrap()
            .bridges
            .insert(1000, bridge_handle);
        state
            .instances
            .lock()
            .unwrap()
            .insert("sampler".to_string(), instance);

        // The napi command surface: mode, arm, feed, stop.
        crate::block_on_test(set_crumbs_mode(
            "sampler".to_string(),
            "record".to_string(),
            &state,
        ))
        .unwrap();
        crate::block_on_test(arm_recording("sampler".to_string(), 0.01, 0, 10.0, &state)).unwrap();

        let interleaved = |left: f32, right: f32, frames: usize| {
            let mut bytes = Vec::with_capacity(frames * 8);
            for _ in 0..frames {
                bytes.extend_from_slice(&left.to_le_bytes());
                bytes.extend_from_slice(&right.to_le_bytes());
            }
            bytes
        };

        // Four quanta of monitored input (L=0.5, R=0.25 — the channels are
        // distinct so a swap cannot pass), each followed by the render
        // callback's per-period pass: budget = a 512-frame period plus one
        // quantum of catch-up, target depth two periods plus slack, exactly
        // as the scheduler computes them.
        for _ in 0..4 {
            crate::block_on_test(feed_record_input(interleaved(0.5, 0.25, 128), &app_state))
                .unwrap();
            bridge.drain_process(512 + 128, 10, |left, right, frames| {
                slot.process_bridged_audio(left, right, frames)
            });
        }

        crate::block_on_test(stop_recording("sampler".to_string(), &state)).unwrap();
        // One more fed (silent) block so a drain pass consumes the stop and
        // the engine hands the commit to the ring — the flush the slot
        // tests perform with a bare process call.
        crate::block_on_test(feed_record_input(interleaved(0.0, 0.0, 128), &app_state)).unwrap();
        bridge.drain_process(512 + 128, 10, |left, right, frames| {
            slot.process_bridged_audio(left, right, frames)
        });

        let mut instances = state.instances.lock().unwrap();
        let instance = instances.get_mut("sampler").unwrap();
        drain_pending_recording_commits(instance);
        let sample = instance.samples.get(&1).expect("armed take registered");
        assert_eq!(sample.meta.frame_count as usize, 512);
        assert!(
            sample.left.iter().all(|&s| (s - 0.5).abs() < 1.0e-6),
            "the take must hold the fed monitored input, not silence"
        );
        assert!(
            sample.right.iter().all(|&s| (s - 0.25).abs() < 1.0e-6),
            "the take must hold the fed monitored input on the right channel too"
        );
        drop(instances);

        // The happy path refuses nothing: every block found ring capacity.
        assert_eq!(
            app_state
                .bridge_input_blocks_refused
                .load(Ordering::Relaxed),
            0
        );
    }
}
