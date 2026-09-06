use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::types::CrumbsCommand;
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
use daw_plugin_host::{
    HostMidiEvent, HostParameterUpdate, HostTransport, HostedPluginRuntime, HostedRuntime,
    PluginParameter, ProcessingGate,
};
use rtrb::Consumer;
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
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
const MAX_BUFFER: usize = 4096;
/// Maximum MIDI events per block for the event-conversion scratch array.
///
/// The engine's own per-block buffer, so the array holds every event the
/// engine can hand over in one call. Sized under it, the packing would drop a
/// full block's tail — the notes latest in the block, silently and with no
/// counter — which is the whole reason the figure is taken from the engine
/// rather than restated here.
const MAX_MIDI_EVENTS: usize = daw_engine::midi_fx::MIDI_EVENT_BUFFER_CAPACITY;
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

struct PendingParameterSlot {
    param_id: AtomicU32,
    value_bits: AtomicU64,
    sequence: AtomicU64,
    state: AtomicU8,
}

impl PendingParameterSlot {
    fn new() -> Self {
        Self {
            param_id: AtomicU32::new(0),
            value_bits: AtomicU64::new(0.0f64.to_bits()),
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
}

impl PendingParameterQueue {
    fn new() -> Self {
        Self {
            slots: std::array::from_fn(|_| PendingParameterSlot::new()),
            next_sequence: AtomicU64::new(1),
        }
    }

    fn enqueue(&self, param_id: u32, value: f64) -> Result<(), ()> {
        let value_bits = value.to_bits();
        let sequence = self.next_sequence.fetch_add(1, Ordering::Relaxed);

        if self.coalesce(param_id, value_bits, sequence) {
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
                slot.sequence.store(sequence, Ordering::Relaxed);
                slot.state.store(PENDING_PARAMETER_READY, Ordering::Release);
                return Ok(());
            }
        }

        if self.coalesce(param_id, value_bits, sequence) {
            return Ok(());
        }

        Err(())
    }

    /// Fold a write into the pending value this queue already holds for the
    /// same parameter, if it holds one.
    ///
    /// The fold keeps the later sequence, never simply the later writer: two
    /// producers — the control path and the audio thread — take their sequence
    /// numbers before they reach a slot, so the one that arrives second is not
    /// always the one that was issued second. Overwriting unconditionally would
    /// leave the earlier write's value pending and hand the plugin a parameter
    /// value the automation had already moved past. A write the slot subsumes
    /// still counts as queued: the parameter's pending value is at least as new
    /// as the one being folded in.
    fn coalesce(&self, param_id: u32, value_bits: u64, sequence: u64) -> bool {
        for slot in &self.slots {
            if slot.state.load(Ordering::Acquire) != PENDING_PARAMETER_READY {
                continue;
            }

            if slot.param_id.load(Ordering::Relaxed) != param_id {
                continue;
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

            if slot.sequence.load(Ordering::Relaxed) < sequence {
                slot.value_bits.store(value_bits, Ordering::Relaxed);
                slot.sequence.store(sequence, Ordering::Relaxed);
            }
            slot.state.store(PENDING_PARAMETER_READY, Ordering::Release);
            return true;
        }

        false
    }

    fn drain(&self, out: &mut [PendingParameterUpdate]) -> usize {
        let mut count = 0;
        let mut entries = [PendingParameterDrainEntry::default(); PENDING_PARAMETER_CAPACITY];

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

            let update = PendingParameterUpdate {
                param_id: slot.param_id.load(Ordering::Relaxed),
                value: f64::from_bits(slot.value_bits.load(Ordering::Relaxed)),
            };
            let sequence = slot.sequence.load(Ordering::Relaxed);
            if let Some(existing) = entries[..count]
                .iter_mut()
                .find(|entry| entry.update.param_id == update.param_id)
            {
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

fn sort_pending_parameter_entries(entries: &mut [PendingParameterDrainEntry]) {
    for index in 1..entries.len() {
        let entry = entries[index];
        let mut cursor = index;
        while cursor > 0 && entries[cursor - 1].sequence > entry.sequence {
            entries[cursor] = entries[cursor - 1];
            cursor -= 1;
        }
        entries[cursor] = entry;
    }
}

struct PluginRuntimeLifecycle {
    state: AtomicU8,
}

impl PluginRuntimeLifecycle {
    fn new() -> Self {
        Self {
            state: AtomicU8::new(PLUGIN_LIFECYCLE_ACTIVE),
        }
    }

    fn begin_unload(&self) {
        let _ = self.state.compare_exchange(
            PLUGIN_LIFECYCLE_ACTIVE,
            PLUGIN_LIFECYCLE_UNLOADING,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    fn cancel_unload(&self) {
        let _ = self.state.compare_exchange(
            PLUGIN_LIFECYCLE_UNLOADING,
            PLUGIN_LIFECYCLE_ACTIVE,
            Ordering::AcqRel,
            Ordering::Acquire,
        );
    }

    fn retire(&self) {
        self.state
            .store(PLUGIN_LIFECYCLE_RETIRED, Ordering::Release);
    }

    fn allows_process(&self) -> bool {
        self.state.load(Ordering::Acquire) == PLUGIN_LIFECYCLE_ACTIVE
    }

    fn ensure_public_control_allowed(&self, plugin_name: &str) -> Result<(), String> {
        match self.state.load(Ordering::Acquire) {
            PLUGIN_LIFECYCLE_ACTIVE => Ok(()),
            PLUGIN_LIFECYCLE_UNLOADING => Err(format!(
                "Engine-owned plugin instance '{}' is unloading",
                plugin_name
            )),
            PLUGIN_LIFECYCLE_RETIRED => Err(format!(
                "Engine-owned plugin instance '{}' has been retired",
                plugin_name
            )),
            lifecycle_state => Err(format!(
                "Engine-owned plugin instance '{}' is in invalid lifecycle state {}",
                plugin_name, lifecycle_state
            )),
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
}

// SAFETY: access_state enforces exclusive mutable access to wrapper. The audio
// path never waits; if non-RT control owns the wrapper, processing bypasses it.
unsafe impl<Runtime: HostedPluginRuntime> Send for SharedHostedPlugin<Runtime> {}
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
            activated,
            accepts_midi,
            processing,
            pending_parameters: PendingParameterQueue::new(),
            editor_parameter_writes: PendingParameterQueue::new(),
        }
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
    /// one pending value per parameter id: where a write meets a pending one
    /// for the same id, the later sequence number survives, so a control write
    /// and an audio write of the same parameter before one process call
    /// collapse to the later of the two rather than to both.
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
    pub fn enqueue_parameter_on_audio_thread(&self, param_id: u32, value: f64) -> bool {
        if !value.is_finite() {
            return false;
        }

        self.pending_parameters.enqueue(param_id, value).is_ok()
    }

    pub fn enqueue_parameter(&self, param_id: u32, value: f64) -> Result<(), String> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;

        if !self.activated {
            return Err(format!(
                "CLAP plugin '{}' is not activated; parameter update rejected",
                self.name
            ));
        }

        if !value.is_finite() {
            return Err(format!(
                "Invalid parameter value for plugin '{}': {}",
                self.name, value
            ));
        }

        self.pending_parameters
            .enqueue(param_id, value)
            .map_err(|()| format!("Pending parameter queue full for plugin '{}'", self.name))?;

        // The processor learns about this write from the audio thread. The
        // editor is a different object in some formats and has to be told
        // separately, or its knob keeps showing the value the user moved away
        // from. Queued first so a write that arrives while the audio thread
        // holds the seam is delivered by the next control visit rather than
        // lost.
        let _ = self.editor_parameter_writes.enqueue(param_id, value);
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
    ) -> Result<Vec<u8>, String> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;

        self.with_control_locked(timeout, |plugin| {
            if self.pending_parameters.has_pending() {
                return Err(format!(
                    "Plugin '{}' has pending parameter writes awaiting audio processing; retry state save after the process path drains them",
                    self.name
                ));
            }

            plugin.get_state()
        })
    }

    pub fn set_state_invalidating_pending_parameters(
        &self,
        timeout: Duration,
        plugin_state: &[u8],
    ) -> Result<Vec<PluginParameter>, String> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;

        self.with_control_locked(timeout, |plugin| {
            plugin.set_state(plugin_state)?;
            self.pending_parameters.clear();
            Ok(plugin.get_parameters())
        })
    }

    pub fn begin_unload(&self) {
        // Withdraw the intent to process before the lifecycle closes the door,
        // so the audio thread — the only thread CLAP lets leave the processing
        // state — still has blocks in which to do it. The instance stays in the
        // scheduler until the unload finishes, so those blocks do arrive.
        self.processing.request_stop();
        self.lifecycle.begin_unload();
    }

    pub fn cancel_unload(&self) {
        self.lifecycle.cancel_unload();
        self.processing.request_start();
    }

    pub fn retire(&self) {
        self.lifecycle.retire();
    }

    pub fn ensure_public_control_allowed(&self) -> Result<(), String> {
        self.ensure_active_lifecycle()
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
    pub fn poll_latency_change(&self, timeout: Duration) -> Result<Option<LatencyChange>, String> {
        self.with_control(timeout, |plugin| match plugin.poll_latency_change()? {
            Some(_) => Ok(Some(LatencyChange {
                latency_ms: plugin.latency_ms(),
                latency_frames: plugin.latency_samples() as usize,
            })),
            None => Ok(None),
        })
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
    ) -> Result<Option<Vec<PluginParameter>>, String> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;

        self.with_control_locked(timeout, |plugin| {
            // The regular control-path visit, and so the place a write that
            // could not be delivered when it was made finally reaches the
            // editor.
            self.show_editor_the_host_writes(plugin);

            if self.pending_parameters.has_pending() {
                return Ok(None);
            }

            Ok(Some(plugin.get_parameters()))
        })
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

    pub fn with_control<ResultValue>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, String>,
    ) -> Result<ResultValue, String> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;
        self.with_control_locked(timeout, operation)
    }

    /// Run a control operation, but only if the control gate is free right now.
    ///
    /// [`with_control`](Self::with_control) waits twice: on the gate that
    /// serializes this instance's control operations, and then on the RT seam
    /// under `timeout`. Only the second wait is bounded — the gate is held for
    /// however long the operation holding it takes, and `open_gui` or `set_state`
    /// on a large preset is unbounded third-party code. That is fine for a
    /// command answering one user action, and wrong for a caller serving every
    /// instance on a timer: the parameter drain answers flush requests on the
    /// same 16 ms tick that feeds every plugin's knobs to the renderer, so one
    /// instance mid-`open_gui` would freeze all of them.
    ///
    /// So this refuses instead of waiting, and leaves what to do about it to the
    /// caller, which is the one that knows whether coming back later is cheap.
    /// The bounded RT wait is kept: that one is the audio thread holding the seam
    /// for the length of a block, which is what `timeout` was sized for.
    pub fn try_with_control<ResultValue>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, String>,
    ) -> Result<ResultValue, String> {
        let _non_rt_control_guard = self.try_lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;
        self.with_control_locked(timeout, operation)
    }

    pub fn with_unload_control<ResultValue>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, String>,
    ) -> Result<ResultValue, String> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.with_control_locked(timeout, operation)
    }

