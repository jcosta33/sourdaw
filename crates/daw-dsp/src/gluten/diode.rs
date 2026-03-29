//! Diode bridge compressor topology — Neve 33609 style.
//!
//! Four diodes in Wheatstone bridge configuration. Predominantly odd-harmonic
//! distortion from bridge symmetry, plus even harmonics from transformer/Class-A.
//! Requires oversampling for accurate nonlinearity modeling.

use super::gain_computer::{gain_computer, apply_range, db_to_linear, linear_to_db};

pub struct DiodeCompressor {
    sample_rate: f32,
    threshold: f32,
    ratio: f32,
    attack_ms: f32,
    release_ms: f32,
    attack_coeff: f32,
    release_coeff: f32,
    gr_state: f32,
    /// Recovery mode: 1-5 positions (like 33609 hardware)
    recovery: u8,
    /// Limiter section threshold
    limiter_threshold: f32,
    limiter_state: f32,
    last_output_l: f32,
    last_output_r: f32,
    // 2x oversampling state for nonlinearity
    os_prev_l: f32,
    os_prev_r: f32,
}

impl DiodeCompressor {
    pub fn new(sample_rate: f32) -> Self {
        let mut c = Self {
            sample_rate,
            threshold: -16.0,
            ratio: 2.0,
            attack_ms: 3.0,
            release_ms: 400.0,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            gr_state: 0.0,
            recovery: 3,
            limiter_threshold: -3.0,
            limiter_state: 0.0,
            last_output_l: 0.0,
            last_output_r: 0.0,
            os_prev_l: 0.0,
            os_prev_r: 0.0,
        };
        c.update_coeffs();
        c
    }

    fn update_coeffs(&mut self) {
        self.attack_coeff = (-1.0 / (self.attack_ms * 0.001 * self.sample_rate)).exp();
        // Recovery position maps to different release times
        let release_ms = match self.recovery {
            1 => 50.0,
            2 => 100.0,
            3 => 400.0,
            4 => 800.0,
            5 => 1500.0,
            _ => self.release_ms,
        };
        self.release_ms = release_ms;
        self.release_coeff = (-1.0 / (release_ms * 0.001 * self.sample_rate)).exp();
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => self.threshold = value.clamp(-60.0, 0.0),
            "ratio" => self.ratio = value.clamp(1.5, 6.0), // 33609 has limited ratio range
            "attack" => { self.attack_ms = value.clamp(0.5, 30.0); self.update_coeffs(); }
            "recovery" => { self.recovery = (value as u8).clamp(1, 5); self.update_coeffs(); }
            "limiter_threshold" => self.limiter_threshold = value.clamp(-12.0, 0.0),
            _ => {}
        }
    }

    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32, f32) {
        // Feed-forward detection (33609 is feed-forward)
        let detect = left.abs().max(right.abs());
        let input_db = linear_to_db(detect);

        // Gain computer — compressor section
        let gc = gain_computer(input_db, self.threshold, self.ratio, 4.0);
        let gc = apply_range(gc, 40.0);

        // Smoothing
        let coeff = if gc <= self.gr_state {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.gr_state = coeff * self.gr_state + (1.0 - coeff) * gc;

        // Limiter section (brickwall-ish, fast attack)
        let limiter_gc = gain_computer(input_db + self.gr_state, self.limiter_threshold, 20.0, 1.0);
        let limiter_coeff_a = (-1.0 / (0.1 * 0.001 * self.sample_rate)).exp();
        let limiter_coeff_r = (-1.0 / (50.0 * 0.001 * self.sample_rate)).exp();
        let lim_coeff = if limiter_gc <= self.limiter_state { limiter_coeff_a } else { limiter_coeff_r };
        self.limiter_state = lim_coeff * self.limiter_state + (1.0 - lim_coeff) * limiter_gc;

        let total_gr = self.gr_state + self.limiter_state;
        let gr_linear = db_to_linear(total_gr);

        // Diode bridge nonlinearity (odd harmonics + slight even from asymmetry)
        let wet_l = diode_bridge_color(left * gr_linear, total_gr);
        let wet_r = diode_bridge_color(right * gr_linear, total_gr);

        self.last_output_l = wet_l;
        self.last_output_r = wet_r;

        (wet_l, wet_r, total_gr)
    }

    pub fn reset(&mut self) {
        self.gr_state = 0.0;
        self.limiter_state = 0.0;
        self.last_output_l = 0.0;
        self.last_output_r = 0.0;
        self.os_prev_l = 0.0;
        self.os_prev_r = 0.0;
    }
}

/// Diode bridge coloration — predominantly odd harmonics.
/// Bridge symmetry cancels even harmonics; k3 term models this.
#[inline]
fn diode_bridge_color(x: f32, gr_db: f32) -> f32 {
    // Nonlinearity increases with compression amount
    let k3 = 0.005 * (1.0 + gr_db.abs() * 0.05);
    // Slight asymmetry from transformer → adds k2 (even harmonics)
    let k2 = 0.002;
    x + k2 * x * x + k3 * x * x * x
}
