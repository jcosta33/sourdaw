use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::types::CrumbsCommand;
/// Bridge: implements daw_engine::NativePlugin for ClapWrapper.
///
/// This allows plugin instances from daw-plugin-host to be sent to the native
/// audio thread and processed inline by the scheduler — no IPC in the audio path.
/// Supports MIDI note events and transport info forwarding.
///
/// RT-safety: all scratch buffers are preallocated. No heap allocation occurs
/// in any `NativePlugin` method.
use daw_engine::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use daw_plugin_host::{
    AudioPlugin, ClapParameterUpdate, ClapWrapper, HostTransport, PluginParameter, ProcessingGate,
};
use rtrb::Consumer;
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
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
const MAX_MIDI_EVENTS: usize = 64;
/// Bounded pending parameter capacity, matched to ClapWrapper's process-event scratch.
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

type PendingParameterUpdate = ClapParameterUpdate;

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

            slot.value_bits.store(value_bits, Ordering::Relaxed);
            slot.sequence.store(sequence, Ordering::Relaxed);
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

    fn clear(&self) {
        for slot in &self.slots {
            slot.state.store(PENDING_PARAMETER_EMPTY, Ordering::Release);
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

/// Runtime owner for a CLAP plugin shared by the RT processor and non-RT control path.
pub struct SharedClapPlugin {
    name: String,
    wrapper: UnsafeCell<ClapWrapper>,
    access_state: AtomicU8,
    lifecycle: PluginRuntimeLifecycle,
    non_rt_control_lock: Mutex<()>,
    activated: bool,
    /// Shared with the wrapper. Lets the control path ask for the CLAP
    /// processing state to be left without performing the transition itself.
    processing: Arc<ProcessingGate>,
    pending_parameters: PendingParameterQueue,
}

// SAFETY: access_state enforces exclusive mutable access to wrapper. The audio
// path never waits; if non-RT control owns the wrapper, processing bypasses it.
unsafe impl Send for SharedClapPlugin {}
unsafe impl Sync for SharedClapPlugin {}

impl SharedClapPlugin {
    pub fn new(wrapper: ClapWrapper) -> Self {
        let name = wrapper.get_name().to_string();
        let activated = wrapper.is_activated();
        let processing = wrapper.processing_gate();
        Self {
            name,
            wrapper: UnsafeCell::new(wrapper),
            access_state: AtomicU8::new(PLUGIN_ACCESS_IDLE),
            lifecycle: PluginRuntimeLifecycle::new(),
            non_rt_control_lock: Mutex::new(()),
            activated,
            processing,
            pending_parameters: PendingParameterQueue::new(),
        }
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
            .map_err(|()| format!("Pending parameter queue full for plugin '{}'", self.name))
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

            Ok(plugin.get_state())
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
    /// latency in **milliseconds**, or `None` when nothing was pending.
    ///
    /// Milliseconds, not samples: the plugin counts latency in frames of the rate
    /// it was ACTIVATED with (the CPAL device rate). That is a different clock
    /// from the webview's `AudioContext`, so a sample count must not cross the
    /// IPC boundary — `ClapWrapper::latency_ms` converts where the rate is known.
    ///
    /// Runs on the non-RT control path through the existing CAS control seam, so
    /// the deactivate/reactivate a latency change requires cannot race the RT
    /// `process` path — and it adds no new audio-thread calls.
    pub fn poll_latency_change_ms(&self, timeout: Duration) -> Result<Option<f64>, String> {
        self.with_control(timeout, |plugin| match plugin.poll_latency_change()? {
            Some(_) => Ok(Some(plugin.latency_ms())),
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
        operation: impl FnOnce(&mut ClapWrapper) -> Result<ResultValue, String>,
    ) -> Result<ResultValue, String> {
        let _non_rt_control_guard = self.lock_non_rt_control()?;
        self.ensure_active_lifecycle()?;
        self.with_control_locked(timeout, operation)
    }

    pub fn with_unload_control<ResultValue>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut ClapWrapper) -> Result<ResultValue, String>,
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

    fn ensure_active_lifecycle(&self) -> Result<(), String> {
        self.lifecycle.ensure_public_control_allowed(&self.name)
    }

    fn with_control_locked<ResultValue>(
        &self,
        timeout: Duration,
        operation: impl FnOnce(&mut ClapWrapper) -> Result<ResultValue, String>,
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
        operation: impl FnOnce(&mut ClapWrapper) -> Result<ResultValue, String>,
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
        operation: impl FnOnce(&mut ClapWrapper, &PendingParameterQueue) -> ResultValue,
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

/// RT processing handle for a shared CLAP runtime plugin.
pub struct ClapPluginSlot {
    plugin: Arc<SharedClapPlugin>,
    /// Preallocated output scratch for left channel (avoids per-block Vec alloc on RT thread).
    out_l_scratch: Box<[f32; MAX_BUFFER]>,
    /// Preallocated output scratch for right channel.
    out_r_scratch: Box<[f32; MAX_BUFFER]>,
    /// Preallocated pending parameter drain scratch.
    pending_parameter_scratch: [PendingParameterUpdate; PENDING_PARAMETER_CAPACITY],
}

impl ClapPluginSlot {
    pub fn new(plugin: Arc<SharedClapPlugin>) -> Self {
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

impl NativePlugin for ClapPluginSlot {
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

        // Convert MidiNoteEvent → (u8, u8, i16, bool) using a stack array — no Vec alloc.
        let count = midi_events.len().min(MAX_MIDI_EVENTS);
        let mut event_buf = [(0u8, 0u8, 0i16, false); MAX_MIDI_EVENTS];
        for (i, e) in midi_events.iter().enumerate().take(count) {
            event_buf[i] = (e.note, e.velocity, e.channel, e.is_note_on);
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

    fn name(&self) -> &str {
        self.plugin.name()
    }

    fn accepts_midi(&self) -> bool {
        true // CLAP instruments accept MIDI
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
        let shared = SharedClapPlugin::new(wrapper);
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
        let shared = SharedClapPlugin::new(wrapper);
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
        let shared = SharedClapPlugin::new(wrapper);

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
        let shared = SharedClapPlugin::new(wrapper);
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
            let shared = Arc::new(SharedClapPlugin::new(wrapper));
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
            let shared = Arc::new(SharedClapPlugin::new(wrapper));

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

    /// Wiring-boundary regression (ledger #508 row 24): the slot must feed
    /// the incoming audio buffers to the engine's record input before
    /// zeroing them. Pre-fix the buffers were discarded unread, so an armed
    /// recording captured silence end-to-end.
    #[test]
    fn crumbs_slot_feeds_record_input_to_engine() {
        use daw_dsp::crumbs::types::{CrumbsMode, RecordState};

        let (mut slot, mut tx, mut commit_rx, _recycle_tx) = crumbs_slot_with_rings();

        tx.push(CrumbsCommand::SetMode(CrumbsMode::Record)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        })
        .unwrap();

        let frames = 256;
        let mut left = vec![0.5f32; frames];
        let mut right = vec![0.5f32; frames];
        slot.process_bridged_audio(&mut left, &mut right, frames);

        assert_eq!(
            slot.engine.record_state(),
            RecordState::Recording,
            "over-threshold input through the slot must start the take"
        );

        tx.push(CrumbsCommand::StopRecording).unwrap();
        let mut flush_l = vec![0.0f32; 128];
        let mut flush_r = vec![0.0f32; 128];
        slot.process_bridged_audio(&mut flush_l, &mut flush_r, 128);

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
            "committed buffer must hold the fed input, not silence"
        );
        assert!(
            commit.right.iter().all(|&s| (s - 0.5).abs() < 1.0e-6),
            "committed buffer must hold the fed input, not silence"
        );
        assert_eq!(commit.sample_rate, 48_000);
    }

    /// PR #564 review (blocking): the real CPAL callback interleaves bridge
    /// bursts (real audio) with standalone process_block over zeroed
    /// scratch. The record feed must be bridge-only, so the committed take
    /// contains the real frames and NOTHING from the standalone path.
    #[test]
    fn crumbs_take_has_no_interleaved_silence_across_callback_paths() {
        use daw_dsp::crumbs::types::{CrumbsMode, RecordState};

        let (mut slot, mut tx, mut commit_rx, _recycle_tx) = crumbs_slot_with_rings();

        tx.push(CrumbsCommand::SetMode(CrumbsMode::Record)).unwrap();
        tx.push(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        })
        .unwrap();

        // Real callback pattern: 8 bridged 128-frame bursts of real audio
        // (1024 frames), then a 4096-frame device buffer of zeroed
        // standalone scratch (in the callback's 128-frame chunks).
        for _ in 0..8 {
            let mut left = vec![0.5f32; 128];
            let mut right = vec![0.5f32; 128];
            slot.process_bridged_audio(&mut left, &mut right, 128);
        }
        assert_eq!(slot.engine.record_state(), RecordState::Recording);

        for _ in 0..32 {
            let mut left = vec![0.0f32; 128];
            let mut right = vec![0.0f32; 128];
            slot.process_audio(&mut left, &mut right, 128);
        }

        tx.push(CrumbsCommand::StopRecording).unwrap();
        let mut flush_l = vec![0.0f32; 128];
        let mut flush_r = vec![0.0f32; 128];
        slot.process_bridged_audio(&mut flush_l, &mut flush_r, 128);

        let commit = commit_rx
            .pop()
            .expect("stopping an armed take must hand a commit to the ring");
        assert_eq!(
            commit.left.len(),
            1024,
            "standalone-chain silence must not enter the take (got {} frames)",
            commit.left.len()
        );
        assert!(
            commit.left.iter().all(|&s| (s - 0.5).abs() < 1.0e-6),
            "take must be the 1024 real frames, no interleaved zeros"
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
        let mut left = vec![0.5f32; 128];
        let mut right = vec![0.5f32; 128];
        slot.process_bridged_audio(&mut left, &mut right, 128);
        tx.push(CrumbsCommand::StopRecording).unwrap();
        let mut flush_l = vec![0.0f32; 128];
        let mut flush_r = vec![0.0f32; 128];
        slot.process_bridged_audio(&mut flush_l, &mut flush_r, 128);
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

        // One process call: must adopt the recycled pair, THEN process the
        // arm — in that order.
        slot.process_bridged_audio(&mut flush_l, &mut flush_r, 128);

        assert_eq!(
            slot.engine.record_state(),
            RecordState::Armed,
            "re-arm immediately after a drained commit must find recycled capacity"
        );

        // And the re-armed recorder actually captures the next take.
        let mut left2 = vec![0.5f32; 128];
        let mut right2 = vec![0.5f32; 128];
        slot.process_bridged_audio(&mut left2, &mut right2, 128);
        assert_eq!(slot.engine.record_state(), RecordState::Recording);
    }

    /// The same wiring must leave the engine untouched when it is not armed:
    /// feeding input in a non-Record mode captures nothing.
    #[test]
    fn crumbs_slot_ignores_record_input_when_not_armed() {
        let (mut slot, _tx, _commit_rx, _recycle_tx) = crumbs_slot_with_rings();

        // No SetMode(Record), no ArmRecording — default mode.
        let frames = 256;
        let mut left = vec![0.5f32; frames];
        let mut right = vec![0.5f32; frames];
        slot.process_bridged_audio(&mut left, &mut right, frames);
        slot.process_bridged_audio(&mut left, &mut right, frames);

        assert_eq!(slot.engine.sample_pool().count(), 0);
        assert_eq!(slot.engine.active_sample_id(), None);
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
    /// Shared block body. `feed_record_input` is true only for bridge
    /// processing: bridge buffers carry real input audio from the app, while
    /// the standalone native chain runs on silent scratch — feeding that
    /// scratch into an armed take interleaved a device-buffer of silence
    /// into every real burst (PR #564 review).
    fn process_block_internal(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        feed_record_input: bool,
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

        // Forward MIDI events to the engine
        for event in midi_events {
            if event.is_note_on {
                self.engine.handle_command(CrumbsCommand::NoteOn {
                    note: event.note,
                    velocity: event.velocity,
                });
            } else {
                self.engine
                    .handle_command(CrumbsCommand::NoteOff { note: event.note });
            }
        }

        if feed_record_input {
            self.engine
                .process_record_input(&left[..num_samples], &right[..num_samples]);
        }

        // CrumbsEngine adds to buffers, so we should zero them if we are the only generator
        // in this slot. NativePlugin's contract is in-place, but for an instrument
        // it usually means starting fresh in the given buffer.
        left[..num_samples].fill(0.0);
        right[..num_samples].fill(0.0);

        self.engine.process_block(left, right);

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
}

impl NativePlugin for CrumbsPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        // Standalone native chain: scratch carries no app input, so no
        // record feed here (bridge-only, see process_bridged_audio).
        self.process_block_internal(left, right, num_samples, &[], false);
    }

    fn process_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        self.process_block_internal(left, right, num_samples, midi_events, false);
    }

    fn process_bridged_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        // Bridge path: the buffers hold the worklet's real input block — the
        // one and only record-input feed.
        self.process_block_internal(left, right, num_samples, &[], true);
    }

    fn process_bridged_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        self.process_block_internal(left, right, num_samples, midi_events, true);
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
