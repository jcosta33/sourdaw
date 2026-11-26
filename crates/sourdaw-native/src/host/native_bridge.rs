use crate::events::EventSink;
use daw_dsp::crumbs::engine::{CrumbsEngine, CrumbsMetering};
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsMode, RecordState};
/// Bridge: implements daw_engine::NativePlugin for any hosted plugin runtime.
///
/// This allows plugin instances from daw-plugin-host to be sent to the native
/// audio thread and processed inline by the scheduler — no IPC in the audio path.
/// Supports MIDI note events and transport info forwarding.
///
/// The runtime owner and the slot are generic over
/// [`daw_plugin_host::HostedPluginRuntime`] rather than holding a trait object:
/// the audio path is the reason. A `dyn` runtime would put a vtable dispatch on
/// every `process` call in the render callback, where a generic monomorphises to
/// the same direct call the concrete type had. `HostedRuntime` is the default
/// type argument — the one enum the application actually loads, whichever format
/// the plugin is — so callers that hold a loaded plugin name no format at all.
///
/// RT-safety: all scratch buffers are preallocated. No heap allocation occurs
/// in any `NativePlugin` method.
use daw_engine::plugin_slot::{CaptureInputBlock, MidiNoteEvent, NativePlugin, TransportState};
use daw_engine::{CaptureFirstInput, CapturePeriodObservation};
use daw_plugin_host::{
    signal_pending_process_refusal, HostMidiEvent, HostParameterUpdate, HostTransport,
    HostedPluginRuntime, HostedRuntime, PluginError, PluginParameter, ProcessingGate,
};
use rtrb::Consumer;
use std::cell::UnsafeCell;
use std::sync::atomic::{fence, AtomicBool, AtomicU32, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, TryLockError, Weak};
use std::thread;
use std::time::{Duration, Instant};
use tokio::runtime::RuntimeFlavor;

/// Translate the engine's transport into the plugin host's own shape.
///
/// The two types are deliberately separate — the engine is free to carry state
/// no CLAP plugin has a field for — so the mapping lives here, at the seam, and
/// is a plain function so it can be checked without an audio thread.
fn host_transport_from(transport: &TransportState) -> HostTransport {
    HostTransport {
        tempo: transport.tempo,
        time_sig_num: transport.time_sig_num,
        time_sig_denom: transport.time_sig_denom,
        is_playing: transport.is_playing,
        song_pos_beats: transport.song_pos_beats,
        song_pos_seconds: transport.song_pos_seconds,
    }
}
/// Maximum block size the native engine produces (matches ClapWrapper activation).
///
/// Taken from the engine's own callback ceiling rather than restated, for the
/// same reason as [`MAX_MIDI_EVENTS`] below: scratch sized under the real
/// ceiling would truncate a block. `daw-plugin-host` cannot import the engine's
/// constant (no crate edge), so it restates the figure as
/// `clap_wrapper::MAX_BUFFER` — this assert welds that lockstep pair at
/// compile time, here where both are visible.
const MAX_BUFFER: usize = daw_engine::audio_thread::MAX_CALLBACK_FRAMES;
const _: () = assert!(MAX_BUFFER == daw_plugin_host::clap_wrapper::MAX_BUFFER);
/// Maximum MIDI events per block for the event-conversion scratch array.
///
/// The engine's own per-block buffer, so the array holds every event the
/// engine can hand over in one call. Sized under it, the packing would drop a
/// full block's tail — the notes latest in the block, silently and with no
/// counter — which is the whole reason the figure is taken from the engine
/// rather than restated here. The wrappers below hand the same events to the
/// plugin from their own preallocated lists, sized by the plugin host's
/// restatement of this figure; this assert welds that lockstep pair, so a list
/// sized under the engine's block cannot compile.
const MAX_MIDI_EVENTS: usize = daw_engine::midi_fx::MIDI_EVENT_BUFFER_CAPACITY;
const _: () = assert!(MAX_MIDI_EVENTS == daw_plugin_host::traits::MAX_MIDI_EVENTS_PER_BLOCK);
/// Bounded pending parameter capacity, matched to ClapWrapper's process-event scratch.
///
/// The engine's per-effect stamp window,
/// [`daw_engine::timeline::DEVICE_PARAM_QUEUE_CAPACITY`], is sized at what one
/// process call of a hosted body can take, which is this number. The engine
/// states that rationale without naming this constant — it sits downstream of
/// the engine and must stay unknown to it — so the equality is recorded here,
/// where the dependency runs the right way: raising this leaves the engine's
/// window merely conservative, while lowering it lets a batch the engine admits
/// whole overrun this ring, which drops the excess with nothing left to resend.
const PENDING_PARAMETER_CAPACITY: usize = 64;

const PLUGIN_ACCESS_IDLE: u8 = 0;
const PLUGIN_ACCESS_PROCESSING: u8 = 1;
const PLUGIN_ACCESS_CONTROL: u8 = 2;
const PENDING_PARAMETER_EMPTY: u8 = 0;
const PENDING_PARAMETER_WRITING: u8 = 1;
const PENDING_PARAMETER_READY: u8 = 2;
const PLUGIN_LIFECYCLE_ACTIVE: u8 = 0;
const PLUGIN_LIFECYCLE_UNLOADING: u8 = 1;
const PLUGIN_LIFECYCLE_RETIRED: u8 = 2;
/// How long a control call waits for another control call on the same
/// instance to let go of its control gate before treating the instance as
/// unresponsive.
///
/// The holder is third-party code of unbounded duration, so no figure separates
/// a slow call from a hung one; this one is chosen to sit well clear of every
/// bound the host already puts on a control call's own waits. A control call
/// spends at most 2 s on the RT seam (every production `with_control` timeout)
/// and 2 s on the editor's UI-thread hop (`EDITOR_UI_THREAD_DEADLINE`), and the
/// host gives a whole plugin instantiation plus its full capability query 10 s
/// in the scan worker (`WORKER_TIMEOUT`) and one shell window round trip 10 s
/// (`WINDOW_HOST_DEADLINE`). A gate held longer than the longest of those makes
/// the instance unresponsive until the holder lets go — a slow call recovers,
/// a hung one never does. TypeScript's rebuild fence waits longer than this
/// (`LIFECYCLE_SETTLEMENT_DEADLINE_MS`), so a call queued natively behind a
/// hung one answers before the fence gives up on it.
const CONTROL_GATE_DEADLINE: Duration = Duration::from_secs(10);
/// The gate wait's poll interval, the same cadence as the RT-seam wait.
const CONTROL_GATE_POLL: Duration = Duration::from_millis(2);
/// The start of every refusal from an instance found unresponsive
/// ([`PluginControlRefusal::Unresponsive`]). A wire contract: TypeScript
/// classifies the failure by this text
/// (`src/modules/PluginHost/useCases/pluginLifecycle/isPluginUnresponsiveFailure.ts`).
const PLUGIN_UNRESPONSIVE_MARKER: &str = "plugin-unresponsive:";

/// The retention queue's filler value. `MidiNoteEvent` has no `Default`, so the
/// inert note-off stands in; its fields are never read past
/// `retained_event_count`.
const EMPTY_RETAINED_EVENT: MidiNoteEvent = MidiNoteEvent {
    note: 0,
    velocity: 0,
    channel: 0,
    is_note_on: false,
    probability_cutoff: 0,
    project_probability_seed: 0,
    clip_id_hash: 0,
    event_id_hash: 0,
    absolute_occurrence_index: 0,
    frame_offset: 0,
    articulation_id: None,
};

/// Run one of the non-RT control path's blocking bodies — lock acquisition,
/// seam wait, or the plugin operation itself — without parking an async worker
/// thread.
///
/// The control path is blocking by construction: the operation it guards reaches
/// CLAP entry points, so it has to run on the caller's own thread rather than be
/// handed to a pool. Every public control entry point is reached from an async
/// command body, and parking that body's worker — for a contended wait or for
/// the plugin call itself, third-party code of unbounded duration — parks
/// every other command queued behind it on the same worker, including the
/// worklet audio relay, which runs once per render quantum. `block_in_place`
/// releases the worker's run queue to another thread for the duration of the
/// body, so unrelated IPC keeps moving while this thread blocks, and the caller
/// still gets the wrapper on the thread it asked from.
///
/// Off a multi-threaded runtime — the shell's window-event thread, the app-exit
/// path, the plugin scan worker, tests — there is no worker to release and the
/// body runs exactly as it always has. The flavour is checked rather than
/// assumed because `block_in_place` panics on a current-thread runtime or
/// inside a `LocalSet`, neither of which this crate is reached from.
fn without_stalling_async_worker<ResultValue>(wait: impl FnOnce() -> ResultValue) -> ResultValue {
    let on_multi_thread_worker = matches!(
        tokio::runtime::Handle::try_current().map(|handle| handle.runtime_flavor()),
        Ok(RuntimeFlavor::MultiThread)
    );

    if on_multi_thread_worker {
        return tokio::task::block_in_place(wait);
    }

    wait()
}

type PendingParameterUpdate = HostParameterUpdate;

/// One pending write: a parameter, its value, and the sample of the next
/// process call it applies at.
///
/// A slot is keyed by `(param_id, sample_offset)`, not by the parameter alone:
/// automation hands one parameter several points inside one block, and each is
/// a point of the ramp the plugin is owed rather than a newer value replacing
/// an older one. Two writes for the same parameter at the same sample do still
/// collapse to the later — that is the coalescing a control write and an audio
/// write at the head of one block rely on.
struct PendingParameterSlot {
    param_id: AtomicU32,
    value_bits: AtomicU64,
    sample_offset: AtomicU32,
    sequence: AtomicU64,
    state: AtomicU8,
}

impl PendingParameterSlot {
    fn new() -> Self {
        Self {
            param_id: AtomicU32::new(0),
            value_bits: AtomicU64::new(0.0f64.to_bits()),
            sample_offset: AtomicU32::new(0),
            sequence: AtomicU64::new(0),
            state: AtomicU8::new(PENDING_PARAMETER_EMPTY),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct PendingParameterDrainEntry {
    update: PendingParameterUpdate,
    sequence: u64,
}

struct PendingParameterQueue {
    slots: [PendingParameterSlot; PENDING_PARAMETER_CAPACITY],
    next_sequence: AtomicU64,
    /// Every write whose sequence is at or below this was issued before the
    /// last block the plugin was not handed ended, so the sample it names is
    /// one of a block that no longer exists: it is delivered at sample 0.
    /// Lateness is carried by the sequence rather than by rewriting a slot's
    /// offset, because a slot another thread holds mid-claim cannot be
    /// rewritten and must not be waited for. Only grows.
    late_through: AtomicU64,
}

/// The sample a write is delivered at: its own, unless it was issued before
/// the last unserved block ended, in which case the head of the next block.
fn effective_sample_offset(sample_offset: u32, sequence: u64, late_through: u64) -> u32 {
    if sequence <= late_through {
        0
    } else {
        sample_offset
    }
}

impl PendingParameterQueue {
    fn new() -> Self {
        Self {
            slots: std::array::from_fn(|_| PendingParameterSlot::new()),
            next_sequence: AtomicU64::new(1),
            late_through: AtomicU64::new(0),
        }
    }

    fn enqueue(&self, param_id: u32, value: f64, sample_offset: u32) -> Result<(), ()> {
        let value_bits = value.to_bits();
        let sequence = self.next_sequence.fetch_add(1, Ordering::Relaxed);

        if self.coalesce(param_id, sample_offset, value_bits, sequence) {
            return Ok(());
        }

        for slot in &self.slots {
            if slot
                .state
                .compare_exchange(
                    PENDING_PARAMETER_EMPTY,
                    PENDING_PARAMETER_WRITING,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_ok()
            {
                slot.param_id.store(param_id, Ordering::Relaxed);
                slot.value_bits.store(value_bits, Ordering::Relaxed);
                slot.sample_offset.store(sample_offset, Ordering::Relaxed);
                slot.sequence.store(sequence, Ordering::Relaxed);
                slot.state.store(PENDING_PARAMETER_READY, Ordering::Release);
                return Ok(());
            }
        }

        if self.coalesce(param_id, sample_offset, value_bits, sequence) {
            return Ok(());
        }

        Err(())
    }

    /// Fold a write into the pending value this queue already holds for the
    /// same parameter at the same sample, if it holds one.
    ///
    /// The fold keeps the later sequence, never simply the later writer: two
    /// producers — the control path and the audio thread — take their sequence
    /// numbers before they reach a slot, so the one that arrives second is not
    /// always the one that was issued second. Overwriting unconditionally would
    /// leave the earlier write's value pending and hand the plugin a parameter
    /// value the automation had already moved past. A write the slot subsumes
    /// still counts as queued: the parameter's pending value is at least as new
    /// as the one being folded in.
    fn coalesce(&self, param_id: u32, sample_offset: u32, value_bits: u64, sequence: u64) -> bool {
        let late_through = self.late_through.load(Ordering::Acquire);
        for slot in &self.slots {
            if slot.state.load(Ordering::Acquire) != PENDING_PARAMETER_READY {
                continue;
            }

            if slot.param_id.load(Ordering::Relaxed) != param_id {
                continue;
            }

            if Self::fold_into_ready_slot(
                slot,
                param_id,
                sample_offset,
                value_bits,
                sequence,
                late_through,
            ) {
                return true;
            }
        }

        false
    }

    /// Claim a published slot and fold the write into it when, read under the
    /// claim, it still holds the same parameter at the same effective sample.
    /// The unclaimed checks that chose this slot may be stale: it can have been
    /// drained and republished for another parameter or sample since, so the
    /// claim re-reads both and gives the slot back untouched on a mismatch.
    /// A slot another thread holds is skipped, never waited for.
    ///
    /// Both sides compare effective samples: a write issued before the last
    /// unserved block is late and names sample 0, whatever offset it carries.
    fn fold_into_ready_slot(
        slot: &PendingParameterSlot,
        param_id: u32,
        sample_offset: u32,
        value_bits: u64,
        sequence: u64,
        late_through: u64,
    ) -> bool {
        if !Self::claim_ready(slot) {
            return false;
        }

        let held_sequence = slot.sequence.load(Ordering::Relaxed);
        let same_point = slot.param_id.load(Ordering::Relaxed) == param_id
            && effective_sample_offset(
                slot.sample_offset.load(Ordering::Relaxed),
                held_sequence,
                late_through,
            ) == effective_sample_offset(sample_offset, sequence, late_through);
        if !same_point {
            slot.state.store(PENDING_PARAMETER_READY, Ordering::Release);
            return false;
        }

        if held_sequence < sequence {
            slot.value_bits.store(value_bits, Ordering::Relaxed);
            slot.sample_offset.store(sample_offset, Ordering::Relaxed);
            slot.sequence.store(sequence, Ordering::Relaxed);
        }
        slot.state.store(PENDING_PARAMETER_READY, Ordering::Release);
        true
    }

    fn drain(&self, out: &mut [PendingParameterUpdate]) -> usize {
        let mut count = 0;
        let mut entries = [PendingParameterDrainEntry::default(); PENDING_PARAMETER_CAPACITY];
        let late_through = self.late_through.load(Ordering::Acquire);

        for slot in &self.slots {
            if count >= out.len() {
                break;
            }

            if slot
                .state
                .compare_exchange(
                    PENDING_PARAMETER_READY,
                    PENDING_PARAMETER_WRITING,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_err()
            {
                continue;
            }

            let sequence = slot.sequence.load(Ordering::Relaxed);
            let update = PendingParameterUpdate {
                param_id: slot.param_id.load(Ordering::Relaxed),
                value: f64::from_bits(slot.value_bits.load(Ordering::Relaxed)),
                sample_offset: effective_sample_offset(
                    slot.sample_offset.load(Ordering::Relaxed),
                    sequence,
                    late_through,
                ),
            };
            if let Some(existing) = entries[..count].iter_mut().find(|entry| {
                entry.update.param_id == update.param_id
                    && entry.update.sample_offset == update.sample_offset
            }) {
                if sequence > existing.sequence {
                    *existing = PendingParameterDrainEntry { update, sequence };
                }
            } else {
                entries[count] = PendingParameterDrainEntry { update, sequence };
                count += 1;
            }
            slot.state.store(PENDING_PARAMETER_EMPTY, Ordering::Release);
        }

        sort_pending_parameter_entries(&mut entries[..count]);
        for (index, entry) in entries[..count].iter().enumerate() {
            out[index] = entry.update;
        }

        count
    }

    fn has_pending(&self) -> bool {
        self.slots
            .iter()
            .any(|slot| slot.state.load(Ordering::Acquire) != PENDING_PARAMETER_EMPTY)
    }

    /// Move every pending write to the head of whichever block delivers it.
    /// Audio thread only, after a block the plugin was not handed.
    ///
    /// The offsets a write carries name samples of the block it was queued
    /// for; once that block has passed without reaching the plugin they name
    /// samples of a block that no longer exists, and left as they are they
    /// would sort behind the next block's own early points. A late write is
    /// delivered at the head, exactly as [`HostedPluginSlot`] re-stamps a
    /// retained note.
    ///
    /// Lateness is marked by sequence: every write issued so far is at or
    /// below the new `late_through`, and drain and coalesce read a late write
    /// as sample 0 whatever offset its slot holds. Rewriting offsets in place
    /// would miss a slot another thread holds mid-claim, and the audio thread
    /// may not wait for it; the watermark covers that slot all the same. A
    /// write issued after the mark carries a higher sequence and keeps its own
    /// offset, since it is for the block about to run.
    ///
    /// Every late write of one parameter names the same sample, so they are
    /// one write: the slots of a parameter fold into its latest (highest
    /// sequence) and the rest are freed. Kept apart, the points of a ramp from
    /// consecutive unserved blocks would fill the queue and refuse the newest
    /// writes of that ramp. A slot another thread holds is skipped by the
    /// fold; drain folds it the same way once it is published.
    fn mark_pending_late(&self) {
        let issued = self.next_sequence.load(Ordering::Acquire).saturating_sub(1);
        self.late_through.fetch_max(issued, Ordering::Release);
        let late_through = self.late_through.load(Ordering::Acquire);

        for (index, slot) in self.slots.iter().enumerate() {
            if !Self::claim_ready(slot) {
                continue;
            }
            let param_id = slot.param_id.load(Ordering::Relaxed);
            if slot.sequence.load(Ordering::Relaxed) > late_through {
                slot.state.store(PENDING_PARAMETER_READY, Ordering::Release);
                continue;
            }
            for other in &self.slots[index + 1..] {
                if other.state.load(Ordering::Acquire) != PENDING_PARAMETER_READY
                    || other.param_id.load(Ordering::Relaxed) != param_id
                    || !Self::claim_ready(other)
                {
                    continue;
                }
                // Re-read under the claim: the slot may have been freed and
                // republished for another parameter, or for the coming block,
                // since the unclaimed check.
                if other.param_id.load(Ordering::Relaxed) != param_id
                    || other.sequence.load(Ordering::Relaxed) > late_through
                {
                    other
                        .state
                        .store(PENDING_PARAMETER_READY, Ordering::Release);
                    continue;
                }
                if other.sequence.load(Ordering::Relaxed) > slot.sequence.load(Ordering::Relaxed) {
                    slot.value_bits
                        .store(other.value_bits.load(Ordering::Relaxed), Ordering::Relaxed);
                    slot.sequence
                        .store(other.sequence.load(Ordering::Relaxed), Ordering::Relaxed);
                }
                other
                    .state
                    .store(PENDING_PARAMETER_EMPTY, Ordering::Release);
            }
            slot.state.store(PENDING_PARAMETER_READY, Ordering::Release);
        }
    }

    /// Take a published slot for this thread alone, or report that it is empty
    /// or mid-publish and so someone else's.
    fn claim_ready(slot: &PendingParameterSlot) -> bool {
        slot.state
            .compare_exchange(
                PENDING_PARAMETER_READY,
                PENDING_PARAMETER_WRITING,
                Ordering::Acquire,
                Ordering::Relaxed,
            )
            .is_ok()
    }

    /// Drop every write this queue holds, leaving any slot mid-publish to the
    /// producer that owns it.
    ///
    /// A slot in `WRITING` belongs to whoever won the CAS into it, and storing
    /// `EMPTY` over one hands its address to the next producer while its owner
    /// is still writing the value: the owner's later store of the value lands
    /// on the id the new producer just put there, and the plugin is handed one
    /// parameter carrying another's value. Two producers reach this queue, one
    /// of them the audio thread, so the overlap is real rather than
    /// theoretical.
    ///
    /// So a write caught mid-publish survives the load and is delivered after
    /// the preset. What the compare-exchange guarantees is only that: a slot's
    /// owner republishes whatever coalescing left in it, which may be its own
    /// value or an editor write it folded a stale value into — the queue does
    /// not record which path a pending value came from, and this is not a rule
    /// about automation outranking the preset.
    fn clear(&self) {
        for slot in &self.slots {
            let _ = slot.state.compare_exchange(
                PENDING_PARAMETER_READY,
                PENDING_PARAMETER_EMPTY,
                Ordering::AcqRel,
                Ordering::Relaxed,
            );
        }
    }
}

/// Order a drain the way a plugin is owed it: by the sample each write applies
/// at, and by issue order among writes at one sample, so the later of two
/// writes to one parameter is the one it ends on. An insertion sort because the
/// audio thread runs it and it allocates nothing.
fn sort_pending_parameter_entries(entries: &mut [PendingParameterDrainEntry]) {
    let key = |entry: &PendingParameterDrainEntry| (entry.update.sample_offset, entry.sequence);
    for index in 1..entries.len() {
        let entry = entries[index];
        let mut cursor = index;
        while cursor > 0 && key(&entries[cursor - 1]) > key(&entry) {
            entries[cursor] = entries[cursor - 1];
            cursor -= 1;
        }
        entries[cursor] = entry;
    }
}

/// A held control gate. Letting go of it withdraws an unresponsive verdict:
/// the call that outlived the deadline has returned, so the plugin answers
/// again, and it must not wait for some later control call to say so.
///
/// The release allocates nothing and logs nothing — it runs at the end of
/// every control call. The SeqCst fence between the unlock and the verdict
/// read pairs with the one in `give_up_on_gate`, between the verdict write and
/// its last try of the gate.
struct ControlGateGuard<'gate, Runtime: HostedPluginRuntime> {
    gate: Option<MutexGuard<'gate, ()>>,
    owner: &'gate SharedHostedPlugin<Runtime>,
}

impl<Runtime: HostedPluginRuntime> Drop for ControlGateGuard<'_, Runtime> {
    fn drop(&mut self) {
        drop(self.gate.take());
        fence(Ordering::SeqCst);
        self.owner.recover_if_unresponsive();
    }
}

/// Why the control path refused to run an operation against one hosted
/// plugin instance. Built on the control path only, never on the audio
/// callback; each variant names the plugin it refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginControlRefusal {
    Unloading {
        plugin: String,
    },
    Retired {
        plugin: String,
    },
    InvalidLifecycle {
        plugin: String,
        state: u8,
    },
    /// The non-RT control gate is held and the caller refused to wait.
    GateBusy {
        plugin: String,
    },
    /// A control call held the instance's control gate past its deadline, and
    /// that call still holds it. Its text starts with
    /// [`PLUGIN_UNRESPONSIVE_MARKER`].
    Unresponsive {
        plugin: String,
    },
    /// The audio thread held the access seam past the control timeout.
    TimedOut {
        plugin: String,
    },
}

impl std::fmt::Display for PluginControlRefusal {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unloading { plugin } => write!(
                formatter,
                "Engine-owned plugin instance '{}' is unloading",
                plugin
            ),
            Self::Retired { plugin } => write!(
                formatter,
                "Engine-owned plugin instance '{}' has been retired",
                plugin
            ),
            Self::InvalidLifecycle { plugin, state } => write!(
                formatter,
                "Engine-owned plugin instance '{}' is in invalid lifecycle state {}",
                plugin, state
            ),
            Self::GateBusy { plugin } => write!(
                formatter,
                "Plugin non-RT control path for '{}' is busy",
                plugin
            ),
            Self::Unresponsive { plugin } => write!(
                formatter,
                "{PLUGIN_UNRESPONSIVE_MARKER} Plugin '{plugin}' stopped responding inside a call and is no longer processed or controlled"
            ),
            Self::TimedOut { plugin } => write!(
                formatter,
                "Timed out waiting for plugin control access: {}",
                plugin
            ),
        }
    }
}

