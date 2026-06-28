/// Bridge: implements daw_engine::NativePlugin for ClapWrapper and Vst3Wrapper.
///
/// This allows plugin instances from daw-plugin-host to be sent to the native
/// audio thread and processed inline by the scheduler — no IPC in the audio path.
/// Supports MIDI note events and transport info forwarding.
///
/// RT-safety: all scratch buffers are preallocated. No heap allocation occurs
/// in any `NativePlugin` method.
use daw_engine::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::types::CrumbsCommand;
use daw_plugin_host::{AudioPlugin, ClapParameterUpdate, ClapWrapper, PluginParameter, Vst3Wrapper};
use rtrb::Consumer;
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

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
                slot.state
                    .store(PENDING_PARAMETER_READY, Ordering::Release);
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
            slot.state
                .store(PENDING_PARAMETER_READY, Ordering::Release);
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
            slot.state
                .store(PENDING_PARAMETER_EMPTY, Ordering::Release);
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
            slot.state
                .store(PENDING_PARAMETER_EMPTY, Ordering::Release);
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
        Self {
            name,
            wrapper: UnsafeCell::new(wrapper),
            access_state: AtomicU8::new(PLUGIN_ACCESS_IDLE),
            lifecycle: PluginRuntimeLifecycle::new(),
            non_rt_control_lock: Mutex::new(()),
            activated,
            pending_parameters: PendingParameterQueue::new(),
        }
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

        self.pending_parameters.enqueue(param_id, value).map_err(|()| {
            format!("Pending parameter queue full for plugin '{}'", self.name)
        })
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
        self.lifecycle.begin_unload();
    }

    pub fn retire(&self) {
        self.lifecycle.retire();
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

    fn lock_non_rt_control(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.non_rt_control_lock.lock().map_err(|error| {
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
        let deadline = Instant::now() + timeout;

        loop {
            if self
                .access_state
                .compare_exchange(
                    PLUGIN_ACCESS_IDLE,
                    PLUGIN_ACCESS_CONTROL,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_ok()
            {
                let _guard = PluginAccessGuard {
                    access_state: &self.access_state,
                };
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
        _transport: &TransportState,
    ) {
        let n = num_samples.min(MAX_BUFFER);

        // Convert MidiNoteEvent → (u8, u8, i16, bool) using a stack array — no Vec alloc.
        let count = midi_events.len().min(MAX_MIDI_EVENTS);
        let mut event_buf = [(0u8, 0u8, 0i16, false); MAX_MIDI_EVENTS];
        for (i, e) in midi_events.iter().enumerate().take(count) {
            event_buf[i] = (e.note, e.velocity, e.channel, e.is_note_on);
        }

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

/// VST3 plugin slot — adapts Vst3Wrapper for the native audio thread.
pub struct Vst3PluginSlot {
    pub wrapper: Vst3Wrapper,
}

impl NativePlugin for Vst3PluginSlot {
    fn process_audio(&mut self, _left: &mut [f32], _right: &mut [f32], _num_samples: usize) {
        // Vst3Wrapper is currently passthrough-only (COM audio processing pending).
        // Audio passes through unchanged — no allocation needed.
        // When COM processing is added, add preallocated scratch buffers here.
    }

    fn name(&self) -> &str {
        self.wrapper.get_name()
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
        assert_eq!(drain_pending_parameters_for_process(&queue, &mut scratch), 0);
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
}

/// Crumbs plugin slot — adapts CrumbsEngine for the native audio thread.
pub struct CrumbsPluginSlot {
    pub engine: CrumbsEngine,
    pub command_rx: Consumer<CrumbsCommand>,
}

impl NativePlugin for CrumbsPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        // Drain commands from the UI thread
        while let Ok(cmd) = self.command_rx.pop() {
            self.engine.handle_command(cmd);
        }

        // CrumbsEngine adds to buffers, so we should zero them if we are the only generator
        // in this slot. NativePlugin's contract is in-place, but for an instrument
        // it usually means starting fresh in the given buffer.
        left[..num_samples].fill(0.0);
        right[..num_samples].fill(0.0);

        self.engine.process_block(left, right);
    }

    fn process_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        // Drain commands
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
                self.engine.handle_command(CrumbsCommand::NoteOff { note: event.note });
            }
        }

        left[..num_samples].fill(0.0);
        right[..num_samples].fill(0.0);
        self.engine.process_block(left, right);
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
