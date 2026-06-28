/// Bridge: implements daw_engine::NativePlugin for ClapWrapper and Vst3Wrapper.
///
/// This allows plugin instances from daw-plugin-host to be sent to the native
/// audio thread and processed inline by the scheduler — no IPC in the audio path.
/// Supports MIDI note events and transport info forwarding.
///
/// RT-safety: all scratch buffers are preallocated. No heap allocation occurs
/// in any `NativePlugin` method.
use daw_engine::plugin_slot::{MidiNoteEvent, NativePlugin, TransportState};
use daw_plugin_host::AudioPlugin;
use daw_plugin_host::ClapWrapper;
use daw_plugin_host::Vst3Wrapper;
use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::types::CrumbsCommand;
use rtrb::Consumer;
use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

/// Maximum block size the native engine produces (matches ClapWrapper activation).
const MAX_BUFFER: usize = 4096;
/// Maximum MIDI events per block for the event-conversion scratch array.
const MAX_MIDI_EVENTS: usize = 64;

const PLUGIN_ACCESS_IDLE: u8 = 0;
const PLUGIN_ACCESS_PROCESSING: u8 = 1;
const PLUGIN_ACCESS_CONTROL: u8 = 2;

/// Runtime owner for a CLAP plugin shared by the RT processor and non-RT control path.
pub struct SharedClapPlugin {
    name: String,
    wrapper: UnsafeCell<ClapWrapper>,
    access_state: AtomicU8,
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
        }
    }

    pub fn name(&self) -> &str {
        &self.name
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
        operation: impl FnOnce(&mut ClapWrapper) -> ResultValue,
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
        Some(operation(unsafe { &mut *self.wrapper.get() }))
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
}

impl ClapPluginSlot {
    pub fn new(plugin: Arc<SharedClapPlugin>) -> Self {
        Self {
            plugin,
            out_l_scratch: Box::new([0.0f32; MAX_BUFFER]),
            out_r_scratch: Box::new([0.0f32; MAX_BUFFER]),
        }
    }
}

impl NativePlugin for ClapPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let n = num_samples.min(MAX_BUFFER);
        let processed = self.plugin.with_process(|wrapper| {
            let inputs: [&[f32]; 2] = [&left[..n], &right[..n]];
            let out_l = &mut self.out_l_scratch;
            let out_r = &mut self.out_r_scratch;
            {
                let mut outputs: [&mut [f32]; 2] = [&mut out_l[..n], &mut out_r[..n]];
                wrapper.process(&inputs, &mut outputs, n);
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

        let processed = self.plugin.with_process(|wrapper| {
            let inputs: [&[f32]; 2] = [&left[..n], &right[..n]];
            let out_l = &mut self.out_l_scratch;
            let out_r = &mut self.out_r_scratch;
            {
                let mut outputs: [&mut [f32]; 2] = [&mut out_l[..n], &mut out_r[..n]];
                wrapper.process_with_midi(&inputs, &mut outputs, n, &event_buf[..count]);
            }
            left[..n].copy_from_slice(&out_l[..n]);
            right[..n].copy_from_slice(&out_r[..n]);
        });

        if processed.is_none() {
            // Non-RT state/editor control owns the plugin. Leave the block as-is.
        }
    }

    fn set_param(&mut self, param_id: u32, value: f64) {
        let _ = self
            .plugin
            .with_process(|wrapper| wrapper.set_parameter(param_id, value));
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

    fn set_param(&mut self, param_id: u32, value: f64) {
        self.wrapper.set_parameter(param_id, value);
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

    fn set_param(&mut self, _param_id: u32, _value: f64) {
        // Crumbs uses named parameters via the command queue (command_rx).
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
