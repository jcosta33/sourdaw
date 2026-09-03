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
use daw_engine::scheduler::{GraphCommand, CRUMBS_CAPTURE_RESERVE};
use daw_engine::{EngineHandle, GraphBatchError};
use rtrb::Producer;
use serde::{Deserialize, Serialize};

use super::filesystem;

// ── Crumbs State ──────────────────────────────────────────────────────

/// Where one instance's audio side lives.
///
/// The engine starts lazily, on the first graph batch, and the panel can be
/// opened long before the first play. An instance created then is dormant
/// rather than refused: it holds the ring ends its slot will take and
/// registers on the engine [`attach_dormant_crumbs`] finds.
pub enum CrumbsEngineSlot {
    /// Registered on the engine's master chain and capture bus under this
    /// plugin id.
    Attached(usize),
    /// Built before the engine ran; holds the ring ends the slot takes at
    /// attach.
    Dormant(DormantCrumbsSlot),
}

/// The slot-side ends of one instance's rings, held command-side until an
/// engine exists to render them.
pub struct DormantCrumbsSlot {
    command_rx: rtrb::Consumer<CrumbsCommand>,
    commit_tx: rtrb::Producer<PendingRecordingCommit>,
    recycle_rx: rtrb::Consumer<RecordBufferPair>,
}

/// The command-side ends of the same rings.
struct CrumbsInstanceEnds {
    command_tx: Producer<CrumbsCommand>,
    commit_rx: rtrb::Consumer<PendingRecordingCommit>,
    recycle_tx: Producer<RecordBufferPair>,
}

/// One instance's rings: the command feed the slot drains, and the
/// commit-handoff pair (ledger #568) that returns takes and recycles their
/// buffers.
fn new_crumbs_rings() -> (CrumbsInstanceEnds, DormantCrumbsSlot) {
    let (command_tx, command_rx) = rtrb::RingBuffer::new(128);
    let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
    let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
    (
        CrumbsInstanceEnds {
            command_tx,
            commit_rx,
            recycle_tx,
        },
        DormantCrumbsSlot {
            command_rx,
            commit_tx,
            recycle_rx,
        },
    )
}

pub struct CrumbsInstanceData {
    pub command_tx: Producer<CrumbsCommand>,
    pub samples: HashMap<SampleId, Arc<SampleData>>,
    pub metering: Arc<CrumbsMetering>,
    pub engine_slot: CrumbsEngineSlot,
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
    #[cfg(test)]
    before_engine_lock: Mutex<Option<std::sync::mpsc::SyncSender<()>>>,
}

impl Default for CrumbsState {
    fn default() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
            #[cfg(test)]
            before_engine_lock: Mutex::new(None),
        }
    }
}

#[cfg(test)]
impl CrumbsState {
    /// Rendezvous with one create immediately before it takes the engine mutex.
    /// Test-only and per state, so parallel tests cannot observe each other.
    fn observe_next_create_before_engine_lock(&self) -> std::sync::mpsc::Receiver<()> {
        let (reached_tx, reached_rx) = std::sync::mpsc::sync_channel(0);
        let previous = self
            .before_engine_lock
            .lock()
            .expect("create observer lock should be available")
            .replace(reached_tx);
        assert!(previous.is_none(), "only one create observer may be armed");
        reached_rx
    }

