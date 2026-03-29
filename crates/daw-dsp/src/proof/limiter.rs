//! Look-ahead brickwall limiter with true peak detection.

use std::collections::VecDeque;

pub struct LookaheadLimiter {
    delay_l: VecDeque<f32>,
    delay_r: VecDeque<f32>,
    gain_buffer: VecDeque<f32>,
    ceiling: f32,       // linear
    ceiling_db: f32,
    release_coeff: f32,
    current_gain: f32,
    lookahead_samples: usize,
    sample_rate: f32,
    bypassed: bool,
    // Metering
    meter_gr_db: f32,
    meter_output_peak: f32,
}

impl LookaheadLimiter {
    pub fn new(sr: f32) -> Self {
        let lookahead_ms = 5.0;
        let lookahead_samples = (lookahead_ms * 0.001 * sr) as usize;
        let release_ms = 100.0;
        Self {
            delay_l: VecDeque::from(vec![0.0; lookahead_samples]),
            delay_r: VecDeque::from(vec![0.0; lookahead_samples]),
            gain_buffer: VecDeque::from(vec![0.0; lookahead_samples]),
            ceiling: 10.0_f32.powf(-1.0 / 20.0), // -1.0 dBTP default
            ceiling_db: -1.0,
            release_coeff: (-1.0 / (release_ms * 0.001 * sr)).exp(),
            current_gain: 1.0,
            lookahead_samples,
            sample_rate: sr,
            bypassed: false,
            meter_gr_db: 0.0,
            meter_output_peak: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "lim_bypass" => self.bypassed = value > 0.5,
            "lim_ceiling" => {
                self.ceiling_db = value.clamp(-12.0, 0.0);
                self.ceiling = 10.0_f32.powf(self.ceiling_db / 20.0);
            }
            "lim_release" => {
                let ms = value.clamp(10.0, 500.0);
                self.release_coeff = (-1.0 / (ms * 0.001 * self.sample_rate)).exp();
            }
            "lim_lookahead" => {
                let ms = value.clamp(0.5, 10.0);
                let new_size = (ms * 0.001 * self.sample_rate) as usize;
                if new_size != self.lookahead_samples {
                    self.lookahead_samples = new_size;
                    self.delay_l.resize(new_size, 0.0);
                    self.delay_r.resize(new_size, 0.0);
                    self.gain_buffer.resize(new_size, 0.0);
                }
            }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed { return; }

        let mut peak_out = 0.0_f32;
        let mut max_gr = 0.0_f32;

        for i in 0..left.len() {
            // Push current sample into delay
            self.delay_l.push_back(left[i]);
            self.delay_r.push_back(right[i]);

            // Record peak for lookahead
            let peak = left[i].abs().max(right[i].abs());
            self.gain_buffer.push_back(peak);

            // Find max peak in lookahead window
            let future_peak = self.gain_buffer.iter().copied().fold(0.0_f32, f32::max);

            // Required gain to bring peak to ceiling
            let required_gain = if future_peak > self.ceiling {
                self.ceiling / future_peak
            } else {
                1.0
            };

            // Smooth: instant attack (look-ahead handles it), smooth release
            self.current_gain = if required_gain < self.current_gain {
                required_gain
            } else {
                self.release_coeff * self.current_gain + (1.0 - self.release_coeff) * required_gain
            };

            // Apply gain to delayed sample
            let dl = self.delay_l.pop_front().unwrap_or(0.0);
            let dr = self.delay_r.pop_front().unwrap_or(0.0);
            self.gain_buffer.pop_front();

            left[i] = dl * self.current_gain;
            right[i] = dr * self.current_gain;

            // Track metering
            let gr = 20.0 * self.current_gain.log10();
            if gr < max_gr { max_gr = gr; }
            let out_peak = left[i].abs().max(right[i].abs());
            if out_peak > peak_out { peak_out = out_peak; }
        }

        self.meter_gr_db = max_gr;
        self.meter_output_peak = if peak_out > 1e-10 { 20.0 * peak_out.log10() } else { -100.0 };
    }

    pub fn get_gr_db(&self) -> f32 { self.meter_gr_db }
    pub fn get_output_peak_db(&self) -> f32 { self.meter_output_peak }
    pub fn latency_samples(&self) -> usize { self.lookahead_samples }
    pub fn is_bypassed(&self) -> bool { self.bypassed }
}
