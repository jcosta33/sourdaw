//! Plugin slot — trait for external plugins processed on the native audio thread.

use std::any::Any;

/// A MIDI note event to send to a plugin.
#[derive(Clone, Copy)]
pub struct MidiNoteEvent {
    pub note: u8,
    pub velocity: u8,
    pub channel: i16,
    pub is_note_on: bool,
    /// Fixed acceptance cutoff in the inclusive range 0..=2^32.
    pub probability_cutoff: u64,
    pub project_probability_seed: u32,
    pub clip_id_hash: u32,
    pub event_id_hash: u32,
    pub absolute_occurrence_index: u64,
}

/// Transport state for plugins that need tempo/position info.
///
/// Ownership is split by field, not by writer: tempo and time signature are
/// owned by the plugin-transport path (`update_plugin_transport`, applied via
/// `GraphCommand::SetTransport`), while `is_playing` and the song position
/// are also written by the graph path (`GraphCommand::SetTransportPlayback`),
/// which merges into the held state and re-derives `song_pos_beats` from the
/// tempo it does not own. A graph transport write can never move a
/// plugin-visible tempo or time signature.
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

    /// Process a block that arrived over an audio bridge — the only path
    /// whose buffers carry real input audio from the app. Default delegates
    /// to process_audio, so existing plugins keep exactly one behaviour;
    /// plugins that consume their input (e.g. recording) override this to
    /// run input-side work only for real bridge audio, never for the
    /// standalone native chain (whose scratch carries no app input).
    fn process_bridged_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        self.process_audio(left, right, num_samples);
    }

    /// Bridged counterpart of process_with_events (see process_bridged_audio).
    fn process_bridged_with_events(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        num_samples: usize,
        midi_events: &[MidiNoteEvent],
        transport: &TransportState,
    ) {
        self.process_with_events(left, right, num_samples, midi_events, transport);
    }

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
