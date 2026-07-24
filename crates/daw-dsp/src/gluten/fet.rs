//! FET compressor topology — 1176 style.
//!
//! Ultra-fast attack (20µs–800µs), JFET square-law distortion (odd harmonics),
//! transformer saturation (even harmonics), "all buttons in" mode.

use super::gain_computer::{apply_range, db_to_linear, gain_computer, linear_to_db};
use super::oversample::ConfigurableOversample;
use crate::primitives::flush_denormal;

pub struct FetCompressor {
    sample_rate: f32,
    threshold: f32,
    ratio: f32,
    attack_ms: f32,
    release_ms: f32,
    input_gain: f32,  // input drive (dB)
    output_gain: f32, // output level (dB)
    attack_coeff: f32,
    release_coeff: f32,
    gr_state: f32,
    /// Transformer saturation drive
    xfmr_drive: f32,
    /// JFET odd-harmonic amount (k3 coefficient)
    jfet_k3: f32,
    /// Transformer even-harmonic asymmetry (k2 coefficient)
    xfmr_k2: f32,
    /// All-buttons-in mode
    all_buttons: bool,
    /// Time since last peak (for all-buttons ratio lag)
    peak_timer: f32,
    last_output_l: f32,
    last_output_r: f32,
    /// Configurable oversamplers for nonlinear distortion (L/R)
    os_l: ConfigurableOversample,
    os_r: ConfigurableOversample,
}

impl FetCompressor {
    pub fn new(sample_rate: f32) -> Self {
        let mut c = Self {
            sample_rate,
            threshold: -24.0,
            ratio: 4.0,
            attack_ms: 0.8, // 800µs — very fast
            release_ms: 300.0,
            input_gain: 0.0,
            output_gain: 0.0,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            gr_state: 0.0,
            xfmr_drive: 1.2,
            jfet_k3: 0.15,
            xfmr_k2: 0.0,
            all_buttons: false,
            peak_timer: 0.0,
            last_output_l: 0.0,
            last_output_r: 0.0,
            os_l: ConfigurableOversample::new(2),
            os_r: ConfigurableOversample::new(2),
        };
        c.update_coeffs();
        c
    }

    fn update_coeffs(&mut self) {
        self.attack_coeff = (-1.0 / (self.attack_ms * 0.001 * self.sample_rate)).exp();
        self.release_coeff = (-1.0 / (self.release_ms * 0.001 * self.sample_rate)).exp();
    }

    pub fn get_threshold(&self) -> f32 {
        self.threshold
    }

    pub fn get_ratio(&self) -> f32 {
        self.ratio
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => self.threshold = value.clamp(-60.0, 0.0),
            "ratio" => self.ratio = value.clamp(1.0, 20.0),
            "attack" => {
                self.attack_ms = value.clamp(0.02, 2.0);
                self.update_coeffs();
            }
            "release" => {
                self.release_ms = value.clamp(25.0, 5000.0);
                self.update_coeffs();
            }
            "input_gain" => self.input_gain = value.clamp(-12.0, 24.0),
            "output_gain" => self.output_gain = value.clamp(-24.0, 24.0),
            "xfmr_drive" => self.xfmr_drive = value.clamp(0.0, 3.0),
            "jfet_k3" => self.jfet_k3 = value.clamp(0.0, 0.5),
            "xfmr_k2" => self.xfmr_k2 = value.clamp(0.0, 0.3),
            "oversampling" => {
                self.os_l.set_rate(value as u8);
                self.os_r.set_rate(value as u8);
            }
            "all_buttons" => self.all_buttons = value > 0.5,
            _ => {}
        }
    }

    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32, f32) {
        // Input gain (drive)
        let input_linear = db_to_linear(self.input_gain);
        let in_l = left * input_linear;
        let in_r = right * input_linear;

        // Feedback detection
        let detect = self.last_output_l.abs().max(self.last_output_r.abs());
        let input_db = linear_to_db(detect);

        // Ratio — all-buttons-in mode increases ratio after transient
        let effective_ratio = if self.all_buttons {
            let base = 12.0; // Parallel resistance of all 4 ratio networks
            let lag_factor = 1.0 + 0.5 * (1.0 - (-self.peak_timer / 50.0).exp());
            base * lag_factor
        } else {
            self.ratio
        };

        // Gain computer
        let gc = gain_computer(input_db, self.threshold, effective_ratio, 3.0);
        let gc = apply_range(gc, 60.0); // FET can go deep

        // Smoothing
        let coeff = if gc <= self.gr_state {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.gr_state = flush_denormal(coeff * self.gr_state + (1.0 - coeff) * gc);

        // Track peak timer for all-buttons mode
        if gc < self.gr_state - 1.0 {
            self.peak_timer = 0.0;
        } else {
            self.peak_timer += 1000.0 / self.sample_rate; // ms
        }

        // Apply gain reduction
        let gr_linear = db_to_linear(self.gr_state);
        let wet_l = in_l * gr_linear;
        let wet_r = in_r * gr_linear;

        // JFET + transformer distortion at configurable oversampled rate
        let xfmr = self.xfmr_drive;
        let k3 = self.jfet_k3;
        let k2 = self.xfmr_k2;
        let distortion = |x: f32| -> f32 {
            let jfet = x - k3 * x * x * x;
            let xfmr_out = transformer_saturate(jfet, xfmr);
            xfmr_out + k2 * xfmr_out * xfmr_out
        };
        let dist_l = self.os_l.process(wet_l, &distortion);
        let dist_r = self.os_r.process(wet_r, &distortion);

        let output_linear = db_to_linear(self.output_gain);
        let out_l = dist_l * output_linear;
        let out_r = dist_r * output_linear;

        self.last_output_l = out_l;
        self.last_output_r = out_r;

        (out_l, out_r, self.gr_state)
    }

    pub fn reset(&mut self) {
        self.gr_state = 0.0;
        self.peak_timer = 0.0;
        self.last_output_l = 0.0;
        self.last_output_r = 0.0;
        self.os_l.reset();
        self.os_r.reset();
    }
}

/// JFET square-law distortion — odd harmonics.
#[inline]
fn jfet_distortion(x: f32) -> f32 {
    // Soft cubic nonlinearity (odd harmonics)
    let k = 0.15;
    x - k * x * x * x
}

/// Transformer saturation — even harmonics via tanh waveshaper.
#[inline]
fn transformer_saturate(x: f32, drive: f32) -> f32 {
    if drive < 0.01 {
        return x;
    }
    (x * drive).tanh() / drive.tanh()
}
