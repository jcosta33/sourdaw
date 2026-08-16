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

        // Cent deviation from the nearest note, measured on the *adjusted*
        // grid. `midi_note` is the rounding of `adjusted`, so the deviation has
        // to come from `adjusted` too: measuring it from the unshifted
        // `midi_continuous` leaves the whole transpose+capo shift inside the
        // readout, and an in-tune A4 with transpose +12 reads +1200 cents.
        let sweetener = self.offsets[note_index];
        let cents = (adjusted - midi_note as f32) * 100.0 - sweetener;

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

#[cfg(test)]
mod tests {
    use super::*;

    /// A tone `cents` away from A440, so a test can state the deviation it
    /// expects to read back instead of a frequency literal.
    fn detuned_a4(cents: f32) -> f32 {
        440.0 * (2.0_f32).powf(cents / 1200.0)
    }

    #[test]
    fn exact_a4_reads_zero_cents() {
        let tuning = TuningSystem::new();
        let (midi, note_index, octave, cents) = tuning.map_frequency(440.0);
        assert_eq!((midi, note_index, octave), (69, 9, 4));
        assert!(cents.abs() < 0.01, "expected ~0 cents, read {cents:.3}");
    }

    /// Transpose renames the note; it must not move the needle. A player whose
    /// A4 is dead in tune sees "+0" at every transpose setting — the shift
    /// belongs to the note name, not to the deviation.
    #[test]
    fn transpose_renames_the_note_without_moving_the_needle() {
        for transpose in [-12, -7, -1, 0, 1, 7, 12] {
            let mut tuning = TuningSystem::new();
            tuning.set_param("transpose", transpose as f32);
            let (midi, note_index, _octave, cents) = tuning.map_frequency(440.0);
            assert_eq!(
                midi,
                69 - transpose,
                "transpose {transpose} named the wrong note"
            );
            assert_eq!(note_index, midi.rem_euclid(12) as usize);
            assert!(
                cents.abs() < 0.01,
                "in-tune A4 at transpose {transpose} read {cents:.3} cents",
            );
        }
    }

    #[test]
    fn capo_renames_the_note_without_moving_the_needle() {
        for capo in [0, 1, 5, 12] {
            let mut tuning = TuningSystem::new();
            tuning.set_param("capo", capo as f32);
            let (midi, _note_index, _octave, cents) = tuning.map_frequency(440.0);
            assert_eq!(midi, 69 - capo, "capo {capo} named the wrong note");
            assert!(
                cents.abs() < 0.01,
                "in-tune A4 at capo {capo} read {cents:.3} cents",
            );
        }
    }

    #[test]
    fn transpose_and_capo_stack_without_moving_the_needle() {
        let mut tuning = TuningSystem::new();
        tuning.set_param("transpose", 2.0);
        tuning.set_param("capo", 3.0);
        let (midi, _note_index, _octave, cents) = tuning.map_frequency(440.0);
        assert_eq!(midi, 64);
        assert!(cents.abs() < 0.01, "expected ~0 cents, read {cents:.3}");
    }

    /// The deviation the player is actually chasing survives the shift: a tone
    /// 20 cents sharp reads +20 whether or not transpose is engaged.
    #[test]
    fn real_deviation_survives_transpose() {
        let sharp = detuned_a4(20.0);
        let mut plain = TuningSystem::new();
        let (_, _, _, plain_cents) = plain.map_frequency(sharp);
        plain.set_param("transpose", 12.0);
        let (midi, _, _, shifted_cents) = plain.map_frequency(sharp);
        assert_eq!(midi, 57);
        assert!((plain_cents - 20.0).abs() < 0.05, "read {plain_cents:.3}");
        assert!(
            (shifted_cents - 20.0).abs() < 0.05,
            "transposed read {shifted_cents:.3}",
        );
    }

    /// Sweeteners still bend the readout, and they follow the *named* pitch
    /// class, so a transposed reading picks up the offset of the note it
    /// displays.
    #[test]
    fn sweetener_offset_is_applied_at_any_transpose() {
        let mut tuning = TuningSystem::new();
        tuning.offsets[9] = 10.0; // A
        let (_, _, _, cents) = tuning.map_frequency(440.0);
        assert!(
            (cents + 10.0).abs() < 0.01,
            "expected -10 cents from the A sweetener, read {cents:.3}",
        );

        // Transposed by an octave the note is still an A, so the same
        // sweetener applies and the reading is unchanged.
        tuning.set_param("transpose", 12.0);
        let (midi, note_index, _, transposed) = tuning.map_frequency(440.0);
        assert_eq!((midi, note_index), (57, 9));
        assert!(
            (transposed + 10.0).abs() < 0.01,
            "expected -10 cents at transpose +12, read {transposed:.3}",
        );
    }

    #[test]
    fn non_positive_frequency_falls_back_to_a4() {
        let tuning = TuningSystem::new();
        assert_eq!(tuning.map_frequency(0.0), (69, 9, 4, 0.0));
        assert_eq!(tuning.map_frequency(-1.0), (69, 9, 4, 0.0));
    }
}