impl std::error::Error for PluginControlRefusal {}

/// A control operation's outcome when it did not succeed: the control path
/// refused to run it, or it ran and failed with its own error `E`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginControlError<E> {
    Refused(PluginControlRefusal),
    Operation(E),
}

impl<E: std::fmt::Display> std::fmt::Display for PluginControlError<E> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(refusal) => refusal.fmt(formatter),
            Self::Operation(error) => error.fmt(formatter),
        }
    }
}

impl<E: std::fmt::Debug + std::fmt::Display> std::error::Error for PluginControlError<E> {}

impl<E> From<PluginControlRefusal> for PluginControlError<E> {
    fn from(refusal: PluginControlRefusal) -> Self {
        Self::Refused(refusal)
    }
}

impl PluginControlError<std::convert::Infallible> {
    /// The refusal of an operation that cannot fail on its own.
    pub fn into_refusal(self) -> PluginControlRefusal {
        match self {
            Self::Refused(refusal) => refusal,
            Self::Operation(never) => match never {},
        }
    }
}

/// Why a host-side parameter write was not queued for the audio thread.
#[derive(Debug, Clone, PartialEq)]
pub enum ParameterWriteError {
    Refused(PluginControlRefusal),
    NotActivated { plugin: String },
    NonFinite { plugin: String, value: f64 },
    QueueFull { plugin: String },
}

impl std::fmt::Display for ParameterWriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(refusal) => refusal.fmt(formatter),
            Self::NotActivated { plugin } => write!(
                formatter,
                "CLAP plugin '{}' is not activated; parameter update rejected",
                plugin
            ),
            Self::NonFinite { plugin, value } => write!(
                formatter,
                "Invalid parameter value for plugin '{}': {}",
                plugin, value
            ),
            Self::QueueFull { plugin } => write!(
                formatter,
                "Pending parameter queue full for plugin '{}'",
                plugin
            ),
        }
    }
}

impl std::error::Error for ParameterWriteError {}

impl From<PluginControlRefusal> for ParameterWriteError {
    fn from(refusal: PluginControlRefusal) -> Self {
        Self::Refused(refusal)
    }
}

/// Why a state save or restore through the control path failed on its own.
#[derive(Debug)]
pub enum PluginStateError {
    /// Host writes are still queued for the audio thread, so a saved state
    /// would miss them.
    PendingWrites {
        plugin: String,
    },
    Plugin(PluginError),
}

impl std::fmt::Display for PluginStateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PendingWrites { plugin } => write!(
                formatter,
                "Plugin '{}' has pending parameter writes awaiting audio processing; retry state save after the process path drains them",
                plugin
            ),
            Self::Plugin(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for PluginStateError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::PendingWrites { .. } => None,
            Self::Plugin(error) => Some(error),
        }
    }
}

struct PluginRuntimeLifecycle {
    state: AtomicU8,
    /// Set when a control call gave up on the instance's control gate, and
    /// cleared as soon as that gate is let go again.
    /// Separate from `state` because unload and retire still move `state`
    /// along while the call that outlived the deadline may still be executing
    /// inside the plugin.
    unresponsive: AtomicBool,
}

impl PluginRuntimeLifecycle {
    fn new() -> Self {
        Self {
            state: AtomicU8::new(PLUGIN_LIFECYCLE_ACTIVE),
            unresponsive: AtomicBool::new(false),
        }
    }

    // The verdict and the lifecycle state are SeqCst: a recovery (clear the
    // verdict, then read the state) and a cancelled unload (reactivate, then
    // read the verdict) each write one flag and read the other, and only a
    // single total order over both guarantees that at least one of them sees
    // the other's write and asks the instance to process again. The same order
    // pairs the lifecycle with the intent to process across the SeqCst fences
    // in `SharedHostedPlugin::{begin_unload, cancel_unload, restart_if_active}`.

    /// Record the verdict; `true` only for the call that made it.
    fn mark_unresponsive(&self) -> bool {
        !self.unresponsive.swap(true, Ordering::SeqCst)
    }

    /// Withdraw the verdict; `true` only when there was one to withdraw.
    fn clear_unresponsive(&self) -> bool {
        self.unresponsive.swap(false, Ordering::SeqCst)
    }

    fn is_unresponsive(&self) -> bool {
        self.unresponsive.load(Ordering::SeqCst)
    }

    fn is_active(&self) -> bool {
        self.state.load(Ordering::SeqCst) == PLUGIN_LIFECYCLE_ACTIVE
    }

    fn begin_unload(&self) {
        let _ = self.state.compare_exchange(
            PLUGIN_LIFECYCLE_ACTIVE,
            PLUGIN_LIFECYCLE_UNLOADING,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    fn cancel_unload(&self) {
        let _ = self.state.compare_exchange(
            PLUGIN_LIFECYCLE_UNLOADING,
            PLUGIN_LIFECYCLE_ACTIVE,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    fn retire(&self) {
        self.state
            .store(PLUGIN_LIFECYCLE_RETIRED, Ordering::Release);
    }

    fn allows_process(&self) -> bool {
        self.is_active() && !self.is_unresponsive()
    }

    fn ensure_public_control_allowed(&self, plugin_name: &str) -> Result<(), PluginControlRefusal> {
        let plugin = || plugin_name.to_string();
        match self.state.load(Ordering::Acquire) {
            PLUGIN_LIFECYCLE_ACTIVE => Ok(()),
            PLUGIN_LIFECYCLE_UNLOADING => Err(PluginControlRefusal::Unloading { plugin: plugin() }),
            PLUGIN_LIFECYCLE_RETIRED => Err(PluginControlRefusal::Retired { plugin: plugin() }),
            state => Err(PluginControlRefusal::InvalidLifecycle {
                plugin: plugin(),
                state,
            }),
        }
    }
}

/// One plugin's latency after a change it flagged, in the two units its two
/// consumers need.
///
/// Milliseconds for the webview: the plugin counts latency in frames of the rate
/// it was ACTIVATED with, which is a different clock from the `AudioContext`, so
/// a sample count must not cross the IPC boundary. Frames for the engine graph,
/// which schedules in the device's own frames and has no other unit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatencyChange {
    pub latency_ms: f64,
    pub latency_frames: usize,
}

/// Runtime owner for a hosted plugin shared by the RT processor and non-RT
/// control path.
///
/// Generic over the backend, defaulted to `HostedRuntime` — see the module note
/// for why this is a type parameter and not a trait object.
pub struct SharedHostedPlugin<Runtime = HostedRuntime> {
    name: String,
    wrapper: UnsafeCell<Runtime>,
    access_state: AtomicU8,
    lifecycle: PluginRuntimeLifecycle,
    non_rt_control_lock: Mutex<()>,
    /// How long a control call waits for this instance's control gate before
    /// it treats the instance as unresponsive. [`CONTROL_GATE_DEADLINE`] in
    /// production.
    control_gate_deadline: Duration,
    activated: bool,
    /// Whether the plugin takes note events, read from it once at load.
    ///
    /// Cached rather than asked per call: it is a property of the loaded
    /// instance, it cannot change while the instance lives, and the engine asks
    /// for it from the audio thread — where reaching into the wrapper would
    /// contend with the control path for an answer that was already fixed.
    accepts_midi: bool,
    /// Shared with the wrapper. Lets the control path ask for the plugin's
    /// processing state to be left without performing the transition itself.
    processing: Arc<ProcessingGate>,
    pending_parameters: PendingParameterQueue,
    /// The same host-side writes again, for the plugin's editor.
    ///
    /// `pending_parameters` is consumed by the audio thread on its way into the
    /// processor, and a format whose editor is a separate object learns nothing
    /// from that. This second queue is what the control path hands the editor,
    /// and it is a queue rather than a direct call because the write may arrive
    /// while the audio thread holds the access seam.
    editor_parameter_writes: PendingParameterQueue,
    /// Note events the slot accepted for this plugin and then lost, because
    /// they arrived while its retention queue was already full. Written by the
    /// audio thread, read by the control path.
    dropped_note_events: AtomicU64,
    /// How much of `dropped_note_events` the control path has already logged.
    reported_dropped_note_events: AtomicU64,
    /// Blocks a slot handed this plugin that it was not served — the lifecycle
    /// closed, the plugin inactive, or the control path holding the seam — and
    /// so passed through dry. Written by the audio thread, read by the control
    /// path. Live playback only counts them; an offline render refuses a print
    /// that holds one (`commands::offline_plugins`).
    unserved_blocks: AtomicU64,
    /// Records the thread the wrapper is torn down on. Declared last so it
    /// drops after `wrapper`, on the same thread.
    #[cfg(test)]
    teardown_witness: OnceLock<TeardownWitness>,
    /// What a test runs on another side of a race when a recovery reaches the
    /// step it names.
    #[cfg(test)]
    recovery_interleaving: Mutex<Option<RecoveryInterleaving<Runtime>>>,
}

/// A point inside a recovery at which a test runs the other side of a race.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RecoveryStep {
    /// The verdict is withdrawn and the lifecycle not yet read.
    VerdictWithdrawn,
    /// The lifecycle was read active and the start not yet requested.
    LifecycleReadActive,
    /// The start is requested and the lifecycle not yet read again.
    StartRequested,
}

#[cfg(test)]
type RecoveryInterleaving<Runtime> = (
    RecoveryStep,
    Box<dyn FnOnce(&SharedHostedPlugin<Runtime>) + Send>,
);

/// Pushes the thread it drops on into a test's record.
#[cfg(test)]
pub(crate) struct TeardownWitness(Arc<Mutex<Vec<thread::ThreadId>>>);

#[cfg(test)]
impl Drop for TeardownWitness {
    fn drop(&mut self) {
        if let Ok(mut threads) = self.0.lock() {
            threads.push(thread::current().id());
        }
    }
}

// SAFETY: access_state enforces exclusive mutable access to wrapper. The audio
// path never waits; if non-RT control owns the wrapper, processing bypasses it.
unsafe impl<Runtime: HostedPluginRuntime> Send for SharedHostedPlugin<Runtime> {}
// SAFETY: every field but `wrapper` is `Sync` on its own (atomics, `Mutex`,
// `Arc<ProcessingGate>`, `String`, `bool`). `wrapper` is reached only as
// `&mut` while holding the `access_state` claim, taken by an `Acquire`
// compare-exchange from idle and released by `PluginAccessGuard`'s `Release`
// store, so at most one thread touches it at a time and each holder sees the
// previous holder's writes; `Runtime: Send` (via `AudioPlugin`) lets that
// holder be any thread.
unsafe impl<Runtime: HostedPluginRuntime> Sync for SharedHostedPlugin<Runtime> {}

impl<Runtime: HostedPluginRuntime> SharedHostedPlugin<Runtime> {
    pub fn new(wrapper: Runtime) -> Self {
        let name = wrapper.get_name().to_string();
        let activated = wrapper.is_activated();
        let accepts_midi = wrapper.accepts_midi();
        let processing = wrapper.processing_gate();
        Self {
            name,
            wrapper: UnsafeCell::new(wrapper),
            access_state: AtomicU8::new(PLUGIN_ACCESS_IDLE),
            lifecycle: PluginRuntimeLifecycle::new(),
            non_rt_control_lock: Mutex::new(()),
            control_gate_deadline: CONTROL_GATE_DEADLINE,
            activated,
            accepts_midi,
            processing,
            pending_parameters: PendingParameterQueue::new(),
            editor_parameter_writes: PendingParameterQueue::new(),
            dropped_note_events: AtomicU64::new(0),
            reported_dropped_note_events: AtomicU64::new(0),
            unserved_blocks: AtomicU64::new(0),
            #[cfg(test)]
            teardown_witness: OnceLock::new(),
            #[cfg(test)]
            recovery_interleaving: Mutex::new(None),
        }
    }

    /// Run `other_side` once, the first time a recovery reaches `step`.
    #[cfg(test)]
    pub(crate) fn interleave_with_recovery(
        &self,
        step: RecoveryStep,
        other_side: impl FnOnce(&Self) + Send + 'static,
    ) {
        *self
            .recovery_interleaving
            .lock()
            .expect("the recovery interleaving slot must not be poisoned") =
            Some((step, Box::new(other_side)));
    }

    /// Whether the interleaving a test set is still waiting for its step.
    #[cfg(test)]
    fn recovery_interleaving_pending(&self) -> bool {
        self.recovery_interleaving
            .lock()
            .expect("the recovery interleaving slot must not be poisoned")
            .is_some()
    }

    #[cfg(test)]
    fn reach_recovery_step(&self, step: RecoveryStep) {
        let other_side = {
            let mut slot = self
                .recovery_interleaving
                .lock()
                .expect("the recovery interleaving slot must not be poisoned");
            match slot.take() {
                Some((at, other_side)) if at == step => Some(other_side),
                unmatched => {
                    *slot = unmatched;
                    None
                }
            }
        };
        if let Some(other_side) = other_side {
            other_side(self);
        }
    }

    /// The same owner with a shorter gate deadline, so a test can hold the
    /// gate past it without waiting out the production figure.
    #[cfg(test)]
    pub(crate) fn with_control_gate_deadline(mut self, deadline: Duration) -> Self {
        self.control_gate_deadline = deadline;
        self
    }

    /// Record into `threads` the thread this plugin's wrapper is torn down on.
    #[cfg(test)]
    pub(crate) fn witness_teardown(&self, threads: Arc<Mutex<Vec<thread::ThreadId>>>) {
        let _ = self.teardown_witness.set(TeardownWitness(threads));
    }

    /// How many blocks a slot handed this plugin without its being served.
    pub fn unserved_blocks(&self) -> u64 {
        self.unserved_blocks.load(Ordering::Acquire)
    }

    /// One atomic add: the audio thread may not do more.
    fn record_unserved_block(&self) {
        self.unserved_blocks.fetch_add(1, Ordering::AcqRel);
    }

    /// Leave the processing state on the thread that processed this plugin,
    /// after its last block.
    ///
    /// Both formats bind leaving the processing state to the audio thread
    /// (CLAP `stop_processing`, VST3 `setProcessing(false)`). A live instance
    /// gets more blocks after `begin_unload` asks, and leaves there; an offline
    /// render's instance gets no block after its print, so the render thread —
    /// its audio thread — leaves it here before the instance is torn down.
    /// Without it the wrapper's drop performs the stop off the audio thread
    /// and counts the deviation.
    pub fn leave_processing_after_last_block(&self) {
        self.processing.request_stop();
        self.leave_processing_state_on_audio_thread();
    }

    /// How many note events this plugin has lost to a full retention queue.
    pub fn dropped_note_events(&self) -> u64 {
        self.dropped_note_events.load(Ordering::Acquire)
    }

    /// Count note events lost on the audio thread and raise the hint that
    /// brings the control path round to say so. One atomic add and one store:
    /// the audio thread may not print.
    fn record_dropped_note_events(&self, count: usize) {
        self.dropped_note_events
            .fetch_add(count as u64, Ordering::AcqRel);
        signal_pending_process_refusal();
    }

    /// Log the note events lost since the last report. Control path only.
    pub fn report_dropped_note_events(&self, instance_id: &str) {
        let dropped = self.dropped_note_events();
        let reported = self
            .reported_dropped_note_events
            .swap(dropped, Ordering::AcqRel);
        if dropped == reported {
            return;
        }
        eprintln!(
            "[Plugin] '{}' ({}) lost {} note event(s) that arrived while its retention queue \
             was full ({} in total)",
            self.name,
            instance_id,
            dropped - reported,
            dropped
        );
    }

    /// Take the wrapper back out of an owner that is being discarded.
    ///
    /// Consumes the owner, so the caller has already proven — by holding it by
    /// value, which past construction means an `Arc::try_unwrap` that succeeded
    /// — that no audio thread and no control path can be inside the wrapper.
    /// That is what makes a registration the engine refused recoverable rather
    /// than spent: the runtime goes back to the caller instead of dying with
    /// the owner it was briefly moved into.
    pub fn into_inner(self) -> Runtime {
        self.wrapper.into_inner()
    }

    /// The plugin's processing gate. Held here as well as inside the wrapper so
    /// the control path can state its intent, and read whether the audio thread
    /// has acted on it, without touching the wrapper at all.
    pub fn processing_gate(&self) -> Arc<ProcessingGate> {
        Arc::clone(&self.processing)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Whether this plugin takes note events, as the plugin itself declared.
    pub fn accepts_midi(&self) -> bool {
        self.accepts_midi
    }

    /// Queue one parameter write for this plugin's next process call, from the
    /// audio thread.
    ///
    /// The audio-thread counterpart of [`Self::enqueue_parameter`], and
    /// deliberately not that method: the control entry takes
    /// `lock_non_rt_control`, checks the instance's lifecycle, and copies the
    /// write into the editor's queue, none of which the audio thread may do.
    /// It skips each of them for a reason rather than for speed. The lifecycle
    /// and activation checks are already enforced where they bind — an
    /// unloading or inactive instance is never handed a block, because
    /// [`Self::with_process`] refuses it. Nothing clears the queue an unload
    /// leaves behind, and nothing needs to: the writes it holds are never
    /// delivered once the lifecycle closes, and the retirement sweep drops the
    /// instance whole, queue included. The editor is not told,
    /// because an automated parameter is not a host-side edit: the plugin moves
    /// its own parameter and reports it back through its own parameter events,
    /// which is how every format expects a processor-side change to reach the
    /// editor.
    ///
    /// The queue admits this second producer. Its slots run a
    /// `EMPTY → WRITING → READY` compare-and-swap state machine that already
    /// serialises the control-thread producer against the audio thread's drain,
    /// and it serialises two producers by exactly the same transitions: a slot
    /// is owned by whoever won the CAS into `WRITING`. Coalescing keeps at most
    /// one pending value per parameter id and sample: where a write meets a
    /// pending one for the same id at the same `sample_offset`, the later
    /// sequence number survives, so a control write and an audio write of the
    /// same parameter at the head of one process call collapse to the later of
    /// the two rather than to both. Writes at different samples are distinct
    /// points of one ramp and each reaches the plugin, in sample order.
    ///
    /// `sample_offset` is the sample of the next process call the write
    /// applies at, in the frame of reference the engine hands that call (see
    /// `NativePlugin::apply_parameter_on_audio_thread`). A block the plugin is
    /// not handed leaves its writes queued and moves them to the head of the
    /// block that delivers them.
    ///
    /// That ordering is what coalescing guarantees, and only that. A producer
    /// takes its sequence number before it reaches a slot, so one descheduled
    /// for longer than a block between taking a sequence and publishing it
    /// finds no pending value left to fold into and publishes an older write
    /// after newer ones have already drained — a window the queue does not
    /// close, and one the control path's own lock keeps to a single writer.
    ///
    /// A non-finite value is refused without touching the queue, mirroring the
    /// control path: `NaN` reaching the plugin is a parameter the host can
    /// never move back.
    pub fn enqueue_parameter_on_audio_thread(
        &self,
        param_id: u32,
        value: f64,
        sample_offset: u32,
    ) -> bool {
        if !value.is_finite() {
            return false;
        }

        self.pending_parameters
            .enqueue(param_id, value, sample_offset)
            .is_ok()
    }

    pub fn enqueue_parameter(&self, param_id: u32, value: f64) -> Result<(), ParameterWriteError> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;

        if !self.activated {
            return Err(ParameterWriteError::NotActivated {
                plugin: self.name.clone(),
            });
        }

        if !value.is_finite() {
            return Err(ParameterWriteError::NonFinite {
                plugin: self.name.clone(),
                value,
            });
        }

        // A control write has no timeline position: it lands at the head of
        // the next block.
        self.pending_parameters
            .enqueue(param_id, value, 0)
            .map_err(|()| ParameterWriteError::QueueFull {
                plugin: self.name.clone(),
            })?;

        // The processor learns about this write from the audio thread. The
        // editor is a different object in some formats and has to be told
        // separately, or its knob keeps showing the value the user moved away
        // from. Queued first so a write that arrives while the audio thread
        // holds the seam is delivered by the next control visit rather than
        // lost.
        let _ = self.editor_parameter_writes.enqueue(param_id, value, 0);
        if let Some(_guard) = self.try_claim_control() {
            // SAFETY: the guard holds the control side of the access seam, so
            // the audio thread cannot be inside the wrapper.
            self.show_editor_the_host_writes(unsafe { &mut *self.wrapper.get() });
        }
        Ok(())
    }

    /// Hand the plugin's editor every host-side write it has not seen.
    ///
    /// Control path only. The caller must already hold the control side of the
    /// access seam, which is what makes this safe to call with a live `&mut`
    /// borrow of the wrapper.
    fn show_editor_the_host_writes(&self, plugin: &mut Runtime) {
        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = self.editor_parameter_writes.drain(&mut drained);
        for update in &drained[..count] {
            plugin.apply_host_parameter_write_to_editor(update.param_id, update.value);
        }
    }

    pub fn get_state_after_pending_parameters_drain(
        &self,
        timeout: Duration,
    ) -> Result<Vec<u8>, PluginControlError<PluginStateError>> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.read_state_after_parameters_drain(timeout)
    }

    /// [`Self::get_state_after_pending_parameters_drain`], except that the wait
    /// for the control gate ends, refusing `GateBusy`, once `abandoned` says
    /// the caller no longer wants the state. The deadline and the verdict a
    /// deadline brings are the waiting lock's own.
    pub fn get_state_after_pending_parameters_drain_unless(
        &self,
        timeout: Duration,
        abandoned: &dyn Fn() -> bool,
    ) -> Result<Vec<u8>, PluginControlError<PluginStateError>> {
        let _non_rt_control_guard = self.lock_non_rt_control_unless(abandoned)?;
        self.read_state_after_parameters_drain(timeout)
    }

    fn read_state_after_parameters_drain(
        &self,
        timeout: Duration,
    ) -> Result<Vec<u8>, PluginControlError<PluginStateError>> {
        self.ensure_active_lifecycle()?;

        self.with_control_locked(timeout, |plugin| {
            if self.pending_parameters.has_pending() {
                return Err(PluginStateError::PendingWrites {
                    plugin: self.name.clone(),
                });
            }

            plugin.get_state().map_err(PluginStateError::Plugin)
        })
    }

    pub fn set_state_invalidating_pending_parameters(
        &self,
        timeout: Duration,
        plugin_state: &[u8],
    ) -> Result<Vec<PluginParameter>, PluginControlError<PluginError>> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;

        self.with_control_locked(timeout, |plugin| {
            plugin.set_state(plugin_state)?;
            self.pending_parameters.clear();
            Ok(plugin.get_parameters())
        })
    }

    /// Close the lifecycle, then withdraw the intent to process across a
    /// SeqCst fence.
    ///
    /// A racing recovery requests the start, fences, and re-reads the
    /// lifecycle (`restart_if_active`): either it reads this unload and
    /// withdraws its own start, or its start precedes this withdrawal. Either
    /// way the unloading instance ends not asked to process.
    ///
    /// The audio thread — the only thread CLAP lets leave the processing state
    /// — skips an unloading instance without processing it and leaves the
    /// processing state on its first block after the withdrawal. The instance
    /// stays in the scheduler until the unload finishes, so that block arrives.
    pub fn begin_unload(&self) {
        self.lifecycle.begin_unload();
        fence(Ordering::SeqCst);
        self.processing.request_stop();
    }

