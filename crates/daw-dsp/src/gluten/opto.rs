//! Opto compressor topology — LA-2A / Shadow Hills style.
//!
//! T4 opto cell with program-dependent release and physical memory effect.
//! Feedback topology with soft, inherently program-dependent ratio.

use super::gain_computer::{db_to_linear, linear_to_db};

pub struct OptoCompressor {
    sample_rate: f32,
    threshold: f32,
    /// Fixed soft ratio that increases with excess (3:1 → ~10:1)
    base_ratio: f32,
    gr_state: f32,
    /// CdS memory accumulator (0.0 – 1.0)
    memory_state: f32,
    last_output_l: f32,
    last_output_r: f32,
    /// ~10ms fixed attack (EL panel rise time)
    tau_attack: f32,
    /// ~60ms fast release
    tau_release_fast: f32,
    /// ~200ms memory charge
    tau_memory_charge: f32,
    /// ~2s memory decay
    tau_memory_decay: f32,
    /// Compress vs Limit mode (LA-2A)
    limit_mode: bool,
}

impl OptoCompressor {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            threshold: -20.0,
            base_ratio: 3.0,
            gr_state: 0.0,
            memory_state: 0.0,
            last_output_l: 0.0,
            last_output_r: 0.0,
            tau_attack: 0.010,
            tau_release_fast: 0.060,
            tau_memory_charge: 0.200,
            tau_memory_decay: 2.0,
            limit_mode: false,
        }
    }

    pub fn get_threshold(&self) -> f32 {
        self.threshold
    }

    pub fn get_ratio(&self) -> f32 {
        if self.limit_mode {
            10.0
        } else {
            3.0
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => self.threshold = value.clamp(-60.0, 0.0),
            "limit_mode" => self.limit_mode = value > 0.5,
            "peak_reduction" => {
                // LA-2A style: maps 0-100 to threshold range
                self.threshold = -(value.clamp(0.0, 100.0) * 0.5);
            }
            _ => {}
        }
    }

    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32, f32) {
        // Feedback: detect from previous output
        let detect = self.last_output_l.abs().max(self.last_output_r.abs());
        let detect_db = linear_to_db(detect);
        let excess = (detect_db - self.threshold).max(0.0);

        // Program-dependent ratio: increases with excess
        let max_ratio = if self.limit_mode {
            10.0
        } else {
            3.0 + self.base_ratio
        };
        let effective_ratio =
            self.base_ratio + (max_ratio - self.base_ratio) * (excess / 20.0).min(1.0);
        let desired_gr_db = excess * (1.0 - 1.0 / effective_ratio);

        // Update memory state (CdS charge trapping)
        if desired_gr_db > 0.5 {
            let charge_alpha = 1.0 - (-1.0 / (self.tau_memory_charge * self.sample_rate)).exp();
            self.memory_state += charge_alpha * (1.0 - self.memory_state);
        } else {
            let decay_alpha = 1.0 - (-1.0 / (self.tau_memory_decay * self.sample_rate)).exp();
            self.memory_state -= decay_alpha * self.memory_state;
        }

        // Release time stretches with memory
        let tau_release = self.tau_release_fast + (5.0 - self.tau_release_fast) * self.memory_state;

        // Ballistics
        let alpha = if desired_gr_db > self.gr_state {
            1.0 - (-1.0 / (self.tau_attack * self.sample_rate)).exp()
        } else {
            1.0 - (-1.0 / (tau_release * self.sample_rate)).exp()
        };

        self.gr_state += alpha * (desired_gr_db - self.gr_state);

        let gain = db_to_linear(-self.gr_state);
        let out_l = left * gain;
        let out_r = right * gain;
        self.last_output_l = out_l;
        self.last_output_r = out_r;

        (out_l, out_r, -self.gr_state)
    }

    pub fn reset(&mut self) {
        self.gr_state = 0.0;
        self.memory_state = 0.0;
        self.last_output_l = 0.0;
        self.last_output_r = 0.0;
    }
}
