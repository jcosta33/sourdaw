pub mod scala;

#[derive(Clone, Copy, Debug)]
pub struct TuningTable {
    pub frequencies: [f64; 128],
    pub log2_frequencies: [f64; 128],
}

impl Default for TuningTable {
    fn default() -> Self {
        let mut frequencies = [0.0; 128];
        let mut log2_frequencies = [0.0; 128];

        for midi_note in 0..128 {
            let freq = 440.0 * 2.0_f64.powf((midi_note as f64 - 69.0) / 12.0);
            frequencies[midi_note] = freq;
            log2_frequencies[midi_note] = freq.log2();
        }

        Self {
            frequencies,
            log2_frequencies,
        }
    }
}

impl TuningTable {
    /// Build a 128-entry tuning table from a Scala scale.
    ///
    /// Every entry is guaranteed finite and positive. A table with a non-finite
    /// entry serializes to JSON `null` against a frontend typed `number[]` and
    /// detunes every note to infinity or silence while the parse reports
    /// success, so a table that cannot be computed is an error, never a value.
    pub fn from_scale(scale: &scala::Scale, root_note: u8, root_freq: f64) -> Result<Self, String> {
        if !root_freq.is_finite() || root_freq <= 0.0 {
            return Err(format!(
                "Root frequency must be finite and above zero, got {}",
                root_freq
            ));
        }

        let mut frequencies = [0.0; 128];
        let mut log2_frequencies = [0.0; 128];

        let tones = &scale.tones;
        let count = tones.len();
        if count == 0 {
            return Ok(Self::default());
        }

        // Calculate cents for each degree
        let mut degree_cents = Vec::with_capacity(count);
        for tone in tones {
            match tone {
                scala::Tone::Cents(c) => degree_cents.push(*c),
                scala::Tone::Ratio(n, d) => {
                    let ratio = *n as f64 / *d as f64;
                    degree_cents.push(1200.0 * ratio.log2());
                }
            }
        }

        let period_cents = degree_cents[count - 1];

        for i in 0..128 {
            let diff = i as i32 - root_note as i32;
            let octaves = if diff >= 0 {
                diff / count as i32
            } else {
                (diff - count as i32 + 1) / count as i32
            };

            let degree_idx = (diff - (octaves * count as i32)) as usize;

            let cents_offset = if degree_idx == 0 {
                octaves as f64 * period_cents
            } else {
                octaves as f64 * period_cents + degree_cents[degree_idx - 1]
            };

            let freq = root_freq * 2.0_f64.powf(cents_offset / 1200.0);
            let log2_freq = freq.log2();
            if !freq.is_finite() || freq <= 0.0 || !log2_freq.is_finite() {
                return Err(format!(
                    "Scale produces a non-finite frequency at MIDI note {}: {}",
                    i, freq
                ));
            }
            frequencies[i] = freq;
            log2_frequencies[i] = log2_freq;
        }

        Ok(Self {
            frequencies,
            log2_frequencies,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::scala::Scale;
    use super::TuningTable;

    /// 12-TET expressed in cents, so the table must reproduce equal temperament
    /// exactly at every root.
    fn twelve_tet() -> Scale {
        let mut scl = String::from("! test.scl\n12-TET\n 12\n");
        for degree in 1..=12 {
            scl.push_str(&format!(" {}.0\n", degree * 100));
        }
        Scale::from_scl(&scl).expect("12-TET must parse")
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn twelve_tet_reproduces_equal_temperament_at_the_reference_root() {
        let table = TuningTable::from_scale(&twelve_tet(), 69, 440.0).expect("12-TET is valid");

        assert_close(table.frequencies[69], 440.0);
        assert_close(table.frequencies[81], 880.0);
        assert_close(table.frequencies[70], 440.0 * 2.0_f64.powf(1.0 / 12.0));
        assert_close(table.log2_frequencies[69], 440.0_f64.log2());
    }

    #[test]
    fn notes_below_the_root_use_the_negative_octave_arithmetic() {
        // `diff < 0` takes the floor-division branch; an off-by-one there puts
        // the note an octave or a degree away, silently retuning the low range.
        let table = TuningTable::from_scale(&twelve_tet(), 69, 440.0).expect("12-TET is valid");

        assert_close(table.frequencies[57], 220.0);
        assert_close(table.frequencies[45], 110.0);
        assert_close(table.frequencies[68], 440.0 * 2.0_f64.powf(-1.0 / 12.0));
        assert_close(table.frequencies[60], 440.0 * 2.0_f64.powf(-9.0 / 12.0));
    }

    #[test]
    fn a_root_above_the_reference_shifts_the_whole_table() {
        let table = TuningTable::from_scale(&twelve_tet(), 81, 880.0).expect("12-TET is valid");

        assert_close(table.frequencies[81], 880.0);
        assert_close(table.frequencies[69], 440.0);
        assert_close(table.frequencies[93], 1760.0);
    }

    #[test]
    fn every_entry_is_finite_across_the_full_midi_range() {
        let table = TuningTable::from_scale(&twelve_tet(), 69, 440.0).expect("12-TET is valid");

        assert!(table.frequencies.iter().all(|f| f.is_finite() && *f > 0.0));
        assert!(table.log2_frequencies.iter().all(|f| f.is_finite()));
    }

    #[test]
    fn a_non_finite_root_frequency_is_rejected() {
        for root_freq in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -440.0] {
            let error = TuningTable::from_scale(&twelve_tet(), 69, root_freq)
                .expect_err("a non-positive or non-finite root must be rejected");

            assert!(
                error.starts_with("Root frequency must be finite and above zero"),
                "unexpected error for root {root_freq}: {error}"
            );
        }
    }

    #[test]
    fn a_non_finite_computed_frequency_is_rejected() {
        // A cents line may parse to infinity even though every ratio term is
        // well formed, so the table is validated after it is computed too.
        let scale = Scale::from_scl("! test.scl\ninfinite cents\n 1\n 1.0e400\n")
            .expect("the line parses as f64 infinity");

        let error = TuningTable::from_scale(&scale, 69, 440.0)
            .expect_err("an infinite table must not be handed back as a value");

        assert!(
            error.starts_with("Scale produces a non-finite frequency"),
            "unexpected error: {error}"
        );
    }
}