    /// Reactivate first, then restart unless the instance is unresponsive. A
    /// recovery racing this clears the verdict first and then restarts if the
    /// instance is active, so whichever of the two reads second sees the
    /// other's write and the restart is never lost.
    ///
    /// The SeqCst fence between reactivating and restarting pairs with the one
    /// a recovery takes after withdrawing a start it found unloading
    /// (`restart_if_active`): either the recovery reads this
    /// reactivation and starts again, or its withdrawal precedes this start.
    pub fn cancel_unload(&self) {
        self.lifecycle.cancel_unload();
        fence(Ordering::SeqCst);
        self.restart_unless_unresponsive();
    }

    fn restart_unless_unresponsive(&self) {
        if !self.lifecycle.is_unresponsive() {
            self.processing.request_start();
        }
    }

    pub fn retire(&self) {
        self.lifecycle.retire();
    }

    pub fn ensure_public_control_allowed(&self) -> Result<(), PluginControlRefusal> {
        self.ensure_active_lifecycle()
    }

    /// The one control visit a latency re-query makes: poll the plugin, and
    /// read both figures the answer travels with while the seam is still held.
    ///
    /// Shared by [`Self::poll_latency_change`] and the latency watcher's
    /// hint-driven sweep, so the two paths cannot drift into answering the
    /// same ask with different conversions.
    pub(crate) fn refresh_latency_change(
        plugin: &mut Runtime,
    ) -> Result<Option<LatencyChange>, PluginError> {
        match plugin.poll_latency_change()? {
            Some(_) => Ok(Some(LatencyChange {
                latency_ms: plugin.latency_ms(),
                latency_frames: plugin.latency_samples() as usize,
            })),
            None => Ok(None),
        }
    }

    /// Apply any pending latency change the plugin flagged (via
    /// `clap_host_latency.changed()` / `request_restart()`) and report the new
    /// latency, or `None` when nothing was pending.
    ///
    /// Both figures are read in this one control visit rather than in two,
    /// because a second visit would answer about a plugin that may have been
    /// deactivated, reactivated or re-flagged in between, and the event and the
    /// compensation would then describe different plugins.
    ///
    /// Runs on the non-RT control path through the existing CAS control seam, so
    /// the deactivate/reactivate a latency change requires cannot race the RT
    /// `process` path — and it adds no new audio-thread calls.
    pub fn poll_latency_change(
        &self,
        timeout: Duration,
    ) -> Result<Option<LatencyChange>, PluginControlError<PluginError>> {
        self.with_control(timeout, |plugin| Self::refresh_latency_change(plugin))
    }

    /// Read the plugin's *current* parameter values, or `None` when the host's
    /// own cache is the newer of the two.
    ///
    /// A user turning a knob in the plugin's own editor changes values the host
    /// never wrote, and CLAP gives no host-side notification this binding layer
    /// surfaces — `clap_host_params.rescan` is a no-op stub here and GUI edits
    /// reach a host through the process output event list, which this runtime
    /// does not read. So the values are polled from the plugin on the control
    /// path instead, through the same CAS seam every other control operation
    /// uses, and never from the audio thread.
    ///
    /// `None` when parameter writes are still queued for the audio thread: those
    /// were accepted from the host side and have not reached the plugin yet, so
    /// the plugin would answer with the value they are about to replace and a
    /// poll would report a knob snapping back. The cache already holds them, and
    /// it is authoritative until the queue drains.
    ///
    /// Known limitation, deliberately accepted here: the queue only drains on
    /// the process path, and the scheduler short-circuits a **bypassed** effect
    /// before `with_process` ever runs. A bypassed instance whose queue is
    /// non-empty therefore refuses every poll, and its host-side cache stays
    /// authoritative until it is un-bypassed. Nothing is lost — the cache holds
    /// every value this host wrote — but a change made inside the plugin's own
    /// editor while bypassed is not visible until then.
    pub fn poll_parameters(
        &self,
        timeout: Duration,
    ) -> Result<Option<Vec<PluginParameter>>, PluginControlRefusal> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;

        self.with_control_locked(timeout, |plugin| -> Result<_, std::convert::Infallible> {
            // The regular control-path visit, and so the place a write that
            // could not be delivered when it was made finally reaches the
            // editor.
            self.show_editor_the_host_writes(plugin);

            if self.pending_parameters.has_pending() {
                return Ok(None);
            }

            Ok(Some(plugin.get_parameters()))
        })
        .map_err(PluginControlError::into_refusal)
    }

    /// Whether any host-side parameter write is still queued for the audio
    /// thread.
    ///
    /// Narrow accessor for the command layer's parameter-cache write-back: a
    /// snapshot polled before such a write was accepted is older than the cache,
    /// and storing it would revert the write.
    pub fn has_pending_parameter_writes(&self) -> bool {
        self.pending_parameters.has_pending()
    }

    pub fn with_control<ResultValue, OperationError>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, OperationError>,
    ) -> Result<ResultValue, PluginControlError<OperationError>> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;
        self.with_control_locked(timeout, operation)
    }

    /// Run a control operation, but only if the control gate is free right now.
    ///
    /// [`with_control`](Self::with_control) waits twice: on the gate that
    /// serializes this instance's control operations, for up to
    /// [`CONTROL_GATE_DEADLINE`], and then on the RT seam under `timeout`. The
    /// gate is held for however long the operation holding it takes, and
    /// `open_gui` or `set_state` on a large preset is unbounded third-party code,
    /// so the first wait can run to that deadline. That is fine for a command
    /// answering one user action, and wrong for a caller serving every instance
    /// on a timer: the parameter drain answers flush requests on the
    /// same 16 ms tick that feeds every plugin's knobs to the renderer, so one
    /// instance mid-`open_gui` would freeze all of them.
    ///
    /// So this refuses instead of waiting, and leaves what to do about it to the
    /// caller, which is the one that knows whether coming back later is cheap.
    /// The bounded RT wait is kept: that one is the audio thread holding the seam
    /// for the length of a block, which is what `timeout` was sized for.
    pub fn try_with_control<ResultValue, OperationError>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, OperationError>,
    ) -> Result<ResultValue, PluginControlError<OperationError>> {
        let _non_rt_control_guard = self.try_lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;
        self.with_control_locked(timeout, operation)
    }

    pub fn with_unload_control<ResultValue, OperationError>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, OperationError>,
    ) -> Result<ResultValue, PluginControlError<OperationError>> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.with_control_locked(timeout, operation)
    }

    /// Take the gate that serializes this instance's non-RT control operations.
    ///
    /// The whole acquisition runs under the async-worker hand-off: uncontended —
    /// the ordinary case — it is one `try_lock`, and contended it polls until the
    /// holder lets go or the gate deadline passes. Only the acquisition is handed
    /// off — the guard comes back to the caller — which is sound because
    /// `block_in_place` runs its closure on the calling thread.
    ///
    /// A holder still inside the plugin at the deadline is treated as
    /// unresponsive: the instance stops processing, and while that holder keeps
    /// the gate every later control call refuses at once instead of queueing
    /// behind it. The holder is not interrupted — nothing can stop a vendor call
    /// from outside — so the instance stays allocated for as long as that call
    /// holds its reference; see [`Self::mark_unresponsive`]. A call that was
    /// only slow lets go of the gate eventually, and letting go withdraws the
    /// verdict ([`ControlGateGuard`]), so the instance processes again even if
    /// no further control call ever comes.
    fn lock_non_rt_control(&self) -> Result<ControlGateGuard<'_, Runtime>, PluginControlRefusal> {
        self.lock_non_rt_control_unless(&|| false)
    }

    /// [`Self::lock_non_rt_control`], leaving the wait with `GateBusy` once
    /// `abandoned` is true: the gate was busy when this waiter left, which is
    /// no verdict on its holder.
    fn lock_non_rt_control_unless(
        &self,
        abandoned: &dyn Fn() -> bool,
    ) -> Result<ControlGateGuard<'_, Runtime>, PluginControlRefusal> {
        without_stalling_async_worker(|| {
            let deadline = Instant::now() + self.control_gate_deadline;
            loop {
                if let Some(guard) = self.try_take_gate() {
                    return Ok(guard);
                }

                // The gate is still held by the call some waiter already gave
                // up on: waiting out a deadline of its own would only add a
                // hang the verdict settled.
                self.refuse_if_unresponsive()?;

                if abandoned() {
                    return Err(PluginControlRefusal::GateBusy {
                        plugin: self.name.clone(),
                    });
                }

                if Instant::now() >= deadline {
                    return self.give_up_on_gate();
                }

                thread::sleep(CONTROL_GATE_POLL);
            }
        })
    }

    /// The deadline has passed: one last look at the gate, then the verdict.
    ///
    /// The holder may let go between the verdict and this waiter's refusal, and
    /// a holder that let go before the verdict was recorded had nothing to
    /// withdraw. So the gate is tried once more after marking, across a SeqCst
    /// fence matched by the one in [`ControlGateGuard`]'s release: either that
    /// release sees the verdict and withdraws it, or this try sees the gate
    /// free and takes it, withdrawing the verdict on the way.
    fn give_up_on_gate(&self) -> Result<ControlGateGuard<'_, Runtime>, PluginControlRefusal> {
        if let Some(guard) = self.try_take_gate() {
            return Ok(guard);
        }
        self.mark_unresponsive();
        fence(Ordering::SeqCst);
        if let Some(guard) = self.try_take_gate() {
            return Ok(guard);
        }
        Err(self.unresponsive_refusal())
    }

    fn refuse_if_unresponsive(&self) -> Result<(), PluginControlRefusal> {
        if self.lifecycle.is_unresponsive() {
            return Err(self.unresponsive_refusal());
        }
        Ok(())
    }

    /// The refusal every control call on an unresponsive instance answers.
    fn unresponsive_refusal(&self) -> PluginControlRefusal {
        PluginControlRefusal::Unresponsive {
            plugin: self.name.clone(),
        }
    }

    /// Take the control gate if it is free right now, withdrawing an
    /// unresponsive verdict on the way.
    ///
    /// A free gate is the proof the verdict was waiting for: the call that held
    /// it past the deadline has returned, so the plugin answers again.
    ///
    /// A poisoned gate is taken rather than refused — the panic that poisoned
    /// it happened inside some earlier operation's body, the gate itself is
    /// free, and refusing forever would both silence this instance for the life
    /// of the process and have a caller that retries spin on every tick.
    fn try_take_gate(&self) -> Option<ControlGateGuard<'_, Runtime>> {
        let guard = match self.non_rt_control_lock.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return None,
        };
        self.recover_if_unresponsive();
        Some(ControlGateGuard {
            gate: Some(guard),
            owner: self,
        })
    }

    /// Withdraw the verdict, then restart an instance whose lifecycle is
    /// still active; an unloading or retired one must not start again.
    ///
    /// The verdict goes first so a racing [`Self::cancel_unload`], which
    /// reactivates first and restarts unless unresponsive, cannot lose the
    /// restart: each writes one flag before reading the other. The cost is
    /// that the audio thread may meet a processable instance still asked to
    /// stop for a block, which only delays its start by that block.
    ///
    /// The restart re-reads the lifecycle after requesting the start
    /// ([`Self::restart_if_active`]), so a racing [`Self::begin_unload`] that
    /// lands between the first read and the start cannot leave the unloading
    /// instance asked to process.
    fn recover_if_unresponsive(&self) {
        if self.lifecycle.clear_unresponsive() {
            #[cfg(test)]
            self.reach_recovery_step(RecoveryStep::VerdictWithdrawn);
            self.restart_if_active();
        }
    }

    /// Request the start, then re-read the lifecycle across a SeqCst fence and
    /// withdraw the start if it is no longer active.
    ///
    /// Each side of the race writes before it reads the other's flag:
    /// [`Self::begin_unload`] closes the lifecycle, fences, and withdraws, so
    /// a start this re-read finds still active precedes that withdrawal. A
    /// withdrawal made here is fenced before the next read, so a
    /// [`Self::cancel_unload`] landing after it is either read here and
    /// started again, or starts after the withdrawal itself.
    fn restart_if_active(&self) {
        while self.lifecycle.is_active() {
            #[cfg(test)]
            self.reach_recovery_step(RecoveryStep::LifecycleReadActive);
            self.processing.request_start();
            fence(Ordering::SeqCst);
            #[cfg(test)]
            self.reach_recovery_step(RecoveryStep::StartRequested);
            if self.lifecycle.is_active() {
                return;
            }
            self.processing.request_stop();
            fence(Ordering::SeqCst);
        }
    }

    /// Record that this instance's control gate outlived its deadline.
    ///
    /// The verdict withdraws the intent to process, so the audio thread — which
    /// already skips the instance while the late call holds the RT seam — leaves
    /// the processing state on its own thread once that call returns, and
    /// processes the instance again only once that gate is let go and the
    /// verdict withdrawn.
    ///
    /// The intent to process is withdrawn before the verdict is recorded: a
    /// recovery that clears this verdict restarts after it, so a stop landing
    /// later can only be one whose verdict that recovery has not seen, and the
    /// caller's retry of the gate ([`Self::give_up_on_gate`]) withdraws it.
    ///
    /// Nothing here frees anything, and nothing may: the late call may still be
    /// executing inside the plugin's code. An unload of an unresponsive instance
    /// detaches it from the scheduler and the instance map as any unload does,
    /// then hands its runtime to the retirement vec, whose sweep frees only a
    /// runtime nothing else references (`take_released_retired_runtimes`). The
    /// late call reached this owner through an `Arc` clone of its own, so the
    /// runtime — wrapper, plugin and library — stays allocated until that call
    /// returns, or for the rest of the process if it never does.
    fn mark_unresponsive(&self) {
        self.processing.request_stop();
        if self.lifecycle.mark_unresponsive() {
            eprintln!(
                "[Plugin] '{}' held its control gate past {:?}; treating it as unresponsive",
                self.name, self.control_gate_deadline
            );
        }
    }

    /// Take the control gate without waiting for it.
    ///
    /// No async hand-off, because there is nothing to hand off: this never
    /// blocks. A held gate answers busy, or the unresponsive refusal when the
    /// holder is the call a waiter already gave up on.
    fn try_lock_non_rt_control(
        &self,
    ) -> Result<ControlGateGuard<'_, Runtime>, PluginControlRefusal> {
        if let Some(guard) = self.try_take_gate() {
            return Ok(guard);
        }
        self.refuse_if_unresponsive()?;
        Err(PluginControlRefusal::GateBusy {
            plugin: self.name.clone(),
        })
    }

    fn ensure_active_lifecycle(&self) -> Result<(), PluginControlRefusal> {
        self.lifecycle.ensure_public_control_allowed(&self.name)
    }

    fn with_control_locked<ResultValue, OperationError>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, OperationError>,
    ) -> Result<ResultValue, PluginControlError<OperationError>> {
        // The whole body runs under the hand-off, not just the contended wait:
        // `operation` is third-party CLAP code of unbounded duration (`set_state`
        // on a large preset, `open_gui`), so the ordinary uncontended claim —
        // the seam is free unless the audio thread is inside a block for this
        // instance, so the first CAS normally takes it — would otherwise still
        // park the worker for the whole plugin call.
        without_stalling_async_worker(|| {
            if let Some(_guard) = self.try_claim_control() {
                // SAFETY: `_guard` holds the control side of the access seam
                // until this return, so neither the audio thread nor another
                // control visit can be inside the wrapper.
                return operation(unsafe { &mut *self.wrapper.get() })
                    .map_err(PluginControlError::Operation);
            }

            self.spin_for_control(timeout, operation)
        })
    }

    /// Take the control side of the RT/control access seam, or `None` when the
    /// audio thread holds it. Never waits.
    ///
    /// Crate-visible because the sibling control paths (the latency watcher's
    /// busy-instance test) hold the same seam a command operation would.
    pub(crate) fn try_claim_control(&self) -> Option<PluginAccessGuard<'_>> {
        self.access_state
            .compare_exchange(
                PLUGIN_ACCESS_IDLE,
                PLUGIN_ACCESS_CONTROL,
                Ordering::Acquire,
                Ordering::Relaxed,
            )
            .is_ok()
            .then(|| PluginAccessGuard {
                access_state: &self.access_state,
            })
    }

    /// Poll for the control side of the access seam until `timeout`, then run
    /// `operation` under it.
    ///
    /// Stays a blocking spin on purpose. The audio thread releases the seam at
    /// the end of a block, so the wait is normally one poll and the deadline is
    /// there for a plugin whose block never completes; and `operation` reaching
    /// CLAP entry points from the caller's own thread is what the GUI and state
    /// call sites depend on. `with_control_locked` owns the async-worker
    /// hand-off so this stays a plain wait.
    fn spin_for_control<ResultValue, OperationError>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, OperationError>,
    ) -> Result<ResultValue, PluginControlError<OperationError>> {
        let deadline = Instant::now() + timeout;

        loop {
            if let Some(_guard) = self.try_claim_control() {
                // SAFETY: `_guard` holds the control side of the access seam
                // until this return, so neither the audio thread nor another
                // control visit can be inside the wrapper.
                return operation(unsafe { &mut *self.wrapper.get() })
                    .map_err(PluginControlError::Operation);
            }

            if Instant::now() >= deadline {
                return Err(PluginControlError::Refused(
                    PluginControlRefusal::TimedOut {
                        plugin: self.name.clone(),
                    },
                ));
            }

            thread::sleep(Duration::from_millis(2));
        }
    }

    fn with_process<ResultValue>(
        &self,
        operation: impl FnOnce(&mut Runtime, &PendingParameterQueue) -> ResultValue,
    ) -> Option<ResultValue> {
        if !self.lifecycle.allows_process() {
            // An unloading or unresponsive instance is still wired into the
            // scheduler, so blocks keep arriving for it. It must not be processed, but this is the
            // audio thread, and leaving the CLAP processing state is the audio
            // thread's job — so spend the visit on that and nothing else.
            self.leave_processing_state_on_audio_thread();
            return None;
        }

        if !self.activated {
            return None;
        }

        if self
            .access_state
            .compare_exchange(
                PLUGIN_ACCESS_IDLE,
                PLUGIN_ACCESS_PROCESSING,
                Ordering::Acquire,
                Ordering::Relaxed,
            )
            .is_err()
        {
            return None;
        }

        let _guard = PluginAccessGuard {
            access_state: &self.access_state,
        };
        Some(operation(
            // SAFETY: the compare-exchange above moved the seam from idle to
            // processing and `_guard` releases it only after `operation`
            // returns, so no control visit can be inside the wrapper.
            unsafe { &mut *self.wrapper.get() },
            &self.pending_parameters,
        ))
    }

    /// Perform a pending stop on the audio thread. Called from the RT path only.
    ///
    /// Never waits: if the control path currently owns the wrapper, the next
    /// block tries again. If no block ever comes, `ClapWrapper::drop` performs
    /// the stop itself and counts the deviation.
    fn leave_processing_state_on_audio_thread(&self) {
        if !self.processing.has_pending_stop() {
            return;
        }

        if self
            .access_state
            .compare_exchange(
                PLUGIN_ACCESS_IDLE,
                PLUGIN_ACCESS_PROCESSING,
                Ordering::Acquire,
                Ordering::Relaxed,
            )
            .is_err()
        {
            return;
        }

        let _guard = PluginAccessGuard {
            access_state: &self.access_state,
        };
        // SAFETY: the compare-exchange above moved the seam from idle to
        // processing and `_guard` releases it only at the end of this scope,
        // so no control visit can be inside the wrapper.
        unsafe { &mut *self.wrapper.get() }.sync_processing_state();
    }
}

/// The control side of the access seam, held for the duration of one control
/// visit. Crate-visible because sibling control paths claim the seam through
/// [`SharedHostedPlugin::try_claim_control`].
pub(crate) struct PluginAccessGuard<'a> {
    access_state: &'a AtomicU8,
}

impl Drop for PluginAccessGuard<'_> {
    fn drop(&mut self) {
        self.access_state
            .store(PLUGIN_ACCESS_IDLE, Ordering::Release);
    }
}

/// RT processing handle for a shared hosted plugin runtime.
pub struct HostedPluginSlot<Runtime = HostedRuntime> {
    plugin: Arc<SharedHostedPlugin<Runtime>>,
    /// Preallocated output scratch for left channel (avoids per-block Vec alloc on RT thread).
    out_l_scratch: Box<[f32; MAX_BUFFER]>,
    /// Preallocated output scratch for right channel.
    out_r_scratch: Box<[f32; MAX_BUFFER]>,
    /// Preallocated pending parameter drain scratch.
    pending_parameter_scratch: [PendingParameterUpdate; PENDING_PARAMETER_CAPACITY],
    /// Events accepted for this plugin but not yet delivered to it, oldest
    /// first, with their count.
    ///
    /// The scheduler clears the buffer it hands over the moment the dispatch
    /// returns, so this slot is the only place an unconsumed event can survive
    /// in. Two things put one here: a block the plugin could not be handed
    /// (non-RT control owned the access seam, or the instance is unloading or
    /// inactive), and a block whose events did not all fit the delivery
    /// scratch. Both drain at the head of the first block the plugin actually
    /// receives — the note-off a stuck key is waiting for is the event this
    /// exists for.
    retained_events: [MidiNoteEvent; MAX_MIDI_EVENTS],
    retained_event_count: usize,
}

impl<Runtime: HostedPluginRuntime> HostedPluginSlot<Runtime> {
    pub fn new(plugin: Arc<SharedHostedPlugin<Runtime>>) -> Self {
        let pending_parameter_scratch =
            [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];

        Self {
            plugin,
            out_l_scratch: Box::new([0.0f32; MAX_BUFFER]),
            out_r_scratch: Box::new([0.0f32; MAX_BUFFER]),
            pending_parameter_scratch,
            retained_events: [EMPTY_RETAINED_EVENT; MAX_MIDI_EVENTS],
            retained_event_count: 0,
        }
    }

    /// Copy events onto the retention queue, oldest first.
    ///
    /// An event kept here is already late — its block has passed — so it is
    /// re-stamped to the head of whichever block finally delivers it. Keeping
    /// the original offset would name a sample inside a block that no longer
    /// exists, and the plugin is entitled to reject an event past its frame
    /// count. The queue is exactly one engine buffer deep, which is everything
    /// one dispatch can hand over declined. A second declined block arriving
    /// while it is still full has nowhere to go: those events are counted on
    /// the plugin as dropped, because growing the queue would allocate here.
    fn retain_events(&mut self, events: &[MidiNoteEvent]) {
        let room = MAX_MIDI_EVENTS - self.retained_event_count;
        let kept = events.len().min(room);
        for (slot, event) in self.retained_events[self.retained_event_count..]
            .iter_mut()
            .zip(events)
            .take(kept)
        {
            *slot = MidiNoteEvent {
                frame_offset: 0,
                ..*event
            };
        }
        self.retained_event_count += kept;
        let dropped = events.len() - kept;
        if dropped > 0 {
            self.plugin.record_dropped_note_events(dropped);
        }
    }
}

fn drain_pending_parameters_for_process(
    pending_parameters: &PendingParameterQueue,
    scratch: &mut [PendingParameterUpdate; PENDING_PARAMETER_CAPACITY],
) -> usize {
    pending_parameters.drain(scratch)
}

