//! Plugin slot — trait for external plugins processed on the native audio thread.

use std::any::Any;

/// A MIDI note event to send to a plugin.
#[derive(Clone, Copy)]
pub struct MidiNoteEvent {
    pub note: u8,
    pub velocity: u8,
    pub channel: i16,
    pub is_note_on: bool,
    pub probability: f32, // 0.0 to 1.0
}

/// Transport state for plugins that need tempo/position info.
#[derive(Clone, Copy)]
pub struct TransportState {
    pub tempo: f64,
    pub time_sig_num: u16,
    pub time_sig_denom: u16,
    pub is_playing: bool,
    pub song_pos_beats: f64,
    pub song_pos_seconds: f64,
}

impl Default for TransportState {
    fn default() -> Self {
        Self {
            tempo: 120.0,
            time_sig_num: 4,
            time_sig_denom: 4,
            is_playing: false,
            song_pos_beats: 0.0,
            song_pos_seconds: 0.0,
        }
    }
}

/// Trait for a plugin that can process audio on the real-time thread.
pub trait NativePlugin: Any + Send {
    /// Process a block of stereo audio in-place.
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize);

    /// Process audio with MIDI events and transport info.
    /// Default implementation ignores MIDI/transport and delegates to process_audio.
    fn process_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        _midi_events: &[MidiNoteEvent],
        _transport: &TransportState,
    ) {
        self.process_audio(left, right, num_samples);
    }

    /// Set a parameter by ID and value.
    fn set_param(&mut self, param_id: u32, value: f64);

    /// Get the plugin's name (for logging).
    fn name(&self) -> &str;

    /// Whether this plugin accepts MIDI input (instruments).
    fn accepts_midi(&self) -> bool {
        false
    }

    /// Expose concrete plugin adapters to non-RT control code after transfer.
    fn as_any(&self) -> &dyn Any;

    /// Expose concrete plugin adapters to non-RT control code after transfer.
    fn as_any_mut(&mut self) -> &mut dyn Any;
}