    /// Take the gate that serializes this instance's non-RT control operations.
    ///
    /// The whole acquisition runs under the async-worker hand-off: uncontended —
    /// the ordinary case — it is one `try_lock`, and contended it waits for
    /// however long the operation holding the gate takes, bounded only by *that*
    /// operation's control timeout. Only the acquisition is handed off — the
    /// guard comes back to the caller — which is sound because `block_in_place`
    /// runs its closure on the calling thread.
    fn lock_non_rt_control(&self) -> Result<MutexGuard<'_, ()>, String> {
        without_stalling_async_worker(|| {
            if let Ok(guard) = self.non_rt_control_lock.try_lock() {
                return Ok(guard);
            }

            self.non_rt_control_lock.lock()
        })
        .map_err(|error| {
            format!(
                "Failed to lock plugin non-RT control path for '{}': {}",
                self.name, error
            )
        })
    }

    /// Take the control gate without waiting for it.
    ///
    /// No async hand-off, because there is nothing to hand off: this never
    /// blocks. A poisoned gate is taken rather than refused — the panic that
    /// poisoned it happened inside some earlier operation's body, the gate itself
    /// is free, and refusing forever would both silence this instance for the
    /// life of the process and have a caller that retries spin on every tick.
    fn try_lock_non_rt_control(&self) -> Result<MutexGuard<'_, ()>, String> {
        match self.non_rt_control_lock.try_lock() {
            Ok(guard) => Ok(guard),
            Err(TryLockError::Poisoned(poisoned)) => Ok(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => Err(format!(
                "Plugin non-RT control path for '{}' is busy",
                self.name
            )),
        }
    }

    fn ensure_active_lifecycle(&self) -> Result<(), String> {
        self.lifecycle.ensure_public_control_allowed(&self.name)
    }

    fn with_control_locked<ResultValue>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, String>,
    ) -> Result<ResultValue, String> {
        // The whole body runs under the hand-off, not just the contended wait:
        // `operation` is third-party CLAP code of unbounded duration (`set_state`
        // on a large preset, `open_gui`), so the ordinary uncontended claim —
        // the seam is free unless the audio thread is inside a block for this
        // instance, so the first CAS normally takes it — would otherwise still
        // park the worker for the whole plugin call.
        without_stalling_async_worker(|| {
            if let Some(_guard) = self.try_claim_control() {
                return operation(unsafe { &mut *self.wrapper.get() });
            }

            self.spin_for_control(timeout, operation)
        })
    }

    /// Take the control side of the RT/control access seam, or `None` when the
    /// audio thread holds it. Never waits.
    fn try_claim_control(&self) -> Option<PluginAccessGuard<'_>> {
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
    fn spin_for_control<ResultValue>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut Runtime) -> Result<ResultValue, String>,
    ) -> Result<ResultValue, String> {
        let deadline = Instant::now() + timeout;

        loop {
            if let Some(_guard) = self.try_claim_control() {
                return operation(unsafe { &mut *self.wrapper.get() });
            }

            if Instant::now() >= deadline {
                return Err(format!(
                    "Timed out waiting for plugin control access: {}",
                    self.name
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
            // An unloading instance is still wired into the scheduler, so blocks
            // keep arriving for it. It must not be processed, but this is the
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
        unsafe { &mut *self.wrapper.get() }.sync_processing_state();
    }
}

struct PluginAccessGuard<'a> {
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
            // Non-RT state/editor control owns the plugin. Leave the block as-is.
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

        // Convert MidiNoteEvent → HostMidiEvent using a stack array — no Vec
        // alloc. The engine's per-event frame offset travels with the note:
        // dropping it here would collapse a block's timing onto its first
        // frame, whatever the wrapper below does with it.
        let count = midi_events.len().min(MAX_MIDI_EVENTS);
        let mut event_buf = [HostMidiEvent::default(); MAX_MIDI_EVENTS];
        for (slot, event) in event_buf.iter_mut().zip(midi_events).take(count) {
            *slot = HostMidiEvent {
                note: event.note,
                velocity: event.velocity,
                channel: event.channel,
                is_note_on: event.is_note_on,
                frame_offset: event.frame_offset,
            };
        }

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

        if processed.is_none() {
            // Non-RT state/editor control owns the plugin. Leave the block as-is.
        }
    }

    fn apply_parameter_on_audio_thread(&mut self, id: u32, value: f64) -> bool {
        self.plugin.enqueue_parameter_on_audio_thread(id, value)
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
    use daw_engine::midi_fx::MIDI_EVENT_BUFFER_CAPACITY;
    use daw_plugin_host::{AudioPlugin, ClapWrapper};

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

        fn get_state(&self) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _state: &[u8]) -> Result<(), String> {
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

        fn poll_latency_change(&mut self) -> Result<Option<u32>, String> {
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

    fn editor_recording_plugin() -> (
        SharedHostedPlugin<EditorRecordingPlugin>,
        Arc<Mutex<Vec<(u32, f64)>>>,
    ) {
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

    /// A backend that records the parameter updates every process call is
    /// handed — the only place a queued write becomes observable to the plugin.
    /// One entry per call, so a write that arrives on the wrong block or not at
    /// all is visible rather than merely absent from a total.
    struct ProcessRecordingPlugin {
        processing: Arc<ProcessingGate>,
        processed: Arc<Mutex<Vec<Vec<(u32, f64)>>>>,
    }

    impl ProcessRecordingPlugin {
        fn record(&self, updates: &[HostParameterUpdate]) {
            self.processed.lock().expect("the process log").push(
                updates
                    .iter()
                    .map(|update| (update.param_id, update.value))
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

        fn get_state(&self) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _state: &[u8]) -> Result<(), String> {
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

        fn poll_latency_change(&mut self) -> Result<Option<u32>, String> {
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
        Arc<Mutex<Vec<Vec<(u32, f64)>>>>,
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

        assert!(slot.apply_parameter_on_audio_thread(3, 0.75));
        render_one_block(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(3, 0.75)]]
        );
    }

    /// Two producers now write the same queue. A parameter the user is holding
    /// and an automation lane writing the same id before one process call must
    /// reach the plugin as one value — the later of the two — rather than as
    /// two updates the plugin applies in whatever order the slots happen to sit
    /// in.
    #[test]
    fn an_audio_thread_write_coalesces_with_a_control_write_by_sequence() {
        let (mut slot, shared, processed) = process_recording_slot();

        shared
            .enqueue_parameter(3, 0.1)
            .expect("the pending queue has room");
        assert!(slot.apply_parameter_on_audio_thread(3, 0.9));
        render_one_block(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(3, 0.9)]]
        );
    }

    /// A non-finite value is refused before it can occupy a slot. A `NaN` handed
    /// to a plugin is a parameter the host can never move back, and the queue
    /// would carry it as readily as any other bit pattern.
    #[test]
    fn an_audio_thread_write_refuses_a_non_finite_value() {
        let (mut slot, _shared, processed) = process_recording_slot();

        assert!(!slot.apply_parameter_on_audio_thread(3, f64::NAN));
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

        assert!(slot.apply_parameter_on_audio_thread(3, 0.1));
        render_one_block(&mut slot);

        assert_eq!(
            *processed.lock().expect("the process log"),
            vec![vec![(3, 0.9)]],
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
        assert!(queue.enqueue(9, 0.1).is_ok());

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
                },
                PendingParameterUpdate {
                    param_id: 9,
                    value: 0.1,
                },
            ]
        );
    }

    #[test]
    fn pending_parameter_queue_coalesces_and_drains_latest_value() {
        let queue = PendingParameterQueue::new();

        assert!(queue.enqueue(7, 0.25).is_ok());
        assert!(queue.enqueue(7, 0.75).is_ok());

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = queue.drain(&mut drained);

        assert_eq!(count, 1);
        assert_eq!(
            drained[0],
            PendingParameterUpdate {
                param_id: 7,
                value: 0.75,
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
            assert!(queue.enqueue(7, index as f64).is_ok(), "write {index}");
        }
        assert!(
            queue.enqueue(9, 0.5).is_ok(),
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
                },
                PendingParameterUpdate {
                    param_id: 9,
                    value: 0.5,
                },
            ]
        );
    }

    #[test]
    fn pending_parameter_queue_rejects_new_ids_when_full() {
        let queue = PendingParameterQueue::new();

        for index in 0..PENDING_PARAMETER_CAPACITY {
            assert!(queue.enqueue(index as u32, index as f64).is_ok());
        }

        assert_eq!(queue.enqueue(999, 0.5), Err(()));

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = queue.drain(&mut drained);

        assert_eq!(count, PENDING_PARAMETER_CAPACITY);
        assert_eq!(
            drained[0],
            PendingParameterUpdate {
                param_id: 0,
                value: 0.0,
            }
        );
        assert_eq!(
            drained[PENDING_PARAMETER_CAPACITY - 1],
            PendingParameterUpdate {
                param_id: (PENDING_PARAMETER_CAPACITY - 1) as u32,
                value: (PENDING_PARAMETER_CAPACITY - 1) as f64,
            }
        );
    }

    #[test]
    fn pending_parameter_queue_keeps_updates_when_drain_output_is_full() {
        let queue = PendingParameterQueue::new();

        assert!(queue.enqueue(1, 0.1).is_ok());
        assert!(queue.enqueue(2, 0.2).is_ok());

        let mut first_drain = [PendingParameterUpdate::default(); 1];
        assert_eq!(queue.drain(&mut first_drain), 1);
        assert_eq!(
            first_drain[0],
            PendingParameterUpdate {
                param_id: 1,
                value: 0.1,
            }
        );

        let mut second_drain = [PendingParameterUpdate::default(); 1];
        assert_eq!(queue.drain(&mut second_drain), 1);
        assert_eq!(
            second_drain[0],
            PendingParameterUpdate {
                param_id: 2,
                value: 0.2,
            }
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
            }
        );
        assert_eq!(
            drained[1],
            PendingParameterUpdate {
                param_id: 1,
                value: 0.1,
            }
        );
    }

    #[test]
    fn pending_parameter_queue_clear_invalidates_accepted_updates() {
        let queue = PendingParameterQueue::new();

        assert!(queue.enqueue(7, 0.75).is_ok());
        assert!(queue.has_pending());
        queue.clear();

        let mut drained = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        assert_eq!(queue.drain(&mut drained), 0);
        assert!(!queue.has_pending());
    }

    #[test]
    fn process_drain_reads_updates_enqueued_for_runtime_delivery() {
        let queue = PendingParameterQueue::new();
        assert!(queue.enqueue(11, 0.42).is_ok());

        let mut scratch = [PendingParameterUpdate::default(); PENDING_PARAMETER_CAPACITY];
        let count = drain_pending_parameters_for_process(&queue, &mut scratch);

        assert_eq!(count, 1);
        assert_eq!(
            scratch[0],
            PendingParameterUpdate {
                param_id: 11,
                value: 0.42,
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
                Ok(plugin.get_name().to_string())
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
        let outcome = shared.with_control(Duration::from_millis(60), |_| Ok(()));

        assert_eq!(
            outcome,
            Err("Timed out waiting for plugin control access: fixture".to_string())
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
                waiting_plugin.with_control(Duration::from_secs(2), |_| Ok(()))
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
                    Ok(())
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

    #[test]
    fn plugin_lifecycle_rejects_public_control_after_unload_begins() {
        let lifecycle = PluginRuntimeLifecycle::new();

        assert!(lifecycle.ensure_public_control_allowed("fixture").is_ok());

        lifecycle.begin_unload();

        assert_eq!(
            lifecycle.ensure_public_control_allowed("fixture"),
            Err("Engine-owned plugin instance 'fixture' is unloading".to_string())
        );
        assert!(!lifecycle.allows_process());
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
        rtrb::Producer<CrumbsCommand>,
        rtrb::Consumer<PendingRecordingCommit>,
        rtrb::Producer<RecordBufferPair>,
    ) {
        let (tx, rx) = rtrb::RingBuffer::new(8);
        let (commit_tx, commit_rx) = rtrb::RingBuffer::new(2);
        let (recycle_tx, recycle_rx) = rtrb::RingBuffer::new(2);
        let mut engine = CrumbsEngine::new(48_000.0);
        engine.enable_commit_handoff();
        let slot = CrumbsPluginSlot {
            engine,
            command_rx: rx,
            commit_tx,
            recycle_rx,
        };
        (slot, tx, commit_rx, recycle_tx)
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
    fn queue_a_sounding_note(tx: &mut rtrb::Producer<CrumbsCommand>) {
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
    fn queue_a_loaded_sample(tx: &mut rtrb::Producer<CrumbsCommand>) {
        use daw_dsp::crumbs::sample::SampleData;

        tx.push(CrumbsCommand::AddSample {
            id: 1,
            data: Arc::new(SampleData::from_mono(vec![0.1; 4800], 48_000)),
        })
        .unwrap();
        tx.push(CrumbsCommand::SetActiveSample(1)).unwrap();
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

        fn get_state(&self) -> Result<Vec<u8>, String> {
            Ok(Vec::new())
        }

        fn set_state(&mut self, _state: &[u8]) -> Result<(), String> {
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

        fn poll_latency_change(&mut self) -> Result<Option<u32>, String> {
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

pub struct CrumbsPluginSlot {
    pub engine: CrumbsEngine,
    pub command_rx: Consumer<CrumbsCommand>,
    pub commit_tx: rtrb::Producer<PendingRecordingCommit>,
    pub recycle_rx: Consumer<RecordBufferPair>,
}

impl CrumbsPluginSlot {
    /// Shared block body for every render path.
    ///
    /// The slot adds its voice into the mix it is handed. On the master chain
    /// the buffers carry the native sum every member ordered ahead of this one
    /// has already written, and `CrumbsEngine::process_block` sums into them,
    /// so nothing here may zero them: doing so erases those members outright.
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
        // Adopt recycled record buffers BEFORE draining commands: an
        // ArmRecording processed in this same block must find the capacity
        // the command side just returned. Adopting after the command drain
        // silently refused any re-arm that raced a drained commit (PR #579
        // review — silent take loss on fast stop→record). O(1) ring pops,
        // allocation-free on this thread, independent of command ordering.
        while let Ok((buf_left, buf_right)) = self.recycle_rx.pop() {
            self.engine.return_record_buffers(buf_left, buf_right);
        }

        // Drain commands from the UI thread
        while let Ok(cmd) = self.command_rx.pop() {
            self.engine.handle_command(cmd);
        }

        // Render up to each event's own frame before dispatching it, so a note
        // sounds on the sample it was written for rather than at the head of
        // the block that carried it. Dispatching the whole list first puts
        // every note up to a buffer early, which is a timing no DAW invents.
        // The engine stamps its events non-decreasing, so the cursor only ever
        // moves forward.
        let mut cursor = 0;
        for event in midi_events {
            let offset = (event.frame_offset as usize).min(num_samples);
            if offset > cursor {
                self.render_segment(left, right, cursor, offset);
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

        // Forward any committed take to the command side over the SPSC ring.
        // The engine did only pointer moves; the clone + pool insertion
        // happen off-thread in the drain helper. A full ring (command side
        // not draining) drops the take rather than allocating here.
        if let Some((take_left, take_right)) = self.engine.take_pending_commit() {
            let _ = self.commit_tx.push(PendingRecordingCommit {
                left: take_left,
                right: take_right,
                sample_rate: self.engine.sample_rate() as u32,
            });
        }
    }

    /// Render `from..to` of the block through the engine, which sums into
    /// whatever the buffers already carry.
    fn render_segment(&mut self, left: &mut [f32], right: &mut [f32], from: usize, to: usize) {
        self.engine
            .process_block(&mut left[from..to], &mut right[from..to]);
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

    /// The sampler's record feed: the engine's own input tap, delivered ahead
    /// of the block this slot renders.
    ///
    /// An unserved block carries zeros and is fed all the same, deliberately.
    /// A capture dropout then lands in the take as silence of exactly the
    /// duration it lasted, where skipping it would compress time and move
    /// every frame after the gap earlier than the musician played it. Zeros
    /// before the threshold crossing cost nothing: an armed take consumes no
    /// `max_duration` until it triggers.
    ///
    /// `latency_frames` and `position_frames` are not consumed here. A Crumbs
    /// take is a threshold-triggered one-shot whose own zero is the crossing,
    /// not a position on the timeline, so it has nothing to align to; latency
    /// compensation belongs to the timeline recorder that anchors its take to
    /// the transport.
    ///
    /// RT-safe: the record buffers are sized when the take is armed and an arm
    /// that finds no capacity refuses rather than allocating
    /// (`daw_dsp::crumbs::engine` — `ArmRecording`), so this path only pushes
    /// into capacity that already exists.
    fn process_capture_input(&mut self, block: CaptureInputBlock<'_>) {
        self.engine.process_record_input(block.left, block.right);
    }

    fn name(&self) -> &str {
        "Crumbs"
    }

    fn accepts_midi(&self) -> bool {
        true
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
