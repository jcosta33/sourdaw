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
use daw_plugin_host::{AudioPlugin, ClapParameterUpdate, ClapWrapper, Vst3Wrapper};
use rtrb::Consumer;
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
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

type PendingParameterUpdate = ClapParameterUpdate;

struct PendingParameterSlot {
    param_id: AtomicU32,
    value_bits: AtomicU64,
    state: AtomicU8,
}

impl PendingParameterSlot {
    fn new() -> Self {
        Self {
            param_id: AtomicU32::new(0),
            value_bits: AtomicU64::new(0.0f64.to_bits()),
            state: AtomicU8::new(PENDING_PARAMETER_EMPTY),
        }
    }
}

struct PendingParameterQueue {
    slots: [PendingParameterSlot; PENDING_PARAMETER_CAPACITY],
}

impl PendingParameterQueue {
    fn new() -> Self {
        Self {
            slots: std::array::from_fn(|_| PendingParameterSlot::new()),
        }
    }

    fn enqueue(&self, param_id: u32, value: f64) -> Result<(), ()> {
        let value_bits = value.to_bits();

        if self.coalesce(param_id, value_bits) {
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
                slot.state
                    .store(PENDING_PARAMETER_READY, Ordering::Release);
                return Ok(());
            }
        }

        if self.coalesce(param_id, value_bits) {
            return Ok(());
        }

        Err(())
    }

    fn coalesce(&self, param_id: u32, value_bits: u64) -> bool {
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
            slot.state
                .store(PENDING_PARAMETER_READY, Ordering::Release);
            return true;
        }

        false
    }

    fn drain(&self, out: &mut [PendingParameterUpdate]) -> usize {
        let mut count = 0;

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

            out[count] = PendingParameterUpdate {
                param_id: slot.param_id.load(Ordering::Relaxed),
                value: f64::from_bits(slot.value_bits.load(Ordering::Relaxed)),
            };
            count += 1;
            slot.state
                .store(PENDING_PARAMETER_EMPTY, Ordering::Release);
        }

        count
    }
}

/// Runtime owner for a CLAP plugin shared by the RT processor and non-RT control path.
pub struct SharedClapPlugin {
    name: String,
    wrapper: UnsafeCell<ClapWrapper>,
    access_state: AtomicU8,
    pending_parameters: PendingParameterQueue,
}

// SAFETY: access_state enforces exclusive mutable access to wrapper. The audio
// path never waits; if non-RT control owns the wrapper, processing bypasses it.
unsafe impl Send for SharedClapPlugin {}
unsafe impl Sync for SharedClapPlugin {}

impl SharedClapPlugin {
    pub fn new(wrapper: ClapWrapper) -> Self {
        let name = wrapper.get_name().to_string();
        Self {
            name,
            wrapper: UnsafeCell::new(wrapper),
            access_state: AtomicU8::new(PLUGIN_ACCESS_IDLE),
            pending_parameters: PendingParameterQueue::new(),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn enqueue_parameter(&self, param_id: u32, value: f64) -> Result<(), String> {
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

    pub fn with_control<ResultValue>(
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

impl NativePlugin for ClapPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let n = num_samples.min(MAX_BUFFER);
        let processed = self.plugin.with_process(|wrapper, pending_parameters| {
            let parameter_count = pending_parameters.drain(&mut self.pending_parameter_scratch);
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
            let parameter_count = pending_parameters.drain(&mut self.pending_parameter_scratch);
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