// `'static` comes from `daw_engine::NativePlugin`, which carries its own
// `as_any`: the engine's slot registry is where a scheduler node's concrete type
// is recovered, and that is untouched here.
impl<Runtime: HostedPluginRuntime + 'static> NativePlugin for HostedPluginSlot<Runtime> {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let n = num_samples.min(MAX_BUFFER);
        let processed = self.plugin.with_process(|wrapper, pending_parameters| {
            let parameter_count = drain_pending_parameters_for_process(
                pending_parameters,
                &mut self.pending_parameter_scratch,
            );
            let inputs: [&[f32]; 2] = [&left[..n], &right[..n]];
            let out_l = &mut self.out_l_scratch;
            let out_r = &mut self.out_r_scratch;
            {
                let mut outputs: [&mut [f32]; 2] = [&mut out_l[..n], &mut out_r[..n]];
                if parameter_count == 0 {
                    wrapper.process(&inputs, &mut outputs, n);
                } else {
                    wrapper.process_with_parameter_updates(
                        &inputs,
                        &mut outputs,
                        n,
                        &self.pending_parameter_scratch[..parameter_count],
                    );
                }
            }
            left[..n].copy_from_slice(&out_l[..n]);
            right[..n].copy_from_slice(&out_r[..n]);
        });

        if processed.is_none() {
            // Non-RT state/editor control owns the plugin, or it is unloading
            // or inactive: the block passes through as-is, and is counted. Its
            // parameter writes stay queued, late, for the next block's head.
            self.plugin.pending_parameters.mark_pending_late();
            self.plugin.record_unserved_block();
        }
    }

    fn process_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        transport: &TransportState,
    ) {
        let n = num_samples.min(MAX_BUFFER);

        // Stage the block's deliverable set, oldest first: events kept over
        // from a block this plugin could not be handed or that could not all
        // fit, then this block's own events up to the room left. The engine's
        // per-event frame offset travels with the note: dropping it here would
        // collapse a block's timing onto its first frame, whatever the wrapper
        // below does with it.
        let retained_count = self.retained_event_count;
        let fresh_capacity = MAX_MIDI_EVENTS - retained_count;
        let fresh_staged_count = midi_events.len().min(fresh_capacity);

        let mut event_buf = [HostMidiEvent::default(); MAX_MIDI_EVENTS];
        for (index, slot) in event_buf.iter_mut().enumerate().take(retained_count) {
            let event = &self.retained_events[index];
            *slot = HostMidiEvent {
                note: event.note,
                velocity: event.velocity,
                channel: event.channel,
                is_note_on: event.is_note_on,
                frame_offset: event.frame_offset,
            };
        }
        for (slot, event) in event_buf[retained_count..]
            .iter_mut()
            .zip(midi_events)
            .take(fresh_staged_count)
        {
            *slot = HostMidiEvent {
                note: event.note,
                velocity: event.velocity,
                channel: event.channel,
                is_note_on: event.is_note_on,
                frame_offset: event.frame_offset,
            };
        }
        let count = retained_count + fresh_staged_count;

        let host_transport = host_transport_from(transport);

        let processed = self.plugin.with_process(|wrapper, pending_parameters| {
            // Refills a preallocated event in place — no allocation here.
            wrapper.set_transport(host_transport);
            let parameter_count = drain_pending_parameters_for_process(
                pending_parameters,
                &mut self.pending_parameter_scratch,
            );
            let inputs: [&[f32]; 2] = [&left[..n], &right[..n]];
            let out_l = &mut self.out_l_scratch;
            let out_r = &mut self.out_r_scratch;
            {
                let mut outputs: [&mut [f32]; 2] = [&mut out_l[..n], &mut out_r[..n]];
                wrapper.process_with_midi_and_parameters(
                    &inputs,
                    &mut outputs,
                    n,
                    &event_buf[..count],
                    &self.pending_parameter_scratch[..parameter_count],
                );
            }
            left[..n].copy_from_slice(&out_l[..n]);
            right[..n].copy_from_slice(&out_r[..n]);
        });

        match processed {
            Some(()) => {
                // Everything staged was delivered. What was staged over is the
                // tail of a dispatch longer than one block's delivery scratch,
                // and it drains the same way: at the head of the next block.
                self.retained_event_count = 0;
                self.retain_events(&midi_events[fresh_staged_count..]);
            }
            None => {
                // Non-RT state/editor control owns the plugin, or the instance
                // is unloading or inactive: the block was bypassed and the
                // runtime consumed nothing. The scheduler has already cleared
                // the buffer it handed over, so this queue is the events' only
                // remaining copy — the staged prefix is still exactly what the
                // retention array holds, and this block's events go back
                // behind it: the staged ones fit, and any the queue cannot
                // hold are counted as dropped.
                // Its parameter writes are late the same way the notes are.
                self.retain_events(midi_events);
                self.plugin.pending_parameters.mark_pending_late();
                self.plugin.record_unserved_block();
            }
        }
    }

    fn apply_parameter_on_audio_thread(&mut self, id: u32, value: f64, sample_offset: u32) -> bool {
        self.plugin
            .enqueue_parameter_on_audio_thread(id, value, sample_offset)
    }

    fn name(&self) -> &str {
        self.plugin.name()
    }

    /// The plugin's own answer, not the slot's assumption.
    ///
    /// This used to be a hardcoded `true`, which routed notes to every effect in
    /// the rack. A VST3 plugin that declares no event input bus is entitled to
    /// treat an event list as a host fault, so the answer has to come from the
    /// plugin.
    fn accepts_midi(&self) -> bool {
        self.plugin.accepts_midi()
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // The engine's own figure, not the bridge's alias for it: the point of
    // these specs is that the two agree.
    use daw_engine::midi_fx::{MidiEventBuffer, MIDI_EVENT_BUFFER_CAPACITY};
    use daw_plugin_host::{AudioPlugin, ClapWrapper, PluginError};

    /// A backend that records only what the runtime owner asked of its editor.
    ///
    /// A real VST3 controller is a separate COM object and cannot be built
    /// without a plugin binary, so what is faked here is the backend — the seam
    /// the owner drives is the production one.
    struct EditorRecordingPlugin {
        name: String,
        processing: Arc<ProcessingGate>,
        editor_writes: Arc<Mutex<Vec<(u32, f64)>>>,
    }

    impl AudioPlugin for EditorRecordingPlugin {
        fn process(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
        ) {
        }

        fn set_parameter(&mut self, _param_id: u32, _value: f64) {}

        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }

        fn get_state(&self) -> Result<Vec<u8>, PluginError> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _state: &[u8]) -> Result<(), PluginError> {
            Ok(())
        }

        fn get_name(&self) -> &str {
            &self.name
        }
    }

    impl HostedPluginRuntime for EditorRecordingPlugin {
        fn is_activated(&self) -> bool {
            true
        }

        fn processing_gate(&self) -> Arc<ProcessingGate> {
            Arc::clone(&self.processing)
        }

        fn sync_processing_state(&mut self) {}

        fn set_transport(&mut self, _transport: HostTransport) {}

        fn process_with_parameter_updates(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
            _parameter_updates: &[HostParameterUpdate],
        ) {
        }

        fn process_with_midi_and_parameters(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
            _midi_events: &[HostMidiEvent],
            _parameter_updates: &[HostParameterUpdate],
        ) {
        }

        fn apply_host_parameter_write_to_editor(&mut self, param_id: u32, value: f64) {
            self.editor_writes
                .lock()
                .expect("editor write log")
                .push((param_id, value));
        }

        fn poll_latency_change(&mut self) -> Result<Option<u32>, PluginError> {
            Ok(None)
        }

        fn latency_ms(&self) -> f64 {
            0.0
        }

        fn latency_samples(&self) -> u32 {
            0
        }

        fn tail_samples(&self) -> u32 {
            0
        }
    }

    /// The `(parameter id, value)` writes a recording plugin has received.
    type ParameterWrites = Arc<Mutex<Vec<(u32, f64)>>>;

    fn editor_recording_plugin() -> (SharedHostedPlugin<EditorRecordingPlugin>, ParameterWrites) {
        let editor_writes = Arc::new(Mutex::new(Vec::new()));
        let shared = SharedHostedPlugin::new(EditorRecordingPlugin {
            name: "fixture".to_string(),
            processing: Arc::new(ProcessingGate::default()),
            editor_writes: Arc::clone(&editor_writes),
        });
        (shared, editor_writes)
    }

    /// A host-side parameter write reaches the processor through the audio
    /// thread's own queue, which a format whose editor is a separate object
    /// never sees. A write that stops at that queue leaves the plugin's own knob
    /// showing the value the user moved away from.
    #[test]
    fn a_host_parameter_write_is_shown_to_the_plugins_editor() {
        let (shared, editor_writes) = editor_recording_plugin();

        shared
            .enqueue_parameter(7, 0.25)
            .expect("the pending queue has room");

        assert_eq!(
            *editor_writes.lock().expect("editor write log"),
            vec![(7, 0.25)]
        );
    }

    /// The editor's copy is a queue, not a direct call, so a write that arrives
    /// while the audio thread holds the access seam is delivered by the next
    /// control visit rather than dropped.
    #[test]
    fn a_write_made_while_the_audio_thread_holds_the_seam_reaches_the_editor_later() {
        let (shared, editor_writes) = editor_recording_plugin();

        shared
            .with_process(|_, _| {
                // Inside the audio-thread claim: the control path cannot enter
                // the wrapper, which is exactly the race the queue exists for.
                shared
                    .enqueue_parameter(3, 0.5)
                    .expect("the pending queue has room");
            })
            .expect("an activated instance is processed");

        assert!(
            editor_writes.lock().expect("editor write log").is_empty(),
            "the control path entered the wrapper while the audio thread held it"
        );

        shared
            .poll_parameters(Duration::from_millis(50))
            .expect("the control path visits the plugin");

        assert_eq!(
            *editor_writes.lock().expect("editor write log"),
            vec![(3, 0.5)]
        );
    }

    /// The parameter updates each process call was handed, one entry per call.
    /// Each update is `(parameter id, value, sample offset)`.
    type ProcessedBlocks = Arc<Mutex<Vec<Vec<(u32, f64, u32)>>>>;

    /// A backend that records the parameter updates every process call is
    /// handed — the only place a queued write becomes observable to the plugin.
    /// One entry per call, so a write that arrives on the wrong block or not at
    /// all is visible rather than merely absent from a total.
    struct ProcessRecordingPlugin {
        processing: Arc<ProcessingGate>,
        processed: ProcessedBlocks,
    }

    impl ProcessRecordingPlugin {
        fn record(&self, updates: &[HostParameterUpdate]) {
            self.processed.lock().expect("the process log").push(
                updates
                    .iter()
                    .map(|update| (update.param_id, update.value, update.sample_offset))
                    .collect(),
            );
        }
    }

    impl AudioPlugin for ProcessRecordingPlugin {
        fn process(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
        ) {
            self.record(&[]);
        }

        fn set_parameter(&mut self, _param_id: u32, _value: f64) {}

        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }

        fn get_state(&self) -> Result<Vec<u8>, PluginError> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _state: &[u8]) -> Result<(), PluginError> {
            Ok(())
        }

        fn get_name(&self) -> &str {
            "process-recording-fixture"
        }
    }

    impl HostedPluginRuntime for ProcessRecordingPlugin {
        fn is_activated(&self) -> bool {
            true
        }

        fn processing_gate(&self) -> Arc<ProcessingGate> {
            Arc::clone(&self.processing)
        }

        fn sync_processing_state(&mut self) {}

        fn set_transport(&mut self, _transport: HostTransport) {}

        fn process_with_parameter_updates(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
            parameter_updates: &[HostParameterUpdate],
        ) {
            self.record(parameter_updates);
        }

        fn process_with_midi_and_parameters(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
            _midi_events: &[HostMidiEvent],
            parameter_updates: &[HostParameterUpdate],
        ) {
            self.record(parameter_updates);
        }

        fn apply_host_parameter_write_to_editor(&mut self, _param_id: u32, _value: f64) {}

        fn poll_latency_change(&mut self) -> Result<Option<u32>, PluginError> {
            Ok(None)
        }

        fn latency_ms(&self) -> f64 {
            0.0
        }

        fn latency_samples(&self) -> u32 {
            0
        }

        fn tail_samples(&self) -> u32 {
            0
        }
    }

    fn process_recording_slot() -> (
        HostedPluginSlot<ProcessRecordingPlugin>,
        Arc<SharedHostedPlugin<ProcessRecordingPlugin>>,
        ProcessedBlocks,
    ) {
        let processed = Arc::new(Mutex::new(Vec::new()));
        let shared = Arc::new(SharedHostedPlugin::new(ProcessRecordingPlugin {
            processing: Arc::new(ProcessingGate::default()),
            processed: Arc::clone(&processed),
        }));
        (
            HostedPluginSlot::new(Arc::clone(&shared)),
            shared,
            processed,
        )
    }

    fn render_one_block(slot: &mut HostedPluginSlot<ProcessRecordingPlugin>) {
        let mut left = [0.0f32; 8];
        let mut right = [0.0f32; 8];
        slot.process_audio(&mut left, &mut right, 8);
    }

    /// The scheduler lands a stamped automation write on the audio thread, so
    /// the write has to reach the plugin without the control path's lock. It
    /// must arrive on the very next process call: queued a block late, the
    /// parameter moves after the audio it was written for.
    #[test]
    fn an_audio_thread_parameter_write_reaches_the_next_process() {
        let (mut slot, _shared, processed) = process_recording_slot();

        assert!(slot.apply_parameter_on_audio_thread(3, 0.75, 0));
        render_one_block(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(3, 0.75, 0)]]
        );
    }

    /// Two producers now write the same queue. A parameter the user is holding
    /// and an automation lane writing the same id at the head of one process
    /// call must reach the plugin as one value — the later of the two — rather
    /// than as two updates the plugin applies in whatever order the slots
    /// happen to sit in.
    #[test]
    fn an_audio_thread_write_coalesces_with_a_control_write_by_sequence() {
        let (mut slot, shared, processed) = process_recording_slot();

        shared
            .enqueue_parameter(3, 0.1)
            .expect("the pending queue has room");
        assert!(slot.apply_parameter_on_audio_thread(3, 0.9, 0));
        render_one_block(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(3, 0.9, 0)]]
        );
    }

    /// The engine's offset travels with the write into the update the runtime
    /// is handed, and a UI edit queued beside the automation stays at the head
    /// of the block. Several automation points for one parameter all reach the
    /// plugin, in sample order, in the one process call they were queued for.
    #[test]
    fn an_audio_thread_write_reaches_the_plugin_at_its_sample_offset() {
        let (mut slot, shared, processed) = process_recording_slot();

        assert!(slot.apply_parameter_on_audio_thread(4, 0.2, 10));
        assert!(slot.apply_parameter_on_audio_thread(4, 0.8, 200));
        shared
            .enqueue_parameter(9, 0.5)
            .expect("the pending queue has room");
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(9, 0.5, 0), (4, 0.2, 10), (4, 0.8, 200)]]
        );
    }

    /// A block the plugin is not handed leaves its writes queued, and the
    /// offsets they carry name samples of a block that has passed. They are
    /// delivered late, at the head of the next block the plugin receives, and
    /// ahead of that block's own points — never sorted in among them as if
    /// they were still on time.
    #[test]
    fn a_write_queued_for_an_unserved_block_lands_at_the_head_of_the_next() {
        let (mut slot, shared, processed) = process_recording_slot();

        assert!(slot.apply_parameter_on_audio_thread(4, 0.2, 200));
        let control = shared
            .try_claim_control()
            .expect("an idle seam can be claimed");
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);
        drop(control);

        assert!(slot.apply_parameter_on_audio_thread(4, 0.8, 100));
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(4, 0.2, 0), (4, 0.8, 100)]],
            "the unserved block's write arrives once, at the head, ahead of the \
             next block's own point"
        );
    }

    /// Every late point of one parameter lands at the same sample, so they are
    /// one write: the queue folds them into the latest on the restamp rather
    /// than holding a slot each until the next served block. Held, the points
    /// of a ramp from consecutive unserved blocks would fill the queue and the
    /// newest writes of that ramp would be the ones refused.
    #[test]
    fn late_points_of_one_parameter_do_not_hold_a_slot_each() {
        let (mut slot, shared, processed) = process_recording_slot();

        for offset in 1..=PENDING_PARAMETER_CAPACITY as u32 {
            assert!(slot.apply_parameter_on_audio_thread(4, f64::from(offset) / 100.0, offset));
        }
        let control = shared
            .try_claim_control()
            .expect("an idle seam can be claimed");
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);
        drop(control);

        assert!(
            slot.apply_parameter_on_audio_thread(4, 0.99, 5),
            "the unserved block's points hold one slot, so the next write has room"
        );
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(4, 0.64, 0), (4, 0.99, 5)]],
            "the late points arrive as their last value at the head, ahead of \
             the next block's own point"
        );
    }

    /// A write another thread holds mid-claim when the unserved block ends is
    /// still late: the audio thread cannot rewrite a slot it does not own, so
    /// lateness is a fact of the write's sequence, not of the slot's offset.
    /// Mutation: restamp only the slots the audio thread manages to claim —
    /// the write drains at offset 200 of the next block.
    #[test]
    fn a_late_write_whose_slot_another_thread_holds_still_lands_at_the_head() {
        let (mut slot, shared, processed) = process_recording_slot();
        let queue = &shared.pending_parameters;

        assert!(slot.apply_parameter_on_audio_thread(4, 0.2, 200));
        // Another thread's claim on the slot, as `coalesce` takes one.
        queue.slots[0]
            .state
            .store(PENDING_PARAMETER_WRITING, Ordering::Release);
        let control = shared
            .try_claim_control()
            .expect("an idle seam can be claimed");
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);
        drop(control);
        queue.slots[0]
            .state
            .store(PENDING_PARAMETER_READY, Ordering::Release);

        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(4, 0.2, 0)]]
        );
    }

    /// A late slot holds the head of the next block, so a write for that
    /// block's own sample 200 is a separate point, and one for the head folds
    /// into the late write by sequence.
    #[test]
    fn a_new_write_never_folds_into_a_late_slot_at_a_different_sample() {
        let (mut slot, shared, processed) = process_recording_slot();

        assert!(slot.apply_parameter_on_audio_thread(4, 0.2, 200));
        let control = shared
            .try_claim_control()
            .expect("an idle seam can be claimed");
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);
        drop(control);
        assert!(slot.apply_parameter_on_audio_thread(4, 0.8, 200));
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);

        let control = shared
            .try_claim_control()
            .expect("an idle seam can be claimed");
        assert!(slot.apply_parameter_on_audio_thread(4, 0.3, 200));
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);
        drop(control);
        assert!(slot.apply_parameter_on_audio_thread(4, 0.9, 0));
        slot.process_audio(&mut [0.0f32; 256], &mut [0.0f32; 256], 256);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(4, 0.2, 0), (4, 0.8, 200)], vec![(4, 0.9, 0)]],
            "a write at 200 keeps its own sample beside the late one, and a \
             newer write at the head replaces a late one"
        );
    }

    /// A slot republished for another parameter between `coalesce`'s unclaimed
    /// pre-check and its claim must keep its own value: the claim re-reads the
    /// parameter. Mutation: drop the re-check — Q's pending value is
    /// overwritten with P's.
    #[test]
    fn a_fold_claim_on_a_slot_holding_another_parameter_leaves_it_alone() {
        let queue = PendingParameterQueue::new();
        assert!(queue.enqueue(8, 0.25, 0).is_ok());

        // `coalesce` for parameter 7 found slot 0 holding 7 and claims it, but
        // the slot now holds 8: the claim itself has to notice.
        let late_through = queue.late_through.load(Ordering::Acquire);
        let folded = PendingParameterQueue::fold_into_ready_slot(
            &queue.slots[0],
            7,
            0,
            0.9f64.to_bits(),
            queue.next_sequence.fetch_add(1, Ordering::Relaxed),
            late_through,
        );

        assert!(!folded);
        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        assert_eq!(queue.drain(&mut drained), 1);
        assert_eq!(
            drained[0],
            PendingParameterUpdate {
                param_id: 8,
                value: 0.25,
                sample_offset: 0,
            }
        );
    }

    /// Both instrument paths owe their late parameter writes the same head
    /// delivery as the effect path, one slot per parameter: a block the
    /// instrument is not handed is followed by a block that receives every
    /// late point of a parameter as one write at sample 0.
    /// Mutation: delete the `mark_pending_late` call of `process_with_events`.
    #[test]
    fn an_unserved_instrument_block_delivers_its_late_parameter_writes_at_the_head() {
        let (mut slot, shared, processed) = process_recording_slot();
        let render = |slot: &mut HostedPluginSlot<ProcessRecordingPlugin>| {
            slot.process_with_events(
                &mut [0.0f32; 256],
                &mut [0.0f32; 256],
                256,
                &[],
                &TransportState::default(),
            );
        };

        for offset in 1..=PENDING_PARAMETER_CAPACITY as u32 {
            assert!(slot.apply_parameter_on_audio_thread(4, f64::from(offset) / 100.0, offset));
        }
        let control = shared
            .try_claim_control()
            .expect("an idle seam can be claimed");
        render(&mut slot);
        drop(control);

        assert!(
            slot.apply_parameter_on_audio_thread(4, 0.99, 5),
            "the unserved block's points hold one slot, so the next write has room"
        );
        render(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(4, 0.64, 0), (4, 0.99, 5)]]
        );
    }

    /// A non-finite value is refused before it can occupy a slot. A `NaN` handed
    /// to a plugin is a parameter the host can never move back, and the queue
    /// would carry it as readily as any other bit pattern.
    #[test]
    fn an_audio_thread_write_refuses_a_non_finite_value() {
        let (mut slot, _shared, processed) = process_recording_slot();

        assert!(!slot.apply_parameter_on_audio_thread(3, f64::NAN, 0));
        render_one_block(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![Vec::new()],
            "the refused write reached neither the queue nor the plugin"
        );
    }

    /// Coalescing keeps the later sequence, not the later arrival. The two
    /// producers take their sequence numbers before they reach a slot, so a
    /// write can arrive after one already issued behind it; folding it in
    /// regardless would hand the plugin a value the automation had already
    /// moved past. The pending write here carries a sequence the queue has not
    /// even issued yet, so the arriving one is unambiguously older.
    #[test]
    fn coalesce_keeps_the_newer_sequence_over_a_later_arrival() {
        let (mut slot, shared, processed) = process_recording_slot();
        let queue = &shared.pending_parameters;

        queue.slots[0].param_id.store(3, Ordering::Relaxed);
        queue.slots[0]
            .value_bits
            .store(0.9f64.to_bits(), Ordering::Relaxed);
        queue.slots[0].sequence.store(
            queue.next_sequence.load(Ordering::Relaxed) + 1,
            Ordering::Relaxed,
        );
        queue.slots[0]
            .state
            .store(PENDING_PARAMETER_READY, Ordering::Release);

        assert!(slot.apply_parameter_on_audio_thread(3, 0.1, 0));
        render_one_block(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(3, 0.9, 0)]],
            "the newer sequence's value survives the write that arrived after it"
        );
    }

    /// `clear` drops accepted writes; it must not drop a slot's *address*. A
    /// slot mid-publish belongs to the producer that won the CAS into it, and
    /// freeing that slot lets the next producer claim it while its owner is
    /// still storing a value — the owner's value then lands under the new
    /// producer's parameter id, and the plugin is moved on a parameter nobody
    /// wrote.
    #[test]
    fn clear_leaves_a_slot_mid_write_to_its_owner() {
        let queue = PendingParameterQueue::new();

        // The audio-thread producer wins slot 0 and stores its id: exactly the
        // state `enqueue` is in between claiming a slot and publishing it.
        let mid_write_sequence = queue.next_sequence.fetch_add(1, Ordering::Relaxed);
        assert!(queue.slots[0]
            .state
            .compare_exchange(
                PENDING_PARAMETER_EMPTY,
                PENDING_PARAMETER_WRITING,
                Ordering::Acquire,
                Ordering::Relaxed,
            )
            .is_ok());
        queue.slots[0].param_id.store(7, Ordering::Relaxed);

        queue.clear();
        assert!(queue.enqueue(9, 0.1, 0).is_ok());

        // The interrupted producer finishes its publish.
        queue.slots[0]
            .value_bits
            .store(0.9f64.to_bits(), Ordering::Relaxed);
        queue.slots[0]
            .sequence
            .store(mid_write_sequence, Ordering::Relaxed);
        queue.slots[0]
            .state
            .store(PENDING_PARAMETER_READY, Ordering::Release);

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        assert_eq!(
            queue.drain(&mut drained),
            2,
            "the mid-write slot and the write made after the clear are both delivered"
        );
        assert_eq!(
            drained[..2],
            [
                PendingParameterUpdate {
                    param_id: 7,
                    value: 0.9,
                    sample_offset: 0,
                },
                PendingParameterUpdate {
                    param_id: 9,
                    value: 0.1,
                    sample_offset: 0,
                },
            ]
        );
    }

    #[test]
    fn pending_parameter_queue_coalesces_and_drains_latest_value() {
        let queue = PendingParameterQueue::new();

        assert!(queue.enqueue(7, 0.25, 0).is_ok());
        assert!(queue.enqueue(7, 0.75, 0).is_ok());

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = queue.drain(&mut drained);

        assert_eq!(count, 1);
        assert_eq!(
            drained[0],
            PendingParameterUpdate {
                param_id: 7,
                value: 0.75,
                sample_offset: 0,
            }
        );
        assert_eq!(queue.drain(&mut drained), 0);
    }

    /// Repeated writes to one parameter must occupy one slot, not one each.
    /// Two producers now write this queue between drains — a held knob and an
    /// automation lane can both be moving the same parameter — and a queue that
    /// spent a slot per write would fill from a single gesture and refuse every
    /// other parameter until the next block drained it.
    #[test]
    fn pending_parameter_queue_folds_repeated_writes_into_one_slot() {
        let queue = PendingParameterQueue::new();

        for index in 0..=PENDING_PARAMETER_CAPACITY {
            assert!(queue.enqueue(7, index as f64, 0).is_ok(), "write {index}");
        }
        assert!(
            queue.enqueue(9, 0.5, 0).is_ok(),
            "the repeated writes left no room for another parameter"
        );

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        assert_eq!(queue.drain(&mut drained), 2);
        assert_eq!(
            drained[..2],
            [
                PendingParameterUpdate {
                    param_id: 7,
                    value: PENDING_PARAMETER_CAPACITY as f64,
                    sample_offset: 0,
                },
                PendingParameterUpdate {
                    param_id: 9,
                    value: 0.5,
                    sample_offset: 0,
                },
            ]
        );
    }

    #[test]
    fn pending_parameter_queue_rejects_new_ids_when_full() {
        let queue = PendingParameterQueue::new();

        for index in 0..PENDING_PARAMETER_CAPACITY {
            assert!(queue.enqueue(index as u32, index as f64, 0).is_ok());
        }

        assert_eq!(queue.enqueue(999, 0.5, 0), Err(()));

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = queue.drain(&mut drained);

        assert_eq!(count, PENDING_PARAMETER_CAPACITY);
        assert_eq!(
            drained[0],
            PendingParameterUpdate {
                param_id: 0,
                value: 0.0,
                sample_offset: 0,
            }
        );
        assert_eq!(
            drained[PENDING_PARAMETER_CAPACITY - 1],
            PendingParameterUpdate {
                param_id: (PENDING_PARAMETER_CAPACITY - 1) as u32,
                value: (PENDING_PARAMETER_CAPACITY - 1) as f64,
                sample_offset: 0,
            }
        );
    }

    #[test]
    fn pending_parameter_queue_keeps_updates_when_drain_output_is_full() {
        let queue = PendingParameterQueue::new();

        assert!(queue.enqueue(1, 0.1, 0).is_ok());
        assert!(queue.enqueue(2, 0.2, 0).is_ok());

        let mut first_drain = [PendingParameterUpdate::default(); 1];
        assert_eq!(queue.drain(&mut first_drain), 1);
        assert_eq!(
            first_drain[0],
            PendingParameterUpdate {
                param_id: 1,
                value: 0.1,
                sample_offset: 0,
            }
        );

        let mut second_drain = [PendingParameterUpdate::default(); 1];
        assert_eq!(queue.drain(&mut second_drain), 1);
        assert_eq!(
            second_drain[0],
            PendingParameterUpdate {
                param_id: 2,
                value: 0.2,
                sample_offset: 0,
            }
        );
    }

    /// Automation hands one parameter several points inside one block, and
    /// each is a point of the ramp rather than a newer value replacing an older
    /// one: every point is drained, in the order of the samples they apply at,
    /// with the other parameter's point between them. Folding them by parameter
    /// id — the per-id coalescing UI writes rely on — would hand the plugin the
    /// ramp's last value at the wrong sample and nothing else.
    #[test]
    fn pending_parameter_queue_keeps_every_point_of_a_ramp_in_sample_order() {
        let queue = PendingParameterQueue::new();

        assert!(queue.enqueue(4, 0.8, 200).is_ok());
        assert!(queue.enqueue(4, 0.2, 10).is_ok());
        assert!(queue.enqueue(7, 0.5, 100).is_ok());
        assert!(queue.enqueue(4, 0.6, 10).is_ok());

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = queue.drain(&mut drained);

        assert_eq!(
            drained[..count],
            [
                PendingParameterUpdate {
                    param_id: 4,
                    value: 0.6,
                    sample_offset: 10,
                },
                PendingParameterUpdate {
                    param_id: 7,
                    value: 0.5,
                    sample_offset: 100,
                },
                PendingParameterUpdate {
                    param_id: 4,
                    value: 0.8,
                    sample_offset: 200,
                },
            ],
            "distinct samples stay distinct points, in sample order; two writes at \
             one sample still fold to the later"
        );
    }

    #[test]
    fn host_transport_carries_every_field_a_tempo_synced_plugin_reads() {
        let engine_transport = TransportState {
            tempo: 174.0,
            time_sig_num: 5,
            time_sig_denom: 4,
            is_playing: true,
            song_pos_beats: 12.25,
            song_pos_seconds: 4.5,
        };

        let plugin_transport = host_transport_from(&engine_transport);

        assert_eq!(
            plugin_transport,
            HostTransport {
                tempo: 174.0,
                time_sig_num: 5,
                time_sig_denom: 4,
                is_playing: true,
                song_pos_beats: 12.25,
                song_pos_seconds: 4.5,
            }
        );
    }

    #[test]
    fn host_transport_keeps_a_parked_playhead_parked() {
        let engine_transport = TransportState {
            is_playing: false,
            song_pos_beats: 8.0,
            ..TransportState::default()
        };

        let plugin_transport = host_transport_from(&engine_transport);

        assert!(
            !plugin_transport.is_playing,
            "a stopped transport must not read as rolling to the plugin"
        );
        assert_eq!(plugin_transport.song_pos_beats, 8.0);
    }

    #[test]
    fn beginning_an_unload_asks_the_audio_thread_to_stop_processing() {
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared = SharedHostedPlugin::new(wrapper);
        let gate = shared.processing_gate();
        gate.request_start();

        shared.begin_unload();

        assert!(
            !gate.wants_processing(),
            "an unload must withdraw the intent to process before deactivate runs"
        );
    }

    #[test]
    fn an_unloading_instance_is_visited_for_the_stop_but_never_processed() {
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared = SharedHostedPlugin::new(wrapper);
        shared.processing_gate().request_start();

        assert!(
            shared.with_process(|_, _| ()).is_some(),
            "an active instance processes normally"
        );

        shared.begin_unload();

        assert!(
            shared.with_process(|_, _| ()).is_none(),
            "an unloading instance is never handed a block to process"
        );
        assert!(
            shared.processing_gate().has_stopped(),
            "the audio-thread visit still leaves the CLAP processing state"
        );
    }

    #[test]
    fn pending_parameter_queue_drains_latest_duplicate_param_by_sequence() {
        let queue = PendingParameterQueue::new();
        queue.slots[0].param_id.store(7, Ordering::Relaxed);
        queue.slots[0]
            .value_bits
            .store(0.9f64.to_bits(), Ordering::Relaxed);
        queue.slots[0].sequence.store(2, Ordering::Relaxed);
        queue.slots[0]
            .state
            .store(PENDING_PARAMETER_READY, Ordering::Release);
        queue.slots[1].param_id.store(7, Ordering::Relaxed);
        queue.slots[1]
            .value_bits
            .store(0.1f64.to_bits(), Ordering::Relaxed);
        queue.slots[1].sequence.store(1, Ordering::Relaxed);
        queue.slots[1]
            .state
            .store(PENDING_PARAMETER_READY, Ordering::Release);

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = queue.drain(&mut drained);

        assert_eq!(count, 1);
        assert_eq!(
            drained[0],
            PendingParameterUpdate {
                param_id: 7,
                value: 0.9,
                sample_offset: 0,
            }
        );
    }

    #[test]
    fn pending_parameter_queue_drains_unique_params_in_sequence_order() {
        let queue = PendingParameterQueue::new();
        queue.slots[0].param_id.store(1, Ordering::Relaxed);
        queue.slots[0]
            .value_bits
            .store(0.1f64.to_bits(), Ordering::Relaxed);
        queue.slots[0].sequence.store(3, Ordering::Relaxed);
        queue.slots[0]
            .state
            .store(PENDING_PARAMETER_READY, Ordering::Release);
        queue.slots[1].param_id.store(2, Ordering::Relaxed);
        queue.slots[1]
            .value_bits
            .store(0.2f64.to_bits(), Ordering::Relaxed);
        queue.slots[1].sequence.store(2, Ordering::Relaxed);
        queue.slots[1]
            .state
            .store(PENDING_PARAMETER_READY, Ordering::Release);

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = queue.drain(&mut drained);

        assert_eq!(count, 2);
        assert_eq!(
            drained[0],
            PendingParameterUpdate {
                param_id: 2,
                value: 0.2,
                sample_offset: 0,
            }
        );
        assert_eq!(
            drained[1],
            PendingParameterUpdate {
                param_id: 1,
                value: 0.1,
                sample_offset: 0,
            }
        );
    }

    #[test]
    fn pending_parameter_queue_clear_invalidates_accepted_updates() {
        let queue = PendingParameterQueue::new();

        assert!(queue.enqueue(7, 0.75, 0).is_ok());
        assert!(queue.has_pending());
        queue.clear();

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        assert_eq!(queue.drain(&mut drained), 0);
        assert!(!queue.has_pending());
    }

    #[test]
    fn process_drain_reads_updates_enqueued_for_runtime_delivery() {
        let queue = PendingParameterQueue::new();
        assert!(queue.enqueue(11, 0.42, 0).is_ok());

        let mut scratch = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = drain_pending_parameters_for_process(&queue, &mut scratch);

        assert_eq!(count, 1);
        assert_eq!(
            scratch[0],
            PendingParameterUpdate {
                param_id: 11,
                value: 0.42,
                sample_offset: 0,
            }
        );
        assert_eq!(
            drain_pending_parameters_for_process(&queue, &mut scratch),
            0
        );
    }

    #[test]
    fn control_access_hands_the_wrapper_over_while_the_seam_is_free() {
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared = SharedHostedPlugin::new(wrapper);

        let name = shared
            .with_control(Duration::from_millis(50), |plugin| {
                Ok::<_, String>(plugin.get_name().to_string())
            })
            .expect("an idle seam must hand the wrapper straight to the operation");

        assert_eq!(name, "fixture");
        assert_eq!(
            shared.access_state.load(Ordering::Acquire),
            PLUGIN_ACCESS_IDLE,
            "the seam must be released once the operation returns"
        );
    }

    #[test]
    fn control_access_times_out_while_the_audio_thread_holds_the_seam() {
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared = SharedHostedPlugin::new(wrapper);
        shared
            .access_state
            .store(PLUGIN_ACCESS_PROCESSING, Ordering::Release);

        let started = Instant::now();
        let outcome = shared.with_control(Duration::from_millis(60), |_| Ok::<_, String>(()));

        assert_eq!(
            outcome,
            Err(PluginControlError::Refused(
                PluginControlRefusal::TimedOut {
                    plugin: "fixture".to_string()
                }
            ))
        );
        assert_eq!(
            outcome.unwrap_err().to_string(),
            "Timed out waiting for plugin control access: fixture"
        );
        assert!(
            started.elapsed() >= Duration::from_millis(60),
            "the waiter must poll to its deadline before giving up, gave up after {:?}",
            started.elapsed()
        );
        assert_eq!(
            shared.access_state.load(Ordering::Acquire),
            PLUGIN_ACCESS_PROCESSING,
            "a timed-out waiter must never take the seam from the audio thread"
        );
    }

    /// The control seam is a blocking wait and every public entry point is
    /// reached from an async command body. On a multi-threaded runtime the wait
    /// must release its worker: parking it parks every other command queued
    /// behind it for the whole control timeout — up to 2 s of unrelated IPC,
    /// including the per-quantum worklet audio relay.
    #[test]
    fn a_contended_control_wait_does_not_park_unrelated_work_on_the_runtime() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .build()
            .expect("multi-threaded test runtime");

        runtime.block_on(async {
            let wrapper =
                ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
            let shared = Arc::new(SharedHostedPlugin::new(wrapper));
            shared
                .access_state
                .store(PLUGIN_ACCESS_PROCESSING, Ordering::Release);

            let waiting_plugin = Arc::clone(&shared);
            let waiter = tokio::spawn(async move {
                waiting_plugin.with_control(Duration::from_secs(2), |_| Ok::<_, String>(()))
            });

            // The waiter holds the non-RT gate for as long as it is spinning, so
            // a refused try_lock is the signal that it has reached the wait on
            // the runtime's only worker. Bounded: an unreached gate must name
            // the waiter instead of dying by harness timeout.
            let probe_deadline = Instant::now() + Duration::from_secs(5);
            while shared.non_rt_control_lock.try_lock().is_ok() {
                if Instant::now() >= probe_deadline {
                    panic!(
                        "the contended control waiter never reached its wait on the runtime's only worker"
                    );
                }
                thread::sleep(Duration::from_millis(2));
            }

            let progressed = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let unrelated_flag = Arc::clone(&progressed);
            let started = Instant::now();
            tokio::spawn(async move {
                unrelated_flag.store(true, Ordering::Release);
            })
            .await
            .expect("unrelated task must not be cancelled");

            assert!(progressed.load(Ordering::Acquire));
            assert!(
                started.elapsed() < Duration::from_millis(500),
                "unrelated runtime work waited {:?} behind a contended plugin control wait",
                started.elapsed()
            );

            shared
                .access_state
                .store(PLUGIN_ACCESS_IDLE, Ordering::Release);
            let _ = waiter.await;
        });
    }

    /// The companion to the contended test above: the *uncontended* claim is
    /// the ordinary case, and `operation` is third-party CLAP code of unbounded
    /// duration (`set_state` on a large preset, `open_gui`). The whole control
    /// body must be handed over, not just the contended wait — otherwise an
    /// ordinary uncontended call still parks the worker for the entire plugin
    /// call.
    #[test]
    fn an_uncontended_control_operation_does_not_park_unrelated_work_on_the_runtime() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .build()
            .expect("multi-threaded test runtime");

        runtime.block_on(async {
            let wrapper =
                ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
            let shared = Arc::new(SharedHostedPlugin::new(wrapper));

            let operating_plugin = Arc::clone(&shared);
            let operation = tokio::spawn(async move {
                operating_plugin.with_control(Duration::from_secs(2), |_| {
                    thread::sleep(Duration::from_millis(600));
                    Ok::<_, String>(())
                })
            });

            // The operation holds the non-RT gate while its body blocks, so a
            // refused try_lock is the signal that the body is running on the
            // runtime's only worker. Bounded: an unreached gate must name the
            // operation instead of dying by harness timeout.
            let probe_deadline = Instant::now() + Duration::from_secs(5);
            while shared.non_rt_control_lock.try_lock().is_ok() {
                if Instant::now() >= probe_deadline {
                    panic!(
                        "the uncontended control operation never reached its body on the runtime's only worker"
                    );
                }
                thread::sleep(Duration::from_millis(2));
            }

            let progressed = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let unrelated_flag = Arc::clone(&progressed);
            let started = Instant::now();
            tokio::spawn(async move {
                unrelated_flag.store(true, Ordering::Release);
            })
            .await
            .expect("unrelated task must not be cancelled");

            assert!(progressed.load(Ordering::Acquire));
            assert!(
                started.elapsed() < Duration::from_millis(200),
                "unrelated runtime work waited {:?} behind an uncontended plugin control operation",
                started.elapsed()
            );

            operation
                .await
                .expect("control operation task must not be cancelled")
                .expect("an uncontended control operation must succeed");
        });
    }

    /// Hold the instance's control gate with an operation that does not return
    /// until the returned sender fires — the way a vendor call that hangs holds
    /// it — and return once the gate is provably taken.
    fn hold_control_gate_until_released(
        shared: &Arc<SharedHostedPlugin<ClapWrapper>>,
    ) -> (
        std::sync::mpsc::Sender<()>,
        thread::JoinHandle<Result<(), PluginControlRefusal>>,
    ) {
        let (release, released) = std::sync::mpsc::channel::<()>();
        let holding = Arc::clone(shared);
        let holder = thread::spawn(move || {
            holding
                .with_control(Duration::from_secs(2), |_| {
                    let _ = released.recv();
                    Ok(())
                })
                .map_err(PluginControlError::into_refusal)
        });
        let probe_deadline = Instant::now() + Duration::from_secs(5);
        while shared.non_rt_control_lock.try_lock().is_ok() {
            if Instant::now() >= probe_deadline {
                panic!("the holding operation never took the control gate");
            }
            thread::sleep(Duration::from_millis(2));
        }
        (release, holder)
    }

    /// Run `call` on its own thread and wait for its answer under a watchdog,
    /// so a call that never returns fails the test by name instead of hanging
    /// the harness.
    fn answer_within<ResultValue: Send + 'static>(
        watchdog: Duration,
        call: impl FnOnce() -> ResultValue + Send + 'static,
    ) -> Option<(ResultValue, Duration)> {
        let (answer, answered) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let started = Instant::now();
            let outcome = call();
            let _ = answer.send((outcome, started.elapsed()));
        });
        answered.recv_timeout(watchdog).ok()
    }

    /// The defect this guards: the gate wait fell back to an unbounded `lock()`,
    /// so one vendor call that never returned held every later control call on
    /// the instance — unload included — forever.
    #[test]
    fn a_control_call_behind_a_hung_holder_gives_up_and_the_instance_fails_fast_after() {
        let gate_deadline = Duration::from_millis(100);
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared =
            Arc::new(SharedHostedPlugin::new(wrapper).with_control_gate_deadline(gate_deadline));
        assert!(
            shared.with_process(|_, _| ()).is_some(),
            "the fixture must process while it is responsive"
        );
        let (release, holder) = hold_control_gate_until_released(&shared);

        let unloading = Arc::clone(&shared);
        let unload = answer_within(Duration::from_secs(5), move || {
            unloading
                .with_unload_control(Duration::from_secs(2), |_| Ok(()))
                .map_err(PluginControlError::into_refusal)
        });
        let Some((unload_outcome, unload_waited)) = unload else {
            let _ = release.send(());
            panic!("an unload behind a hung control call never answered");
        };

        let controlling = Arc::clone(&shared);
        let later = answer_within(Duration::from_secs(5), move || {
            (
                controlling
                    .with_control(Duration::from_secs(2), |_| Ok(()))
                    .map_err(PluginControlError::into_refusal),
                controlling
                    .try_with_control(Duration::from_secs(2), |_| Ok(()))
                    .map_err(PluginControlError::into_refusal),
            )
        });
        let still_hung_processable = shared.lifecycle.allows_process();
        let still_hung_asked_to_process = shared.processing_gate().wants_processing();
        let _ = release.send(());
        let Some(((later_control, later_try_control), later_waited)) = later else {
            panic!("a control call on an instance already found unresponsive never answered");
        };

        let unload_error =
            unload_outcome.expect_err("the unload must give up behind a hung holder");
        assert_eq!(
            unload_error,
            PluginControlRefusal::Unresponsive {
                plugin: "fixture".to_string()
            },
            "the unload must answer the unresponsive refusal naming the plugin"
        );
        let unload_text = unload_error.to_string();
        assert!(
            unload_text.starts_with("plugin-unresponsive:") && unload_text.contains("'fixture'"),
            "the unresponsive refusal must carry the wire marker and name the plugin, answered {unload_text:?}"
        );
        assert!(
            unload_waited >= gate_deadline,
            "the unload must wait out the gate deadline before giving up, gave up after {unload_waited:?}"
        );
        assert_eq!(later_control, Err(unload_error.clone()));
        assert_eq!(later_try_control, Err(unload_error));
        assert!(
            later_waited < gate_deadline,
            "an instance already found unresponsive must refuse without waiting again, waited {later_waited:?}"
        );
        assert_eq!(
            holder.join().expect("the holding thread must not panic"),
            Ok(()),
            "the hung call itself is left to finish whenever it does"
        );
        assert!(
            !still_hung_processable && !still_hung_asked_to_process,
            "an instance whose call is still hung must be neither processable nor asked to process"
        );
    }

    /// A call that outlived the gate deadline but did return was slow, not
    /// hung: once it lets go, the next control call runs, and the instance
    /// processes again.
    #[test]
    fn an_instance_found_unresponsive_recovers_once_its_slow_call_returns() {
        let gate_deadline = Duration::from_millis(100);
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared =
            Arc::new(SharedHostedPlugin::new(wrapper).with_control_gate_deadline(gate_deadline));
        let (release, holder) = hold_control_gate_until_released(&shared);

        let waiting = Arc::clone(&shared);
        let gave_up = answer_within(Duration::from_secs(5), move || {
            waiting
                .with_unload_control(Duration::from_secs(2), |_| Ok(()))
                .map_err(PluginControlError::into_refusal)
        });
        let Some((gave_up, _)) = gave_up else {
            let _ = release.send(());
            panic!("a waiter behind a slow control call never answered");
        };
        assert_eq!(
            gave_up,
            Err(PluginControlRefusal::Unresponsive {
                plugin: "fixture".to_string()
            }),
            "the waiter must give up at the deadline while the slow call holds the gate"
        );
        assert!(shared.lifecycle.is_unresponsive());
        let _ = release.send(());
        assert_eq!(
            holder.join().expect("the holding thread must not panic"),
            Ok(())
        );

        let recovering = Arc::clone(&shared);
        let recovered = answer_within(Duration::from_secs(5), move || {
            recovering
                .with_control(Duration::from_secs(2), |_| Ok(()))
                .map_err(PluginControlError::into_refusal)
        });
        let Some((recovered, _)) = recovered else {
            panic!("a control call on a free gate never answered");
        };

        assert_eq!(
            recovered,
            Ok(()),
            "the first control call to find the gate free must run"
        );
        assert!(
            !shared.lifecycle.is_unresponsive(),
            "taking the free gate must withdraw the unresponsive verdict"
        );
        assert!(
            shared.processing_gate().wants_processing(),
            "a recovered active instance must be asked to process again"
        );
        assert!(
            shared.with_process(|_, _| ()).is_some(),
            "a recovered instance must be processed again"
        );
    }

    /// A plugin found unresponsive that nobody calls again — no editor open, no
    /// parameter write, no unload — must not stay silent once its slow call
    /// returns: letting go of the gate is itself the proof it answers again.
    #[test]
    fn an_instance_found_unresponsive_processes_again_when_its_slow_call_lets_go() {
        let gate_deadline = Duration::from_millis(100);
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared =
            Arc::new(SharedHostedPlugin::new(wrapper).with_control_gate_deadline(gate_deadline));
        let (release, holder) = hold_control_gate_until_released(&shared);

        let waiting = Arc::clone(&shared);
        let gave_up = answer_within(Duration::from_secs(5), move || {
            waiting
                .with_control(Duration::from_secs(2), |_| Ok(()))
                .map_err(PluginControlError::into_refusal)
        });
        let Some((gave_up, _)) = gave_up else {
            let _ = release.send(());
            panic!("a waiter behind a slow control call never answered");
        };
        assert_eq!(
            gave_up,
            Err(PluginControlRefusal::Unresponsive {
                plugin: "fixture".to_string()
            }),
            "the waiter must give up at the deadline while the slow call holds the gate"
        );
        assert!(shared.lifecycle.is_unresponsive());

        let _ = release.send(());
        assert_eq!(
            holder.join().expect("the holding thread must not panic"),
            Ok(())
        );

        assert!(
            !shared.lifecycle.is_unresponsive(),
            "the slow call letting go of the gate must withdraw the verdict"
        );
        assert!(
            shared.processing_gate().wants_processing(),
            "a recovered active instance must be asked to process again"
        );
        assert!(
            shared.with_process(|_, _| ()).is_some(),
            "a recovered instance must be processed with no further control call"
        );
    }

    /// When the other side of a race with a recovery runs: before the
    /// recovery, at one of its steps, or after it.
    #[derive(Clone, Copy, Debug)]
    enum RacePoint {
        Before,
        At(RecoveryStep),
        After,
    }

    /// Run the real recovery with `other_side` at `point`, and fail if the
    /// point was never reached.
    fn recover_with_other_side_at(
        shared: &SharedHostedPlugin<ClapWrapper>,
        point: RacePoint,
        other_side: fn(&SharedHostedPlugin<ClapWrapper>),
    ) {
        match point {
            RacePoint::Before => {
                other_side(shared);
                shared.recover_if_unresponsive();
            }
            RacePoint::At(step) => {
                shared.interleave_with_recovery(step, other_side);
                shared.recover_if_unresponsive();
                assert!(
                    !shared.recovery_interleaving_pending(),
                    "the recovery never reached {step:?}"
                );
            }
            RacePoint::After => {
                shared.recover_if_unresponsive();
                other_side(shared);
            }
        }
    }

    /// A recovery and a cancelled unload can race on an instance that is both
    /// unresponsive and unloading. Whether the unload is cancelled before the
    /// recovery, between its withdrawing the verdict and its restart, or after
    /// it, the instance must end up asked to process and processable.
    #[test]
    fn a_recovery_racing_a_cancelled_unload_never_loses_the_restart() {
        let points = [
            RacePoint::Before,
            RacePoint::At(RecoveryStep::VerdictWithdrawn),
            RacePoint::After,
        ];
        for point in points {
            let wrapper =
                ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
            let shared = SharedHostedPlugin::new(wrapper);
            shared.begin_unload();
            shared.mark_unresponsive();
            recover_with_other_side_at(&shared, point, |shared| shared.cancel_unload());
            assert!(
                shared.processing_gate().wants_processing() && shared.lifecycle.allows_process(),
                "the restart was lost with the unload cancelled at {point:?}"
            );
        }
    }

    /// A recovery and an unload can race on an active, unresponsive instance.
    /// Wherever the unload lands relative to the recovery, the unloading
    /// instance must end up not asked to process.
    #[test]
    fn a_recovery_racing_an_unload_never_leaves_the_unloading_instance_asked_to_process() {
        let points = [
            RacePoint::Before,
            RacePoint::At(RecoveryStep::VerdictWithdrawn),
            RacePoint::At(RecoveryStep::LifecycleReadActive),
            RacePoint::At(RecoveryStep::StartRequested),
            RacePoint::After,
        ];
        for point in points {
            let wrapper =
                ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
            let shared = SharedHostedPlugin::new(wrapper);
            shared.mark_unresponsive();
            recover_with_other_side_at(&shared, point, |shared| shared.begin_unload());
            assert!(
                !shared.lifecycle.is_active(),
                "the unload at {point:?} must leave the instance unloading"
            );
            assert!(
                !shared.processing_gate().wants_processing(),
                "the unloading instance was left asked to process with the unload at {point:?}"
            );
        }
    }

    /// Ordinary contention is not a hang: a holder that lets go inside the
    /// deadline hands the gate to the waiter, which runs and leaves the
    /// instance usable.
    #[test]
    fn a_control_call_behind_a_holder_that_finishes_in_time_takes_the_gate() {
        let wrapper = ClapWrapper::new_engine_owned_command_fixture("fixture", Vec::new(), false);
        let shared = Arc::new(
            SharedHostedPlugin::new(wrapper).with_control_gate_deadline(Duration::from_secs(2)),
        );
        let (release, holder) = hold_control_gate_until_released(&shared);

        let waiting = Arc::clone(&shared);
        let releasing = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            let _ = release.send(());
        });
        let waited = answer_within(Duration::from_secs(5), move || {
            waiting
                .with_unload_control(Duration::from_secs(2), |_| Ok(()))
                .map_err(PluginControlError::into_refusal)
        });

        releasing
            .join()
            .expect("the releasing thread must not panic");
        let _ = holder.join();
        let (outcome, _) = waited.expect("the waiter must answer once the holder lets go");
        assert_eq!(outcome, Ok(()));
        assert_eq!(
            shared
                .with_control(Duration::from_secs(2), |_| Ok(()))
                .map_err(PluginControlError::into_refusal),
            Ok(()),
            "contention resolved inside the deadline must not mark the instance unresponsive"
        );
    }

    #[test]
    fn plugin_lifecycle_rejects_public_control_after_unload_begins() {
        let lifecycle = PluginRuntimeLifecycle::new();

        assert!(lifecycle.ensure_public_control_allowed("fixture").is_ok());

        lifecycle.begin_unload();

        assert_eq!(
            lifecycle.ensure_public_control_allowed("fixture"),
            Err(PluginControlRefusal::Unloading {
                plugin: "fixture".to_string()
            })
        );
        assert_eq!(
            lifecycle
                .ensure_public_control_allowed("fixture")
                .unwrap_err()
                .to_string(),
            "Engine-owned plugin instance 'fixture' is unloading"
        );
        assert!(!lifecycle.allows_process());
    }

    #[test]
    fn control_refusals_keep_their_historical_text() {
        let plugin = || "fixture".to_string();
        let cases = [
            (
                PluginControlRefusal::Retired { plugin: plugin() },
                "Engine-owned plugin instance 'fixture' has been retired",
            ),
            (
                PluginControlRefusal::InvalidLifecycle {
                    plugin: plugin(),
                    state: 7,
                },
                "Engine-owned plugin instance 'fixture' is in invalid lifecycle state 7",
            ),
            (
                PluginControlRefusal::GateBusy { plugin: plugin() },
                "Plugin non-RT control path for 'fixture' is busy",
            ),
            (
                PluginControlRefusal::Unresponsive { plugin: plugin() },
                "plugin-unresponsive: Plugin 'fixture' stopped responding inside a call and is no longer processed or controlled",
            ),
        ];
        for (refusal, text) in cases {
            assert_eq!(refusal.to_string(), text);
        }
        assert_eq!(
            ParameterWriteError::NotActivated { plugin: plugin() }.to_string(),
            "CLAP plugin 'fixture' is not activated; parameter update rejected"
        );
        assert_eq!(
            ParameterWriteError::NonFinite {
                plugin: plugin(),
                value: f64::NAN
            }
            .to_string(),
            "Invalid parameter value for plugin 'fixture': NaN"
        );
        assert_eq!(
            ParameterWriteError::QueueFull { plugin: plugin() }.to_string(),
            "Pending parameter queue full for plugin 'fixture'"
        );
        assert_eq!(
            PluginStateError::PendingWrites { plugin: plugin() }.to_string(),
            "Plugin 'fixture' has pending parameter writes awaiting audio processing; retry state save after the process path drains them"
        );
        assert_eq!(
            PadAuditionError::IdsExhausted.to_string(),
            "Crumbs pad audition ids exhausted"
        );
        assert_eq!(
            PadAuditionError::QueueFull(CrumbsCommandQueueFull).to_string(),
            "Command queue full"
        );
    }

    #[test]
    fn cancelled_unload_restores_public_control_and_processing_eligibility() {
        let lifecycle = PluginRuntimeLifecycle::new();
        lifecycle.begin_unload();

        lifecycle.cancel_unload();

        assert!(lifecycle.ensure_public_control_allowed("fixture").is_ok());
        assert!(lifecycle.allows_process());
    }

    /// Build a slot the way create_crumbs wires it in production: handoff
    /// enabled, commit/recycle rings attached. Returns the slot plus the
    /// command-side ring endpoints a test can drive.
    fn crumbs_slot_with_rings() -> (
        CrumbsPluginSlot,
        CrumbsCommandSender,
        rtrb::Consumer<PendingRecordingCommit>,
        rtrb::Producer<RecordBufferPair>,
    ) {
        let (tx, rx) = rtrb::RingBuffer::new(8);
        let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
        let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
        let metering = Arc::new(CrumbsMetering::default());
        let mut engine = CrumbsEngine::with_metering(48_000.0, Arc::clone(&metering));
        engine.enable_commit_handoff();
        let (retired_tx, _retired_rx) = rtrb::RingBuffer::new(2);
        let slot = CrumbsPluginSlot::new(
            engine,
            rx,
            commit_tx,
            recycle_rx,
            retired_tx,
            Arc::new(CrumbsSlotLifetime::default()),
            metering,
        );
        (slot, CrumbsCommandSender::new(tx), commit_rx, recycle_tx)
    }

    /// One chunk of the engine's input tap, as the render callback hands it
    /// to the bus.
    fn capture_block<'a>(left: &'a [f32], right: &'a [f32], served: bool) -> CaptureInputBlock<'a> {
        CaptureInputBlock {
            left,
            right,
            frames: left.len(),
            served,
            latency_frames: 0,
            position_frames: 0,
        }
    }

    /// Run one master-chain block over silent output scratch — the pass the
    /// scheduler makes on this slot every callback, whether or not the tap
    /// delivered anything.
    fn render_block(slot: &mut CrumbsPluginSlot, frames: usize) {
        let mut left = vec![0.0f32; frames];
        let mut right = vec![0.0f32; frames];
        slot.process_with_events(
            &mut left,
            &mut right,
            frames,
            &[],
            &TransportState::default(),
        );
    }

    /// Wiring-boundary regression (ledger #508 row 24): what an armed take
    /// holds is the capture block the slot was fed, channel for channel.
    /// Pre-fix the input was never delivered at all, so an armed recording
    /// captured silence end-to-end.
    #[test]
    fn first_served_block_acknowledges_each_take_and_preserves_its_transient() {
        crate::commands::crumbs::tests::first_served_native_take_probe();
    }

    #[test]
    fn joining_take_waits_through_refill_despite_period_first_serve() {
        crate::commands::crumbs::tests::joining_native_take_probe();
    }

    #[cfg(debug_assertions)]
    #[test]
    fn take_callback_transitions_never_allocate_or_free() {
        crate::commands::crumbs::tests::callback_lifecycle_probe();
        let (mut slot, mut tx, _commits, _recycle) = crumbs_slot_with_rings();
        for _ in 0..2 {
            assert!(slot
                .commit_tx
                .push(PendingRecordingCommit {
                    left: vec![0.0; 8],
                    right: vec![0.0; 8],
                    sample_rate: 48_000,
                })
                .is_ok());
        }
        tx.push(CrumbsCommand::SetMode(CrumbsMode::Record)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.1,
            target_pad: 0,
            max_duration_secs: 1.0,
        })
        .unwrap();
        let audio = [0.5; 128];
        assert_no_alloc::assert_no_alloc(|| {
            slot.process_capture_input(capture_block(&audio, &audio, true))
        });
        tx.push(CrumbsCommand::StopRecording).unwrap();
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        assert_no_alloc::assert_no_alloc(|| slot.process_audio(&mut left, &mut right, 128));
        assert!(
            slot.pending_commit.is_some(),
            "full commit ring retains PCM on the slot"
        );
    }

    #[test]
    fn crumbs_slot_records_the_capture_block_it_is_fed() {
        use daw_dsp::crumbs::types::{CrumbsMode, RecordState};

        let (mut slot, mut tx, mut commit_rx, _recycle_tx) = crumbs_slot_with_rings();

        tx.push(CrumbsCommand::SetMode(CrumbsMode::Record)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        })
        .unwrap();
        render_block(&mut slot, 128);
        assert_eq!(
            slot.engine.record_state(),
            RecordState::Armed,
            "the master-chain pass must drain the arm command"
        );

        // Distinct channels, so a swapped feed cannot pass.
        let frames = 256;
        let left = vec![0.5f32; frames];
        let right = vec![0.25f32; frames];
        slot.process_capture_input(capture_block(&left, &right, true));

        assert_eq!(
            slot.engine.record_state(),
            RecordState::Recording,
            "an over-threshold capture block must start the take"
        );

        tx.push(CrumbsCommand::StopRecording).unwrap();
        render_block(&mut slot, 128);

        assert_eq!(slot.engine.record_state(), RecordState::Idle);
        // Handoff mode: the take leaves the engine over the commit ring; the
        // engine pool is updated later by the command side (off-RT).
        assert_eq!(slot.engine.sample_pool().count(), 0);
        let commit = commit_rx
            .pop()
            .expect("stopping an armed take must hand a commit to the ring");
        assert_eq!(commit.left.len(), frames);
        assert_eq!(commit.right.len(), frames);
        assert!(
            commit.left.iter().all(|&s| (s - 0.5).abs() < 1.0e-6),
            "the take's left channel must hold the captured left channel"
        );
        assert!(
            commit.right.iter().all(|&s| (s - 0.25).abs() < 1.0e-6),
            "the take's right channel must hold the captured right channel"
        );
        assert_eq!(commit.sample_rate, 48_000);
    }

    /// PR #564 review (blocking), on the tap driver: the render pass runs on
    /// output scratch that carries no input, and the scheduler runs it on
    /// this slot every block. It must add nothing to a take — a take spanning
    /// two capture blocks holds those two blocks and no third thing.
    #[test]
    fn crumbs_take_holds_only_capture_blocks_across_render_passes() {
        use daw_dsp::crumbs::types::{CrumbsMode, RecordState};

        let (mut slot, mut tx, mut commit_rx, _recycle_tx) = crumbs_slot_with_rings();

        tx.push(CrumbsCommand::SetMode(CrumbsMode::Record)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        })
        .unwrap();
        render_block(&mut slot, 128);

        let left = vec![0.5f32; 128];
        let right = vec![0.5f32; 128];
        slot.process_capture_input(capture_block(&left, &right, true));
        assert_eq!(slot.engine.record_state(), RecordState::Recording);

        // A whole device buffer of master-chain passes between the two
        // capture blocks, in the callback's own chunk size.
        for _ in 0..32 {
            render_block(&mut slot, 128);
        }

        slot.process_capture_input(capture_block(&left, &right, true));

        tx.push(CrumbsCommand::StopRecording).unwrap();
        render_block(&mut slot, 128);

        let commit = commit_rx
            .pop()
            .expect("stopping an armed take must hand a commit to the ring");
        assert_eq!(
            commit.left.len(),
            256,
            "the take must be the two captured blocks alone (got {} frames)",
            commit.left.len()
        );
        assert!(
            commit.left.iter().all(|&s| (s - 0.5).abs() < 1.0e-6),
            "render-pass scratch must not reach the take"
        );
    }

    /// A capture dropout is a hole in the recorded time, not a cut in it. An
    /// unserved block carries zeros and is recorded all the same, so the
    /// frames after it stay where the musician played them instead of being
    /// pulled earlier by the length of the gap.
    #[test]
    fn crumbs_take_holds_an_unserved_capture_block_as_its_own_silence() {
        use daw_dsp::crumbs::types::CrumbsMode;

        let (mut slot, mut tx, mut commit_rx, _recycle_tx) = crumbs_slot_with_rings();

        tx.push(CrumbsCommand::SetMode(CrumbsMode::Record)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        })
        .unwrap();
        render_block(&mut slot, 128);

        const DROPOUT_FRAMES: usize = 64;
        let played = vec![0.5f32; 128];
        let dropout = vec![0.0f32; DROPOUT_FRAMES];

        slot.process_capture_input(capture_block(&played, &played, true));
        slot.process_capture_input(capture_block(&dropout, &dropout, false));
        slot.process_capture_input(capture_block(&played, &played, true));

        tx.push(CrumbsCommand::StopRecording).unwrap();
        render_block(&mut slot, 128);

        let commit = commit_rx
            .pop()
            .expect("stopping an armed take must hand a commit to the ring");
        assert_eq!(
            commit.left.len(),
            128 + DROPOUT_FRAMES + 128,
            "an unserved block must occupy its own duration in the take"
        );
        assert!(
            commit.left[128..128 + DROPOUT_FRAMES]
                .iter()
                .all(|&s| s == 0.0),
            "the dropout must read as silence where it happened"
        );
        assert!(
            commit.left[128 + DROPOUT_FRAMES..]
                .iter()
                .all(|&s| (s - 0.5).abs() < 1.0e-6),
            "audio after the dropout must resume after it, not in place of it"
        );
    }

    /// PR #579 review (blocking): a re-arm whose ArmRecording command is
    /// processed in the same block that adopts the just-recycled buffers
    /// must find capacity. Pre-fix the adoption ran AFTER the command
    /// drain, so the arm was silently refused (record_state stayed Idle —
    /// silent take loss on fast stop→record).
    #[test]
    fn crumbs_rearm_right_after_drained_commit_finds_recycled_capacity() {
        use daw_dsp::crumbs::types::{CrumbsMode, RecordState};

        let (mut slot, mut tx, mut commit_rx, mut recycle_tx) = crumbs_slot_with_rings();

        tx.push(CrumbsCommand::SetMode(CrumbsMode::Record)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        })
        .unwrap();

        // Take one take and stop it.
        render_block(&mut slot, 128);
        let left = vec![0.5f32; 128];
        let right = vec![0.5f32; 128];
        slot.process_capture_input(capture_block(&left, &right, true));
        tx.push(CrumbsCommand::StopRecording).unwrap();
        render_block(&mut slot, 128);
        let commit = commit_rx.pop().expect("take handed to the commit ring");

        // Simulate the command side (arm_recording's drain): clone the take
        // off-thread, then return the emptied buffers BEFORE the ArmRecording
        // command reaches the engine.
        let (mut buf_left, mut buf_right) = (commit.left, commit.right);
        buf_left.clear();
        buf_right.clear();
        recycle_tx.push((buf_left, buf_right)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        })
        .unwrap();

        // One master-chain block: must adopt the recycled pair, THEN process
        // the arm — in that order.
        render_block(&mut slot, 128);

        assert_eq!(
            slot.engine.record_state(),
            RecordState::Armed,
            "re-arm immediately after a drained commit must find recycled capacity"
        );

        // And the re-armed recorder actually captures the next take.
        slot.process_capture_input(capture_block(&left, &right, true));
        assert_eq!(slot.engine.record_state(), RecordState::Recording);
    }

    /// The same wiring must leave the engine untouched when it is not armed:
    /// a capture block in a non-Record mode captures nothing.
    #[test]
    fn crumbs_slot_ignores_record_input_when_not_armed() {
        let (mut slot, _tx, mut commit_rx, _recycle_tx) = crumbs_slot_with_rings();

        // No SetMode(Record), no ArmRecording — default mode.
        let left = vec![0.5f32; 256];
        let right = vec![0.5f32; 256];
        slot.process_capture_input(capture_block(&left, &right, true));
        slot.process_capture_input(capture_block(&left, &right, true));
        render_block(&mut slot, 128);

        assert!(
            commit_rx.pop().is_err(),
            "an unarmed slot must hand no take to the commit ring"
        );
        assert_eq!(slot.engine.sample_pool().count(), 0);
        assert_eq!(slot.engine.active_sample_id(), None);
    }

    /// Queue the commands that make a slot sound: a sample, made active, and a
    /// note at the root so nothing is transposed.
    fn queue_a_sounding_note(tx: &mut CrumbsCommandSender) {
        use daw_dsp::crumbs::sample::SampleData;

        tx.push(CrumbsCommand::AddSample {
            id: 1,
            data: Arc::new(SampleData::from_mono(vec![0.1; 4800], 48_000)),
        })
        .unwrap();
        tx.push(CrumbsCommand::SetActiveSample(1)).unwrap();
        tx.push(CrumbsCommand::NoteOn {
            note: 60,
            velocity: 100,
        })
        .unwrap();
    }

    /// A sample the slot can sound, with no note pressed: the engine holds it
    /// and answers a later note-on with a voice.
    fn queue_a_loaded_sample(tx: &mut CrumbsCommandSender) {
        use daw_dsp::crumbs::sample::SampleData;

        tx.push(CrumbsCommand::AddSample {
            id: 1,
            data: Arc::new(SampleData::from_mono(vec![0.1; 4800], 48_000)),
        })
        .unwrap();
        tx.push(CrumbsCommand::SetActiveSample(1)).unwrap();
    }

    /// The wrapper is transparent: what the slot voices from the engine's note
    /// store is sample-for-sample what the bare `CrumbsEngine` voices from the
    /// same note at the same frame.
    ///
    /// This is the claim the strip splice rests on. The slot now renders inside
    /// a track's chain rather than on the master insert chain, so the audio a
    /// musician hears is whatever this wrapper puts into the generator scratch
    /// the chain hands it — and nothing between the note store and
    /// `CrumbsEngine::process_block` may colour, delay, or gate it.
    ///
    /// One block of 512 frames, the note at offset 0, so the wrapper's own
    /// segmenting reduces to the single unconditional tail render and the two
    /// paths are comparable at all.
    #[test]
    fn the_crumbs_slot_voices_its_note_store_events_like_the_bare_engine() {
        use daw_dsp::crumbs::sample::SampleData;

        const FRAMES: usize = 512;

        let sample = Arc::new(SampleData::from_mono(vec![0.1; 4800], 48_000));

        let (mut slot, mut tx, _commit, _recycle) = crumbs_slot_with_rings();
        tx.push(CrumbsCommand::AddSample {
            id: 1,
            data: Arc::clone(&sample),
        })
        .unwrap();
        tx.push(CrumbsCommand::SetActiveSample(1)).unwrap();

        let mut slot_left = vec![0.0f32; FRAMES];
        let mut slot_right = vec![0.0f32; FRAMES];
        slot.process_with_events(
            &mut slot_left,
            &mut slot_right,
            FRAMES,
            &[engine_note(60, 100, 0, true, 0)],
            &TransportState::default(),
        );

        // The same engine, built the same way, driven by the commands the
        // wrapper's own `dispatch_note` would have issued.
        let mut bare = CrumbsEngine::with_metering(48_000.0, Arc::new(CrumbsMetering::default()));
        bare.enable_commit_handoff();
        bare.handle_command(CrumbsCommand::AddSample {
            id: 1,
            data: sample,
        });
        bare.handle_command(CrumbsCommand::SetActiveSample(1));
        bare.handle_command(CrumbsCommand::NoteOn {
            note: 60,
            velocity: 100,
        });
        let mut bare_left = vec![0.0f32; FRAMES];
        let mut bare_right = vec![0.0f32; FRAMES];
        bare.process_block(&mut bare_left, &mut bare_right);

        assert!(
            bare_left.iter().any(|&sample| sample != 0.0),
            "two silent blocks would make the comparison vacuous"
        );
        assert_eq!(
            slot_left, bare_left,
            "the wrapper must add nothing of its own to the left channel"
        );
        assert_eq!(
            slot_right, bare_right,
            "the wrapper must add nothing of its own to the right channel"
        );
    }

    /// A note the engine stamps for a frame inside the block sounds from that
    /// frame, not from the block's head.
    ///
    /// The slot is the built-in sampler's whole render path, so a block whose
    /// events are all dispatched before the render puts every note up to a
    /// buffer early — audible timing the engine's own delivery took care to
    /// get right, thrown away at the last hop.
    #[test]
    fn a_crumbs_note_scheduled_inside_the_block_sounds_from_its_offset() {
        const FRAMES: usize = 512;
        const ONSET: usize = 300;

        let (mut slot, mut tx, _commit, _recycle) = crumbs_slot_with_rings();
        queue_a_loaded_sample(&mut tx);

        let mut left = vec![0.0f32; FRAMES];
        let mut right = vec![0.0f32; FRAMES];
        slot.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            &[engine_note(60, 100, 0, true, ONSET as u32)],
            &TransportState::default(),
        );

        assert!(
            left[..ONSET].iter().all(|&sample| sample == 0.0)
                && right[..ONSET].iter().all(|&sample| sample == 0.0),
            "nothing sounds before the frame the note was written for"
        );
        assert!(
            left[ONSET..].iter().any(|&sample| sample != 0.0),
            "the note sounds from its own frame, or this test proves nothing"
        );
    }

    /// A block rendered in segments must publish the peak of the whole block,
    /// not the peak of any one segment.
    ///
    /// `CrumbsEngine::process_block` measures and publishes only the slice it
    /// was just handed. Splitting a block at each MIDI event's offset calls it
    /// once per segment, so the raw per-segment publish leaves the atomics
    /// holding only the last-rendered segment's own peak. Three events put
    /// the block's loudest audio in the second of four segments — neither the
    /// first loop iteration nor, crucially, the *last* one — which no single
    /// segment's own peak can stand in for. A publish that merely tracks the
    /// final segment rendered (whether that segment comes from the in-loop
    /// render or the unconditional tail) would pass a test whose loudest
    /// segment happened to be that last one; putting the loudest segment in
    /// the middle of the loop is what makes the assertion mean something.
    #[test]
    fn a_segmented_crumbs_block_publishes_the_peak_of_the_whole_block() {
        const FRAMES: usize = 512;
        const NOTE_ON_OFFSET: usize = 100;
        const NOTE_OFF_OFFSET: usize = 300;
        const REDUNDANT_NOTE_OFF_OFFSET: usize = 450;

        let (mut slot, mut tx, _commit, _recycle) = crumbs_slot_with_rings();
        // Loaded but not pressed, so the first segment is silent and the note
        // sounds from the offset the note-on names.
        queue_a_loaded_sample(&mut tx);

        let mut left = vec![0.0f32; FRAMES];
        let mut right = vec![0.0f32; FRAMES];
        slot.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            &[
                engine_note(60, 100, 0, true, NOTE_ON_OFFSET as u32),
                engine_note(60, 100, 0, false, NOTE_OFF_OFFSET as u32),
                // A second note-off on the same note, already releasing:
                // `CrumbsEnvelope::note_off` only moves a non-idle envelope
                // into `Release`, so this is a no-op on the audio. Its only
                // job is to split the decaying tail into two loop segments,
                // so the loudest segment (the sustain plateau above) sits
                // before the *last* loop iteration rather than being it.
                engine_note(60, 100, 0, false, REDUNDANT_NOTE_OFF_OFFSET as u32),
            ],
            &TransportState::default(),
        );

        let peak_of = |slice: &[f32]| slice.iter().fold(0.0f32, |peak, &s| peak.max(s.abs()));
        let block_peak = peak_of(&left);
        let head_peak = peak_of(&left[..NOTE_ON_OFFSET]);
        let sustain_peak = peak_of(&left[NOTE_ON_OFFSET..NOTE_OFF_OFFSET]);
        let decay_peak = peak_of(&left[NOTE_OFF_OFFSET..REDUNDANT_NOTE_OFF_OFFSET]);
        let tail_peak = peak_of(&left[REDUNDANT_NOTE_OFF_OFFSET..]);

        assert_eq!(
            sustain_peak, block_peak,
            "the loudest audio must sit in the sustain segment, or this test proves nothing"
        );
        assert!(
            head_peak < block_peak && decay_peak < block_peak && tail_peak < block_peak,
            "only the sustain segment may reach the block's peak, or this test proves \
             nothing"
        );
        assert_eq!(
            slot.engine.read_peak_left(),
            block_peak,
            "a segmented block must publish the peak of the whole block, not the peak of \
             any one segment"
        );
    }

    /// The slot is one member of the native master chain, and
    /// `CrumbsEngine::process_block` sums into the buffers it is handed. It
    /// must never zero them: on the master chain they carry what every member
    /// ordered ahead of this one already wrote, and clearing them erases that
    /// audio while the slot's own voice still comes out — so the chain sounds
    /// plausible and everything upstream of the sampler is gone.
    #[test]
    fn crumbs_slot_adds_its_voice_into_the_mix_it_is_handed() {
        const FRAMES: usize = 128;
        const MIX_L: f32 = 0.25;
        const MIX_R: f32 = 0.5;

        // An idle slot must hand the mix back exactly as it found it.
        let (mut idle, _idle_tx, _idle_commit, _idle_recycle) = crumbs_slot_with_rings();
        let mut left = vec![MIX_L; FRAMES];
        let mut right = vec![MIX_R; FRAMES];
        idle.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            &[],
            &TransportState::default(),
        );
        assert!(
            left.iter().all(|&s| s == MIX_L) && right.iter().all(|&s| s == MIX_R),
            "an idle slot must leave the mix it was handed untouched"
        );

        // A sounding slot must add to it. Two slots driven identically differ
        // only in what they were handed, so their difference is the mix itself,
        // frame for frame — which holds however the voice or the master gain
        // ramps, because both ramp the same way.
        let (mut voice_only, mut voice_tx, _voice_commit, _voice_recycle) =
            crumbs_slot_with_rings();
        let (mut over_mix, mut mix_tx, _mix_commit, _mix_recycle) = crumbs_slot_with_rings();
        queue_a_sounding_note(&mut voice_tx);
        queue_a_sounding_note(&mut mix_tx);

        let mut bare_left = vec![0.0f32; FRAMES];
        let mut bare_right = vec![0.0f32; FRAMES];
        voice_only.process_with_events(
            &mut bare_left,
            &mut bare_right,
            FRAMES,
            &[],
            &TransportState::default(),
        );

        let mut mixed_left = vec![MIX_L; FRAMES];
        let mut mixed_right = vec![MIX_R; FRAMES];
        over_mix.process_with_events(
            &mut mixed_left,
            &mut mixed_right,
            FRAMES,
            &[],
            &TransportState::default(),
        );

        assert!(
            bare_left.iter().any(|&s| s != 0.0),
            "the triggered voice must actually sound, or this test proves nothing"
        );
        for frame in 0..FRAMES {
            assert!(
                (mixed_left[frame] - (bare_left[frame] + MIX_L)).abs() < 1.0e-6,
                "frame {frame}: the slot must add its voice to the mix, not replace it"
            );
            assert!(
                (mixed_right[frame] - (bare_right[frame] + MIX_R)).abs() < 1.0e-6,
                "frame {frame}: the slot must add its voice to the mix, not replace it"
            );
        }
    }

    /// A backend that records what each note the runtime is handed carries, so
    /// a field the bridge drops on the way in is visible as a wrong figure
    /// rather than as a missing note.
    struct MidiRecordingPlugin {
        processing: Arc<ProcessingGate>,
        notes: Arc<Mutex<Vec<RecordedNote>>>,
    }

    /// Every field the bridge copies out of an engine event, in the order the
    /// host type declares them: note, velocity, channel, note-on, frame
    /// offset. A field the packing crossed with another is a wrong figure
    /// here rather than a note that still arrives.
    type RecordedNote = (u8, u8, i16, bool, u32);

    type RecordedNotes = Arc<Mutex<Vec<RecordedNote>>>;

    impl AudioPlugin for MidiRecordingPlugin {
        fn process(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
        ) {
        }

        fn set_parameter(&mut self, _param_id: u32, _value: f64) {}

        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }

        fn get_state(&self) -> Result<Vec<u8>, PluginError> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _state: &[u8]) -> Result<(), PluginError> {
            Ok(())
        }

        fn get_name(&self) -> &str {
            "midi-recording-fixture"
        }
    }

    impl HostedPluginRuntime for MidiRecordingPlugin {
        fn is_activated(&self) -> bool {
            true
        }

        fn processing_gate(&self) -> Arc<ProcessingGate> {
            Arc::clone(&self.processing)
        }

        fn sync_processing_state(&mut self) {}

        fn set_transport(&mut self, _transport: HostTransport) {}

        fn process_with_parameter_updates(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
            _parameter_updates: &[HostParameterUpdate],
        ) {
        }

        fn process_with_midi_and_parameters(
            &mut self,
            _inputs: &[&[f32]],
            _outputs: &mut [&mut [f32]],
            _num_samples: usize,
            midi_events: &[HostMidiEvent],
            _parameter_updates: &[HostParameterUpdate],
        ) {
            self.notes
                .lock()
                .expect("the note log")
                .extend(midi_events.iter().map(|event| {
                    (
                        event.note,
                        event.velocity,
                        event.channel,
                        event.is_note_on,
                        event.frame_offset,
                    )
                }));
        }

        fn apply_host_parameter_write_to_editor(&mut self, _param_id: u32, _value: f64) {}

        fn poll_latency_change(&mut self) -> Result<Option<u32>, PluginError> {
            Ok(None)
        }

        fn latency_ms(&self) -> f64 {
            0.0
        }

        fn latency_samples(&self) -> u32 {
            0
        }

        fn tail_samples(&self) -> u32 {
            0
        }
    }

    /// One note as the engine stamps it for a block. Every field the bridge
    /// copies takes a value of its own, so a packing that read one field into
    /// another shows up as a wrong figure rather than as a note that happens
    /// to match.
    fn engine_note(
        note: u8,
        velocity: u8,
        channel: i16,
        is_note_on: bool,
        frame_offset: u32,
    ) -> MidiNoteEvent {
        MidiNoteEvent {
            note,
            velocity,
            channel,
            is_note_on,
            frame_offset,
            probability_cutoff: u64::from(u32::MAX) + 1,
            project_probability_seed: 0,
            clip_id_hash: 0,
            event_id_hash: 0,
            absolute_occurrence_index: 0,
            articulation_id: None,
        }
    }

    /// A slot over a fixture that records what each note it is handed carries.
    fn recording_slot() -> (
        HostedPluginSlot<MidiRecordingPlugin>,
        Arc<Mutex<Vec<RecordedNote>>>,
    ) {
        let notes = Arc::new(Mutex::new(Vec::new()));
        let shared = Arc::new(SharedHostedPlugin::new(MidiRecordingPlugin {
            processing: Arc::new(ProcessingGate::default()),
            notes: Arc::clone(&notes),
        }));
        (HostedPluginSlot::new(shared), notes)
    }

    /// The bridge packs the engine's events into the host's own event type on
    /// the audio thread, and every field has to survive that packing. A frame
    /// offset lost there sounds the note on the block boundary rather than on
    /// the frame it was written for — timing jitter of up to a whole buffer —
    /// and a velocity, channel or note-on flag crossed with another field is a
    /// note at the wrong loudness, on the wrong part, or never released.
    #[test]
    fn process_with_events_carries_each_notes_frame_offset_into_the_host_event() {
        const FRAMES: usize = 64;

        let (mut slot, notes) = recording_slot();
        let mut left = [0.0f32; FRAMES];
        let mut right = [0.0f32; FRAMES];
        slot.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            &[
                engine_note(60, 100, 0, true, 0),
                engine_note(64, 33, 5, true, 17),
                engine_note(67, 0, 9, false, 63),
            ],
            &TransportState::default(),
        );

        assert_eq!(
            *notes.lock().expect("the note log"),
            vec![
                (60, 100, 0, true, 0),
                (64, 33, 5, true, 17),
                (67, 0, 9, false, 63),
            ]
        );
    }

    /// The engine hands over one fixed buffer of events per block, and the
    /// bridge's packing array is the far side of it. Sized under that buffer
    /// the packing drops the block's tail — the notes latest inside it —
    /// silently, so a dense passage loses its end rather than reporting
    /// anything.
    #[test]
    fn a_full_engine_block_of_midi_events_reaches_the_host_intact() {
        const FRAMES: usize = 256;

        let (mut slot, notes) = recording_slot();
        let scheduled: Vec<MidiNoteEvent> = (0..MIDI_EVENT_BUFFER_CAPACITY)
            .map(|index| engine_note(60, 100, 0, true, index as u32))
            .collect();

        let mut left = [0.0f32; FRAMES];
        let mut right = [0.0f32; FRAMES];
        slot.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            &scheduled,
            &TransportState::default(),
        );

        let received = notes.lock().expect("the note log");
        assert_eq!(received.len(), MIDI_EVENT_BUFFER_CAPACITY);
        let offsets: Vec<u32> = received.iter().map(|note| note.4).collect();
        assert_eq!(
            offsets,
            (0..MIDI_EVENT_BUFFER_CAPACITY as u32).collect::<Vec<u32>>()
        );
    }

    // ── The adapter consumes everything the scheduler hands it ─────────────
    //
    // The scheduler clears the buffer it hands over the moment the dispatch
    // returns, so this slot is the only place an accepted-but-undelivered
    // event can survive in. #3654 was a silent truncation here; these tests
    // are what fails if the delivery path ever drops an event again.

    /// The issue's own sequence: 64 note-ons and the first key's note-off in
    /// one callback window, through the engine's buffer and the real adapter
    /// to a capturing runtime. All 65 must reach the plugin on that block —
    /// the off last of all — and a second, empty block must add nothing,
    /// because nothing was left queued anywhere.
    #[test]
    fn the_65_event_callback_sequence_reaches_the_host_and_releases_key_0() {
        const FRAMES: usize = 256;

        let (mut slot, notes) = recording_slot();

        let mut block = MidiEventBuffer::new();
        for key in 0..64u8 {
            assert!(block.try_push(engine_note(key, 100, 0, true, 0)));
        }
        assert!(block.try_push(engine_note(0, 0, 0, false, 64)));
        assert_eq!(block.len(), 65, "the whole sequence fits one buffer");

        let mut left = [0.0f32; FRAMES];
        let mut right = [0.0f32; FRAMES];
        slot.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            block.as_slice(),
            &TransportState::default(),
        );

        let delivered = notes.lock().expect("the note log");
        assert_eq!(
            delivered.len(),
            65,
            "every event the buffer accepted reaches the plugin on its own block"
        );
        assert_eq!(
            delivered.last(),
            Some(&(0, 0, 0, false, 64)),
            "key 0's note-off is delivered, so the key does not stick"
        );

        drop(delivered);
        let mut empty_left = [0.0f32; FRAMES];
        let mut empty_right = [0.0f32; FRAMES];
        slot.process_with_events(
            &mut empty_left,
            &mut empty_right,
            FRAMES,
            &[],
            &TransportState::default(),
        );
        assert_eq!(
            notes.lock().expect("the note log").len(),
            65,
            "a second empty block delivers nothing new: nothing was held back"
        );
    }

    /// One engine buffer's worth of events is the dispatch the scheduler can
    /// produce, at every size its boundaries name. A truncation at any count
    /// under the buffer's capacity fails a run of this loop.
    #[test]
    fn every_engine_buffer_capacity_boundary_reaches_the_host() {
        const FRAMES: usize = 256;

        for boundary in [64usize, 65, MIDI_EVENT_BUFFER_CAPACITY] {
            let (mut slot, notes) = recording_slot();

            let mut block = MidiEventBuffer::new();
            for index in 0..boundary {
                assert!(block.try_push(engine_note(60, 100, 0, true, index as u32)));
            }

            let mut left = [0.0f32; FRAMES];
            let mut right = [0.0f32; FRAMES];
            slot.process_with_events(
                &mut left,
                &mut right,
                FRAMES,
                block.as_slice(),
                &TransportState::default(),
            );

            assert_eq!(
                notes.lock().expect("the note log").len(),
                boundary,
                "all {boundary} events of a full buffer reach the plugin intact"
            );
        }
    }

    /// The overflow policy is drain-in-chunks, observable: a dispatch longer
    /// than one block's delivery scratch delivers a full block's worth, keeps
    /// the tail, and the next block hands the tail over first. Nothing is
    /// dropped and order is preserved. Identity is carried by velocity here,
    /// because an event that had to wait for a later block is re-stamped to
    /// that block's head — its original frame offset named a sample inside a
    /// block that no longer exists.
    #[test]
    fn a_dispatch_longer_than_one_block_drains_in_chunks_across_blocks() {
        const FRAMES: usize = 256;
        const DISPATCH_LEN: usize = MIDI_EVENT_BUFFER_CAPACITY + 3;

        let (mut slot, notes) = recording_slot();
        let dispatch: Vec<MidiNoteEvent> = (0..DISPATCH_LEN)
            .map(|index| engine_note(60, (index + 1) as u8, 0, true, index as u32))
            .collect();

        let mut left = [0.0f32; FRAMES];
        let mut right = [0.0f32; FRAMES];
        slot.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            &dispatch,
            &TransportState::default(),
        );
        slot.process_with_events(
            &mut left,
            &mut right,
            FRAMES,
            &[],
            &TransportState::default(),
        );

        let received = notes.lock().expect("the note log");
        assert_eq!(received.len(), DISPATCH_LEN, "nothing is dropped");
        let identities: Vec<u8> = received.iter().map(|note| note.1).collect();
        let expected: Vec<u8> = (1..=DISPATCH_LEN as u8).collect();
        assert_eq!(
            identities, expected,
            "the tail is delivered on the next block, in order"
        );
        assert!(
            received[..MIDI_EVENT_BUFFER_CAPACITY]
                .iter()
                .enumerate()
                .all(|(index, note)| note.4 == index as u32),
            "events delivered inside their own block keep their frame offsets"
        );
        assert!(
            received[MIDI_EVENT_BUFFER_CAPACITY..]
                .iter()
                .all(|note| note.4 == 0),
            "a retained event is re-stamped to the head of the block that delivers it"
        );
    }

    // ── Retention across a bypassed block ──────────────────────────────────
    //
    // A block the runtime could not be handed — non-RT control owning the
    // access seam, an unloading or inactive instance — is bypassed, and the
    // scheduler clears the buffer it handed over all the same. #3655 was the
    // note-off that clearing destroyed. The slot's retention queue is the
    // defined recovery, and these tests are what fails if it stops keeping
    // what a declined block owed.

    /// A slot whose note log and control seam the test drives directly.
    fn seam_recording_slot() -> (
        HostedPluginSlot<MidiRecordingPlugin>,
        Arc<SharedHostedPlugin<MidiRecordingPlugin>>,
        RecordedNotes,
    ) {
        let notes = Arc::new(Mutex::new(Vec::new()));
        let shared = Arc::new(SharedHostedPlugin::new(MidiRecordingPlugin {
            processing: Arc::new(ProcessingGate::default()),
            notes: Arc::clone(&notes),
        }));
        (HostedPluginSlot::new(Arc::clone(&shared)), shared, notes)
    }

    fn render_block_with_events(
        slot: &mut HostedPluginSlot<MidiRecordingPlugin>,
        events: &[MidiNoteEvent],
    ) {
        let mut left = [0.0f32; 64];
        let mut right = [0.0f32; 64];
        slot.process_with_events(
            &mut left,
            &mut right,
            64,
            events,
            &TransportState::default(),
        );
    }

    /// The issue's own interleaving: the note-off is queued while a control
    /// operation holds the access seam, so the block is bypassed and the
    /// scheduler's clear takes the buffer. Once access is released, the off is
    /// delivered exactly once, and the runtime holds no active note.
    #[test]
    fn a_note_off_queued_while_control_owns_the_seam_is_delivered_once_access_is_released() {
        let (mut slot, shared, notes) = seam_recording_slot();

        render_block_with_events(&mut slot, &[engine_note(60, 100, 0, true, 0)]);
        assert_eq!(
            *notes.lock().expect("the note log"),
            vec![(60, 100, 0, true, 0)],
            "the note-on is delivered while the seam is free"
        );

        // Non-RT control owns the seam for the duration of this guard.
        let _control_guard = shared
            .try_claim_control()
            .expect("the control path takes a free seam");

        render_block_with_events(&mut slot, &[engine_note(60, 100, 0, false, 0)]);
        assert_eq!(
            notes.lock().expect("the note log").len(),
            1,
            "the bypassed block invokes no runtime and delivers nothing"
        );
        drop(_control_guard);

        render_block_with_events(&mut slot, &[]);
        assert_eq!(
            *notes.lock().expect("the note log"),
            vec![(60, 100, 0, true, 0), (60, 100, 0, false, 0)],
            "the held note-off is delivered once access is back, and no active note remains"
        );
    }

    /// Two bypassed blocks in a row each owe their events, and the recovery
    /// owes each of them once: held twice is a stuck key released twice as
    /// well as a double-delivered off, and lost once is the original defect.
    #[test]
    fn two_declined_blocks_deliver_their_events_once_in_order() {
        let (mut slot, shared, notes) = seam_recording_slot();

        render_block_with_events(&mut slot, &[engine_note(60, 100, 0, true, 0)]);

        let _control_guard = shared.try_claim_control().expect("a free seam");
        render_block_with_events(&mut slot, &[engine_note(60, 100, 0, false, 0)]);
        render_block_with_events(&mut slot, &[engine_note(62, 100, 0, true, 0)]);
        drop(_control_guard);

        render_block_with_events(&mut slot, &[]);
        assert_eq!(
            *notes.lock().expect("the note log"),
            vec![
                (60, 100, 0, true, 0),
                (60, 100, 0, false, 0),
                (62, 100, 0, true, 0),
            ],
            "each bypassed block's events are delivered once, in arrival order"
        );
    }

    /// A full engine block of note-ons, each identified by its velocity.
    fn full_block_of_held_notes(first_velocity: u8) -> Vec<MidiNoteEvent> {
        (0..MIDI_EVENT_BUFFER_CAPACITY)
            .map(|index| engine_note(60, first_velocity + index as u8, 0, true, index as u32))
            .collect()
    }

    /// A bypassed block at full capacity fills the retention queue exactly, and
    /// the first block the plugin receives hands every retained event over,
    /// oldest first, before anything else.
    #[test]
    fn a_full_bypassed_block_is_delivered_whole_once_access_is_released() {
        let (mut slot, shared, notes) = seam_recording_slot();
        let held = full_block_of_held_notes(1);

        let control_guard = shared.try_claim_control().expect("a free seam");
        render_block_with_events(&mut slot, &held);
        drop(control_guard);
        render_block_with_events(&mut slot, &[]);

        let identities: Vec<u8> = notes
            .lock()
            .expect("the note log")
            .iter()
            .map(|note| note.1)
            .collect();
        let expected: Vec<u8> = held.iter().map(|note| note.velocity).collect();
        assert_eq!(identities, expected, "every retained event, in order");
        assert_eq!(shared.dropped_note_events(), 0, "nothing was dropped");
    }

    /// The retention queue is one engine block deep. A second bypassed block
    /// arriving while it is full has nowhere to go, and those events are lost:
    /// the loss must be counted, never silent.
    #[test]
    fn events_a_full_retention_queue_cannot_hold_are_counted_as_dropped() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (mut slot, shared, notes) = seam_recording_slot();
        let first = full_block_of_held_notes(1);
        let overflow = [
            engine_note(62, 100, 0, true, 0),
            engine_note(62, 0, 0, false, 5),
        ];

        let control_guard = shared.try_claim_control().expect("a free seam");
        render_block_with_events(&mut slot, &first);
        render_block_with_events(&mut slot, &overflow);
        drop(control_guard);
        render_block_with_events(&mut slot, &[]);

        assert_eq!(
            notes.lock().expect("the note log").len(),
            MIDI_EVENT_BUFFER_CAPACITY,
            "the queue delivers the block it holds"
        );
        assert_eq!(
            shared.dropped_note_events(),
            overflow.len() as u64,
            "each event the queue could not hold is counted"
        );
    }

    /// The recovery must not reintroduce a wait: the audio path declines a
    /// held seam and returns, and the control path's release is what unblocks
    /// it. The barrier here is causal — the control thread holds the seam
    /// until the process call has already returned — so a callback that ever
    /// waited on the seam hangs this test instead of passing it.
    #[test]
    fn the_audio_path_does_not_wait_for_a_control_path_barrier() {
        let (mut slot, shared, notes) = seam_recording_slot();
        let (callback_done_tx, callback_done_rx) = std::sync::mpsc::channel::<()>();
        let control = std::thread::spawn(move || {
            let _guard = shared
                .try_claim_control()
                .expect("the control path takes a free seam");
            callback_done_tx
                .send(())
                .expect("the audio path is still running");
            // Hold the seam until after the audio path was observed to return.
            std::thread::sleep(Duration::from_millis(50));
        });

        callback_done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("the control thread takes the seam");

        render_block_with_events(&mut slot, &[engine_note(60, 100, 0, false, 0)]);
        assert_eq!(
            notes.lock().expect("the note log").len(),
            0,
            "the bypassed block returned without invoking the runtime"
        );

        control
            .join()
            .expect("the control thread releases the seam");
        render_block_with_events(&mut slot, &[]);
        assert_eq!(
            *notes.lock().expect("the note log"),
            vec![(60, 100, 0, false, 0)],
            "the retained note-off is delivered on the first block after release"
        );
    }

    /// Both process entries count a block they could not hand the plugin, and
    /// neither counts one they did. Mutation: drop either
    /// `record_unserved_block` call — its count stays behind.
    #[test]
    fn a_block_the_slot_could_not_serve_is_counted_and_a_served_one_is_not() {
        let (mut slot, shared, _notes) = seam_recording_slot();
        render_block_with_events(&mut slot, &[]);
        let mut left = [0.25f32; 64];
        let mut right = [0.25f32; 64];
        slot.process_audio(&mut left, &mut right, 64);
        assert_eq!(shared.unserved_blocks(), 0, "both blocks were served");

        let guard = shared
            .try_claim_control()
            .expect("the control path takes a free seam");
        render_block_with_events(&mut slot, &[]);
        // The served block above left the plugin's output in both buffers.
        left.fill(0.25);
        right.fill(0.25);
        slot.process_audio(&mut left, &mut right, 64);
        drop(guard);

        assert_eq!(shared.unserved_blocks(), 2);
        assert!(
            left.iter().chain(&right).all(|sample| *sample == 0.25),
            "an unserved block passes through untouched"
        );
    }

    /// The count is an atomic add on the audio thread, never an allocation.
    #[cfg(debug_assertions)]
    #[test]
    fn counting_an_unserved_block_never_allocates() {
        let (mut slot, shared, _notes) = seam_recording_slot();
        let guard = shared
            .try_claim_control()
            .expect("the control path takes a free seam");
        let mut left = [0.5f32; 64];
        let mut right = [0.5f32; 64];
        assert_no_alloc::assert_no_alloc(|| {
            slot.process_audio(&mut left, &mut right, 64);
            slot.process_with_events(&mut left, &mut right, 64, &[], &TransportState::default());
        });
        drop(guard);
        assert_eq!(shared.unserved_blocks(), 2);
    }
}

