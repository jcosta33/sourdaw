/// Quick mode — chromatic sample playback across the keyboard.
///
/// Maps a single sample chromatically: each MIDI note transposes the sample
/// relative to its root note using pitch ratio calculation. This is the
/// default mode for tonal samples.
use super::super::types::{FilterType, LoopMode, PlaybackMode, SampleId, LOOP_CROSSFADE_DEFAULT};
use super::super::voice::VoiceTriggerParams;

/// Quick mode state and parameter mapping.
#[derive(Debug, Clone)]
pub struct QuickMode {
    pub sample_id: SampleId,
    pub root_note: u8,
    pub playback_mode: PlaybackMode,
    pub loop_mode: LoopMode,
    pub loop_start: u32,
    pub loop_end: u32,
    pub loop_crossfade: u32,

    // Envelope
    pub attack: f32,
    pub hold: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,

    // Filter
    pub filter_cutoff: f32,
    pub filter_resonance: f32,
    pub filter_type: FilterType,
}

impl Default for QuickMode {
    fn default() -> Self {
        Self {
            sample_id: 0,
            root_note: 60,
            playback_mode: PlaybackMode::Sustain,
            loop_mode: LoopMode::Off,
            loop_start: 0,
            loop_end: 0,
            loop_crossfade: LOOP_CROSSFADE_DEFAULT,
            attack: 0.001,
            hold: 0.0,
            decay: 0.0,
            sustain: 1.0,
            release: 0.05,
            filter_cutoff: 20000.0,
            filter_resonance: 0.0,
            filter_type: FilterType::Lowpass,
        }
    }
}

impl QuickMode {
    /// Build voice trigger parameters for a given MIDI note.
    ///
    /// In Quick mode, every note triggers the same sample at different pitches.
    pub fn trigger_params(&self, note: u8, velocity: u8) -> VoiceTriggerParams {
        VoiceTriggerParams {
            note,
            velocity,
            sample_id: self.sample_id,
            root_note: self.root_note,
            choke_group: 0,
            playback_mode: self.playback_mode,
            loop_mode: self.loop_mode,
            loop_start: self.loop_start,
            loop_end: self.loop_end,
            loop_crossfade: self.loop_crossfade,
            start_frame: 0,
            attack: self.attack,
            hold: self.hold,
            decay: self.decay,
            sustain: self.sustain,
            release: self.release,
            filter_cutoff: self.filter_cutoff,
            filter_resonance: self.filter_resonance,
            filter_type: self.filter_type,
        }
    }
}
