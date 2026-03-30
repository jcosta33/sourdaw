/// Bridge: implements daw_engine::NativePlugin for ClapWrapper.
///
/// This allows ClapWrapper instances to be sent to the native audio thread
/// and processed inline by the scheduler — no IPC in the audio path.
/// Supports MIDI note events and transport info forwarding.

use daw_engine::plugin_slot::{NativePlugin, MidiNoteEvent, TransportState};
use crate::host::clap_wrapper::ClapWrapper;
use crate::host::vst3_wrapper::Vst3Wrapper;
use crate::host::traits::AudioPlugin;

// CLAP event types are now handled directly in ClapWrapper.process_with_midi()

/// Newtype wrapper that implements NativePlugin for ClapWrapper.
pub struct ClapPluginSlot {
    pub wrapper: ClapWrapper,
}

impl NativePlugin for ClapPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let inputs: [&[f32]; 2] = [&left[..num_samples], &right[..num_samples]];
        let mut out_l = vec![0.0f32; num_samples];
        let mut out_r = vec![0.0f32; num_samples];
        {
            let mut outputs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
            self.wrapper.process(&inputs, &mut outputs, num_samples);
        }
        left[..num_samples].copy_from_slice(&out_l);
        right[..num_samples].copy_from_slice(&out_r);
    }

    fn process_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        // Convert to the tuple format ClapWrapper.process_with_midi expects
        let events: Vec<(u8, u8, i16, bool)> = midi_events.iter()
            .map(|e| (e.note, e.velocity, e.channel, e.is_note_on))
            .collect();

        let inputs: [&[f32]; 2] = [&left[..num_samples], &right[..num_samples]];
        let mut out_l = vec![0.0f32; num_samples];
        let mut out_r = vec![0.0f32; num_samples];
        {
            let mut outputs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
            self.wrapper.process_with_midi(&inputs, &mut outputs, num_samples, &events);
        }
        left[..num_samples].copy_from_slice(&out_l);
        right[..num_samples].copy_from_slice(&out_r);
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
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        let inputs: [&[f32]; 2] = [&left[..num_samples], &right[..num_samples]];
        let mut out_l = vec![0.0f32; num_samples];
        let mut out_r = vec![0.0f32; num_samples];
        {
            let mut outputs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
            self.wrapper.process(&inputs, &mut outputs, num_samples);
        }
        left[..num_samples].copy_from_slice(&out_l);
        right[..num_samples].copy_from_slice(&out_r);
    }

    fn set_param(&mut self, param_id: u32, value: f64) {
        self.wrapper.set_parameter(param_id, value);
    }

    fn name(&self) -> &str {
        self.wrapper.get_name()
    }
}