/// Crumbs plugin slot — adapts CrumbsEngine for the native audio thread.
///
/// A committed take handed off by the engine in O(1) (ledger #568).
pub struct PendingRecordingCommit {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub sample_rate: u32,
}

/// An emptied record-buffer pair returned by the command side for reuse.
pub type RecordBufferPair = (Vec<f32>, Vec<f32>);

pub(crate) const TAKE_PREPARING: u8 = 0;
pub(crate) const TAKE_WAITING: u8 = 1;
pub(crate) const TAKE_RECORDING: u8 = 2;
pub(crate) const TAKE_FINISHING: u8 = 3;
pub(crate) const TAKE_COMPLETED: u8 = 4;
pub(crate) const TAKE_CANCELLED: u8 = 5;
pub(crate) const TAKE_FAILED: u8 = 6;

/// Published by the slot's off-RT destructor, never by a callback before a drop.
#[derive(Default)]
pub struct CrumbsSlotLifetime {
    pub stopped: AtomicBool,
}

#[derive(Clone, Copy)]
pub struct NativeTakeReadout {
    pub revision: u64,
    pub phase: u8,
    pub first_input: Option<CaptureFirstInput>,
    pub failure: u8,
}

/// One accepted preparation. Only the slot writes its actual DSP/input witnesses.
/// Control-side original PCM remains owned here if retirement interrupts cloning.
pub struct NativeTakeSession {
    pub instance_id: String,
    pub incarnation: u64,
    pub take_id: u64,
    pub period: OnceLock<CapturePeriodObservation>,
    pub valid: AtomicBool,
    pub slot_enqueued: AtomicBool,
    pub admitted: AtomicBool,
    pub released: AtomicBool,
    pub complete: AtomicBool,
    pub cancel_requested: AtomicBool,
    pub cancel_revision: AtomicU64,
    pub rt_phase: AtomicU8,
    pub failure: AtomicU8,
    pub first_position: AtomicU64,
    pub first_frames: AtomicUsize,
    pub has_commit: AtomicBool,
    pub sample_id: AtomicU32,
    pub sample_safe: AtomicBool,
    pub original_commit: Mutex<Option<Arc<PendingRecordingCommit>>>,
    pub published: Mutex<NativeTakeReadout>,
    pub revisions: Arc<AtomicU64>,
    pub lifetime: Arc<CrumbsSlotLifetime>,
    pub events: Weak<dyn EventSink>,
    #[cfg(test)]
    pub before_materialize: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    #[cfg(test)]
    pub publication_attempts: AtomicU64,
}