    fn notify_create_before_engine_lock(&self) {
        let observer = self
            .before_engine_lock
            .lock()
            .expect("create observer lock should be available")
            .take();
        if let Some(observer) = observer {
            observer
                .send(())
                .expect("create observer receiver should remain alive");
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

/// Refuse when the session already holds its ceiling of live crumbs
/// instances.
///
/// Each live instance holds one slot of the shared effect table and one seat
/// on the engine's captured-input bus — a dormant one takes both the moment it
/// attaches, so it is counted here exactly like an attached one and attaching
/// every instance the map holds cannot overrun the reserve. The app renders
/// exactly one Crumbs panel, and re-pointing it tears the old instance down
/// asynchronously while the new one is already being created, so two can be
/// live at once. The gate this enforces is the instance map itself: a destroy
/// removes its map entry
/// before the engine slot's retirement has drained, so re-points inside that
/// teardown window can admit a third engine slot past this check — at that
/// extreme the engine's own callback-time capacity check is the last line.
/// Inside the gate, the refusal reaches the panel instead of dying as a
/// counter on the audio callback that leaves armed recording capturing
/// silence with nothing saying why.
///
/// Takes the map `create_crumbs` already holds: the check and the insert stay
/// inside that one critical section, so a create that parked mid-registration
/// cannot let a concurrent create read the same live count and slip past the
/// ceiling.
fn ensure_crumbs_capture_headroom(
    instances: &HashMap<String, CrumbsInstanceData>,
) -> Result<(), String> {
    if instances.len() >= CRUMBS_CAPTURE_RESERVE {
        return Err(format!(
            "the session holds its maximum of {CRUMBS_CAPTURE_RESERVE} live crumbs instances"
        ));
    }
    Ok(())
}

/// Build the audio-thread slot from ring ends the command side already holds
/// and publish it, returning the engine plugin id both commands name.
///
/// The slot and its record feed cross as one fenced batch. Admission checks
/// the effect table and the capture ledger for the whole batch and provisions
/// the ring to fit before the first push, so a refusal leaves nothing queued
/// and nothing to unwind. Registering the two separately could strand a slot
/// on the graph — audible, unrecordable, and owned by no instance — whenever
/// the second command was refused.
///
/// A refused batch is dropped whole by the engine, `slot_ends` with it: a
/// caller that must survive a refusal hands over ends it built for this call
/// rather than the ones it has to keep.
fn register_crumbs_slot(
    engine_handle: &mut EngineHandle,
    metering: &Arc<CrumbsMetering>,
    slot_ends: DormantCrumbsSlot,
) -> Result<usize, String> {
    // A reserved id is an opaque handle, never a dense index, so a refused
    // batch below simply leaves this one unused.
    let id = engine_handle.reserve_plugin_id();
    // The device's rate, not the caller's: this engine renders on the
    // master chain and records the tap the same device feeds.
    let mut engine = CrumbsEngine::with_metering(engine_handle.sample_rate(), Arc::clone(metering));
    engine.enable_commit_handoff();
    let DormantCrumbsSlot {
        command_rx,
        commit_tx,
        recycle_rx,
    } = slot_ends;
    let slot = CrumbsPluginSlot {
        engine,
        command_rx,
        commit_tx,
        recycle_rx,
    };

    engine_handle
        .send_graph_batch(vec![
            GraphCommand::AddPlugin(id, Box::new(slot)),
            GraphCommand::RegisterCaptureConsumer(id),
        ])
        .map_err(|error| match error {
            GraphBatchError::Refused(reason) => reason,
            // Unreachable by construction, and deliberately not unwound:
            // the only route to the audio thread is the ring that just
            // failed, so a removal command would have nowhere to go.
            GraphBatchError::Partial {
                pushed,
                total,
                error,
            } => format!(
                "the crumbs slot was published in part ({pushed} of {total} commands): {error}"
            ),
        })?;

    Ok(id)
}

/// Register every instance that was created before the engine ran.
///
/// Called from `commands::graph` on a batch that has just found or started an
/// engine, before that batch claims the engine for its own commands. Locks
/// instances then engine, the order every path holding both takes them in.
///
/// Returns one `(instance_id, reason)` per instance the engine refused. A
/// refusal here is not the graph batch's business: the instance stays dormant
/// with everything the panel queued still on its ring, and the next batch
/// tries again.
pub fn attach_dormant_crumbs(
    state: &CrumbsState,
    engine: &Mutex<Option<EngineHandle>>,
) -> Vec<(String, String)> {
    let Ok(mut instances) = state.instances.lock() else {
        return Vec::new();
    };
    let Ok(mut engine_guard) = engine.lock() else {
        return Vec::new();
    };
    let Some(engine_handle) = engine_guard.as_mut() else {
        return Vec::new();
    };

    let mut refusals = Vec::new();
    for (instance_id, instance) in instances.iter_mut() {
        let CrumbsEngineSlot::Dormant(dormant) = &mut instance.engine_slot else {
            continue;
        };

        // The engine drops a refused batch whole, ring ends included, so the
        // ends handed over are built here and adopted command-side only once
        // the batch is admitted. The dormant ring is untouched until then.
        let (mut attached_ends, slot_ends) = new_crumbs_rings();
        let id = match register_crumbs_slot(engine_handle, &instance.metering, slot_ends) {
            Ok(id) => id,
            Err(reason) => {
                refusals.push((instance_id.clone(), reason));
                continue;
            }
        };

        // Carry what the panel queued while dormant onto the ring the slot
        // now drains, in order: the engine state after the slot's first pass
        // is the one the panel set before play. Both rings are the same depth
        // and this one is empty, so all of it fits.
        while let Ok(command) = dormant.command_rx.pop() {
            let _ = attached_ends.command_tx.push(command);
        }
        instance.command_tx = attached_ends.command_tx;
        instance.commit_rx = attached_ends.commit_rx;
        instance.recycle_tx = attached_ends.recycle_tx;
        instance.engine_slot = CrumbsEngineSlot::Attached(id);
    }
    refusals
}

/// Create a new crumbs engine instance.
///
/// Takes no sample rate: the sampler records the engine's own input tap and
/// renders on the engine's master chain, so its only correct rate is the
/// device's, read from the engine handle. A rate supplied by a caller would
/// stamp every committed take — and clamp `record_max_samples` — against a
/// number the device never ran at.
///
/// A missing engine degrades rather than refuses (#2265). The engine starts
/// lazily on the first graph batch, which the app sends on play, so refusing
/// here left every panel opened before the first play dead. The instance is
/// created dormant instead: parameters, mode and samples queue on its ring,
/// and [`attach_dormant_crumbs`] registers it on that first batch.
pub async fn create_crumbs(
    instance_id: String,
    state: &CrumbsState,
    app_state: &AppState,
) -> Result<(), String> {
    // The instances lock is taken first and held through the engine
    // registration to the insert at the bottom, so the headroom decision and
    // the insert are one critical section — a count-then-act split here is
    // what let two concurrent creates both observe the same live count and
    // both register against a ceiling with one slot left. Every path holding
    // both of these locks takes them instances -> engine; `destroy_crumbs`
    // already held exactly that order, so this hold cannot invert against it
    // — including across the re-point's concurrent create/destroy pair.
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;

    // The map is also the ownership ledger for each runtime. Reject an
    // existing id before allocating rings or registering anything engine-side;
    // otherwise the insert below replaces the first ledger entry and strands
    // its slot and bridge.
    if instances.contains_key(&instance_id) {
        return Err(format!("Crumbs instance '{instance_id}' already exists"));
    }

    ensure_crumbs_capture_headroom(&instances)?;

    let (instance_ends, slot_ends) = new_crumbs_rings();
    let metering = Arc::new(CrumbsMetering::default());

    #[cfg(test)]
    state.notify_create_before_engine_lock();

    // The engine guard is scoped to the registration alone — it is the
    // engine-wide mutex, not this instance's — while the instances guard
    // above spans the whole create, per the ordering law stated there.
    let engine_slot = {
        let mut engine_guard = app_state
            .engine
            .lock()
            .map_err(|e| format!("Failed to lock engine: {e}"))?;

        match engine_guard.as_mut() {
            Some(engine_handle) => CrumbsEngineSlot::Attached(register_crumbs_slot(
                engine_handle,
                &metering,
                slot_ends,
            )?),
            None => CrumbsEngineSlot::Dormant(slot_ends),
        }
    };

    let CrumbsInstanceEnds {
        command_tx,
        commit_rx,
        recycle_tx,
    } = instance_ends;
    instances.insert(
        instance_id,
        CrumbsInstanceData {
            command_tx,
            samples: HashMap::new(),
            metering,
            engine_slot,
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

    let Some(instance) = instances.get(&instance_id) else {
        return Ok(());
    };

    // A dormant instance owns nothing engine-side — its slot was never
    // published — so the map entry is the whole of it.
    let CrumbsEngineSlot::Attached(engine_plugin_id) = instance.engine_slot else {
        instances.remove(&instance_id);
        return Ok(());
    };

    // Keep the ownership ledger intact until every fallible lock and the
    // scheduler-removal admission succeed. A full command ring means the
    // runtime is still live, so its map entry must remain reachable for
    // retry. Lock order stays instances -> engine.
    let mut engine_guard = app_state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {e}"))?;

    if let Some(ref mut engine_handle) = *engine_guard {
        // No matching unregister: removal takes the id off the capture ledger
        // and off the callback's input bus with the slot it belongs to, so an
        // unregister here would be a second release of a consumer that is
        // already gone.
        engine_handle.remove_plugin(engine_plugin_id)?;
    }

    // Once queued, scheduler retirement is inevitable. No fallible work may
    // follow before command-side ownership is erased.
    instances.remove(&instance_id);
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

    ensure_slot_is_attached(instance)?;
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

    ensure_slot_is_attached(instance)?;
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

    ensure_slot_is_attached(instance)?;
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

    ensure_slot_is_attached(instance)?;
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

    ensure_slot_is_attached(instance)?;
    drain_pending_recording_commits(instance);
    instance
        .command_tx
        .push(CrumbsCommand::StopRecording)
        .map_err(|_| "Command queue full")?;
    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────

/// Refuse a gesture that only the audio thread can answer.
///
/// A dormant instance has no slot rendering it, so a note would sound nothing
/// and an armed take would capture nothing — both silently, and both while
/// the panel reports the gesture as taken. Everything else an instance
/// accepts is state the slot reads on its first pass, so it queues instead.
fn ensure_slot_is_attached(instance: &CrumbsInstanceData) -> Result<(), String> {
    match instance.engine_slot {
        CrumbsEngineSlot::Attached(_) => Ok(()),
        CrumbsEngineSlot::Dormant(_) => Err("Native engine not running".to_string()),
    }
}

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
            engine_slot: CrumbsEngineSlot::Attached(0),
            next_sample_id: 1,
            commit_rx,
            recycle_tx,
            pending_mirror: Vec::new(),
        };
        (instance, commit_tx, recycle_rx, cmd_rx)
    }

    /// Whether the instance is still waiting for an engine to attach to.
    fn slot_is_dormant(state: &CrumbsState, instance_id: &str) -> bool {
        let instances = state
            .instances
            .lock()
            .expect("crumbs state lock should be available");
        let instance = instances
            .get(instance_id)
            .unwrap_or_else(|| panic!("instance '{instance_id}' should own a map entry"));
        matches!(instance.engine_slot, CrumbsEngineSlot::Dormant(_))
    }

    /// The engine id an attached instance owns. A dormant one owns none, so
    /// asking is the assertion.
    fn attached_plugin_id(state: &CrumbsState, instance_id: &str) -> usize {
        let instances = state
            .instances
            .lock()
            .expect("crumbs state lock should be available");
        let instance = instances
            .get(instance_id)
            .unwrap_or_else(|| panic!("instance '{instance_id}' should own a map entry"));
        match instance.engine_slot {
            CrumbsEngineSlot::Attached(id) => id,
            CrumbsEngineSlot::Dormant(_) => {
                panic!("instance '{instance_id}' should be attached to the engine")
            }
        }
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

    /// The session-limit predicate itself, at the ceiling, in the wording
    /// that names it: a stray create (a double init, a retry racing a slow
    /// destroy) must refuse where the panel can report it, not as a
    /// capture-slot refusal on the callback that leaves recording armed and
    /// capturing silence with nothing saying why. The predicate is only half
    /// the guarantee; the create path's call is pinned by
    /// `create_crumbs_refuses_at_the_capture_ceiling_before_touching_the_engine`.
    #[test]
    fn the_crumbs_capture_ceiling_predicate_refuses_with_the_limit_named() {
        let state = CrumbsState::default();
        {
            let instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            assert!(ensure_crumbs_capture_headroom(&instances).is_ok());
        }

        {
            let mut instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            for index in 0..CRUMBS_CAPTURE_RESERVE {
                let (instance, _commit_tx, _recycle_rx, _cmd_rx) = instance_with_rings();
                instances.insert(format!("instance-{index}"), instance);
            }
        }

        let refusal = {
            let instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            ensure_crumbs_capture_headroom(&instances)
                .expect_err("a session at the capture ceiling must refuse another instance")
        };
        assert_eq!(
            refusal,
            format!(
                "the session holds its maximum of {CRUMBS_CAPTURE_RESERVE} live crumbs instances"
            )
        );

        // Destroying is what makes room: one below the ceiling admits again.
        state
            .instances
            .lock()
            .expect("crumbs state lock should be available")
            .remove("instance-0");
        {
            let instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            assert!(ensure_crumbs_capture_headroom(&instances).is_ok());
        }
    }

    /// Wiring: the ceiling the predicate states is the one `create_crumbs`
    /// itself enforces, before any engine dependency — the check runs ahead
    /// of the engine lock. A state at the ceiling must refuse with the
    /// ceiling message; with the call unwired, this same state has no engine
    /// and the create would succeed as a dormant instance, so the refusal
    /// itself pins the call site. The ceiling counts dormant instances too:
    /// each one takes a seat on the capture bus the moment it attaches.
    #[test]
    fn create_crumbs_refuses_at_the_capture_ceiling_before_touching_the_engine() {
        let state = CrumbsState::default();
        {
            let mut instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            for index in 0..CRUMBS_CAPTURE_RESERVE {
                let (instance, _commit_tx, _recycle_rx, _cmd_rx) = instance_with_rings();
                instances.insert(format!("instance-{index}"), instance);
            }
        }

        let app_state = AppState::default();
        let refusal = crate::block_on_test(create_crumbs(
            "instance-overflow".to_string(),
            &state,
            &app_state,
        ))
        .expect_err("a create at the capture ceiling must refuse");

        assert_eq!(
            refusal,
            format!(
                "the session holds its maximum of {CRUMBS_CAPTURE_RESERVE} live crumbs instances"
            ),
            "the refusal must be the ceiling's own message, not the missing engine's"
        );

        // Nothing was created past the refusal.
        let instances = state
            .instances
            .lock()
            .expect("crumbs state lock should be available");
        assert_eq!(instances.len(), CRUMBS_CAPTURE_RESERVE);
        assert!(!instances.contains_key("instance-overflow"));
    }

    /// Pop the fenced batch one successful create queues — the two-command
    /// fence, the master-chain slot, then its registration on the engine's
    /// input bus — and return the engine plugin id both commands name.
    fn pop_create_commands(command_rx: &mut rtrb::Consumer<GraphCommand>) -> usize {
        match command_rx.pop() {
            Ok(GraphCommand::BeginBatch { commands }) => assert_eq!(
                commands, 2,
                "the create's fence must announce the slot and its capture registration"
            ),
            Ok(_) => panic!("a create must publish its registration behind a batch fence"),
            Err(_) => panic!("a create must queue its batch fence"),
        }
        let id = match command_rx.pop() {
            Ok(GraphCommand::AddPlugin(id, _)) => id,
            Ok(_) => panic!("the batch's first command must register the crumbs slot"),
            Err(_) => panic!("a create must queue the slot registration"),
        };
        match command_rx.pop() {
            Ok(GraphCommand::RegisterCaptureConsumer(registered)) => {
                assert_eq!(
                    registered, id,
                    "the capture registration must name the slot it feeds"
                );
            }
            Ok(_) => panic!("the batch's second command must register the capture consumer"),
            Err(_) => panic!("a create must queue the capture registration"),
        }
        id
    }

    /// A second create for the same UI/runtime id is refused while the
    /// instances guard still owns the first entry. The original registration
    /// survives unchanged, so the engine slot, effect-table ledger, capture
    /// ledger, and command-side map cannot grow or leak a runtime that
    /// destroy no longer reaches.
    #[test]
    fn create_crumbs_refuses_a_duplicate_id_without_registering_another_runtime() {
        let state = CrumbsState::default();
        let app_state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        {
            *app_state
                .engine
                .lock()
                .expect("engine lock should be available") = Some(engine);
        }

        let instance_id = "duplicate-crumbs";
        crate::block_on_test(create_crumbs(instance_id.to_string(), &state, &app_state))
            .expect("the first create should register its runtime");

        let original_engine_plugin_id = attached_plugin_id(&state, instance_id);
        let registered_engine_plugin_id = pop_create_commands(&mut command_rx);
        assert_eq!(
            registered_engine_plugin_id, original_engine_plugin_id,
            "the map entry must own the engine id carried by the registration command"
        );
        assert!(
            command_rx.pop().is_err(),
            "one successful create must queue exactly the slot and its capture registration"
        );

        let refusal =
            crate::block_on_test(create_crumbs(instance_id.to_string(), &state, &app_state))
                .expect_err("a duplicate create must be refused");
        assert_eq!(
            refusal,
            format!("Crumbs instance '{instance_id}' already exists")
        );

        assert_eq!(
            state
                .instances
                .lock()
                .expect("crumbs state lock should be available")
                .len(),
            1,
            "the duplicate must not grow the map"
        );
        assert_eq!(
            attached_plugin_id(&state, instance_id),
            original_engine_plugin_id,
            "the duplicate must not overwrite the first runtime entry"
        );

        assert!(
            command_rx.pop().is_err(),
            "the duplicate must not queue another engine/effect registration"
        );

        crate::block_on_test(destroy_crumbs(instance_id.to_string(), &state, &app_state))
            .expect("the original runtime must remain destroyable after the refusal");
        let removed_engine_plugin_id = match command_rx.pop() {
            Ok(daw_engine::scheduler::GraphCommand::RemovePluginWithBridge(id)) => id,
            Ok(_) => panic!("destroy must queue the plugin removal command"),
            Err(_) => panic!("destroy must queue one engine removal command"),
        };
        assert_eq!(
            removed_engine_plugin_id, registered_engine_plugin_id,
            "destroy must remove the exact engine id registered by the original create"
        );
        assert!(
            command_rx.pop().is_err(),
            "destroy must queue exactly one engine removal command"
        );
        assert!(
            !state
                .instances
                .lock()
                .expect("crumbs state lock should be available")
                .contains_key(instance_id),
            "destroy must remove the original map entry"
        );
    }

    /// A full scheduler command ring refuses destruction before the runtime
    /// ownership ledger is changed. Once capacity is available, the retry must
    /// queue the exact original retirement once and only then erase ownership.
    #[test]
    fn destroy_crumbs_keeps_the_runtime_owned_until_removal_is_admitted() {
        const INSTANCE_ID: &str = "queue-full-destroy-crumbs";

        let state = CrumbsState::default();
        let app_state = AppState::default();
        // Exactly the create's batch — fence plus two commands — so the ring is
        // full when destroy asks for its removal, and admission finds the room
        // it needs without reallocating the channel out from under this test.
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(3);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("create should fill the scheduler ring");

        let original_engine_plugin_id = attached_plugin_id(&state, INSTANCE_ID);

        let refusal =
            crate::block_on_test(destroy_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
                .expect_err("destroy must refuse while scheduler-removal admission is full");
        assert_eq!(refusal, "Audio command queue full");
        assert_eq!(
            attached_plugin_id(&state, INSTANCE_ID),
            original_engine_plugin_id,
            "failed admission must preserve the ownership entry"
        );

        let registered_engine_plugin_id = pop_create_commands(&mut command_rx);
        assert_eq!(registered_engine_plugin_id, original_engine_plugin_id);
        assert!(
            command_rx.pop().is_err(),
            "failed destroy must not queue a removal command"
        );

        crate::block_on_test(destroy_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("destroy should succeed after scheduler capacity is drained");

        let removed_engine_plugin_id = match command_rx.pop() {
            Ok(daw_engine::scheduler::GraphCommand::RemovePluginWithBridge(id)) => id,
            Ok(_) => panic!("retry must queue the plugin removal command"),
            Err(_) => panic!("retry must queue one engine removal command"),
        };
        assert_eq!(
            removed_engine_plugin_id, original_engine_plugin_id,
            "retry must remove the exact runtime registered by create"
        );
        assert!(
            command_rx.pop().is_err(),
            "retry must queue exactly one engine removal command"
        );
        assert!(
            !state
                .instances
                .lock()
                .expect("crumbs state lock should be available")
                .contains_key(INSTANCE_ID),
            "ownership entry may disappear only after removal admission succeeds"
        );
    }

    /// The instances mutex is the create transaction boundary: while one
    /// create is parked on engine registration, another create of the same id
    /// cannot pass the identity check or register a second runtime.
    #[test]
    fn concurrent_duplicate_create_holds_the_instances_lock_through_registration() {
        const INSTANCE_ID: &str = "concurrent-duplicate-crumbs";

        let state = Arc::new(CrumbsState::default());
        let app_state = Arc::new(AppState::default());
        let first_reached_engine_lock = state.observe_next_create_before_engine_lock();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        // Park the first create at the engine lock. It must retain the
        // instances lock while parked; that is the ownership invariant under
        // test, observed directly with try_lock below.
        let engine_guard = app_state
            .engine
            .lock()
            .expect("engine lock should be available");
        let first_state = Arc::clone(&state);
        let first_app_state = Arc::clone(&app_state);
        let first_create = std::thread::spawn(move || {
            crate::block_on_test(create_crumbs(
                INSTANCE_ID.to_string(),
                &first_state,
                &first_app_state,
            ))
        });
        first_reached_engine_lock
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("first create should reach the engine lock within the bounded wait");
        match state.instances.try_lock() {
            Err(std::sync::TryLockError::WouldBlock) => {}
            Err(std::sync::TryLockError::Poisoned(_)) => {
                panic!("crumbs instances lock must not be poisoned")
            }
            Ok(_) => {
                panic!("the first create must hold the instances lock while blocked on the engine")
            }
        }

        let (second_started_tx, second_started_rx) = std::sync::mpsc::sync_channel(0);
        let second_state = Arc::clone(&state);
        let second_app_state = Arc::clone(&app_state);
        let second_create = std::thread::spawn(move || {
            second_started_tx
                .send(())
                .expect("second-create start receiver should remain alive");
            crate::block_on_test(create_crumbs(
                INSTANCE_ID.to_string(),
                &second_state,
                &second_app_state,
            ))
        });
        second_started_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("second create should start within the bounded wait");

        drop(engine_guard);

        first_create
            .join()
            .expect("first create thread should not panic")
            .expect("the lock-owning first create must succeed");
        let second_refusal = second_create
            .join()
            .expect("second create thread should not panic")
            .expect_err("the concurrent duplicate create must be refused");
        assert_eq!(
            second_refusal,
            format!("Crumbs instance '{INSTANCE_ID}' already exists")
        );

        let registered_engine_plugin_id = pop_create_commands(&mut command_rx);
        assert!(
            command_rx.pop().is_err(),
            "the concurrent creates must queue exactly one create's engine commands"
        );
        assert_eq!(
            state
                .instances
                .lock()
                .expect("crumbs state lock should be available")
                .len(),
            1
        );
        assert_eq!(
            attached_plugin_id(&state, INSTANCE_ID),
            registered_engine_plugin_id,
            "the successful create must own one map entry"
        );
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
    /// slot's record input — but no producer, so an armed capture recorded
    /// silence end-to-end. The producer is now the engine's own input tap.
    /// This drives the whole path the napi surface owns against a real
    /// `CrumbsPluginSlot`: mode, arm and stop through the real commands, the
    /// master-chain pass as the per-period clock, and the tap as the feed.
    /// (`create_crumbs` publishes its slot to an engine rather than returning
    /// it, so the test wires that seam by hand and drives the slot directly.)
    /// Sever the tap and the committed take holds silence instead of the
    /// input.
    #[test]
    fn the_capture_tap_fills_the_armed_take_across_the_command_surface() {
        use daw_engine::plugin_slot::{CaptureInputBlock, NativePlugin, TransportState};

        let state = CrumbsState::default();

        // The seam create_crumbs wires in production: a scheduler slot on the
        // master chain, its command and handoff rings held command-side.
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
            engine_slot: CrumbsEngineSlot::Attached(1000),
            next_sample_id: 1,
            commit_rx,
            recycle_tx,
            pending_mirror: Vec::new(),
        };
        state
            .instances
            .lock()
            .unwrap()
            .insert("sampler".to_string(), instance);

        // The napi command surface: mode, arm, stop.
        crate::block_on_test(set_crumbs_mode(
            "sampler".to_string(),
            "record".to_string(),
            &state,
        ))
        .unwrap();
        crate::block_on_test(arm_recording("sampler".to_string(), 0.01, 0, 10.0, &state)).unwrap();

        const PERIOD_FRAMES: usize = 512;
        const CAPTURE_FRAMES: usize = 128;
        let render_period = |slot: &mut CrumbsPluginSlot| {
            let mut left = vec![0.0f32; PERIOD_FRAMES];
            let mut right = vec![0.0f32; PERIOD_FRAMES];
            slot.process_with_events(
                &mut left,
                &mut right,
                PERIOD_FRAMES,
                &[],
                &TransportState::default(),
            );
        };

        // The queued commands reach the engine on the next master-chain pass.
        render_period(&mut slot);

        // Four chunks of captured input (L=0.5, R=0.25 — distinct, so a
        // swapped feed cannot pass), each delivered ahead of the block it was
        // captured for, exactly as the render callback delivers it.
        let left = vec![0.5f32; CAPTURE_FRAMES];
        let right = vec![0.25f32; CAPTURE_FRAMES];
        let mut position_frames = 0u64;
        for _ in 0..4 {
            slot.process_capture_input(CaptureInputBlock {
                left: &left,
                right: &right,
                frames: CAPTURE_FRAMES,
                served: true,
                latency_frames: 0,
                position_frames,
            });
            position_frames += CAPTURE_FRAMES as u64;
            render_period(&mut slot);
        }

        crate::block_on_test(stop_recording("sampler".to_string(), &state)).unwrap();
        // One more period so the pass consumes the stop and the engine hands
        // the commit to the ring.
        render_period(&mut slot);

        let mut instances = state.instances.lock().unwrap();
        let instance = instances.get_mut("sampler").unwrap();
        drain_pending_recording_commits(instance);
        let sample = instance.samples.get(&1).expect("armed take registered");
        assert_eq!(sample.meta.frame_count as usize, 4 * CAPTURE_FRAMES);
        assert!(
            sample.left.iter().all(|&s| (s - 0.5).abs() < 1.0e-6),
            "the take must hold the captured input, not silence"
        );
        assert!(
            sample.right.iter().all(|&s| (s - 0.25).abs() < 1.0e-6),
            "the take must hold the captured input on the right channel too"
        );
    }

    /// A create publishes the sampler twice: once on the master chain, once on
    /// the engine's input tap. Both name the same reserved id, and the slot
    /// goes first — a registration for an id the graph has not been told about
    /// is admitted, but the pair is what makes the sampler both audible and
    /// able to record.
    #[test]
    fn create_crumbs_registers_the_slot_and_its_capture_feed() {
        let state = CrumbsState::default();
        let app_state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        // The engine handle's own rate is the one the slot is built at: a
        // take is stamped, and `record_max_samples` clamped, against that
        // number and no other.
        crate::block_on_test(create_crumbs("tap-sampler".to_string(), &state, &app_state))
            .expect("a create with capture headroom should register its runtime");

        match command_rx.pop() {
            Ok(GraphCommand::BeginBatch { commands }) => assert_eq!(commands, 2),
            Ok(_) => panic!("a create must publish its registration behind a batch fence"),
            Err(_) => panic!("a create must queue its batch fence"),
        }
        let registered_engine_plugin_id = match command_rx.pop() {
            Ok(GraphCommand::AddPlugin(id, plugin)) => {
                let slot = plugin
                    .as_any()
                    .downcast_ref::<CrumbsPluginSlot>()
                    .expect("the registered plugin must be the crumbs slot");
                assert_eq!(
                    slot.engine.sample_rate(),
                    48_000.0,
                    "the slot must be built at the engine handle's rate, not the caller's"
                );
                id
            }
            Ok(_) => panic!("the batch's first command must register the crumbs slot"),
            Err(_) => panic!("a create must queue the slot registration"),
        };
        match command_rx.pop() {
            Ok(GraphCommand::RegisterCaptureConsumer(registered)) => {
                assert_eq!(
                    registered, registered_engine_plugin_id,
                    "the capture registration must name the slot it feeds"
                );
            }
            Ok(_) => panic!("the batch's second command must register the capture consumer"),
            Err(_) => panic!("a create must queue the capture registration"),
        }
        assert!(
            command_rx.pop().is_err(),
            "a create must queue its fence, the slot and its capture registration, nothing else"
        );
        assert_eq!(
            attached_plugin_id(&state, "tap-sampler"),
            registered_engine_plugin_id,
            "the create must publish its ownership entry"
        );
    }

    /// The capture ledger is the authority on the input bus, and it refuses
    /// independently of the instance ceiling. A sampler that cannot record is
    /// not a sampler, so the batch is refused whole: nothing reaches the ring,
    /// there is no slot to unwind, and no instance the panel would show as
    /// live. Two separate pushes would leave the `AddPlugin` on the ring.
    #[test]
    fn create_crumbs_pushes_nothing_when_the_capture_bus_refuses_it() {
        let state = CrumbsState::default();
        let app_state = AppState::default();
        let (mut engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        // Fill the input bus's reserve through the ledger the handle owns, so
        // the create's own registration is the one that overruns it.
        for offset in 0..CRUMBS_CAPTURE_RESERVE {
            engine
                .register_capture_consumer(900 + offset)
                .expect("the reserve must admit its own consumers");
        }
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        let refusal = crate::block_on_test(create_crumbs(
            "refused-sampler".to_string(),
            &state,
            &app_state,
        ))
        .expect_err("a create whose capture registration is refused must fail");
        assert!(
            refusal.starts_with("capture-bus-full:"),
            "the refusal must be the capture ledger's own: {refusal}"
        );

        for _ in 0..CRUMBS_CAPTURE_RESERVE {
            assert!(
                matches!(
                    command_rx.pop(),
                    Ok(GraphCommand::RegisterCaptureConsumer(_))
                ),
                "the reserve's own registrations must be all the ring holds"
            );
        }
        assert!(
            command_rx.pop().is_err(),
            "a refused batch must leave nothing at all on the ring — no fence, no slot"
        );
        assert!(
            state
                .instances
                .lock()
                .expect("crumbs state lock should be available")
                .is_empty(),
            "a refused create must leave no instance behind"
        );
    }

    /// Issue #2265 (live defect): the engine starts lazily on the first graph
    /// batch, which the app sends on play, so a create before then refused and
    /// left the panel with a sampler that stayed dead for the session. The
    /// create degrades instead — the instance exists and takes the state its
    /// slot will read — and only the gestures the audio thread has to answer
    /// are refused, where the panel can report them.
    #[test]
    fn create_crumbs_without_an_engine_holds_a_dormant_instance() {
        const INSTANCE_ID: &str = "before-first-play";

        let state = CrumbsState::default();
        let app_state = AppState::default();
        assert!(
            app_state
                .engine
                .lock()
                .expect("engine lock should be available")
                .is_none(),
            "this fixture is a session that has not sent its first graph batch"
        );

        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("a create before the engine runs must degrade, not refuse");
        assert!(
            slot_is_dormant(&state, INSTANCE_ID),
            "the instance holds the ring ends its slot takes at attach"
        );

        crate::block_on_test(set_crumbs_param(
            INSTANCE_ID.to_string(),
            "filterCutoff".to_string(),
            0.25,
            &state,
        ))
        .expect("state the slot reads on its first pass queues while dormant");

        assert_eq!(
            crate::block_on_test(arm_recording(
                INSTANCE_ID.to_string(),
                0.01,
                0,
                10.0,
                &state
            )),
            Err("Native engine not running".to_string()),
            "an arm with no slot rendering it would capture silence and say nothing"
        );
        assert_eq!(
            crate::block_on_test(crumbs_note_on(INSTANCE_ID.to_string(), 60, 100, &state)),
            Err("Native engine not running".to_string()),
            "a note with no slot rendering it would sound nothing and say nothing"
        );

        crate::block_on_test(destroy_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("a dormant instance destroys without an engine to remove it from");
        assert!(
            state
                .instances
                .lock()
                .expect("crumbs state lock should be available")
                .is_empty(),
            "destroy erases the whole of a dormant instance: its map entry"
        );
    }

    /// The first graph batch is where a dormant instance becomes a sampler: it
    /// publishes exactly the batch a create with an engine publishes, and the
    /// commands the panel queued while dormant reach the ring the slot drains,
    /// so the engine state after its first pass is the one the panel set
    /// before play.
    #[test]
    fn a_dormant_instance_attaches_on_the_engine_it_finds() {
        const INSTANCE_ID: &str = "before-first-play";

        let state = CrumbsState::default();
        let app_state = AppState::default();
        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("a create before the engine runs must degrade, not refuse");
        crate::block_on_test(set_crumbs_param(
            INSTANCE_ID.to_string(),
            "filterCutoff".to_string(),
            0.25,
            &state,
        ))
        .expect("state the slot reads on its first pass queues while dormant");

        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        let refusals = attach_dormant_crumbs(&state, &app_state.engine);
        assert!(
            refusals.is_empty(),
            "the engine had room for this slot: {refusals:?}"
        );

        match command_rx.pop() {
            Ok(GraphCommand::BeginBatch { commands }) => assert_eq!(
                commands, 2,
                "the attach's fence must announce the slot and its capture registration"
            ),
            Ok(_) => panic!("an attach must publish its registration behind a batch fence"),
            Err(_) => panic!("an attach must queue its batch fence"),
        }
        let registered_engine_plugin_id = match command_rx.pop() {
            Ok(GraphCommand::AddPlugin(id, mut plugin)) => {
                let slot = plugin
                    .as_any_mut()
                    .downcast_mut::<CrumbsPluginSlot>()
                    .expect("the registered plugin must be the crumbs slot");
                assert_eq!(
                    slot.engine.sample_rate(),
                    48_000.0,
                    "the slot must be built at the rate of the engine it attaches to"
                );
                assert!(
                    matches!(slot.command_rx.pop(), Ok(CrumbsCommand::SetParam { .. })),
                    "what the panel set while dormant must reach the ring the slot drains"
                );
                id
            }
            Ok(_) => panic!("the batch's first command must register the crumbs slot"),
            Err(_) => panic!("an attach must queue the slot registration"),
        };
        match command_rx.pop() {
            Ok(GraphCommand::RegisterCaptureConsumer(registered)) => assert_eq!(
                registered, registered_engine_plugin_id,
                "the capture registration must name the slot it feeds"
            ),
            Ok(_) => panic!("the batch's second command must register the capture consumer"),
            Err(_) => panic!("an attach must queue the capture registration"),
        }
        assert!(
            command_rx.pop().is_err(),
            "an attach must queue its fence, the slot and its capture registration, nothing else"
        );

        assert_eq!(
            attached_plugin_id(&state, INSTANCE_ID),
            registered_engine_plugin_id,
            "the map entry must own the engine id carried by the registration command"
        );
    }

    /// An engine that refuses the attach leaves the instance exactly as it
    /// was: still dormant, still holding the ring the panel is pushing into,
    /// and attachable on the next batch. Attaching against an already-full
    /// capture bus is what a session that re-points its panel meets.
    #[test]
    fn a_refused_attach_stays_dormant() {
        const INSTANCE_ID: &str = "before-first-play";

        let state = CrumbsState::default();
        let app_state = AppState::default();
        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("a create before the engine runs must degrade, not refuse");

        let (mut engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        // Fill the input bus's reserve through the ledger the handle owns, so
        // the attach's own registration is the one that overruns it.
        for offset in 0..CRUMBS_CAPTURE_RESERVE {
            engine
                .register_capture_consumer(900 + offset)
                .expect("the reserve must admit its own consumers");
        }
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);
        for _ in 0..CRUMBS_CAPTURE_RESERVE {
            assert!(
                matches!(
                    command_rx.pop(),
                    Ok(GraphCommand::RegisterCaptureConsumer(_))
                ),
                "the reserve's own registrations are all the ring holds going in"
            );
        }

        let refusals = attach_dormant_crumbs(&state, &app_state.engine);
        assert_eq!(refusals.len(), 1, "one dormant instance, one refusal");
        let (refused_instance_id, reason) = &refusals[0];
        assert_eq!(refused_instance_id, INSTANCE_ID);
        assert!(
            reason.starts_with("capture-bus-full:"),
            "the reason must be the capture ledger's own: {reason}"
        );

        assert!(
            slot_is_dormant(&state, INSTANCE_ID),
            "a refused attach must leave the instance where the next batch can retry it"
        );
        assert!(
            command_rx.pop().is_err(),
            "a refused batch must leave nothing at all on the ring — no fence, no slot"
        );
    }
}
