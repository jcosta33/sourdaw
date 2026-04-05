/// Tuning system — maps detected frequency to note name and cent deviation.
/// Supports 12-TET (default), adjustable A4 reference, and cent offset tables.

const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

pub struct TuningSystem {
    pub a4_hz: f32,
    pub transpose_semitones: i32,
    pub capo_semitones: i32,
    /// Per-pitch-class cent offsets (sweeteners). Index 0=C, 1=C#, ... 11=B.
    pub offsets: [f32; 12],
}

impl TuningSystem {
    pub fn new() -> Self {
        Self {
            a4_hz: 440.0,
            transpose_semitones: 0,
            capo_semitones: 0,
            offsets: [0.0; 12],
        }
    }

    /// Given a detected frequency, return (midi_note, note_name_index, octave, cents_deviation).
    pub fn map_frequency(&self, freq: f32) -> (i32, usize, i32, f32) {
        if freq <= 0.0 {
            return (69, 9, 4, 0.0); // default A4
        }

        // Continuous MIDI note number relative to A4=69
        let semitones_from_a4 = 12.0 * (freq / self.a4_hz).log2();
        let midi_continuous = 69.0 + semitones_from_a4;

        // Apply transpose and capo
        let adjusted =
            midi_continuous - self.transpose_semitones as f32 - self.capo_semitones as f32;

        // Nearest integer MIDI note
        let midi_note = adjusted.round() as i32;
        let note_index = ((midi_note % 12 + 12) % 12) as usize;
        let octave = (midi_note / 12) - 1;

        // Cent deviation from nearest note (including sweetener offset)
        let target_cents = (midi_note as f32 - 69.0) * 100.0; // cents from A4
        let actual_cents = semitones_from_a4 * 100.0;
        let sweetener = self.offsets[note_index];
        let cents = actual_cents - target_cents - sweetener;

        (midi_note, note_index, octave, cents)
    }

    /// Get the note name string for a note index (0-11).
    pub fn note_name(note_index: usize) -> &'static str {
        NOTE_NAMES[note_index % 12]
    }

    /// Get the target frequency for a MIDI note number.
    pub fn midi_to_freq(&self, midi_note: i32) -> f32 {
        self.a4_hz * (2.0_f32).powf((midi_note as f32 - 69.0) / 12.0)
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "a4_hz" | "reference" => self.a4_hz = value.clamp(400.0, 490.0),
            "transpose" => self.transpose_semitones = (value as i32).clamp(-12, 12),
            "capo" => self.capo_semitones = (value as i32).clamp(0, 12),
            _ => {}
        }
    }
}
