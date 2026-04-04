/// Bridge: implements daw_engine::NativePlugin for ClapWrapper and Vst3Wrapper.
///
/// This allows plugin instances from daw-plugin-host to be sent to the native
/// audio thread and processed inline by the scheduler — no IPC in the audio path.
/// Supports MIDI note events and transport info forwarding.
///
/// RT-safety: all scratch buffers are preallocated. No heap allocation occurs
/// in any `NativePlugin` method.

use daw_engine::plugin_slot::{NativePlugin, MidiNoteEvent, TransportState};
use daw_plugin_host::ClapWrapper;
use daw_plugin_host::Vst3Wrapper;
use daw_plugin_host::AudioPlugin;

/// Maximum block size the native engine produces (matches ClapWrapper activation).
const MAX_BUFFER: usize = 4096;
/// Maximum MIDI events per block for the event-conversion scratch array.
const MAX_MIDI_EVENTS: usize = 64;

/// Newtype wrapper that implements NativePlugin for ClapWrapper.
pub struct ClapPluginSlot {
    pub wrapper: ClapWrapper,
    /// Preallocated output scratch for left channel (avoids per-block Vec alloc on RT thread).
    out_l_scratch: Box<[f32; MAX_BUFFER]>,
    /// Preallocated output scratch for right channel.
    out_r_scratch: Box<[f32; MAX_BUFFER]>,
}

impl ClapPluginSlot {
    pub fn new(wrapper: ClapWrapper) -> Self {
        Self {
            wrapper,
            out_l_scratch: Box::new([0.0f32; MAX_BUFFER]),
            out_r_scratch: Box::new([0.0f32; MAX_BUFFER]),
        }
    }
}

impl NativePlugin for ClapPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let n = num_samples.min(MAX_BUFFER);
        let inputs: [&[f32]; 2] = [&left[..n], &right[..n]];
        // Destructure to satisfy the borrow checker: wrapper + scratch are separate fields.
        let (wrapper, out_l, out_r) = (&mut self.wrapper, &mut self.out_l_scratch, &mut self.out_r_scratch);
        {
            let mut outputs: [&mut [f32]; 2] = [&mut out_l[..n], &mut out_r[..n]];
            wrapper.process(&inputs, &mut outputs, n);
        }
        left[..n].copy_from_slice(&out_l[..n]);
        right[..n].copy_from_slice(&out_r[..n]);
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

        let inputs: [&[f32]; 2] = [&left[..n], &right[..n]];
        let (wrapper, out_l, out_r) = (&mut self.wrapper, &mut self.out_l_scratch, &mut self.out_r_scratch);
        {
            let mut outputs: [&mut [f32]; 2] = [&mut out_l[..n], &mut out_r[..n]];
            wrapper.process_with_midi(&inputs, &mut outputs, n, &event_buf[..count]);
        }
        left[..n].copy_from_slice(&out_l[..n]);
        right[..n].copy_from_slice(&out_r[..n]);
    }

    fn set_param(&mut self, param_id: u32, value: f64) {
        self.wrapper.set_parameter(param_id, value);
    }

    fn name(&self) -> &str {
        self.wrapper.get_name()
    }

    fn accepts_midi(&self) -> bool {
        true // CLAP instruments accept MIDI
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
}
