/// Drum mode — MPC-style pad grid with choke groups.
///
/// Each MIDI note maps to a pad, and each pad has its own sample,
/// envelope, filter, and choke group assignment. Pads default to
/// one-shot playback. Choke groups allow exclusive playback (e.g.,
/// open and closed hi-hat).
use super::super::types::{PadConfig, PlaybackMode, SampleId};
use super::super::voice::VoiceTriggerParams;

// ── Constants ──────────────────────────────────────────────────────────

/// Maximum number of pads in drum mode.
pub const MAX_PADS: usize = 128;

/// Default base note for the first pad.
///
/// 36 is where the General MIDI percussion map begins (35/36 are the two bass
/// drums) and where Ableton's Drum Rack, Battery and the MPC pad banks all put
/// their first visible pad. Every one of them maps one pad per semitone upward
/// from there, which is what `note_to_pad` does.
const DEFAULT_BASE_NOTE: u8 = 36;

// ── Drum Mode ──────────────────────────────────────────────────────────

/// Drum mode state: a grid of pads, each with independent configuration.
#[derive(Debug, Clone)]
pub struct DrumMode {
    pads: Vec<PadConfig>,
    base_note: u8,
    /// Sample every unassigned pad falls back to — the loaded sample.
    ///
    /// A drum rack with nothing mapped is a *default kit*, not silence: load a
    /// sample into a hardware or software drum sampler and the pads play it
    /// immediately. Only an explicit `set_pad_sample` overrides this, so the
    /// user's mapping always wins, and an empty pool still yields None rather
    /// than a voice pointed at a sample that does not exist.
    default_sample: Option<SampleId>,
}

impl DrumMode {
    pub fn new() -> Self {
        let mut pads = Vec::with_capacity(MAX_PADS);
        for idx in 0..MAX_PADS {
            let mut pad = PadConfig::default();
            pad.playback_mode = PlaybackMode::OneShot;
            pad.root_note = (DEFAULT_BASE_NOTE as usize + idx).min(127) as u8;
            pads.push(pad);
        }
        Self {
            pads,
            base_note: DEFAULT_BASE_NOTE,
            default_sample: None,
        }
    }

    /// Point every unassigned pad at the loaded sample.
    ///
    /// Called when the engine's sample selection changes. Writes one `Option`,
    /// so it is safe on the audio thread.
    pub fn set_default_sample(&mut self, sample_id: SampleId) {
        self.default_sample = Some(sample_id);
    }

    /// Get the pad index for a given MIDI note.
    fn note_to_pad(&self, note: u8) -> Option<usize> {
        if note < self.base_note {
            return None;
        }
        let idx = (note - self.base_note) as usize;
        if idx < self.pads.len() {
            Some(idx)
        } else {
            None
        }
    }

    /// Get a reference to a pad's configuration.
    pub fn get_pad(&self, pad_index: usize) -> Option<&PadConfig> {
        self.pads.get(pad_index)
    }

    /// Get a mutable reference to a pad's configuration.
    pub fn get_pad_mut(&mut self, pad_index: usize) -> Option<&mut PadConfig> {
        self.pads.get_mut(pad_index)
    }

    /// Assign a sample to a pad.
    pub fn set_pad_sample(&mut self, pad_index: usize, sample_id: SampleId) {
        if let Some(pad) = self.pads.get_mut(pad_index) {
            pad.sample_id = Some(sample_id);
        }
    }

    /// Set the choke group for a pad. 0 = no choke group.
    pub fn set_pad_choke_group(&mut self, pad_index: usize, choke_group: u8) {
        if let Some(pad) = self.pads.get_mut(pad_index) {
            pad.choke_group = choke_group;
        }
    }

    /// Build voice trigger parameters for a given MIDI note.
    ///
    /// Returns None if the note maps to no pad, or if nothing is loaded for the
    /// pad to play — an explicit assignment first, then the default kit.
    pub fn trigger_params(&self, note: u8, velocity: u8) -> Option<VoiceTriggerParams> {
        let pad_idx = self.note_to_pad(note)?;
        let pad = &self.pads[pad_idx];

        // An explicit assignment wins; otherwise the pad plays the loaded
        // sample. Only an empty pool leaves nothing to trigger.
        let sample_id = pad.sample_id.or(self.default_sample)?;

        Some(VoiceTriggerParams {
            note,
            velocity,
            sample_id,
            root_note: pad.root_note,
            choke_group: pad.choke_group,
            playback_mode: pad.playback_mode,
            loop_mode: super::super::types::LoopMode::Off,
            loop_start: pad.start_offset,
            loop_end: pad.end_offset,
            loop_crossfade: 0,
            start_frame: pad.start_offset,
            attack: pad.attack,
            hold: 0.0,
            decay: pad.decay,
            sustain: pad.sustain,
            release: pad.release,
            filter_cutoff: pad.filter_cutoff,
            filter_resonance: pad.filter_resonance,
            filter_type: pad.filter_type,
        })
    }

    /// Get the choke group for a note, if any.
    ///
    /// Used by the engine to silence other voices in the same choke group.
    pub fn choke_group_for_note(&self, note: u8) -> u8 {
        match self.note_to_pad(note) {
            Some(idx) => self.pads[idx].choke_group,
            None => 0,
        }
    }

    /// Get the base note (MIDI note of pad 0).
    pub fn base_note(&self) -> u8 {
        self.base_note
    }

    /// Set the base note.
    pub fn set_base_note(&mut self, note: u8) {
        self.base_note = note;
    }
}

impl Default for DrumMode {
    fn default() -> Self {
        Self::new()
    }
}
