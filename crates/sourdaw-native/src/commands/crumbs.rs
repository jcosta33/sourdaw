//! The Unified Crumbs Suite: sample loading, playback control, analysis, and
//! waveform peak retrieval.
//!
//! An instance's audio side is registered detached and runs every callback all
//! the same. The slot's process call is the only drain of the command ring this
//! module keeps the sending end of, so the engine hands it a discarded block
//! until a strip chain splices the device in — see [`CrumbsEngineSlot`],
//! [`register_crumbs_slot`] and
//! [`daw_engine::plugin_slot::NativePlugin::runs_while_detached`].

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::{
    CrumbsCommandSender, CrumbsPluginSlot, CrumbsSlotLifetime, NativeCrumbsCommand,
    NativePreparedTake, NativeTakeReadout, NativeTakeSession, PendingRecordingCommit,
    RecordBufferPair, TAKE_CANCELLED, TAKE_COMPLETED, TAKE_FAILED, TAKE_FINISHING, TAKE_RECORDING,
    TAKE_WAITING,
};
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
use daw_engine::midi::note_store::MidiNoteStore;
use daw_engine::scheduler::{GraphCommand, CRUMBS_CAPTURE_RESERVE};
use daw_engine::{CaptureCompletionService, CaptureServiceProgress, EngineHandle, GraphBatchError};
use rtrb::Producer;
use serde::{Deserialize, Serialize};

use super::filesystem;
use super::graph::GraphRegistry;

// ── Crumbs State ──────────────────────────────────────────────────────

/// Where one instance's audio side lives.
///
/// The engine starts lazily, on the first graph batch, and the panel can be
/// opened long before the first play. An instance created then is dormant
/// rather than refused: it parks the panel's writes command-side and takes
/// its rings on the engine [`attach_dormant_crumbs`] finds.
pub enum CrumbsEngineSlot {
    /// Registered detached under this plugin id. Only accepted takes acquire
    /// the input bus; this payload owns the slot's control and handback rings.
    ///
    /// Detached is where the instance waits until a strip chain borrows it:
    /// `commands::graph` splices a `builtin-crumbs` device onto this very
    /// plugin id, so the pads sound inside that track's fader, pan, mute,
    /// inserts and sends. Homed on the master insert chain instead — which is
    /// what `AddPlugin` does — they would sound outside every one of them, and
    /// taking the device off the strip would leave the sampler rendering over
    /// the whole mix.
    ///
    /// Waiting, not idle: the engine renders the slot every callback while it
    /// waits, into scratch it discards, because the slot's process call is what
    /// drains the rings this side writes into
    /// ([`register_crumbs_slot`]).
    Attached {
        plugin_id: usize,
        ends: CrumbsInstanceEnds,
    },
    /// Created before the engine ran; holds the writes the slot will read on
    /// its first pass.
    Dormant(DormantCrumbsWrites),
}

/// What the panel set before an engine existed to hear it.
///
/// State, not a queue: a knob drag sends a value every animation frame, and a
/// buffer of gestures would either overflow or replay a drag the engine has no
/// reason to hear. Only the value the panel settled on matters, so each write
/// overwrites the one it supersedes and nothing here can grow with time.
#[derive(Default)]
pub struct DormantCrumbsWrites {
    /// Last write per parameter. `CrumbsParam` is `Copy` and `Eq` but not
    /// `Hash`, so the table is a vector searched in place; it is bounded by
    /// the parameter count.
    params: Vec<(CrumbsParam, f32)>,
    recording: CrumbsRecordingState,
    active_sample: Option<SampleId>,
}

/// The command-side ends of one instance's rings.
pub struct CrumbsInstanceEnds {
    command_tx: CrumbsCommandSender,
    /// Receives committed takes from the audio thread (O(1) engine handoff,
    /// ledger #568); drained by drain_pending_recording_commits off-thread.
    commit_rx: rtrb::Consumer<PendingRecordingCommit>,
    /// Returns emptied record-buffer pairs to the audio thread for reuse.
    recycle_tx: Producer<RecordBufferPair>,
    retired_take_rx: rtrb::Consumer<Arc<NativeTakeSession>>,
    lifetime: Arc<CrumbsSlotLifetime>,
    recording: CrumbsRecordingState,
    pending_recycle: Option<RecordBufferPair>,
}

/// The slot-side ends of the same rings, handed to the audio thread with the
/// slot they belong to.
pub struct CrumbsSlotEnds {
    command_rx: rtrb::Consumer<NativeCrumbsCommand>,
    commit_tx: rtrb::Producer<PendingRecordingCommit>,
    recycle_rx: rtrb::Consumer<RecordBufferPair>,
    retired_take_tx: Producer<Arc<NativeTakeSession>>,
    lifetime: Arc<CrumbsSlotLifetime>,
}

/// One instance's rings: the command feed the slot drains, and the
/// commit-handoff pair (ledger #568) that returns takes and recycles their
/// buffers. Allocated at registration, never before — a dormant instance has
/// no reader for a ring, and a ring nobody drains is a ring that overflows.
fn new_crumbs_rings() -> (CrumbsInstanceEnds, CrumbsSlotEnds) {
    let (command_tx, command_rx) = rtrb::RingBuffer::new(128);
    let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
    let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
    let (retired_take_tx, retired_take_rx) = rtrb::RingBuffer::new(2);
    let lifetime = Arc::new(CrumbsSlotLifetime::default());
    (
        CrumbsInstanceEnds {
            command_tx: CrumbsCommandSender(command_tx),
            commit_rx,
            recycle_tx,
            retired_take_rx,
            lifetime: Arc::clone(&lifetime),
            recording: CrumbsRecordingState::default(),
            pending_recycle: None,
        },
        CrumbsSlotEnds {
            command_rx,
            commit_tx,
            recycle_rx,
            retired_take_tx,
            lifetime,
        },
    )
}

pub struct CrumbsInstanceData {
    pub samples: HashMap<SampleId, Arc<SampleData>>,
    pub metering: Arc<CrumbsMetering>,
    pub engine_slot: CrumbsEngineSlot,
    pub next_sample_id: SampleId,
    /// Engine-mirror entries (AddSample + SetActiveSample) a full command
    /// ring refused; retried at the top of every drain (PR #579 review). An
    /// entry leaves only once both halves land, so a selection the ring
    /// refuses is retried rather than lost. Retries are idempotent:
    /// AddSample uses set() with the same id and data.
    pub pending_mirror: Vec<(SampleId, Arc<SampleData>)>,
}

struct CrumbsRecordingState {
    incarnation: u64,
    revisions: Arc<AtomicU64>,
    mode: Option<CrumbsMode>,
    take: Option<Arc<NativeTakeSession>>,
}
impl Default for CrumbsRecordingState {
    fn default() -> Self {
        Self {
            incarnation: next_incarnation(),
            revisions: Arc::new(AtomicU64::new(0)),
            mode: None,
            take: None,
        }
    }
}

impl CrumbsInstanceData {
    fn recording(&self) -> &CrumbsRecordingState {
        match &self.engine_slot {
            CrumbsEngineSlot::Attached { ends, .. } => &ends.recording,
            CrumbsEngineSlot::Dormant(writes) => &writes.recording,
        }
    }
    fn recording_mut(&mut self) -> &mut CrumbsRecordingState {
        match &mut self.engine_slot {
            CrumbsEngineSlot::Attached { ends, .. } => &mut ends.recording,
            CrumbsEngineSlot::Dormant(writes) => &mut writes.recording,
        }
    }
    /// The one route from a command handler to the engine.
    ///
    /// Attached, that is the command ring. Dormant, it is the parked-write
    /// table: the engine reads this state on the slot's first pass, so a
    /// write made before play lands exactly as one made after it.
    fn send(&mut self, command: CrumbsCommand) -> Result<(), String> {
        let mode = match &command {
            CrumbsCommand::SetMode(mode) => Some(*mode),
            _ => None,
        };
        match &mut self.engine_slot {
            CrumbsEngineSlot::Attached { ends, .. } => ends
                .command_tx
                .push(command)
                .map_err(|_| "Command queue full".to_string())?,
            CrumbsEngineSlot::Dormant(writes) => writes.record(command)?,
        }
        if let Some(mode) = mode {
            self.recording_mut().mode = Some(mode);
        }
        Ok(())
    }
}

impl DormantCrumbsWrites {
    /// Park a write, or refuse a gesture only a running audio thread can
    /// answer.
    ///
    /// A note would sound nothing and an armed take would capture nothing,
    /// both silently and both while the panel reports the gesture as taken,
    /// so those refuse where the panel can report them. Anything not parked
    /// here is refused for that reason.
    fn record(&mut self, command: CrumbsCommand) -> Result<(), String> {
        match command {
            CrumbsCommand::SetParam { param, value } => {
                match self.params.iter_mut().find(|(held, _)| *held == param) {
                    Some(held) => held.1 = value,
                    None => self.params.push((param, value)),
                }
                Ok(())
            }
            CrumbsCommand::SetMode(mode) => {
                self.recording.mode = Some(mode);
                Ok(())
            }
            CrumbsCommand::SetActiveSample(id) => {
                self.active_sample = Some(id);
                Ok(())
            }
            // The command-side sample map is the authority on what the
            // instance holds and already carries the data; the engine's pool
            // is filled from it at attach.
            CrumbsCommand::AddSample { .. } => Ok(()),
            _ => Err("Native engine not running".to_string()),
        }
    }
}

