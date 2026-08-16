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
