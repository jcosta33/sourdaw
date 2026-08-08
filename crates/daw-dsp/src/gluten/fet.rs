//! FET compressor topology — 1176 style.
//!
//! Ultra-fast attack (20µs–800µs), JFET square-law distortion (odd harmonics),
//! transformer saturation (even harmonics), "all buttons in" mode.

use super::detector::{DetectionMode, StereoDetector};
use super::gain_computer::{apply_range, db_to_linear, gain_computer};
use super::oversample::ConfigurableOversample;
use crate::primitives::flush_denormal;

/// One side's FET gain path. `peak_timer` rides along because the all-buttons
/// ratio lag is driven by that channel's own transients.
#[derive(Clone, Default)]
struct FetChannel {
    gr_state: f32,
    /// Time since last peak (for all-buttons ratio lag)
    peak_timer: f32,
}

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
    channel_l: FetChannel,
    channel_r: FetChannel,
    detector: StereoDetector,
    /// Transformer saturation drive
    xfmr_drive: f32,
    /// JFET odd-harmonic amount (k3 coefficient)
    jfet_k3: f32,
    /// Transformer even-harmonic asymmetry (k2 coefficient)
    xfmr_k2: f32,
    /// All-buttons-in mode
    all_buttons: bool,
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
            channel_l: FetChannel::default(),
            channel_r: FetChannel::default(),
            detector: StereoDetector::new(sample_rate),
            xfmr_drive: 1.2,
            jfet_k3: 0.15,
            xfmr_k2: 0.0,
            all_buttons: false,
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

    pub fn set_detection(&mut self, mode: DetectionMode) {
        self.detector.set_mode(mode);
    }

    /// See `VcaCompressor::set_stereo_link`.
    pub fn set_stereo_link(&mut self, link: f32) {
        if self.detector.is_fully_linked() && link < 1.0 {
            self.channel_r = self.channel_l.clone();
        }
        self.detector.set_link(link);
    }

    #[inline]
    fn channel_gain_db(&mut self, input_db: f32, right_channel: bool) -> f32 {
        let sample_rate = self.sample_rate;
        let ratio = self.ratio;
        let all_buttons = self.all_buttons;
        let threshold = self.threshold;
        let attack_coeff = self.attack_coeff;
        let release_coeff = self.release_coeff;
        let channel = if right_channel {
            &mut self.channel_r
        } else {
            &mut self.channel_l
        };

        // Ratio — all-buttons-in mode increases ratio after transient
        let effective_ratio = if all_buttons {
            let base = 12.0; // Parallel resistance of all 4 ratio networks
            let lag_factor = 1.0 + 0.5 * (1.0 - (-channel.peak_timer / 50.0).exp());
            base * lag_factor
        } else {
            ratio
        };

        // Gain computer
        let gc = gain_computer(input_db, threshold, effective_ratio, 3.0);
        let gc = apply_range(gc, 60.0); // FET can go deep

        // Smoothing
        let coeff = if gc <= channel.gr_state {
            attack_coeff
        } else {
            release_coeff
        };
        channel.gr_state = flush_denormal(coeff * channel.gr_state + (1.0 - coeff) * gc);

        // Track peak timer for all-buttons mode
        if gc < channel.gr_state - 1.0 {
            channel.peak_timer = 0.0;
        } else {
            channel.peak_timer += 1000.0 / sample_rate; // ms
        }

        channel.gr_state
    }

    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32, f32) {
        // Input gain (drive)
        let input_linear = db_to_linear(self.input_gain);
        let in_l = left * input_linear;
        let in_r = right * input_linear;

        // Feedback detection
        let (detect_l_db, detect_r_db) =
            self.detector.detect_db(self.last_output_l, self.last_output_r);

        let gr_l = self.channel_gain_db(detect_l_db, false);
        let gr_r = if self.detector.is_fully_linked() {
            gr_l
        } else {
            self.channel_gain_db(detect_r_db, true)
        };

        // Apply gain reduction
        let wet_l = in_l * db_to_linear(gr_l);
        let wet_r = in_r * db_to_linear(gr_r);

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

        (out_l, out_r, gr_l.min(gr_r))
    }

    pub fn reset(&mut self) {
        self.channel_l = FetChannel::default();
        self.channel_r = FetChannel::default();
        self.detector.reset();
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
