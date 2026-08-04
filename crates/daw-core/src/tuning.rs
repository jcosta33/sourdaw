pub mod scala;

use triple_buffer::Output;

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
    pub fn from_scale(scale: &scala::Scale, root_note: u8, root_freq: f64) -> Self {
        let mut frequencies = [0.0; 128];
        let mut log2_frequencies = [0.0; 128];

        let tones = &scale.tones;
        let count = tones.len();
        if count == 0 {
            return Self::default();
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
            frequencies[i] = freq;
            log2_frequencies[i] = freq.log2();
        }

        Self {
            frequencies,
            log2_frequencies,
        }
    }
}

pub struct TuningManager {
    tuning_output: Output<TuningTable>,
    current_table: TuningTable,
}

impl TuningManager {
    pub fn new(tuning_output: Output<TuningTable>) -> Self {
        Self {
            tuning_output,
            current_table: TuningTable::default(),
        }
    }

    #[inline]
    pub fn update(&mut self) {
        if self.tuning_output.update() {
            self.current_table = *self.tuning_output.output_buffer();
        }
    }

    #[inline]
    pub fn get_frequency(&self, midi_note: f64) -> f64 {
        let note = midi_note.clamp(0.0, 127.0);
        let i = note.floor() as usize;
        let frac = note.fract();

        if frac < 1e-9 {
            return self.current_table.frequencies[i];
        }

        if i >= 127 {
            return self.current_table.frequencies[127];
        }

        // Log-space interpolation
        let l1 = self.current_table.log2_frequencies[i];
        let l2 = self.current_table.log2_frequencies[i + 1];
        let interpolated_log2 = l1 + (l2 - l1) * frac;

        2.0_f64.powf(interpolated_log2)
    }
}