/// Complete any recording commits the audio thread handed off (ledger
/// #568): clone the take into a SampleData HERE (off the RT thread), mirror
/// it into the engine pool through the command ring (AddSample +
/// SetActiveSample, same ownership pattern as load_sample), register it in
/// the command-side sample map, and recycle the emptied buffers. Called
/// from the recording and polling command handlers; a pending commit at
/// destroy time is simply dropped with the instance.
///
/// A dormant instance has no slot handing takes back and no ring to mirror
/// through, so there is nothing here to do until it attaches.
pub fn drain_pending_recording_commits(instance: &mut CrumbsInstanceData) {
    if instance
        .recording()
        .take
        .as_ref()
        .is_some_and(|take| !take.complete.load(Ordering::Acquire))
    {
        return;
    }
    let CrumbsInstanceData {
        samples,
        engine_slot,
        next_sample_id,
        pending_mirror,
        ..
    } = instance;
    let CrumbsEngineSlot::Attached { ends, .. } = engine_slot else {
        return;
    };

    // Retry mirror pushes that previously hit a full command ring (oldest
    // first). Stop at the first still-full ring; later entries retry on the
    // next drain call.
    while let Some((id, sample)) = pending_mirror.first() {
        let pushed = ends.command_tx.push(CrumbsCommand::AddSample {
            id: *id,
            data: Arc::clone(sample),
        });
        if pushed.is_err() {
            return;
        }
        // Both halves or neither. The selection is the half the session ends
        // on, so an entry whose AddSample landed but whose SetActiveSample
        // the ring refused stays parked; the next drain re-pushes the pair,
        // and the repeated AddSample costs a ring slot and nothing else.
        if ends
            .command_tx
            .push(CrumbsCommand::SetActiveSample(*id))
            .is_err()
        {
            return;
        }
        pending_mirror.remove(0);
    }

    while let Ok(commit) = ends.commit_rx.pop() {
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
        let id = *next_sample_id;
        *next_sample_id += 1;
        samples.insert(id, Arc::clone(&sample));
        // Mirror into the engine. A full command ring must not lose the
        // mirror (the sample map above already holds the take): queue it in
        // pending_mirror, retried at the top of this drain.
        let pushed = ends.command_tx.push(CrumbsCommand::AddSample {
            id,
            data: Arc::clone(&sample),
        });
        match pushed {
            Ok(()) => {
                // A landed AddSample whose selection the ring refused parks
                // too, on the same both-halves-or-neither rule as the retry
                // above.
                if ends
                    .command_tx
                    .push(CrumbsCommand::SetActiveSample(id))
                    .is_err()
                {
                    pending_mirror.push((id, sample));
                }
            }
            Err(_) => {
                pending_mirror.push((id, sample));
            }
        }
        left.clear();
        right.clear();
        let _ = ends.recycle_tx.push((left, right));
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

/// Publish one persistent detached sampler, without acquiring input.
/// A strip borrows this slot; detached callbacks still drain its controls.
/// Each accepted take separately registers capture after native preparation.
/// The accepted fenced batch is numbered on the graph registry, as every
/// graph batch must be, so later apply receipts observe the same horizon.
fn register_crumbs_slot(
    registry: &mut GraphRegistry,
    engine_handle: &mut EngineHandle,
    metering: &Arc<CrumbsMetering>,
    slot_ends: CrumbsSlotEnds,
) -> Result<usize, String> {
    // A reserved id is an opaque handle, never a dense index, so a refused
    // batch below simply leaves this one unused.
    let id = engine_handle.reserve_plugin_id();
    // The device's rate, not the caller's: this engine renders on the strip
    // chain that borrows it and records the tap the same device feeds.
    let mut engine = CrumbsEngine::with_metering(engine_handle.sample_rate(), Arc::clone(metering));
    engine.enable_commit_handoff();
    let CrumbsSlotEnds {
        command_rx,
        commit_tx,
        recycle_rx,
        retired_take_tx,
        lifetime,
    } = slot_ends;
    let slot = CrumbsPluginSlot::new(
        engine,
        command_rx,
        commit_tx,
        recycle_rx,
        retired_take_tx,
        lifetime,
        Arc::clone(metering),
    );

    engine_handle
        .send_graph_batch(vec![
            // The sampler is an instrument, so its slot arrives holding the
            // note store a producer schedules against. Block-granular delivery
            // is the wrapper's own answer, not a reason to register it without
            // one. `AddHostedPlugin` carries that store unconditionally, which
            // is the same registration every engine-owned device takes.
            GraphCommand::AddHostedPlugin(id, Box::new(slot), MidiNoteStore::new()),
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

    registry.record_fenced_batch();

    Ok(id)
}

/// Put everything parked while dormant onto the ring the slot now drains.
///
/// Order is the engine's own dependency order: parameters and mode first,
/// then the pool, then the selection, so the active sample names one the pool
/// already holds. The pool is replayed from the command-side sample map,
/// which is the authority on what the instance holds — a take recorded before
/// the engine ran cannot exist, but a loaded sample can.
fn replay_parked_writes(instance: &mut CrumbsInstanceData, parked: DormantCrumbsWrites) {
    for (param, value) in parked.params {
        let _ = instance.send(CrumbsCommand::SetParam { param, value });
    }
    if let Some(mode) = instance.recording().mode {
        let _ = instance.send(CrumbsCommand::SetMode(mode));
    }

    let mut sample_ids: Vec<SampleId> = instance.samples.keys().copied().collect();
    sample_ids.sort_unstable();
    let mut mirror_deferred = false;
    for id in sample_ids {
        let Some(data) = instance.samples.get(&id).map(Arc::clone) else {
            continue;
        };
        // A push the ring refuses parks in pending_mirror, which the next
        // drain retries — the same route a mirror from a commit takes.
        if instance
            .send(CrumbsCommand::AddSample {
                id,
                data: Arc::clone(&data),
            })
            .is_err()
        {
            instance.pending_mirror.push((id, data));
            mirror_deferred = true;
        }
    }

    let Some(active) = parked.active_sample else {
        return;
    };
    let selection_refused = instance
        .send(CrumbsCommand::SetActiveSample(active))
        .is_err();
    // The drain replays each parked entry as AddSample + SetActiveSample in
    // order, so the last entry is the one the engine ends on: whenever any of
    // the replay went to pending_mirror, the active sample has to be that
    // entry. AddSample is idempotent, as pending_mirror's own contract states.
    if mirror_deferred || selection_refused {
        if let Some(data) = instance.samples.get(&active).map(Arc::clone) {
            instance.pending_mirror.push((active, data));
        }
    }
}

/// Register every instance that was created before the engine ran.
///
/// Called from `commands::graph` on a batch that has just found or started an
/// engine, before that batch claims the engine for its own commands, with the
/// batch's own registry guard already held — `apply_graph_commands` locks
/// registry first, then this attach locks instances then engine, and passes
/// the same registry through so the attach's fence and the batch fence that
/// follows land on one counter in the order the two take on the ring.
///
/// A lock this cannot take is the `Err`: an empty list of refusals means
/// every dormant instance attached, and a caller cannot be left reading a
/// failure as that. Otherwise returns one `(instance_id, reason)` per
/// instance the engine refused — not the graph batch's business, because the
/// instance keeps its parked writes and the next batch tries again — beside
/// the ids that did take a slot, which the batch reports to the caller: a
/// `create_crumbs` that found no engine answered `attached: false`, and this
/// report is the only correction the caller gets.
pub fn attach_dormant_crumbs(
    state: &CrumbsState,
    registry: &mut GraphRegistry,
    engine: &Mutex<Option<EngineHandle>>,
) -> Result<CrumbsAttachReport, String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let mut engine_guard = engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {e}"))?;
    let Some(engine_handle) = engine_guard.as_mut() else {
        return Ok(CrumbsAttachReport::default());
    };

    let mut report = CrumbsAttachReport::default();
    for (instance_id, instance) in instances.iter_mut() {
        let CrumbsEngineSlot::Dormant(parked) = &mut instance.engine_slot else {
            continue;
        };

        // The engine drops a refused batch whole, ring ends included, so the
        // ends are allocated here and adopted only once the batch is admitted.
        let (mut ends, slot_ends) = new_crumbs_rings();
        let plugin_id =
            match register_crumbs_slot(registry, engine_handle, &instance.metering, slot_ends) {
                Ok(plugin_id) => plugin_id,
                Err(reason) => {
                    // The parked writes are untouched: still dormant, still
                    // holding what the panel set, still attachable next batch.
                    report.refusals.push((instance_id.clone(), reason));
                    continue;
                }
            };

        let mut parked = std::mem::take(parked);
        std::mem::swap(&mut ends.recording, &mut parked.recording);
        instance.engine_slot = CrumbsEngineSlot::Attached { plugin_id, ends };
        replay_parked_writes(instance, parked);
        report.attached.push(instance_id.clone());
    }
    // Map iteration order is arbitrary and the report crosses to a caller, so
    // one batch's attach reads the same whichever order the map drew.
    report.attached.sort_unstable();
    Ok(report)
}

/// What one [`attach_dormant_crumbs`] pass did: the instances that took a slot
/// on the engine, and the ones it refused with the reason each carries.
#[derive(Debug, Default)]
pub struct CrumbsAttachReport {
    pub attached: Vec<String>,
    pub refusals: Vec<(String, String)>,
}

/// Every instance holding a slot on the live engine, as the graph mapper reads
/// it: instance id → engine plugin id.
///
/// The instance id is the device id. A Crumbs device carries no
/// `externalInstanceId` — the panel creates its runtime under the device's own
/// id — so this lookup is keyed by exactly what `map_device` reads off the
/// device, and the id it answers with is the effect the strip chain borrows.
///
/// A dormant instance is absent by construction: it owns no engine plugin id,
/// so there is nothing for a chain to splice and the mapper's own degradation
/// law is what answers for it.
///
/// Takes only the instances lock, so a caller already holding the registry
/// guard keeps the registry -> instances order every other path here follows.
/// A panic elsewhere does not withhold the lookup, on the same terms as every
/// other reader in this module ([`crate::state::locked_or_poisoned`]): the map
/// is a plain map that a panicked writer left readable, and refusing it would
/// degrade every Crumbs device in the batch that asked.
pub fn attached_crumbs_instances(state: &CrumbsState) -> HashMap<String, usize> {
    crate::state::locked_or_poisoned(&state.instances)
        .iter()
        .filter_map(|(instance_id, instance)| match instance.engine_slot {
            CrumbsEngineSlot::Attached { plugin_id, .. } => Some((instance_id.clone(), plugin_id)),
            CrumbsEngineSlot::Dormant(_) => None,
        })
        .collect()
}

/// Put every attached instance back to dormant, because the engine holding
/// their slots has been retired (`commands::engine_lifecycle`).
///
/// An `Attached` slot holds the command side of rings whose slot side went
/// with the retired engine's scheduler, so a write parked there reaches
/// nothing and the next [`attach_dormant_crumbs`] would skip the instance
/// entirely. Dormant is the state that instance was created in before any
/// engine existed, and it is the one the next graph batch re-registers from —
/// at the *new* device's sample rate, which is the whole reason the engine is
/// being replaced rather than restarted.
///
/// The parked-write table starts empty, because the params, the mode and the
/// active sample the panel set after the attach live only inside the engine's
/// own [`CrumbsEngine`] — [`CrumbsInstanceData`] mirrors none of them, so
/// there is nothing here to seed them from. The sample map is mirrored
/// command-side, so [`replay_parked_writes`] still refills the new engine's
/// pool from it; only the settings are lost, and the panel rewrites those on
/// its next write.
///
/// A take the audio thread had already handed off does survive, and only
/// because it is drained first: the commit ring's command side goes with the
/// slot being replaced, so a queued [`PendingRecordingCommit`] left there is a
/// recording the musician performed and the session then silently lost. The
/// drain lands it in `samples`, which is the command-side authority the next
/// attach refills the new engine's pool from. Its mirror pushes are lost with
/// the ring they land on, whichever way they go: the consumer is still alive
/// here — the scheduler owning `command_rx` goes with the handle the retire
/// drops after this drain — but a stalled engine has stopped draining, so the
/// command ring may hold anything from nothing to its full capacity. A push
/// lands while there is room and parks in `pending_mirror` once there is not.
/// Either outcome costs nothing: the ring and the pool it fed die with the
/// slot, but `pending_mirror` is a field of this instance rather than of the
/// slot, so it does not. Left alone it would carry a selection into the
/// replacement engine that the panel never asked this attach for, so the
/// detach below clears it once every id the mirror names is already in
/// `samples`, whether the drain above landed it there or a previous replay read
/// it from there — which sample is active afterward is the panel's to rewrite
/// once a retire has happened, not a stale mirror's. `samples` is what
/// [`replay_parked_writes`] rebuilds the *new* engine's pool from on the next
/// attach.
///
/// Takes the instances lock beneath the registry guard the retire's drain
/// holds, which is the registry -> instances order `apply_graph_commands` and
/// [`create_crumbs`] already establish.
/// Guarded phase: move ownership only. Materialization follows outside the registry.
pub(crate) struct DrainedCrumbsWork {
    instance_id: String,
    incarnation: u64,
    ends: CrumbsInstanceEnds,
    take: Option<Arc<NativeTakeSession>>,
    _mirrors: Vec<(SampleId, Arc<SampleData>)>,
    _recycle: Option<RecordBufferPair>,
}

pub(crate) fn detach_from_retired_engine(state: &CrumbsState) -> Vec<DrainedCrumbsWork> {
    let mut instances = crate::state::locked_or_poisoned(&state.instances);
    let mut work = Vec::new();
    for (instance_id, instance) in instances.iter_mut() {
        if matches!(instance.engine_slot, CrumbsEngineSlot::Dormant(_)) {
            continue;
        }
        let old = std::mem::replace(
            &mut instance.engine_slot,
            CrumbsEngineSlot::Dormant(DormantCrumbsWrites::default()),
        );
        if let CrumbsEngineSlot::Attached { mut ends, .. } = old {
            let mut parked = DormantCrumbsWrites::default();
            std::mem::swap(&mut ends.recording, &mut parked.recording);
            if let Some(take) = &parked.recording.take {
                take.invalidate();
                take.complete.store(true, Ordering::Release);
            }
            work.push(DrainedCrumbsWork {
                instance_id: instance_id.clone(),
                incarnation: parked.recording.incarnation,
                take: parked.recording.take.clone(),
                _mirrors: std::mem::take(&mut instance.pending_mirror),
                _recycle: ends.pending_recycle.take(),
                ends,
            });
            instance.engine_slot = CrumbsEngineSlot::Dormant(parked);
        }
    }
    work
}

pub(crate) fn finish_detached_crumbs(
    mut work: Vec<DrainedCrumbsWork>,
    state: &CrumbsState,
) -> Vec<DrainedCrumbsWork> {
    for work in &mut work {
        let claimed = work.take.as_ref().and_then(|take| {
            take.original_commit
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        });
        let mut commits = Vec::new();
        if let Some(commit) = claimed {
            commits.push(commit);
        }
        while let Ok(commit) = work.ends.commit_rx.pop() {
            commits.push(Arc::new(commit));
        }
        for commit in commits {
            let id = {
                let mut instances = crate::state::locked_or_poisoned(&state.instances);
                let Some(instance) = instances
                    .get_mut(&work.instance_id)
                    .filter(|i| i.recording().incarnation == work.incarnation)
                else {
                    continue;
                };
                if work
                    .take
                    .as_ref()
                    .is_some_and(|take| take.sample_safe.load(Ordering::Acquire))
                {
                    continue;
                }
                let reserved = work
                    .take
                    .as_ref()
                    .map_or(0, |take| take.sample_id.load(Ordering::Acquire));
                if reserved != 0 {
                    reserved
                } else {
                    let id = instance.next_sample_id;
                    instance.next_sample_id += 1;
                    if let Some(take) = &work.take {
                        take.sample_id.store(id, Ordering::Release);
                    }
                    id
                }
            };
            #[cfg(test)]
            BEFORE_RETIRED_PCM.with(|observer| {
                if let Some(observer) = observer.borrow().as_ref() {
                    observer();
                }
            });
            let mut sample = Some(Arc::new(SampleData::from_stereo(
                commit.left.clone(),
                commit.right.clone(),
                commit.sample_rate,
            )));
            {
                let mut instances = crate::state::locked_or_poisoned(&state.instances);
                if let Some(instance) = instances
                    .get_mut(&work.instance_id)
                    .filter(|i| i.recording().incarnation == work.incarnation)
                {
                    if let std::collections::hash_map::Entry::Vacant(entry) =
                        instance.samples.entry(id)
                    {
                        if let Some(sample) = sample.take() {
                            entry.insert(sample);
                        }
                    }
                    if let Some(take) = &work.take {
                        take.sample_safe.store(true, Ordering::Release);
                    }
                }
            }
            drop(sample);
        }
        if let Some(take) = &work.take {
            emit_take(take);
        }
    }
    work
}

#[cfg(test)]
thread_local! { static BEFORE_RETIRED_PCM: std::cell::RefCell<Option<Box<dyn Fn()>>> = const { std::cell::RefCell::new(None) }; }

/// Whether `instance_id` holds a slot on the live engine. For tests outside
/// this module that drive an attach or a detach.
#[cfg(test)]
pub(crate) fn instance_is_attached(state: &CrumbsState, instance_id: &str) -> bool {
    let instances = crate::state::locked_or_poisoned(&state.instances);
    instances
        .get(instance_id)
        .is_some_and(|instance| matches!(instance.engine_slot, CrumbsEngineSlot::Attached { .. }))
}

/// Create a new crumbs engine instance.
///
/// Takes no sample rate: the sampler records the engine's own input tap and
/// renders on the engine's own callback, so its only correct rate is the
/// device's, read from the engine handle. A rate supplied by a caller would
/// stamp every committed take — and clamp `record_max_samples` — against a
/// number the device never ran at.
///
/// Answers whether the instance took an engine slot. `attached` is false for
/// the dormant case below, and the next graph batch is what turns it true —
/// the caller has no other way to tell a sampler the engine is rendering from
/// one still waiting for its first batch.
///
/// A missing engine degrades rather than refuses (#2265). The engine starts
/// lazily on the first graph batch, which the app sends on play, so refusing
/// here left every panel opened before the first play dead. The instance is
/// created dormant instead: parameters, mode and the active sample are parked
/// command-side, and [`attach_dormant_crumbs`] registers it — and replays
/// them — on that first batch.
pub async fn create_crumbs(
    instance_id: String,
    state: &CrumbsState,
    app_state: &AppState,
) -> Result<CrumbsCreateResult, String> {
    // Three locks, taken registry -> instances -> engine. `apply_graph_commands`
    // already establishes that order — it holds the registry guard, then its
    // attach locks instances then engine — so a create cannot invert against a
    // concurrent batch. The registry guard is acquired here, ahead of
    // instances, purely to keep that ordering law; its record_fenced_batch()
    // call is only ever reached below, inside the registration block, so a
    // dormant create (no engine found) never touches the counter.
    let mut registry_guard = app_state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {error}"))?;

    // The instances lock is taken second and held through the engine
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
    // its slot.
    if instances.contains_key(&instance_id) {
        return Err(format!("Crumbs instance '{instance_id}' already exists"));
    }

    ensure_crumbs_capture_headroom(&instances)?;

    let metering = Arc::new(CrumbsMetering::default());

    #[cfg(test)]
    state.notify_create_before_engine_lock();

    // The engine guard is scoped to the registration alone — it is the
    // engine-wide mutex, not this instance's — while the instances guard
    // above spans the whole create, per the ordering law stated there. The
    // registry guard is used here too, alongside the engine guard, because
    // this is the one branch that can actually publish a fence to number.
    let engine_slot = {
        let mut engine_guard = app_state
            .engine
            .lock()
            .map_err(|e| format!("Failed to lock engine: {e}"))?;

        match engine_guard.as_mut() {
            Some(engine_handle) => {
                let (ends, slot_ends) = new_crumbs_rings();
                let plugin_id =
                    register_crumbs_slot(&mut registry_guard, engine_handle, &metering, slot_ends)?;
                CrumbsEngineSlot::Attached { plugin_id, ends }
            }
            None => CrumbsEngineSlot::Dormant(DormantCrumbsWrites::default()),
        }
    };

    let attached = matches!(engine_slot, CrumbsEngineSlot::Attached { .. });
    instances.insert(
        instance_id,
        CrumbsInstanceData {
            samples: HashMap::new(),
            metering,
            engine_slot,
            next_sample_id: 1,
            pending_mirror: Vec::new(),
        },
    );
    Ok(CrumbsCreateResult { attached })
}

/// What a create left behind, as the caller reads it: whether the instance
/// holds a slot on a running engine, or is dormant until the next graph batch
/// attaches it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrumbsCreateResult {
    pub attached: bool,
}

/// Destroy a crumbs engine instance.
///
/// The instance's chain entries go before its retirement, for the reason
/// `release_then_retire_engine_plugin` states for a hosted plugin: a chain
/// entry naming a retired effect is counted nowhere — the scheduler's
/// `run_device` and `run_generator` both return on a failed effect-table
/// lookup — so it stands as a silent passthrough until a topology replacement
/// clears it, and a rolling engine never gets one. Releasing first closes that
/// hole before it can exist.
///
/// Three locks, taken registry -> instances -> engine, the order
/// [`create_crumbs`] and `apply_graph_commands` already establish.
pub async fn destroy_crumbs(
    instance_id: String,
    state: &CrumbsState,
    app_state: &AppState,
) -> Result<(), String> {
    let mut registry_guard = app_state
        .graph
        .lock()
        .map_err(|error| format!("Failed to lock graph registry: {error}"))?;

    let mut instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;

    let Some(instance) = instances.get(&instance_id) else {
        return Ok(());
    };

    // A dormant instance owns nothing engine-side — its slot was never
    // published, so no chain can hold it — and the map entry is the whole of
    // it.
    let CrumbsEngineSlot::Attached { plugin_id, .. } = instance.engine_slot else {
        instances.remove(&instance_id);
        return Ok(());
    };

    // Keep the ownership ledger intact until every fallible lock and the
    // scheduler-removal admission succeed. A full command ring means the
    // runtime is still live, so its map entry must remain reachable for
    // retry.
    let mut engine_guard = app_state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {e}"))?;

    if let Some(ref mut engine_handle) = *engine_guard {
        release_chain_entries(&mut registry_guard, engine_handle, plugin_id);
        // No matching unregister: removal takes the id off the capture ledger
        // and off the callback's input bus with the slot it belongs to, so an
        // unregister here would be a second release of a consumer that is
        // already gone.
        engine_handle.remove_plugin(plugin_id)?;
    }

    // Once queued, scheduler retirement is inevitable. No fallible work may
    // follow before command-side ownership is erased.
    if let Some(take) = &instance.recording().take {
        take.invalidate();
    }
    instances.remove(&instance_id);
    Ok(())
}

/// Take every strip chain entry naming `plugin_id` out of the live graph,
/// ahead of the retirement that follows.
///
/// Computed on a working clone and committed only once the ring has taken the
/// batch, the law `map_batch` follows: a registry that had already forgotten a
/// chain entry the engine still holds could never name it again. A refused
/// release is logged and the retirement still goes — refusing here would
/// abandon a destroy the caller has already begun, and the entry the registry
/// keeps is what lets a later batch unlink it.
fn release_chain_entries(
    registry: &mut GraphRegistry,
    engine_handle: &mut EngineHandle,
    plugin_id: usize,
) {
    let mut working = registry.clone();
    let release = working.release_engine_plugin(plugin_id);
    if release.ops.is_empty() {
        return;
    }
    // The reserved slot is the `RemovePlugin` push the caller makes next: the
    // retirement must not find the ring full behind this release.
    match engine_handle.send_graph_batch_with_headroom(release.ops, 1) {
        Ok(()) => {
            working.record_fenced_batch();
            *registry = working;
        }
        Err(error) => eprintln!("[Crumbs] chain release before destroy was refused: {error:?}"),
    }
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

    // Send to the engine. A dormant instance records the selection instead;
    // the pool itself is replayed from the map above when it attaches.
    instance.send(CrumbsCommand::AddSample {
        id: sample_id,
        data: shared_data,
    })?;
    instance.send(CrumbsCommand::SetActiveSample(sample_id))?;

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

    instance.send(CrumbsCommand::NoteOn { note, velocity })?;
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

    instance.send(CrumbsCommand::NoteOff { note })?;
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

    instance.send(CrumbsCommand::SetParam {
        param: param_enum,
        value,
    })?;
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

    instance.send(CrumbsCommand::SetMode(mode_enum))?;
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

    instance.send(CrumbsCommand::AllSoundOff)?;
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

/// Get how many sample writes the instance's pool has refused because the
/// fixed sample budget (`MAX_POOL_SAMPLES`) was exhausted. Non-zero means
/// sample loads are silently failing; the caller surfaces it as a warning.
pub async fn get_crumbs_dropped_sample_writes(
    instance_id: String,
    state: &CrumbsState,
) -> Result<u32, String> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| format!("Failed to lock crumbs state: {err}"))?;
    let instance = instances
        .get(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;

    Ok(instance
        .metering
        .dropped_sample_writes
        .load(std::sync::atomic::Ordering::Relaxed))
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

static NEXT_INCARNATION: AtomicU64 = AtomicU64::new(1);
static NEXT_TAKE: AtomicU64 = AtomicU64::new(1);
fn next_incarnation() -> u64 {
    NEXT_INCARNATION.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ArmRecordingResult {
    pub take_id: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct CrumbsFirstInput {
    pub position_frames: String,
    pub frames: usize,
}
#[derive(Debug, Clone, Serialize)]
pub struct CrumbsRecordingSnapshot {
    pub instance_id: String,
    pub instance_incarnation: String,
    pub take_id: String,
    pub revision: String,
    pub phase: &'static str,
    pub first_input: Option<CrumbsFirstInput>,
    pub failure: Option<&'static str>,
}
fn phase_name(phase: u8) -> &'static str {
    match phase {
        TAKE_WAITING => "waiting",
        TAKE_RECORDING => "recording",
        TAKE_FINISHING => "finishing",
        TAKE_COMPLETED => "completed",
        TAKE_CANCELLED => "cancelled",
        TAKE_FAILED => "failed",
        _ => "preparing",
    }
}
fn take_snapshot(take: &NativeTakeSession) -> CrumbsRecordingSnapshot {
    snapshot_from_readout(take, take.readout())
}
fn snapshot_from_readout(
    take: &NativeTakeSession,
    state: NativeTakeReadout,
) -> CrumbsRecordingSnapshot {
    CrumbsRecordingSnapshot {
        instance_id: take.instance_id.clone(),
        instance_incarnation: take.incarnation.to_string(),
        take_id: take.take_id.to_string(),
        revision: state.revision.to_string(),
        phase: phase_name(state.phase),
        first_input: state.first_input.map(|first| CrumbsFirstInput {
            position_frames: first.position_frames.to_string(),
            frames: first.frames,
        }),
        failure: match state.failure {
            1 => Some("The native recorder refused to arm"),
            2 => Some("Native input is unavailable"),
            3 => Some("Native take admission failed"),
            _ => None,
        },
    }
}
fn emit_take(take: &NativeTakeSession) {
    if let Some(events) = take.events.upgrade() {
        events.emit("crumbs-recording-state", take_snapshot(take));
    }
}

pub async fn get_crumbs_recording_state(
    instance_id: String,
    state: &CrumbsState,
) -> Result<CrumbsRecordingSnapshot, String> {
    let (take, incarnation, revision) = {
        let instances = state
            .instances
            .lock()
            .map_err(|e| format!("Failed to lock crumbs state: {e}"))?;
        let instance = instances
            .get(&instance_id)
            .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;
        (
            instance.recording().take.clone(),
            instance.recording().incarnation,
            instance.recording().revisions.load(Ordering::Acquire),
        )
    };
    Ok(match take {
        Some(take) => take_snapshot(&take),
        None => CrumbsRecordingSnapshot {
            instance_id,
            instance_incarnation: incarnation.to_string(),
            take_id: "0".into(),
            revision: revision.to_string(),
            phase: "idle",
            first_input: None,
            failure: None,
        },
    })
}

/// Accept intent only. The slot consumes its first served block before readiness.
pub async fn arm_recording(
    instance_id: String,
    threshold: f32,
    target_pad: u8,
    max_duration_secs: f32,
    state: &CrumbsState,
    app_state: &AppState,
    events: Arc<dyn EventSink>,
) -> Result<ArmRecordingResult, String> {
    if !threshold.is_finite()
        || !(0.0..=1.0).contains(&threshold)
        || target_pad >= 16
        || !max_duration_secs.is_finite()
        || max_duration_secs <= 0.0
        || max_duration_secs > 60.0
    {
        return Err("Invalid native recording parameters".into());
    }
    let mut instances = state
        .instances
        .lock()
        .map_err(|e| format!("Failed to lock crumbs state: {e}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;
    if instance.recording().mode.unwrap_or_default() != CrumbsMode::Record {
        return Err("Crumbs must be in Record mode".into());
    }
    if instance
        .recording()
        .take
        .as_ref()
        .is_some_and(|take| !take.complete.load(Ordering::Acquire))
    {
        return Err("The previous native take is still finishing".into());
    }
    let incarnation = instance.recording().incarnation;
    let revisions = Arc::clone(&instance.recording().revisions);
    let CrumbsEngineSlot::Attached { plugin_id, ends } = &mut instance.engine_slot else {
        return Err("Crumbs is not attached to a native engine".into());
    };
    let plugin_id = *plugin_id;
    let take = Arc::new(NativeTakeSession::new(
        instance_id.clone(),
        incarnation,
        NEXT_TAKE.fetch_add(1, Ordering::Relaxed),
        revisions,
        Arc::clone(&ends.lifetime),
        Arc::downgrade(&events),
    ));
    let mut engine_guard = app_state
        .engine
        .lock()
        .map_err(|e| format!("Failed to lock engine: {e}"))?;
    let engine = engine_guard
        .as_mut()
        .ok_or_else(|| "Native engine is not running".to_string())?;
    engine.adopt_capture_completion_service(Box::new(NativeTakeCompletion {
        instances: Arc::downgrade(&state.instances),
        engine: Arc::downgrade(&app_state.engine),
        plugin_id,
        take: Arc::clone(&take),
        retired_reference: None,
        prepared: None,
        recycle: None,
        last_emitted: 0,
    }))?;
    ends.recording.take = Some(Arc::clone(&take));
    let preparation = match engine.prepare_capture_consumer_registration(plugin_id) {
        Ok(preparation) => preparation,
        Err(error) => {
            take.valid.store(false, Ordering::Release);
            take.failure.store(3, Ordering::Release);
            return Err(error);
        }
    };
    let _ = take.period.set(preparation.period().clone());
    if ends
        .command_tx
        .push_native(NativeCrumbsCommand::PrepareTake(NativePreparedTake {
            session: Arc::clone(&take),
            threshold,
            target_pad,
            max_duration_secs,
        }))
        .is_err()
    {
        take.valid.store(false, Ordering::Release);
        take.failure.store(3, Ordering::Release);
        return Err("Command queue full".into());
    }
    take.slot_enqueued.store(true, Ordering::Release);
    if let Err(error) = preparation.commit() {
        take.valid.store(false, Ordering::Release);
        take.cancel_requested.store(true, Ordering::Release);
        take.failure.store(3, Ordering::Release);
        return Err(error);
    }
    take.admitted.store(true, Ordering::Release);
    Ok(ArmRecordingResult {
        take_id: take.take_id.to_string(),
    })
}

/// Stop enqueue is token-bound. Refusal changes neither actual DSP nor its holder.
pub async fn stop_recording(
    instance_id: String,
    take_id: String,
    state: &CrumbsState,
) -> Result<(), String> {
    let take_id = take_id
        .parse::<u64>()
        .map_err(|_| "Invalid native take id".to_string())?;
    let mut instances = state
        .instances
        .lock()
        .map_err(|e| format!("Failed to lock crumbs state: {e}"))?;
    let instance = instances
        .get_mut(&instance_id)
        .ok_or_else(|| format!("Crumbs instance '{instance_id}' not found"))?;
    let take = instance
        .recording()
        .take
        .as_ref()
        .filter(|take| take.take_id == take_id)
        .ok_or_else(|| "Stale native take id".to_string())?;
    if take.complete.load(Ordering::Acquire) || take.cancel_revision.load(Ordering::Acquire) != 0 {
        return Ok(());
    }
    let CrumbsEngineSlot::Attached { ends, .. } = &mut instance.engine_slot else {
        return Err("Crumbs is not attached to a native engine".into());
    };
    ends.command_tx
        .push_native(NativeCrumbsCommand::StopTake { take_id })
        .map_err(|_| "Command queue full".to_string())
}

struct NativeTakeCompletion {
    instances: Weak<Mutex<HashMap<String, CrumbsInstanceData>>>,
    engine: Weak<Mutex<Option<EngineHandle>>>,
    plugin_id: usize,
    take: Arc<NativeTakeSession>,
    retired_reference: Option<Arc<NativeTakeSession>>,
    prepared: Option<Arc<SampleData>>,
    recycle: Option<RecordBufferPair>,
    last_emitted: u64,
}

fn retry_one_mirror(instance: &mut CrumbsInstanceData) {
    let CrumbsEngineSlot::Attached { ends, .. } = &mut instance.engine_slot else {
        return;
    };
    if let Some((id, sample)) = instance.pending_mirror.first() {
        if ends
            .command_tx
            .push(CrumbsCommand::AddSample {
                id: *id,
                data: Arc::clone(sample),
            })
            .is_ok()
            && ends
                .command_tx
                .push(CrumbsCommand::SetActiveSample(*id))
                .is_ok()
        {
            instance.pending_mirror.remove(0);
        }
    }
    if let Some(pair) = ends.pending_recycle.take() {
        if let Err(rtrb::PushError::Full(pair)) = ends.recycle_tx.push(pair) {
            ends.pending_recycle = Some(pair);
        }
    }
}

impl CaptureCompletionService for NativeTakeCompletion {
    fn service(&mut self) -> CaptureServiceProgress {
        let Some(instances) = self.instances.upgrade() else {
            return self.abandoned();
        };
        if self.take.cancel_revision.load(Ordering::Acquire) != 0 {
            return CaptureServiceProgress::Complete;
        }
        if let Some(period) = self.take.period.get() {
            if period.snapshot().failure.is_some() {
                self.take.failure.store(2, Ordering::Release);
                self.take.cancel_requested.store(true, Ordering::Release);
            }
        }
        let mut stale_retirement = None;
        let original = {
            let Ok(mut instances) = instances.try_lock() else {
                return CaptureServiceProgress::Pending;
            };
            let Some(instance) = instances
                .get_mut(&self.take.instance_id)
                .filter(|instance| {
                    instance.recording().incarnation == self.take.incarnation
                        && instance
                            .recording()
                            .take
                            .as_ref()
                            .is_some_and(|take| Arc::ptr_eq(take, &self.take))
                })
            else {
                return self.abandoned();
            };
            let CrumbsEngineSlot::Attached { ends, .. } = &mut instance.engine_slot else {
                return CaptureServiceProgress::Complete;
            };
            if self.retired_reference.is_none() {
                if let Ok(retired) = ends.retired_take_rx.pop() {
                    if Arc::ptr_eq(&retired, &self.take) {
                        self.retired_reference = Some(retired);
                    } else {
                        stale_retirement = Some(retired);
                    }
                }
            }
            let Ok(mut original) = self.take.original_commit.try_lock() else {
                return CaptureServiceProgress::Pending;
            };
            if original.is_none() && !self.take.sample_safe.load(Ordering::Acquire) {
                if let Ok(commit) = ends.commit_rx.pop() {
                    let id = instance.next_sample_id;
                    instance.next_sample_id += 1;
                    self.take.sample_id.store(id, Ordering::Release);
                    *original = Some(Arc::new(commit));
                }
            }
            original.clone()
        };
        drop(stale_retirement);
        // Materialize outside every shared lock. Original ownership survives retirement.
        if self.prepared.is_none() && !self.take.sample_safe.load(Ordering::Acquire) {
            if let Some(commit) = &original {
                #[cfg(test)]
                {
                    let observer = self.take.before_materialize.lock().unwrap().take();
                    if let Some(observer) = observer {
                        observer();
                    }
                }
                self.prepared = Some(Arc::new(SampleData::from_stereo(
                    commit.left.clone(),
                    commit.right.clone(),
                    commit.sample_rate,
                )));
            }
        }
        drop(original);
        {
            let Ok(mut instances) = instances.try_lock() else {
                return CaptureServiceProgress::Pending;
            };
            let Some(instance) = instances
                .get_mut(&self.take.instance_id)
                .filter(|instance| {
                    instance.recording().incarnation == self.take.incarnation
                        && instance
                            .recording()
                            .take
                            .as_ref()
                            .is_some_and(|take| Arc::ptr_eq(take, &self.take))
                })
            else {
                return self.abandoned();
            };
            if self.take.cancel_revision.load(Ordering::Acquire) != 0 {
                return CaptureServiceProgress::Complete;
            }
            if let Some(sample) = self.prepared.take() {
                let id = self.take.sample_id.load(Ordering::Acquire);
                instance.samples.insert(id, Arc::clone(&sample));
                instance.pending_mirror.push((id, sample));
                self.take.sample_safe.store(true, Ordering::Release);
            }
            retry_one_mirror(instance);
        }
        // Take original ownership off RT. No PCM is freed if another control reader holds it.
        if self.recycle.is_none() && self.take.sample_safe.load(Ordering::Acquire) {
            let original = {
                let Ok(mut stored) = self.take.original_commit.try_lock() else {
                    return CaptureServiceProgress::Pending;
                };
                stored.take()
            };
            if let Some(original) = original {
                match Arc::try_unwrap(original) {
                    Ok(mut commit) => {
                        commit.left.clear();
                        commit.right.clear();
                        self.recycle = Some((commit.left, commit.right));
                    }
                    Err(original) => {
                        let Ok(mut stored) = self.take.original_commit.try_lock() else {
                            // Only retirement can share this original. It owns its cloned Arc.
                            return CaptureServiceProgress::Pending;
                        };
                        *stored = Some(original);
                    }
                }
            }
        }
        if self.recycle.is_some() {
            let Ok(mut guard) = instances.try_lock() else {
                return CaptureServiceProgress::Pending;
            };
            if let Some(instance) = guard
                .get_mut(&self.take.instance_id)
                .filter(|i| i.recording().incarnation == self.take.incarnation)
            {
                let CrumbsEngineSlot::Attached { ends, .. } = &mut instance.engine_slot else {
                    return CaptureServiceProgress::Complete;
                };
                if ends.pending_recycle.is_none() {
                    ends.pending_recycle = self.recycle.take();
                }
                retry_one_mirror(instance);
            }
        }
        let terminal =
            self.retired_reference.is_some() || !self.take.slot_enqueued.load(Ordering::Acquire);
        let safe = !self.take.has_commit.load(Ordering::Acquire)
            || self.take.sample_safe.load(Ordering::Acquire);
        if terminal && safe && !self.take.released.load(Ordering::Acquire) {
            if self.take.admitted.load(Ordering::Acquire) {
                let Some(engine) = self.engine.upgrade() else {
                    return self.abandoned();
                };
                let Ok(guard) = instances.try_lock() else {
                    return CaptureServiceProgress::Pending;
                };
                if !guard.get(&self.take.instance_id).is_some_and(|i| {
                    i.recording().incarnation == self.take.incarnation
                        && i.recording()
                            .take
                            .as_ref()
                            .is_some_and(|take| Arc::ptr_eq(take, &self.take))
                }) {
                    return self.abandoned();
                }
                let Ok(mut engine_guard) = engine.try_lock() else {
                    return CaptureServiceProgress::Pending;
                };
                let Some(engine) = engine_guard.as_mut() else {
                    return self.abandoned();
                };
                if !self
                    .take
                    .period
                    .get()
                    .is_some_and(|period| engine.is_current_capture_period(period))
                {
                    return self.abandoned();
                }
                let refused = engine.unregister_capture_consumer(self.plugin_id).is_err();
                drop(engine_guard);
                drop(guard);
                if refused {
                    self.publish(TAKE_FINISHING);
                    return CaptureServiceProgress::Pending;
                }
            }
            self.take.released.store(true, Ordering::Release);
        }
        let clean = {
            let Ok(guard) = instances.try_lock() else {
                return CaptureServiceProgress::Pending;
            };
            guard.get(&self.take.instance_id).is_some_and(|i| i.pending_mirror.is_empty() && matches!(&i.engine_slot, CrumbsEngineSlot::Attached { ends, .. } if ends.pending_recycle.is_none()))
        };
        if terminal
            && safe
            && self.take.released.load(Ordering::Acquire)
            && clean
            && self.recycle.is_none()
        {
            let phase = if self.take.failure.load(Ordering::Acquire) != 0 {
                TAKE_FAILED
            } else if self.take.has_commit.load(Ordering::Acquire) {
                TAKE_COMPLETED
            } else {
                TAKE_CANCELLED
            };
            if self.publish(phase) {
                self.take.complete.store(true, Ordering::Release);
                return CaptureServiceProgress::Complete;
            }
            return CaptureServiceProgress::Pending;
        }
        self.publish(self.take.rt_phase.load(Ordering::Acquire));
        CaptureServiceProgress::Pending
    }
    fn engine_stopped(&mut self) {
        self.take.invalidate();
    }
}
impl NativeTakeCompletion {
    fn publish(&mut self, phase: u8) -> bool {
        let Some(readout) = self.take.publish(phase) else {
            return false;
        };
        if readout.revision != self.last_emitted {
            self.last_emitted = readout.revision;
            if let Some(events) = self.take.events.upgrade() {
                events.emit(
                    "crumbs-recording-state",
                    snapshot_from_readout(&self.take, readout),
                );
            }
        }
        true
    }
    fn abandoned(&mut self) -> CaptureServiceProgress {
        self.take.valid.store(false, Ordering::Release);
        self.take.cancel_requested.store(true, Ordering::Release);
        if self.take.lifetime.stopped.load(Ordering::Acquire) || self.retired_reference.is_some() {
            self.take.invalidate();
            CaptureServiceProgress::Complete
        } else {
            CaptureServiceProgress::Pending
        }
    }
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
pub(crate) mod tests {
    use super::*;

    use std::sync::Condvar;
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct LifecycleEvents {
        values: Mutex<Vec<serde_json::Value>>,
        changed: Condvar,
        reenter: Mutex<Option<(Weak<CrumbsState>, Weak<AppState>)>>,
    }
    impl EventSink for LifecycleEvents {
        fn emit_json(&self, event: &str, value: serde_json::Value) {
            if event != "crumbs-recording-state" {
                return;
            }
            if let Some((state, app)) = self.reenter.lock().unwrap().as_ref() {
                let state = state.upgrade().unwrap();
                let app = app.upgrade().unwrap();
                assert!(
                    state.instances.try_lock().is_ok(),
                    "events must release instances"
                );
                assert!(app.engine.try_lock().is_ok(), "events must release engine");
                assert!(app.graph.try_lock().is_ok(), "events must release graph");
                let id = value["instance_id"].as_str().unwrap().to_string();
                assert!(crate::block_on_test(get_crumbs_recording_state(id, &state)).is_ok());
            }
            self.values.lock().unwrap().push(value);
            self.changed.notify_all();
        }
    }
    impl LifecycleEvents {
        fn wait(&self, token: &str, phase: &str) {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut values = self.values.lock().unwrap();
            loop {
                if values
                    .iter()
                    .any(|value| value["take_id"] == token && value["phase"] == phase)
                {
                    return;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                assert!(
                    !remaining.is_zero(),
                    "missing {phase} for {token}; observed {values:?}"
                );
                values = self.changed.wait_timeout(values, remaining).unwrap().0;
            }
        }
    }
    struct NativeFixture {
        state: Arc<CrumbsState>,
        app: Arc<AppState>,
        driver: daw_engine::CaptureLifecycleDriver,
        events: Arc<LifecycleEvents>,
    }
    impl NativeFixture {
        fn new(refuse: bool) -> Self {
            let (engine, driver) = daw_engine::capture_lifecycle_fixture(64, refuse).unwrap();
            let app = Arc::new(AppState::default());
            *app.engine.lock().unwrap() = Some(engine);
            let mut fixture = Self {
                state: Arc::new(CrumbsState::default()),
                app,
                driver,
                events: Arc::new(LifecycleEvents::default()),
            };
            fixture.create("sampler");
            fixture
        }
        fn create(&mut self, id: &str) {
            crate::block_on_test(create_crumbs(id.into(), &self.state, &self.app)).unwrap();
            crate::block_on_test(set_crumbs_mode(id.into(), "record".into(), &self.state)).unwrap();
            self.driver.render(128).unwrap();
        }
        fn arm(&self, id: &str, threshold: f32, duration: f32) -> String {
            crate::block_on_test(arm_recording(
                id.into(),
                threshold,
                0,
                duration,
                &self.state,
                &self.app,
                self.events.clone(),
            ))
            .unwrap()
            .take_id
        }
        fn snapshot(&self, id: &str) -> CrumbsRecordingSnapshot {
            crate::block_on_test(get_crumbs_recording_state(id.into(), &self.state)).unwrap()
        }
        fn period(&self, id: &str) -> daw_engine::CapturePeriodObservation {
            self.state
                .instances
                .lock()
                .unwrap()
                .get(id)
                .unwrap()
                .recording()
                .take
                .as_ref()
                .unwrap()
                .period
                .get()
                .unwrap()
                .clone()
        }
        fn feed(&mut self, value: f32) {
            self.driver.service_owner_commands();
            let mut input = [0.0f32; 1024];
            for frame in input.chunks_exact_mut(2) {
                frame[0] = value;
                frame[1] = value / 2.0;
            }
            for _ in 0..4 {
                self.driver.deliver_input(&input, 2).unwrap();
            }
            self.driver.render(128).unwrap();
        }
        fn stop(&mut self, id: &str, token: &str) {
            crate::block_on_test(stop_recording(id.into(), token.into(), &self.state)).unwrap();
            self.driver.render(128).unwrap();
        }
    }

    pub(crate) fn first_served_native_take_probe() {
        let mut f = NativeFixture::new(false);
        let token = f.arm("sampler", 0.1, 1.0);
        // No render-side command drain follows Arm before this actual capture delivery.
        f.driver.service_owner_commands();
        let mut transient = [0.0f32; 1024];
        transient[0] = 0.75;
        transient[1] = 0.375;
        f.driver.deliver_input(&transient, 2).unwrap();
        for _ in 0..3 {
            f.driver.deliver_input(&[0.0; 1024], 2).unwrap();
        }
        f.driver.render(128).unwrap();
        f.events.wait(&token, "recording");
        let snapshot = f.snapshot("sampler");
        assert!(snapshot.first_input.is_some());
        f.stop("sampler", &token);
        f.events.wait(&token, "completed");
        let instances = f.state.instances.lock().unwrap();
        let sample = instances["sampler"].samples.get(&1).unwrap();
        assert_eq!(sample.left[0], 0.75);
        assert_eq!(sample.right[0], 0.375);
        assert!(sample.left.len() >= 128);
    }

    pub(crate) fn replacement_native_take_probe(
        state: Arc<CrumbsState>,
        app: Arc<AppState>,
        driver: daw_engine::CaptureLifecycleDriver,
        instance_id: &str,
    ) {
        let mut f = NativeFixture {
            state,
            app,
            driver,
            events: Arc::new(LifecycleEvents::default()),
        };
        f.driver.render(128).unwrap();
        f.driver.service_owner_commands();
        assert_eq!(
            f.driver.deliver_input(&[0.0; 1024], 2),
            Err("Fixture input is not open".to_string()),
            "reattaching an idle sampler must not acquire input"
        );

        crate::block_on_test(set_crumbs_mode(instance_id.into(), "record".into(), &f.state))
            .unwrap();
        let token = f.arm(instance_id, 0.1, 1.0);
        f.driver.service_owner_commands();
        let mut transient = [0.0f32; 1024];
        transient[0] = 0.75;
        transient[1] = 0.375;
        f.driver.deliver_input(&transient, 2).unwrap();
        for _ in 0..3 {
            f.driver.deliver_input(&[0.0; 1024], 2).unwrap();
        }
        f.driver.render(128).unwrap();
        f.events.wait(&token, "recording");
        let snapshot = f.snapshot(instance_id);
        assert_eq!(snapshot.take_id, token);
        assert!(snapshot.first_input.is_some());

        f.stop(instance_id, &token);
        f.events.wait(&token, "completed");
        // Terminal publication follows release admission, not the owner's close.
        f.driver.service_owner_commands();
        assert!(f.period(instance_id).snapshot().closed);
        assert_eq!(
            f.driver.deliver_input(&[0.0; 1024], 2),
            Err("Fixture input is not open".to_string()),
            "the replacement must close input after its last take holder"
        );
        assert!(instance_is_attached(&f.state, instance_id));
        f.driver.render(128).unwrap();
        let instances = f.state.instances.lock().unwrap();
        let sample = instances[instance_id].samples.get(&1).unwrap();
        assert_eq!(sample.left[0], 0.75);
        assert_eq!(sample.right[0], 0.375);
        assert!(sample.left.len() >= 128);
    }

    pub(crate) fn joining_native_take_probe() {
        let mut f = NativeFixture::new(false);
        f.app
            .engine
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .arm_retrospective_capture(7, 2);
        let first = f.arm("sampler", 0.1, 1.0);
        f.feed(0.5);
        f.events.wait(&first, "recording");
        f.stop("sampler", &first);
        f.events.wait(&first, "completed");
        for _ in 0..24 {
            f.driver.render(128).unwrap();
        }
        let token = f.arm("sampler", 0.0, 1.0);
        let period = f.period("sampler");
        assert!(period.snapshot().first_served.is_some());
        f.driver.render(128).unwrap();
        assert!(f.state.instances.lock().unwrap()["sampler"]
            .recording()
            .take
            .as_ref()
            .unwrap()
            .first_input()
            .is_none());
        assert_eq!(f.snapshot("sampler").phase, "preparing");
        f.feed(0.25);
        f.events.wait(&token, "recording");
        f.stop("sampler", &token);
        f.events.wait(&token, "completed");
        let instances = f.state.instances.lock().unwrap();
        let sample = instances["sampler"].samples.get(&2).unwrap();
        assert_eq!(
            sample.left[0], 0.25,
            "refill silence cannot trigger a new threshold-zero take"
        );
    }

    #[test]
    fn native_take_admission_failures_never_strand_capture() {
        let mut f = NativeFixture::new(false);
        assert!(crate::block_on_test(arm_recording(
            "sampler".into(),
            f32::NAN,
            0,
            1.0,
            &f.state,
            &f.app,
            f.events.clone()
        ))
        .is_err());
        {
            let mut instances = f.state.instances.lock().unwrap();
            fill_command_ring(instances.get_mut("sampler").unwrap());
        }
        assert_eq!(
            crate::block_on_test(arm_recording(
                "sampler".into(),
                0.1,
                0,
                1.0,
                &f.state,
                &f.app,
                f.events.clone()
            ))
            .unwrap_err(),
            "Command queue full"
        );
        let token = f.snapshot("sampler").take_id;
        f.events.wait(&token, "failed");
        f.driver.service_owner_commands();
        assert!(f.driver.deliver_input(&[0.0; 1024], 2).is_err());
        f.driver.render(128).unwrap();
        {
            let mut engine = f.app.engine.lock().unwrap();
            let engine = engine.as_mut().unwrap();
            while engine.set_track_mute(1, true).is_ok() {}
        }
        assert!(crate::block_on_test(arm_recording(
            "sampler".into(),
            0.1,
            0,
            1.0,
            &f.state,
            &f.app,
            f.events.clone()
        ))
        .is_err());
        let token = f.snapshot("sampler").take_id;
        f.events.wait(&token, "failed");
        f.driver.service_owner_commands();
        assert!(f.driver.deliver_input(&[0.0; 1024], 2).is_err());
        let mut refused = NativeFixture::new(true);
        let token = refused.arm("sampler", 0.1, 1.0);
        refused.driver.service_owner_commands();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !refused.state.instances.lock().unwrap()["sampler"]
            .recording()
            .take
            .as_ref()
            .unwrap()
            .cancel_requested
            .load(Ordering::Acquire)
        {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        refused.driver.render(128).unwrap();
        refused.events.wait(&token, "failed");
        assert!(refused.state.instances.lock().unwrap()["sampler"]
            .samples
            .is_empty());
        let metering = Arc::new(CrumbsMetering::default());
        let mut dsp = CrumbsEngine::with_metering(48_000.0, Arc::clone(&metering));
        dsp.enable_commit_handoff();
        dsp.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));
        dsp.handle_command(CrumbsCommand::ArmRecording {
            threshold: 0.1,
            target_pad: 0,
            max_duration_secs: 1.0,
        });
        dsp.process_record_input(&[0.5; 8], &[0.25; 8]);
        dsp.handle_command(CrumbsCommand::StopRecording);
        drop(dsp.take_pending_commit().unwrap());
        let (mut ends, slot_ends) = new_crumbs_rings();
        let take = Arc::new(NativeTakeSession::new(
            "refused".into(),
            1,
            1,
            Arc::new(AtomicU64::new(0)),
            Arc::clone(&ends.lifetime),
            Arc::downgrade(&(f.events.clone() as Arc<dyn EventSink>)),
        ));
        ends.command_tx
            .push_native(NativeCrumbsCommand::PrepareTake(NativePreparedTake {
                session: Arc::clone(&take),
                threshold: 0.1,
                target_pad: 0,
                max_duration_secs: 1.0,
            }))
            .unwrap();
        let mut slot = CrumbsPluginSlot::new(
            dsp,
            slot_ends.command_rx,
            slot_ends.commit_tx,
            slot_ends.recycle_rx,
            slot_ends.retired_take_tx,
            slot_ends.lifetime,
            metering,
        );
        use daw_engine::plugin_slot::NativePlugin;
        slot.process_audio(&mut [0.0; 8], &mut [0.0; 8], 8);
        assert_eq!(
            take.failure.load(Ordering::Acquire),
            1,
            "actual DSP refusal cannot masquerade as readiness"
        );
        assert!(take.first_input().is_none());
        assert!(ends.retired_take_rx.pop().is_ok());
        assert!(ends.commit_rx.pop().is_err());
    }

    #[test]
    fn refused_stop_keeps_take_and_holder_until_actual_terminal() {
        let mut f = NativeFixture::new(false);
        let token = f.arm("sampler", 0.1, 1.0);
        f.feed(0.5);
        f.events.wait(&token, "recording");
        {
            let mut instances = f.state.instances.lock().unwrap();
            fill_command_ring(instances.get_mut("sampler").unwrap());
        }
        assert_eq!(
            crate::block_on_test(stop_recording("sampler".into(), token.clone(), &f.state))
                .unwrap_err(),
            "Command queue full"
        );
        assert_eq!(f.snapshot("sampler").phase, "recording");
        assert!(!f.period("sampler").snapshot().closed);
        f.driver.render(128).unwrap();
        f.stop("sampler", &token);
        f.events.wait(&token, "completed");
        f.driver.service_owner_commands();
        assert!(f.period("sampler").snapshot().closed);
    }

    #[test]
    fn automatic_and_empty_terminals_release_without_panel_polls() {
        let mut f = NativeFixture::new(false);
        let token = f.arm("sampler", 0.1, 4.0 / 48_000.0);
        f.feed(0.5);
        f.events.wait(&token, "completed");
        f.driver.service_owner_commands();
        assert!(f.period("sampler").snapshot().closed);
        assert_eq!(
            f.state.instances.lock().unwrap()["sampler"].samples.len(),
            1
        );
        for waiting in [false, true] {
            let mut empty = NativeFixture::new(false);
            let token = empty.arm("sampler", if waiting { 0.1 } else { 0.0 }, 1.0);
            if waiting {
                empty.feed(0.0);
                empty.events.wait(&token, "waiting");
            } else {
                empty.driver.render(128).unwrap();
                assert_eq!(empty.snapshot("sampler").phase, "preparing");
            }
            empty.stop("sampler", &token);
            empty.events.wait(&token, "cancelled");
            empty.driver.service_owner_commands();
            assert!(empty.period("sampler").snapshot().closed);
            assert!(empty.state.instances.lock().unwrap()["sampler"]
                .samples
                .is_empty());
        }
    }

    #[test]
    fn committed_take_survives_mirror_and_release_backpressure() {
        let mut f = NativeFixture::new(false);
        let token = f.arm("sampler", 0.1, 1.0);
        f.feed(0.5);
        f.events.wait(&token, "recording");
        crate::block_on_test(stop_recording("sampler".into(), token.clone(), &f.state)).unwrap();
        {
            let mut instances = f.state.instances.lock().unwrap();
            f.driver.render(128).unwrap();
            fill_command_ring(instances.get_mut("sampler").unwrap());
            let mut engine = f.app.engine.lock().unwrap();
            let engine = engine.as_mut().unwrap();
            while engine.set_track_mute(1, true).is_ok() {}
        }
        f.events.wait(&token, "finishing");
        assert!(!f.period("sampler").snapshot().closed);
        {
            let mut instances = f.state.instances.lock().unwrap();
            f.driver.render(128).unwrap();
            fill_command_ring(instances.get_mut("sampler").unwrap());
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while !f.state.instances.lock().unwrap()["sampler"]
            .recording()
            .take
            .as_ref()
            .unwrap()
            .released
            .load(Ordering::Acquire)
        {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        f.driver.service_owner_commands();
        assert!(
            f.period("sampler").snapshot().closed,
            "mirror congestion cannot hold input"
        );
        assert_eq!(
            f.state.instances.lock().unwrap()["sampler"].samples.len(),
            1
        );
        f.driver.render(128).unwrap();
        f.events.wait(&token, "completed");
        assert_eq!(
            f.state.instances.lock().unwrap()["sampler"].samples.len(),
            1
        );
    }

    #[test]
    fn take_completion_respects_other_slots_and_retrospective_arm() {
        let mut f = NativeFixture::new(false);
        f.create("second");
        let a = f.arm("sampler", 0.1, 1.0);
        let b = f.arm("second", 0.1, 1.0);
        f.feed(0.5);
        f.events.wait(&a, "recording");
        f.events.wait(&b, "recording");
        let period = f.period("sampler");
        f.stop("sampler", &a);
        f.events.wait(&a, "completed");
        f.driver.service_owner_commands();
        assert!(!period.snapshot().closed);
        f.app
            .engine
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .arm_retrospective_capture(7, 2);
        f.stop("second", &b);
        f.events.wait(&b, "completed");
        f.driver.service_owner_commands();
        assert!(!period.snapshot().closed);
        let c = f.arm("sampler", 0.1, 1.0);
        f.feed(0.5);
        f.events.wait(&c, "recording");
        f.app
            .engine
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .disarm_retrospective_capture();
        f.driver.service_owner_commands();
        assert!(!period.snapshot().closed);
        f.stop("sampler", &c);
        f.events.wait(&c, "completed");
        f.driver.service_owner_commands();
        assert!(period.snapshot().closed);
    }

    #[test]
    fn cancelled_take_cannot_reach_a_recreated_instance_or_engine() {
        let mut f = NativeFixture::new(false);
        let old = f.arm("sampler", 0.0, 1.0);
        let old_inc = f.snapshot("sampler").instance_incarnation;
        crate::block_on_test(destroy_crumbs("sampler".into(), &f.state, &f.app)).unwrap();
        f.create("sampler");
        let new = f.arm("sampler", 0.1, 1.0);
        assert_ne!(old_inc, f.snapshot("sampler").instance_incarnation);
        assert!(crate::block_on_test(stop_recording("sampler".into(), old, &f.state)).is_err());
        f.feed(0.5);
        f.events.wait(&new, "recording");
        f.stop("sampler", &new);
        f.events.wait(&new, "completed");
        f.app
            .engine
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .mark_render_stalled(None);
        let reply = crate::block_on_test(super::super::engine_lifecycle::retire_native_engine(
            &f.app,
            &f.state,
            &crate::host::plugin_window::NoWindowHost,
        ));
        assert_eq!(
            reply.outcome,
            super::super::engine_lifecycle::RetireOutcome::Retired
        );
        f.driver.service_owner_commands();
    }

    #[test]
    fn capture_completion_releases_locks_before_pcm_and_events() {
        let mut f = NativeFixture::new(false);
        *f.events.reenter.lock().unwrap() =
            Some((Arc::downgrade(&f.state), Arc::downgrade(&f.app)));
        let token = f.arm("sampler", 0.1, 1.0);
        f.feed(0.5);
        f.events.wait(&token, "recording");
        let witnessed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let instances = f.state.instances.lock().unwrap();
            let take = instances["sampler"].recording().take.as_ref().unwrap();
            let state = Arc::clone(&f.state);
            let app = Arc::clone(&f.app);
            let observed = Arc::clone(&witnessed);
            *take.before_materialize.lock().unwrap() = Some(Box::new(move || {
                assert!(state.instances.try_lock().is_ok());
                assert!(app.engine.try_lock().is_ok());
                assert!(app.graph.try_lock().is_ok());
                observed.store(true, Ordering::Release);
            }));
        }
        f.stop("sampler", &token);
        f.events.wait(&token, "completed");
        assert!(witnessed.load(Ordering::Acquire));
    }

    #[test]
    fn mode_exit_commits_recording_and_cancels_empty_wait() {
        for recording in [false, true] {
            let mut f = NativeFixture::new(false);
            let token = f.arm("sampler", 0.1, 1.0);
            if recording {
                f.feed(0.5);
                f.events.wait(&token, "recording");
            } else {
                f.feed(0.0);
                f.events.wait(&token, "waiting");
            }
            crate::block_on_test(set_crumbs_mode("sampler".into(), "quick".into(), &f.state))
                .unwrap();
            f.driver.render(128).unwrap();
            f.events
                .wait(&token, if recording { "completed" } else { "cancelled" });
            f.driver.service_owner_commands();
            assert!(f.period("sampler").snapshot().closed);
            assert_eq!(
                f.state.instances.lock().unwrap()["sampler"].samples.len(),
                usize::from(recording)
            );
        }
    }

    #[test]
    fn terminal_publication_contention_retries_before_completing_take() {
        let mut f = NativeFixture::new(false);
        let token = f.arm("sampler", 0.1, 1.0);
        f.feed(0.5);
        f.events.wait(&token, "recording");
        let take = f.state.instances.lock().unwrap()["sampler"]
            .recording()
            .take
            .clone()
            .unwrap();
        let published = take.published.lock().unwrap();
        let attempts = take.publication_attempts.load(Ordering::Acquire);
        f.stop("sampler", &token);
        let deadline = Instant::now() + Duration::from_secs(5);
        while !take.released.load(Ordering::Acquire)
            || take.publication_attempts.load(Ordering::Acquire) <= attempts
        {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert!(
            !take.complete.load(Ordering::Acquire),
            "contended terminal publication must remain pending"
        );
        drop(published);
        f.events.wait(&token, "completed");
    }

    #[test]
    fn retirement_materializes_handed_off_take_outside_all_guards() {
        let state = CrumbsState::default();
        let app = Arc::new(AppState::default());
        let (instance, mut commit, _, _) = instance_with_rings();
        state
            .instances
            .lock()
            .unwrap()
            .insert("retired".into(), instance);
        commit
            .push(PendingRecordingCommit {
                left: vec![0.75; 8],
                right: vec![0.25; 8],
                sample_rate: 48_000,
            })
            .unwrap();
        let graph = app.graph.lock().unwrap();
        let engine = app.engine.lock().unwrap();
        let work = detach_from_retired_engine(&state);
        let observer = Arc::clone(&app);
        BEFORE_RETIRED_PCM.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                assert!(observer.graph.try_lock().is_ok());
                assert!(observer.engine.try_lock().is_ok());
            }))
        });
        drop(engine);
        drop(graph);
        let _retained = finish_detached_crumbs(work, &state);
        BEFORE_RETIRED_PCM.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(
            state.instances.lock().unwrap()["retired"].samples[&1].left,
            vec![0.75; 8]
        );
    }

    #[test]
    fn retirement_never_mirrors_a_take_into_replacement_instance_or_engine() {
        let state = CrumbsState::default();
        let (instance, mut commit, _, _) = instance_with_rings();
        state
            .instances
            .lock()
            .unwrap()
            .insert("same".into(), instance);
        commit
            .push(PendingRecordingCommit {
                left: vec![0.5; 8],
                right: vec![0.25; 8],
                sample_rate: 48_000,
            })
            .unwrap();
        let work = detach_from_retired_engine(&state);
        let (replacement, _, _, mut commands) = instance_with_rings();
        state
            .instances
            .lock()
            .unwrap()
            .insert("same".into(), replacement);
        let _retained = finish_detached_crumbs(work, &state);
        assert!(state.instances.lock().unwrap()["same"].samples.is_empty());
        assert!(commands.pop().is_err());
    }

    #[cfg(debug_assertions)]
    pub(crate) fn callback_lifecycle_probe() {
        let mut f = NativeFixture::new(false);
        for _ in 0..2 {
            let token = f.arm("sampler", 0.1, 1.0);
            f.driver.service_owner_commands();
            let input = [0.5f32; 1024];
            assert_no_alloc::assert_no_alloc(|| {
                for _ in 0..4 {
                    f.driver.deliver_input(&input, 2).unwrap();
                }
                f.driver.render(128).unwrap();
            });
            f.events.wait(&token, "recording");
            crate::block_on_test(stop_recording("sampler".into(), token.clone(), &f.state))
                .unwrap();
            assert_no_alloc::assert_no_alloc(|| f.driver.render(128).unwrap());
            f.events.wait(&token, "completed");
            f.driver.service_owner_commands();
            assert_no_alloc::assert_no_alloc(|| f.driver.render(128).unwrap());
        }
        for (threshold, duration, mode_exit) in [
            (0.1, 4.0 / 48_000.0, false),
            (0.9, 1.0, true),
            (0.1, 1.0, true),
        ] {
            let mut f = NativeFixture::new(false);
            let token = f.arm("sampler", threshold, duration);
            f.driver.service_owner_commands();
            let input = [0.5f32; 1024];
            assert_no_alloc::assert_no_alloc(|| {
                f.driver.render(128).unwrap();
                for _ in 0..4 {
                    f.driver.deliver_input(&input, 2).unwrap();
                }
                f.driver.render(128).unwrap();
            });
            if mode_exit {
                f.events.wait(
                    &token,
                    if threshold > 0.5 {
                        "waiting"
                    } else {
                        "recording"
                    },
                );
                crate::block_on_test(set_crumbs_mode("sampler".into(), "quick".into(), &f.state))
                    .unwrap();
                assert_no_alloc::assert_no_alloc(|| f.driver.render(128).unwrap());
            }
            f.events.wait(
                &token,
                if threshold > 0.5 {
                    "cancelled"
                } else {
                    "completed"
                },
            );
        }
    }

    struct EngineCommands(rtrb::Consumer<NativeCrumbsCommand>);
    impl EngineCommands {
        fn pop(&mut self) -> Result<CrumbsCommand, ()> {
            match self.0.pop() {
                Ok(NativeCrumbsCommand::Engine(command)) => Ok(command),
                _ => Err(()),
            }
        }
    }

    /// Build the command-side instance pieces exactly as create_crumbs
    /// wires them, plus the slot-side ring endpoints so a test can simulate
    /// the audio thread handing a commit off.
    fn instance_with_rings() -> (
        CrumbsInstanceData,
        Producer<PendingRecordingCommit>,
        rtrb::Consumer<RecordBufferPair>,
        EngineCommands,
    ) {
        let (command_tx, cmd_rx) = rtrb::RingBuffer::new(8);
        let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
        let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
        let (_retired_tx, retired_take_rx) = rtrb::RingBuffer::new(2);
        let instance = CrumbsInstanceData {
            samples: HashMap::new(),
            metering: Arc::new(CrumbsMetering::default()),
            engine_slot: CrumbsEngineSlot::Attached {
                plugin_id: 0,
                ends: CrumbsInstanceEnds {
                    command_tx: CrumbsCommandSender(command_tx),
                    commit_rx,
                    recycle_tx,
                    retired_take_rx,
                    lifetime: Arc::new(CrumbsSlotLifetime::default()),
                    recording: CrumbsRecordingState::default(),
                    pending_recycle: None,
                },
            },
            next_sample_id: 1,
            pending_mirror: Vec::new(),
        };
        (instance, commit_tx, recycle_rx, EngineCommands(cmd_rx))
    }

    /// Saturate an attached instance's command ring, as a test that needs a
    /// refused push does.
    fn fill_command_ring(instance: &mut CrumbsInstanceData) {
        while instance.send(CrumbsCommand::AllNotesOff).is_ok() {}
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
            CrumbsEngineSlot::Attached { plugin_id, .. } => plugin_id,
            CrumbsEngineSlot::Dormant(_) => {
                panic!("instance '{instance_id}' should be attached to the engine")
            }
        }
    }

    /// The writes an instance has parked, or a panic if it is not dormant.
    fn parked_writes<T>(
        state: &CrumbsState,
        instance_id: &str,
        read: impl FnOnce(&DormantCrumbsWrites) -> T,
    ) -> T {
        let instances = state
            .instances
            .lock()
            .expect("crumbs state lock should be available");
        let instance = instances
            .get(instance_id)
            .unwrap_or_else(|| panic!("instance '{instance_id}' should own a map entry"));
        match &instance.engine_slot {
            CrumbsEngineSlot::Dormant(writes) => read(writes),
            CrumbsEngineSlot::Attached { .. } => {
                panic!("instance '{instance_id}' should still be dormant")
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
    /// each one may independently request a take after it attaches.
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

    /// Pop the fence and persistent detached slot one successful create queues,
    /// returning the engine plugin id. Input belongs to a later accepted take.
    fn pop_create_commands(command_rx: &mut rtrb::Consumer<GraphCommand>) -> usize {
        assert!(matches!(
            command_rx.pop(),
            Ok(GraphCommand::BeginBatch { commands: 1 })
        ));
        match command_rx.pop() {
            Ok(GraphCommand::AddHostedPlugin(id, _, _)) => id,
            _ => panic!("create publishes one persistent detached sampler"),
        }
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
            Ok(daw_engine::scheduler::GraphCommand::RemovePlugin(id)) => id,
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

    /// A destroy takes the instance out of every chain that borrowed it before
    /// it retires the runtime.
    ///
    /// The strip splice is what makes this reachable: the instance now sits in
    /// a track's chain, and a chain entry naming a retired effect is counted
    /// nowhere — `run_device` and `run_generator` both return on a failed
    /// effect-table lookup — so it would stand as a silent passthrough until a
    /// topology replacement cleared it, and a rolling engine never gets one.
    #[test]
    fn destroying_a_spliced_instance_releases_its_chain_entries_before_removal() {
        const INSTANCE_ID: &str = "d-spliced-crumbs";

        let state = CrumbsState::default();
        let app_state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(256);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("a create against a running engine attaches the slot");
        let plugin_id = attached_plugin_id(&state, INSTANCE_ID);

        crate::block_on_test(crate::commands::graph::apply_graph_commands(
            serde_json::json!({
                "schemaVersion": 1,
                "commands": [{
                    "kind": "create-track-strip",
                    "trackId": "pads",
                    "name": "Pads",
                    "state": { "gain": 0.8, "pan": 0, "muted": false,
                               "soloGated": false, "vcaMultiplier": 1 },
                    "devices": [
                        { "id": INSTANCE_ID, "name": "Crumbs", "type": "builtin-crumbs",
                          "bypassed": false, "parameterValues": {} }
                    ],
                    "honorMuted": true,
                    "contributesAudio": true
                }]
            }),
            &app_state,
            &state,
        ))
        .expect("the batch splices the instance onto the strip");

        // Everything up to here is setup; the destroy's own ops are what this
        // test reads.
        while command_rx.pop().is_ok() {}

        crate::block_on_test(destroy_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("the destroy is admitted");

        let mut ops = Vec::new();
        while let Ok(command) = command_rx.pop() {
            ops.push(command);
        }

        let released = ops
            .iter()
            .position(|op| {
                matches!(op, GraphCommand::RemoveTrackDevice { effect_id, .. }
                    if *effect_id == plugin_id)
            })
            .expect("the destroy must take the instance off the chain that borrowed it");
        let retired = ops
            .iter()
            .position(|op| matches!(op, GraphCommand::RemovePlugin(id) if *id == plugin_id))
            .expect("the destroy must still retire the runtime");
        assert!(
            released < retired,
            "the chain release has to reach the ring ahead of the retirement, or a callback \
             between the two runs a chain entry whose effect is already gone"
        );
        assert!(
            !ops.iter()
                .any(|op| matches!(op, GraphCommand::RemoveTrackDeviceRetired { .. })),
            "the chain releases the entry; the retirement is the destroy's own, separate op"
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
        // Idle create publishes a fence and slot. An explicit sentinel below
        // fills the remaining position without reallocating the channel.
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(3);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("create should fill the scheduler ring");

        let original_engine_plugin_id = attached_plugin_id(&state, INSTANCE_ID);

        {
            let mut engine = app_state.engine.lock().unwrap();
            let engine = engine.as_mut().unwrap();
            engine
                .set_bypass(original_engine_plugin_id, false)
                .expect("the sentinel must fill the final scheduler position");
            assert_eq!(
                engine.set_bypass(original_engine_plugin_id, false),
                Err("Audio command queue full".to_string()),
                "a second sentinel independently proves admission is full"
            );
        }
        assert_eq!(command_rx.slots(), command_rx.buffer().capacity());

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
        match command_rx.pop() {
            Ok(GraphCommand::SetBypass(id, false)) => assert_eq!(id, original_engine_plugin_id),
            _ => panic!("the saturation sentinel must follow the persistent slot"),
        }
        assert!(
            command_rx.pop().is_err(),
            "failed destroy must not queue a removal command"
        );

        crate::block_on_test(destroy_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("destroy should succeed after scheduler capacity is drained");

        let removed_engine_plugin_id = match command_rx.pop() {
            Ok(daw_engine::scheduler::GraphCommand::RemovePlugin(id)) => id,
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

    /// The first create holds the instances mutex while parked on engine
    /// registration, observed directly with the `try_lock` probe below, and a
    /// second create of the same id is refused rather than registering a
    /// second runtime.
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
        fill_command_ring(&mut instance);
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

    /// Detaching replaces the slot, and the commit ring's command side goes
    /// with it. A take the audio thread had already handed off is the
    /// musician's performance, so it must land in the command-side sample map
    /// before the ring holding it is dropped.
    #[test]
    fn detaching_a_retired_engine_keeps_a_take_the_audio_thread_handed_off() {
        let state = CrumbsState::default();
        let (instance, mut commit_tx, _recycle_rx, _cmd_rx) = instance_with_rings();
        state
            .instances
            .lock()
            .expect("crumbs state lock should be available")
            .insert("instance-1".to_string(), instance);
        commit_tx
            .push(PendingRecordingCommit {
                left: vec![0.5f32; 256],
                right: vec![0.25f32; 256],
                sample_rate: 48_000,
            })
            .expect("the commit ring takes the handoff");

        let work = detach_from_retired_engine(&state);
        let _retained = finish_detached_crumbs(work, &state);

        let instances = state
            .instances
            .lock()
            .expect("crumbs state lock should be available");
        let instance = instances.get("instance-1").expect("the instance survives");
        assert!(
            matches!(instance.engine_slot, CrumbsEngineSlot::Dormant(_)),
            "the instance must end dormant, which is what the next batch re-registers from"
        );
        let take = instance
            .samples
            .get(&1)
            .expect("the handed-off take must survive the slot the retire replaced");
        assert_eq!(take.meta.frame_count as usize, 256);
        assert!(take.left.iter().all(|&frame| (frame - 0.5).abs() < 1.0e-6));
        assert!(take
            .right
            .iter()
            .all(|&frame| (frame - 0.25).abs() < 1.0e-6));
    }

    /// A take the drain parks in `pending_mirror` — because the ring it would
    /// mirror onto is full — must not survive the detach that follows it.
    /// `pending_mirror` is a field of the instance, not of the slot the ring
    /// belongs to, so a naive detach would carry the parked selection into
    /// the replacement engine and reassert it there, even though the panel
    /// never asked that attach for it. The take itself is not at risk either
    /// way, because the drain lands it in `samples` before it ever tries the
    /// ring.
    #[test]
    fn detaching_a_retired_engine_clears_a_mirror_the_drain_parked() {
        let state = CrumbsState::default();
        let (mut instance, mut commit_tx, _recycle_rx, _cmd_rx) = instance_with_rings();
        fill_command_ring(&mut instance);
        commit_tx
            .push(PendingRecordingCommit {
                left: vec![0.5f32; 256],
                right: vec![0.25f32; 256],
                sample_rate: 48_000,
            })
            .expect("the commit ring takes the handoff");
        state
            .instances
            .lock()
            .expect("crumbs state lock should be available")
            .insert("instance-1".to_string(), instance);

        let work = detach_from_retired_engine(&state);
        let _retained = finish_detached_crumbs(work, &state);

        let instances = state
            .instances
            .lock()
            .expect("crumbs state lock should be available");
        let instance = instances.get("instance-1").expect("the instance survives");
        assert!(
            matches!(instance.engine_slot, CrumbsEngineSlot::Dormant(_)),
            "the instance must end dormant, which is what the next batch re-registers from"
        );
        let take = instance
            .samples
            .get(&1)
            .expect("the handed-off take must survive the slot the retire replaced");
        assert_eq!(take.meta.frame_count as usize, 256);
        assert!(
            instance.pending_mirror.is_empty(),
            "a mirror parked against the retired slot's ring must not carry a stale \
             selection into the replacement engine"
        );
    }

    /// A mirror is a pair. One free slot takes the AddSample and leaves the
    /// selection refused, so the entry that carries it must survive to be
    /// retried — dropping it strands the engine on the wrong active sample.
    #[test]
    fn a_deferred_mirror_keeps_its_entry_until_its_selection_lands() {
        let (mut instance, _commit_tx, _recycle_rx, mut cmd_rx) = instance_with_rings();
        let sample = Arc::new(SampleData::from_stereo(
            vec![0.25f32; 32],
            vec![0.25f32; 32],
            48_000,
        ));
        instance.pending_mirror.push((7, Arc::clone(&sample)));

        // One free slot: the AddSample lands and the selection is refused.
        fill_command_ring(&mut instance);
        cmd_rx
            .pop()
            .expect("the filled ring holds commands to free");

        drain_pending_recording_commits(&mut instance);
        assert_eq!(
            instance.pending_mirror.len(),
            1,
            "an entry whose selection the ring refused must stay parked"
        );

        // Two free slots: the pair lands whole and the entry retires.
        while cmd_rx.pop().is_ok() {}
        drain_pending_recording_commits(&mut instance);
        assert!(
            instance.pending_mirror.is_empty(),
            "a mirror whose pair landed retires"
        );
        let mut delivered = Vec::new();
        while let Ok(command) = cmd_rx.pop() {
            match command {
                CrumbsCommand::AddSample { id, .. } => delivered.push(format!("add {id}")),
                CrumbsCommand::SetActiveSample(id) => delivered.push(format!("select {id}")),
                _ => {}
            }
        }
        assert_eq!(
            delivered.last().map(String::as_str),
            Some("select 7"),
            "the mirror ends on the selection it carried"
        );
        assert_eq!(
            delivered[delivered.len() - 2].as_str(),
            "add 7",
            "the selection follows the sample it selects"
        );
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
        first_served_native_take_probe();
    }

    /// Creating a sampler publishes only its persistent detached slot.
    /// Input belongs to a later admitted take.
    ///
    /// `AddHostedPlugin` and not `AddPlugin`: the first homes the instance
    /// detached, where the strip chain that carries the `builtin-crumbs`
    /// device borrows it; the second would home it on the master insert chain,
    /// outside the track's fader, pan, mute, inserts and sends, and over the
    /// whole mix.
    #[test]
    fn idle_crumbs_slot_acquires_capture_only_for_an_accepted_take() {
        let state = CrumbsState::default();
        let app_state = AppState::default();
        let (engine, mut commands, _adoptions) = daw_engine::engine_handle_for_command_capture(8);
        *app_state.engine.lock().unwrap() = Some(engine);
        crate::block_on_test(create_crumbs("idle".into(), &state, &app_state)).unwrap();
        while let Ok(command) = commands.pop() {
            assert!(
                !matches!(command, GraphCommand::RegisterCaptureConsumer(_)),
                "an idle persistent sampler must not acquire native input"
            );
        }
        assert!(state.instances.lock().unwrap().contains_key("idle"));
        let mut f = NativeFixture::new(false);
        f.driver.service_owner_commands();
        assert!(f.driver.deliver_input(&[0.0; 1024], 2).is_err());
        {
            let mut instances = f.state.instances.lock().unwrap();
            let instance = instances.get_mut("sampler").unwrap();
            let loaded = Arc::new(SampleData::from_mono(vec![0.25; 48_000], 48_000));
            instance.samples.insert(1, Arc::clone(&loaded));
            instance.next_sample_id = 2;
            instance
                .send(CrumbsCommand::AddSample {
                    id: 1,
                    data: loaded,
                })
                .unwrap();
            instance.send(CrumbsCommand::SetActiveSample(1)).unwrap();
        }
        crate::block_on_test(crumbs_note_on("sampler".into(), 60, 100, &f.state)).unwrap();
        f.driver.render(128).unwrap();
        let token = f.arm("sampler", 0.0, 1.0);
        f.driver.service_owner_commands();
        f.driver.render(128).unwrap();
        assert!(f.state.instances.lock().unwrap()["sampler"]
            .recording()
            .take
            .as_ref()
            .unwrap()
            .first_input()
            .is_none());
        assert_eq!(
            f.snapshot("sampler").phase,
            "preparing",
            "initial unserved zero cannot trigger threshold zero"
        );
        f.feed(0.75);
        f.events.wait(&token, "recording");
        f.stop("sampler", &token);
        f.events.wait(&token, "completed");
        f.driver.service_owner_commands();
        assert!(f.period("sampler").snapshot().closed);
        f.driver.render(128).unwrap();
        let instances = f.state.instances.lock().unwrap();
        let instance = &instances["sampler"];
        assert_eq!(instance.samples.len(), 2);
        assert_eq!(instance.samples[&1].left[0], 0.25);
        assert!(
            instance.metering.active_voice_count.load(Ordering::Relaxed) > 0,
            "take end preserves sounding voices"
        );
    }

    #[test]
    fn create_crumbs_registers_only_the_persistent_slot() {
        let state = CrumbsState::default();
        let app = AppState::default();
        let (engine, mut commands, _retired) = daw_engine::engine_handle_for_command_capture(8);
        *app.engine.lock().unwrap() = Some(engine);
        crate::block_on_test(create_crumbs("idle".into(), &state, &app)).unwrap();
        let id = pop_create_commands(&mut commands);
        assert_eq!(attached_plugin_id(&state, "idle"), id);
        assert!(
            commands.pop().is_err(),
            "idle creation must not publish a capture consumer"
        );
    }

    /// A full capture bus can refuse a take, but cannot refuse an idle
    /// persistent sampler whose pads and loaded samples remain playable.
    #[test]
    fn idle_crumbs_creation_does_not_consume_capture_capacity() {
        let state = CrumbsState::default();
        let app = AppState::default();
        let (mut engine, mut commands, _retired) =
            daw_engine::engine_handle_for_command_capture(16);
        for id in 0..CRUMBS_CAPTURE_RESERVE {
            engine.register_capture_consumer(id).unwrap();
        }
        while commands.pop().is_ok() {}
        *app.engine.lock().unwrap() = Some(engine);
        crate::block_on_test(create_crumbs("idle".into(), &state, &app)).unwrap();
        pop_create_commands(&mut commands);
        assert!(commands.pop().is_err());
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
            "the instance parks the panel's writes until an engine exists"
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
                &state,
                &app_state,
                Arc::new(crate::events::NoopEventSink)
            )),
            Err("Crumbs must be in Record mode".to_string()),
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

        let refusals =
            attach_dormant_crumbs(&state, &mut GraphRegistry::default(), &app_state.engine)
                .expect("both locks are free, so the attach reports refusals rather than an error")
                .refusals;
        assert!(
            refusals.is_empty(),
            "the engine had room for this slot: {refusals:?}"
        );

        match command_rx.pop() {
            Ok(GraphCommand::BeginBatch { commands }) => assert_eq!(
                commands, 1,
                "the attach's fence must announce the slot and its capture registration"
            ),
            Ok(_) => panic!("an attach must publish its registration behind a batch fence"),
            Err(_) => panic!("an attach must queue its batch fence"),
        }
        let registered_engine_plugin_id = match command_rx.pop() {
            Ok(GraphCommand::AddHostedPlugin(id, mut plugin, _)) => {
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
                    matches!(
                        slot.command_rx.pop(),
                        Ok(NativeCrumbsCommand::Engine(CrumbsCommand::SetParam { .. }))
                    ),
                    "what the panel set while dormant must reach the ring the slot drains"
                );
                id
            }
            Ok(_) => panic!("the batch's first command must register the crumbs slot"),
            Err(_) => panic!("an attach must queue the slot registration"),
        };

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

    /// Idle attachment is independent of capture capacity and preserves the
    /// same incarnation and parked parameter writes.
    #[test]
    fn an_idle_dormant_instance_attaches_with_a_full_capture_bus() {
        let state = CrumbsState::default();
        let app = AppState::default();
        crate::block_on_test(create_crumbs("dormant".into(), &state, &app)).unwrap();
        crate::block_on_test(set_crumbs_param(
            "dormant".into(),
            "filterCutoff".into(),
            0.25,
            &state,
        ))
        .unwrap();
        let incarnation = state.instances.lock().unwrap()["dormant"]
            .recording()
            .incarnation;
        let (mut engine, mut commands, _retired) =
            daw_engine::engine_handle_for_command_capture(16);
        for id in 0..CRUMBS_CAPTURE_RESERVE {
            engine.register_capture_consumer(id).unwrap();
        }
        while commands.pop().is_ok() {}
        *app.engine.lock().unwrap() = Some(engine);
        let report =
            attach_dormant_crumbs(&state, &mut GraphRegistry::default(), &app.engine).unwrap();
        assert!(report.refusals.is_empty());
        assert_eq!(report.attached, vec!["dormant"]);
        assert_eq!(
            state.instances.lock().unwrap()["dormant"]
                .recording()
                .incarnation,
            incarnation
        );
        assert!(matches!(
            commands.pop(),
            Ok(GraphCommand::BeginBatch { commands: 1 })
        ));
        match commands.pop().unwrap() {
            GraphCommand::AddHostedPlugin(_, mut plugin, _) => {
                let slot = plugin
                    .as_any_mut()
                    .downcast_mut::<CrumbsPluginSlot>()
                    .unwrap();
                assert!(matches!(
                    slot.command_rx.pop(),
                    Ok(NativeCrumbsCommand::Engine(CrumbsCommand::SetParam {
                        value: 0.25,
                        ..
                    }))
                ));
            }
            _ => panic!("attach publishes the persistent slot"),
        }
        assert!(
            commands.pop().is_err(),
            "idle attach does not register input"
        );
    }

    /// The panel's knobs are rAF-throttled, so one drag sends a value about
    /// sixty times a second: a dormant instance that queued them would fill a
    /// ring in seconds and then refuse every later write, leaving the engine
    /// on a mid-drag value and the store on the final one. Dormant state is
    /// state — one entry per parameter, whatever the gesture's length — and
    /// the attach replays it with the pool the selection names.
    #[test]
    fn dormant_writes_survive_a_drag_longer_than_the_ring() {
        const INSTANCE_ID: &str = "before-first-play";
        // One past the command ring's depth: the write that a queue would have
        // had to refuse is the one whose value has to reach the engine.
        const DRAG_WRITES: usize = 129;
        const SAMPLE_ID: SampleId = 7;

        let state = CrumbsState::default();
        let app_state = AppState::default();
        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("a create before the engine runs must degrade, not refuse");

        for write in 0..DRAG_WRITES {
            crate::block_on_test(set_crumbs_param(
                INSTANCE_ID.to_string(),
                "filterCutoff".to_string(),
                write as f32,
                &state,
            ))
            .unwrap_or_else(|error| panic!("write {write} of a drag must be taken: {error}"));
        }
        crate::block_on_test(set_crumbs_mode(
            INSTANCE_ID.to_string(),
            "slice".to_string(),
            &state,
        ))
        .expect("a mode set before play must be taken");

        // A sample loaded while dormant: `load_sample` decodes a file, so the
        // map is filled the way it fills it and the selection sent as it
        // sends it.
        {
            let mut instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            let instance = instances
                .get_mut(INSTANCE_ID)
                .expect("the dormant instance owns a map entry");
            let sample = Arc::new(SampleData::from_mono(vec![0.5f32; 64], 48_000));
            instance.samples.insert(SAMPLE_ID, Arc::clone(&sample));
            instance
                .send(CrumbsCommand::AddSample {
                    id: SAMPLE_ID,
                    data: sample,
                })
                .expect("the map already holds the data, so the mirror parks");
            instance
                .send(CrumbsCommand::SetActiveSample(SAMPLE_ID))
                .expect("the selection parks");
        }

        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);
        let refusals =
            attach_dormant_crumbs(&state, &mut GraphRegistry::default(), &app_state.engine)
                .expect("both locks are free, so the attach reports refusals rather than an error")
                .refusals;
        assert!(refusals.is_empty(), "the engine had room: {refusals:?}");

        assert!(
            matches!(command_rx.pop(), Ok(GraphCommand::BeginBatch { .. })),
            "an attach must publish its registration behind a batch fence"
        );
        let mut plugin = match command_rx.pop() {
            Ok(GraphCommand::AddHostedPlugin(_, plugin, _)) => plugin,
            Ok(_) => panic!("the batch's first command must register the crumbs slot"),
            Err(_) => panic!("an attach must queue the slot registration"),
        };
        let slot = plugin
            .as_any_mut()
            .downcast_mut::<CrumbsPluginSlot>()
            .expect("the registered plugin must be the crumbs slot");

        let mut params = Vec::new();
        let mut modes = 0;
        let mut added_samples = Vec::new();
        let mut last_selection = None;
        while let Ok(command) = slot.command_rx.pop() {
            match command {
                NativeCrumbsCommand::Engine(CrumbsCommand::SetParam { param, value }) => {
                    params.push((param, value))
                }
                NativeCrumbsCommand::Engine(CrumbsCommand::SetMode(_)) => modes += 1,
                NativeCrumbsCommand::Engine(CrumbsCommand::AddSample { id, .. }) => {
                    added_samples.push(id)
                }
                NativeCrumbsCommand::Engine(CrumbsCommand::SetActiveSample(id)) => {
                    last_selection = Some(id)
                }
                _ => panic!("the replay must queue nothing else"),
            }
        }

        assert_eq!(
            params,
            vec![(CrumbsParam::FilterCutoff, (DRAG_WRITES - 1) as f32)],
            "one entry per parameter, holding the value the drag settled on"
        );
        assert_eq!(modes, 1, "the mode set before play reaches the engine once");
        assert_eq!(
            added_samples,
            vec![SAMPLE_ID],
            "the engine's pool is filled from the command-side map"
        );
        assert_eq!(
            last_selection,
            Some(SAMPLE_ID),
            "the replay ends on the sample the panel selected"
        );
    }

    /// A lock this cannot take is reported. Swallowing it as an empty refusal
    /// list would read to the caller as "every dormant instance attached",
    /// which is the one thing it does not know.
    #[test]
    fn a_poisoned_lock_is_reported_not_swallowed() {
        let state = Arc::new(CrumbsState::default());
        let app_state = AppState::default();

        let poisoner = Arc::clone(&state);
        let poisoned = std::thread::spawn(move || {
            let _guard = poisoner
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            panic!("poison the instances lock");
        })
        .join();
        assert!(poisoned.is_err(), "the poisoning thread must have panicked");

        let error = attach_dormant_crumbs(&state, &mut GraphRegistry::default(), &app_state.engine)
            .expect_err("a lock the attach cannot take is an error, not an empty result");
        assert!(
            error.starts_with("Failed to lock crumbs state"),
            "the message must be the one every sibling uses: {error}"
        );
    }

    /// Issue #3807 (regression): an attach that installs a dormant instance's
    /// slot must number its fence on the registry it was given — the same
    /// counter `apply_graph_commands` holds the batch fence that follows it
    /// against. Left unnumbered, every later `PendingStamp::admitted_batch`
    /// would sit one below the horizon the engine actually clears.
    #[test]
    fn an_attach_numbers_its_fence_on_the_registry() {
        const INSTANCE_ID: &str = "dormant-attach-fence-numbering";

        let state = CrumbsState::default();
        let app_state = AppState::default();
        crate::block_on_test(create_crumbs(INSTANCE_ID.to_string(), &state, &app_state))
            .expect("a create before the engine runs must degrade, not refuse");

        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        let mut registry = GraphRegistry::default();
        assert_eq!(registry.fenced_batches(), 0, "no fence sent yet");

        let refusals = attach_dormant_crumbs(&state, &mut registry, &app_state.engine)
            .expect("both locks are free, so the attach reports refusals rather than an error")
            .refusals;
        assert!(
            refusals.is_empty(),
            "the engine had room for this slot: {refusals:?}"
        );

        assert_eq!(
            registry.fenced_batches(),
            1,
            "the attach's fence must be numbered on the registry it was given"
        );
        match command_rx.pop() {
            Ok(GraphCommand::BeginBatch { commands }) => assert_eq!(
                commands, 1,
                "the attach's fence must announce the slot and its capture registration"
            ),
            Ok(_) => panic!("an attach must publish its registration behind a batch fence"),
            Err(_) => panic!("an attach must queue its batch fence"),
        }
    }

    /// Issue #3807: a create that registers straight against a running engine
    /// takes the same route as an attach — `register_crumbs_slot` — and must
    /// number its fence the same way.
    #[test]
    fn a_create_against_a_running_engine_numbers_its_fence() {
        let state = CrumbsState::default();
        let app_state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        crate::block_on_test(create_crumbs(
            "running-engine-create-fence-numbering".to_string(),
            &state,
            &app_state,
        ))
        .expect("a create against a running engine must register");

        assert_eq!(
            app_state
                .graph
                .lock()
                .expect("graph registry lock should be available")
                .fenced_batches(),
            1,
            "a create that registers with a running engine must number its own fence"
        );
        // Structural assertions live in the helper: one fence announcing
        // exactly the slot and its capture registration.
        pop_create_commands(&mut command_rx);
    }

    /// Issue #3807: a create with no engine present parks the instance
    /// dormant and publishes nothing, so nothing here should ever be numbered
    /// — a fence counted without a push would be counting a batch the engine
    /// never saw.
    #[test]
    fn a_dormant_create_numbers_nothing() {
        let state = CrumbsState::default();
        let app_state = AppState::default();

        crate::block_on_test(create_crumbs(
            "dormant-create-fence-numbering".to_string(),
            &state,
            &app_state,
        ))
        .expect("a create before the engine runs must degrade, not refuse");

        assert_eq!(
            app_state
                .graph
                .lock()
                .expect("graph registry lock should be available")
                .fenced_batches(),
            0,
            "a dormant create publishes no fence, so nothing should be numbered"
        );
    }

    /// An accepted idle attach numbers its slot fence even while every input
    /// consumer position is held by another owner.
    #[test]
    fn an_idle_attach_with_full_capture_bus_numbers_its_fence() {
        let state = CrumbsState::default();
        let app = AppState::default();
        crate::block_on_test(create_crumbs("dormant".into(), &state, &app)).unwrap();
        let (mut engine, mut commands, _retired) =
            daw_engine::engine_handle_for_command_capture(16);
        for id in 0..CRUMBS_CAPTURE_RESERVE {
            engine.register_capture_consumer(id).unwrap();
        }
        while commands.pop().is_ok() {}
        *app.engine.lock().unwrap() = Some(engine);
        let mut registry = GraphRegistry::default();
        assert!(attach_dormant_crumbs(&state, &mut registry, &app.engine)
            .unwrap()
            .refusals
            .is_empty());
        assert_eq!(
            registry.fenced_batches(),
            1,
            "the accepted persistent-slot batch owns exactly one fence"
        );
        pop_create_commands(&mut commands);
        assert!(commands.pop().is_err());
    }

    /// An instance no strip ever splices still drains its command ring.
    ///
    /// The slot is registered detached and a chain may never come for it: a
    /// panel opened before the first play, a track left on the Web Audio path,
    /// a device inserted mid-roll. [`CrumbsPluginSlot::process_block_internal`]
    /// is the only drain of that ring, so an unrun slot leaves every gesture
    /// the panel made banked until the ring reports "Command queue full" — and
    /// hands the whole stale backlog to the first chain that takes it.
    ///
    /// Driven on the real scheduler, by the production route, and never
    /// spliced: [`OfflineRenderer`] is `AudioScheduler` without a device, the
    /// registration commands are the ones [`create_crumbs`] published, and the
    /// two gestures go through the command functions the addon calls. What is
    /// observed is the drain itself — the ring comes back empty and the engine
    /// voices the note that ring carried — and that none of it reached the mix,
    /// because no chain is carrying this instance.
    #[test]
    fn an_unspliced_instance_still_drains_its_command_ring_on_a_running_scheduler() {
        use daw_engine::offline::{OfflineRenderer, OFFLINE_BLOCK_FRAMES};

        let state = CrumbsState::default();
        let app_state = AppState::default();
        let (engine, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8);
        *app_state
            .engine
            .lock()
            .expect("engine lock should be available") = Some(engine);

        let instance_id = "unspliced-crumbs";
        crate::block_on_test(create_crumbs(instance_id.to_string(), &state, &app_state))
            .expect("the create should register its runtime");

        // The registration batch, verbatim, onto a scheduler that renders it.
        let mut renderer = OfflineRenderer::new(48_000.0, 8);
        while let Ok(command) = command_rx.pop() {
            renderer
                .push(command)
                .expect("the renderer's ring holds the registration batch");
        }

        // A sample for the note to sound, then the two gestures a panel makes.
        let metering = {
            let mut instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            let instance = instances
                .get_mut(instance_id)
                .expect("the create owns a map entry");
            instance
                .send(CrumbsCommand::AddSample {
                    id: 1,
                    data: Arc::new(SampleData::from_mono(vec![0.1; 4_800], 48_000)),
                })
                .expect("the command ring has room");
            instance
                .send(CrumbsCommand::SetActiveSample(1))
                .expect("the command ring has room");
            Arc::clone(&instance.metering)
        };
        state
            .instances
            .lock()
            .unwrap()
            .get_mut(instance_id)
            .unwrap()
            .send(CrumbsCommand::ArmRecording {
                threshold: 0.5,
                target_pad: 0,
                max_duration_secs: 1.0,
            })
            .expect("the DSP arm should reach the ring");
        crate::block_on_test(crumbs_note_on(instance_id.to_string(), 60, 100, &state))
            .expect("the note should reach the ring");

        let (left, right) = renderer.render(OFFLINE_BLOCK_FRAMES);

        let queued = {
            let instances = state
                .instances
                .lock()
                .expect("crumbs state lock should be available");
            let instance = instances
                .get(instance_id)
                .expect("the create owns a map entry");
            let CrumbsEngineSlot::Attached { ends, .. } = &instance.engine_slot else {
                panic!("the create attaches its instance to the running engine");
            };
            ends.command_tx.capacity() - ends.command_tx.slots()
        };
        assert_eq!(
            queued, 0,
            "an unspliced slot must still drain the ring its panel writes into"
        );
        assert!(
            metering.active_voice_count.load(Ordering::Relaxed) >= 1,
            "the engine must sound the note the drained ring carried"
        );
        assert!(
            left.iter().chain(right.iter()).all(|sample| *sample == 0.0),
            "an instance no chain carries must not reach the mix"
        );
    }
}
