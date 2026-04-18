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
        
        for i in 0..128 {
            let freq = 440.0 * 2.0_f64.powf((i as f64 - 69.0) / 12.0);
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
        if self.tuning_output.has_changed() {
            self.current_table = *self.tuning_output.read();
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