impl NativeTakeSession {
    pub fn new(
        instance_id: String,
        incarnation: u64,
        take_id: u64,
        revisions: Arc<AtomicU64>,
        lifetime: Arc<CrumbsSlotLifetime>,
        events: Weak<dyn EventSink>,
    ) -> Self {
        let revision = revisions.fetch_add(1, Ordering::Relaxed) + 1;
        Self {
            instance_id,
            incarnation,
            take_id,
            period: OnceLock::new(),
            valid: AtomicBool::new(true),
            slot_enqueued: AtomicBool::new(false),
            admitted: AtomicBool::new(false),
            released: AtomicBool::new(false),
            complete: AtomicBool::new(false),
            cancel_requested: AtomicBool::new(false),
            cancel_revision: AtomicU64::new(0),
            rt_phase: AtomicU8::new(TAKE_PREPARING),
            failure: AtomicU8::new(0),
            first_position: AtomicU64::new(0),
            first_frames: AtomicUsize::new(0),
            has_commit: AtomicBool::new(false),
            sample_id: AtomicU32::new(0),
            sample_safe: AtomicBool::new(false),
            original_commit: Mutex::new(None),
            published: Mutex::new(NativeTakeReadout {
                revision,
                phase: TAKE_PREPARING,
                first_input: None,
                failure: 0,
            }),
            revisions,
            lifetime,
            events,
            #[cfg(test)]
            before_materialize: Mutex::new(None),
            #[cfg(test)]
            publication_attempts: AtomicU64::new(0),
        }
    }

    pub fn first_input(&self) -> Option<CaptureFirstInput> {
        let frames = self.first_frames.load(Ordering::Acquire);
        (frames != 0).then(|| CaptureFirstInput {
            position_frames: self.first_position.load(Ordering::Relaxed),
            frames,
        })
    }

    /// Cancellation is separate from the slot's actual terminal/handback witness.
    pub fn invalidate(&self) {
        self.valid.store(false, Ordering::Release);
        self.cancel_requested.store(true, Ordering::Release);
        if self.cancel_revision.load(Ordering::Acquire) == 0 {
            let revision = self.revisions.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = self.cancel_revision.compare_exchange(
                0,
                revision,
                Ordering::Release,
                Ordering::Relaxed,
            );
        }
    }

    pub fn readout(&self) -> NativeTakeReadout {
        let mut value = *self
            .published
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let cancelled = self.cancel_revision.load(Ordering::Acquire);
        if cancelled > value.revision {
            value.revision = cancelled;
            value.phase = TAKE_CANCELLED;
            value.first_input = self.first_input();
        }
        value
    }

    /// A bounded worker visit; copying this readout never clones PCM or emits.
    pub fn publish(&self, phase: u8) -> Option<NativeTakeReadout> {
        #[cfg(test)]
        self.publication_attempts.fetch_add(1, Ordering::Relaxed);
        let Ok(mut value) = self.published.try_lock() else {
            return None;
        };
        let first_input = self.first_input();
        let failure = self.failure.load(Ordering::Acquire);
        if value.phase == phase && value.first_input == first_input && value.failure == failure {
            return Some(*value);
        }
        *value = NativeTakeReadout {
            revision: self.revisions.fetch_add(1, Ordering::Relaxed) + 1,
            phase,
            first_input,
            failure,
        };
        Some(*value)
    }
}

pub struct NativePreparedTake {
    pub session: Arc<NativeTakeSession>,
    pub threshold: f32,
    pub target_pad: u8,
    pub max_duration_secs: f32,
}

pub enum NativeCrumbsCommand {
    Engine(CrumbsCommand),
    PrepareTake(NativePreparedTake),
    StopTake { take_id: u64 },
}

/// The Crumbs command ring had no free slot, so the command was not queued.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrumbsCommandQueueFull;

impl std::fmt::Display for CrumbsCommandQueueFull {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Command queue full")
    }
}

impl std::error::Error for CrumbsCommandQueueFull {}

/// Why a pad audition was not started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PadAuditionError {
    /// No room for the audition and the release it reserves.
    QueueFull(CrumbsCommandQueueFull),
    /// Every audition receipt id has been issued.
    IdsExhausted,
}

impl std::fmt::Display for PadAuditionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::QueueFull(full) => full.fmt(f),
            Self::IdsExhausted => f.write_str("Crumbs pad audition ids exhausted"),
        }
    }
}

impl std::error::Error for PadAuditionError {}

static LAST_PAD_AUDITION_ID: AtomicU32 = AtomicU32::new(0);

/// The control-side producer for one attached slot. Each accepted pad audition
/// reserves one entry of this FIFO until its release is written.
pub struct CrumbsCommandSender {
    producer: rtrb::Producer<NativeCrumbsCommand>,
    held_auditions: Vec<u32>,
}

impl CrumbsCommandSender {
    pub fn new(producer: rtrb::Producer<NativeCrumbsCommand>) -> Self {
        Self {
            producer,
            held_auditions: Vec::new(),
        }
    }

    pub fn push(&mut self, command: CrumbsCommand) -> Result<(), CrumbsCommandQueueFull> {
        self.push_native(NativeCrumbsCommand::Engine(command))
    }

    pub fn push_native(
        &mut self,
        command: NativeCrumbsCommand,
    ) -> Result<(), CrumbsCommandQueueFull> {
        if self.producer.slots() <= self.held_auditions.len() {
            return Err(CrumbsCommandQueueFull);
        }
        self.producer
            .push(command)
            .map_err(|_| CrumbsCommandQueueFull)
    }

    pub fn start_pad_audition(&mut self, note: u8, velocity: u8) -> Result<u32, PadAuditionError> {
        if self.producer.slots() < self.held_auditions.len() + 2 {
            return Err(PadAuditionError::QueueFull(CrumbsCommandQueueFull));
        }

        // Receipts must never alias after a slot with the same instance id
        // is attached, so stop issuing them when the counter is exhausted.
        let previous = LAST_PAD_AUDITION_ID
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |previous| {
                previous.checked_add(1)
            })
            .map_err(|_| PadAuditionError::IdsExhausted)?;
        let audition_id = previous + 1;
        self.push(CrumbsCommand::PadAuditionOn {
            note,
            velocity,
            audition_id,
        })
        .map_err(PadAuditionError::QueueFull)?;
        self.held_auditions.push(audition_id);
        Ok(audition_id)
    }

    pub fn release_pad_audition(&mut self, audition_id: u32) -> Result<(), CrumbsCommandQueueFull> {
        let Some(index) = self.held_auditions.iter().position(|id| *id == audition_id) else {
            return Ok(());
        };
        // This sender is the only producer, and its other writes can never
        // occupy the capacity reserved for an active audition's release.
        self.producer
            .push(NativeCrumbsCommand::Engine(CrumbsCommand::PadAuditionOff {
                audition_id,
            }))
            .map_err(|_| CrumbsCommandQueueFull)?;
        self.held_auditions.swap_remove(index);
        Ok(())
    }

    #[cfg(test)]
    pub fn slots(&self) -> usize {
        self.producer.slots()
    }

    #[cfg(test)]
    pub fn capacity(&self) -> usize {
        self.producer.buffer().capacity()
    }
}

pub struct CrumbsPluginSlot {
    pub engine: CrumbsEngine,
    pub command_rx: Consumer<NativeCrumbsCommand>,
    pub commit_tx: rtrb::Producer<PendingRecordingCommit>,
    pub recycle_rx: Consumer<RecordBufferPair>,
    pub retired_take_tx: rtrb::Producer<Arc<NativeTakeSession>>,
    pub lifetime: Arc<CrumbsSlotLifetime>,
    active_take: Option<Arc<NativeTakeSession>>,
    pending_prepare: Option<NativePreparedTake>,
    pending_commit: Option<PendingRecordingCommit>,
    /// The same `Arc` the engine publishes into (`CrumbsEngine::with_metering`).
    /// `process_block_internal` overwrites it with the whole block's peak once
    /// every segment has rendered — see `publish_block_peak`.
    pub metering: Arc<CrumbsMetering>,
}

impl CrumbsPluginSlot {
    pub fn new(
        engine: CrumbsEngine,
        command_rx: Consumer<NativeCrumbsCommand>,
        commit_tx: rtrb::Producer<PendingRecordingCommit>,
        recycle_rx: Consumer<RecordBufferPair>,
        retired_take_tx: rtrb::Producer<Arc<NativeTakeSession>>,
        lifetime: Arc<CrumbsSlotLifetime>,
        metering: Arc<CrumbsMetering>,
    ) -> Self {
        Self {
            engine,
            command_rx,
            commit_tx,
            recycle_rx,
            retired_take_tx,
            lifetime,
            metering,
            active_take: None,
            pending_prepare: None,
            pending_commit: None,
        }
    }

    fn prepare_take(&mut self, prepared: NativePreparedTake) {
        let NativePreparedTake {
            session,
            threshold,
            target_pad,
            max_duration_secs,
        } = prepared;
        if session.valid.load(Ordering::Acquire) && self.engine.mode() == CrumbsMode::Record {
            self.engine.handle_command(CrumbsCommand::ArmRecording {
                threshold,
                target_pad,
                max_duration_secs,
            });
            if self.engine.record_state() != RecordState::Armed {
                session.failure.store(1, Ordering::Release);
                session.rt_phase.store(TAKE_FINISHING, Ordering::Release);
            }
        } else {
            if session.valid.load(Ordering::Acquire) {
                session.failure.store(1, Ordering::Release);
            }
            session.rt_phase.store(TAKE_FINISHING, Ordering::Release);
        }
        self.active_take = Some(session);
    }

    fn stop_take(&mut self) {
        self.engine.handle_command(CrumbsCommand::StopRecording);
        if let Some(take) = &self.active_take {
            take.rt_phase.store(TAKE_FINISHING, Ordering::Release);
        }
    }

    /// Both render and capture call this; capture runs first in the scheduler.
    fn drain_control(&mut self) {
        while let Ok((left, right)) = self.recycle_rx.pop() {
            self.engine.return_record_buffers(left, right);
        }
        if self.active_take.is_none() {
            if let Some(prepared) = self.pending_prepare.take() {
                self.prepare_take(prepared);
            }
        }
        if self.pending_prepare.is_none() {
            while let Ok(command) = self.command_rx.pop() {
                match command {
                    NativeCrumbsCommand::PrepareTake(prepared) => {
                        if self.active_take.is_some() {
                            self.pending_prepare = Some(prepared);
                            break;
                        }
                        self.prepare_take(prepared);
                    }
                    NativeCrumbsCommand::StopTake { take_id } => {
                        if self
                            .active_take
                            .as_ref()
                            .is_some_and(|take| take.take_id == take_id)
                        {
                            self.stop_take();
                        }
                    }
                    NativeCrumbsCommand::Engine(command) => {
                        if matches!(&command, CrumbsCommand::SetMode(mode) if *mode != CrumbsMode::Record)
                            && self.engine.record_state() != RecordState::Idle
                        {
                            self.stop_take();
                        }
                        self.engine.handle_command(command);
                    }
                }
            }
        }
        if self
            .active_take
            .as_ref()
            .is_some_and(|take| take.cancel_requested.load(Ordering::Acquire))
        {
            self.stop_take();
        }
        self.forward_terminal();
    }

    fn forward_terminal(&mut self) {
        if self.pending_commit.is_none() {
            if let Some((left, right)) = self.engine.take_pending_commit() {
                if let Some(take) = &self.active_take {
                    take.has_commit.store(true, Ordering::Release);
                }
                self.pending_commit = Some(PendingRecordingCommit {
                    left,
                    right,
                    sample_rate: self.engine.sample_rate() as u32,
                });
            }
        }
        if let Some(commit) = self.pending_commit.take() {
            if let Err(rtrb::PushError::Full(commit)) = self.commit_tx.push(commit) {
                self.pending_commit = Some(commit);
            }
        }
        if self.engine.record_state() != RecordState::Idle || self.pending_commit.is_some() {
            return;
        }
        if let Some(take) = self.active_take.take() {
            take.rt_phase.store(TAKE_FINISHING, Ordering::Release);
            // The actual slot-owned Arc moves off RT. A full ring retains it.
            if let Err(rtrb::PushError::Full(take)) = self.retired_take_tx.push(take) {
                self.active_take = Some(take);
            }
        }
    }
    /// Shared block body for every render path.
    ///
    /// The slot adds its voice into the mix it is handed, and nothing here may
    /// zero the buffers.
    ///
    /// On the strip chain that borrows this instance the slot is a
    /// `DeviceKind::Generator`: the chain hands it generator scratch it has
    /// already zeroed, renders it, then sums the result into the strip's own
    /// buffer and carries that on through the rest of the chain
    /// (`crates/daw-engine/src/timeline.rs:2954-2982`). Zeroing here would cost
    /// that chain nothing, but the law is not about the caller: wherever the
    /// slot is handed a buffer it did not get exclusively — a chain member
    /// ordered ahead of it on a shared buffer — zeroing erases that member
    /// outright, and `CrumbsEngine::process_block` sums rather than writes
    /// precisely so this slot never has to know which case it is in.
    ///
    /// The buffers carry no input audio either way. Record input reaches the
    /// engine only through [`NativePlugin::process_capture_input`], from the
    /// device's own capture tap; feeding render buffers to the recorder would
    /// splice a device buffer of the mix into every take (PR #564 review), so
    /// no path here touches the record input.
    fn process_block_internal(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
    ) {
        self.drain_control();

        // Render up to each event's own frame before dispatching it, so a note
        // sounds on the sample it was written for rather than at the head of
        // the block that carried it. Dispatching the whole list first puts
        // every note up to a buffer early, which is a timing no DAW invents.
        // The engine stamps its events non-decreasing, so the cursor only ever
        // moves forward.
        let mut cursor = 0;
        let mut peak_left = 0.0f32;
        let mut peak_right = 0.0f32;
        for event in midi_events {
            let offset = (event.frame_offset as usize).min(num_samples);
            if offset > cursor {
                self.render_segment(left, right, cursor, offset);
                peak_left = peak_left.max(self.engine.read_peak_left());
                peak_right = peak_right.max(self.engine.read_peak_right());
                cursor = offset;
            }
            self.dispatch_note(event);
        }

        // The tail runs unconditionally, empty or not: `process_block` is what
        // publishes this slot's metering, and a block that happened to end on
        // an event still owes that publication.
        //
        // The slice is the block the scheduler asked for, because
        // `process_block` measures its own work from the slice length rather
        // than from a frame count.
        self.engine.process_block(
            &mut left[cursor..num_samples],
            &mut right[cursor..num_samples],
        );
        peak_left = peak_left.max(self.engine.read_peak_left());
        peak_right = peak_right.max(self.engine.read_peak_right());
        self.publish_block_peak(peak_left, peak_right);

        self.forward_terminal();
    }

    /// Render `from..to` of the block through the engine, which sums into
    /// whatever the buffers already carry.
    fn render_segment(&mut self, left: &mut [f32], right: &mut [f32], from: usize, to: usize) {
        self.engine
            .process_block(&mut left[from..to], &mut right[from..to]);
    }

    /// Overwrite the shared metering with the whole block's peak.
    ///
    /// Every `process_block` call — one per segment — measures and publishes
    /// only the peak of the slice it just rendered, so a block split at MIDI
    /// event offsets otherwise leaves the atomics holding just the tail
    /// segment's peak. The meter owes the block's peak, not its last slice's,
    /// so this replaces it with the maximum this caller tracked across every
    /// segment, tail included.
    fn publish_block_peak(&self, peak_left: f32, peak_right: f32) {
        self.metering
            .peak_left
            .store(peak_left.to_bits(), Ordering::Relaxed);
        self.metering
            .peak_right
            .store(peak_right.to_bits(), Ordering::Relaxed);
    }

    /// Hand one engine event to the sampler as the command it names.
    fn dispatch_note(&mut self, event: &MidiNoteEvent) {
        if event.is_note_on {
            self.engine.handle_command(CrumbsCommand::NoteOn {
                note: event.note,
                velocity: event.velocity,
            });
            return;
        }
        self.engine
            .handle_command(CrumbsCommand::NoteOff { note: event.note });
    }
}

impl NativePlugin for CrumbsPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        self.process_block_internal(left, right, num_samples, &[]);
    }

    fn process_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        self.process_block_internal(left, right, num_samples, midi_events);
    }

    /// Drain native controls before delivering this very input block. A new
    /// take requires its exact period and its own first served block, including
    /// when joining an old period during refill. Later unserved blocks retain
    /// their duration as zeros. The witness is published before native readiness.
    fn process_capture_input(&mut self, block: CaptureInputBlock<'_>) {
        self.drain_control();
        if self.engine.record_state() == RecordState::Idle {
            return;
        }
        if let Some(take) = &self.active_take {
            if !take.valid.load(Ordering::Acquire) || take.cancel_requested.load(Ordering::Acquire)
            {
                return;
            }
            if take.first_frames.load(Ordering::Acquire) == 0 {
                let eligible = take.period.get().is_some_and(|period| {
                    let state = period.snapshot();
                    state.opened
                        && state.first_served.is_some()
                        && !state.closed
                        && state.failure.is_none()
                });
                if !eligible || !block.served || block.frames == 0 {
                    return;
                }
                take.first_position
                    .store(block.position_frames, Ordering::Relaxed);
                take.first_frames.store(block.frames, Ordering::Release);
            }
        }
        self.engine.process_record_input(block.left, block.right);
        if let Some(take) = &self.active_take {
            let phase = match self.engine.record_state() {
                RecordState::Armed => TAKE_WAITING,
                RecordState::Recording => TAKE_RECORDING,
                RecordState::Idle => TAKE_FINISHING,
            };
            take.rt_phase.store(phase, Ordering::Release);
        }
        self.forward_terminal();
    }

    fn name(&self) -> &str {
        "Crumbs"
    }

    fn accepts_midi(&self) -> bool {
        true
    }

    /// Every callback, spliced or not.
    ///
    /// The render pass drains controls even without a capture feed. The slot is
    /// registered detached — the strip's chain splices it in later, or never,
    /// if the strip stays on the Web Audio path. A block only while a chain
    /// carried it would leave every arm, note, parameter and sample load the
    /// panel pushed banked in the ring, the recorder unarmed against a caller
    /// the command told `Ok`, and a finished take unforwarded.
    fn runs_while_detached(&self) -> bool {
        true
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

impl Drop for CrumbsPluginSlot {
    fn drop(&mut self) {
        self.lifetime.stopped.store(true, Ordering::Release);
    }
}

#[cfg(all(test, debug_assertions))]
#[global_allocator]
static CRUMBS_TEST_ALLOCATOR: assert_no_alloc::AllocDisabler = assert_no_alloc::AllocDisabler;
