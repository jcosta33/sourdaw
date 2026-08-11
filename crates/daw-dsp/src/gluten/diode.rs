//! Diode bridge compressor topology — Neve 33609 style.
//!
//! Four diodes in Wheatstone bridge configuration. Predominantly odd-harmonic
//! distortion from bridge symmetry, plus even harmonics from transformer/Class-A.
//! Requires oversampling for accurate nonlinearity modeling.

use super::detector::{DetectionMode, StereoDetector};
use super::gain_computer::{apply_range, db_to_linear, gain_computer};
use super::oversample::ConfigurableOversample;
use crate::primitives::flush_denormal;

/// One side's bridge. Both the compressor and the limiter section are
/// per-channel, because the limiter reads the compressor's own output level.
#[derive(Clone, Default)]
struct DiodeChannel {
    gr_state: f32,
    limiter_state: f32,
}

pub struct DiodeCompressor {
    sample_rate: f32,
    threshold: f32,
    ratio: f32,
    attack_ms: f32,
    release_ms: f32,
    attack_coeff: f32,
    release_coeff: f32,
    channel_l: DiodeChannel,
    channel_r: DiodeChannel,
    detector: StereoDetector,
    /// Recovery mode: 1-5 positions (like 33609 hardware)
    recovery: u8,
    /// Limiter section threshold
    limiter_threshold: f32,
    last_output_l: f32,
    last_output_r: f32,
    /// Configurable oversamplers for diode bridge nonlinearity (L/R)
    os_l: ConfigurableOversample,
    os_r: ConfigurableOversample,
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
            channel_l: DiodeChannel::default(),
            channel_r: DiodeChannel::default(),
            detector: StereoDetector::new(sample_rate),
            recovery: 3,
            limiter_threshold: -3.0,
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

    pub fn get_threshold(&self) -> f32 {
        self.threshold
    }

    pub fn get_ratio(&self) -> f32 {
        self.ratio
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => self.threshold = value.clamp(-60.0, 0.0),
            "ratio" => self.ratio = value.clamp(1.5, 6.0), // 33609 has limited ratio range
            "attack" => {
                self.attack_ms = value.clamp(0.5, 30.0);
                self.update_coeffs();
            }
            "recovery" => {
                self.recovery = (value as u8).clamp(1, 5);
                self.update_coeffs();
            }
            "limiter_threshold" => self.limiter_threshold = value.clamp(-12.0, 0.0),
            "oversampling" => {
                self.os_l.set_rate(value as u8);
                self.os_r.set_rate(value as u8);
            }
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

    pub(crate) fn detector_source(&self, left: f32, right: f32) -> (f32, f32) {
        (left, right)
    }

    #[inline]
    pub fn process_sample(
        &mut self,
        left: f32,
        right: f32,
        detector_l: f32,
        detector_r: f32,
    ) -> (f32, f32, f32) {
        let (detect_l_db, detect_r_db) = self.detector.detect_db(detector_l, detector_r);
        self.process_with_level(left, right, detect_l_db, detect_r_db)
    }

    /// Total gain reduction for one channel — compressor plus limiter section.
    #[inline]
    fn channel_gain_db(&mut self, input_db: f32, right_channel: bool) -> f32 {
        let threshold = self.threshold;
        let ratio = self.ratio;
        let attack_coeff = self.attack_coeff;
        let release_coeff = self.release_coeff;
        let limiter_threshold = self.limiter_threshold;
        let limiter_coeff_a = (-1.0 / (0.1 * 0.001 * self.sample_rate)).exp();
        let limiter_coeff_r = (-1.0 / (50.0 * 0.001 * self.sample_rate)).exp();
        let channel = if right_channel {
            &mut self.channel_r
        } else {
            &mut self.channel_l
        };

        // Gain computer — compressor section
        let gc = gain_computer(input_db, threshold, ratio, 4.0);
        let gc = apply_range(gc, 40.0);

        // Smoothing
        let coeff = if gc <= channel.gr_state {
            attack_coeff
        } else {
            release_coeff
        };
        channel.gr_state = flush_denormal(coeff * channel.gr_state + (1.0 - coeff) * gc);

        // Limiter section (brickwall-ish, fast attack)
        let limiter_gc = gain_computer(input_db + channel.gr_state, limiter_threshold, 20.0, 1.0);
        let lim_coeff = if limiter_gc <= channel.limiter_state {
            limiter_coeff_a
        } else {
            limiter_coeff_r
        };
        channel.limiter_state =
            flush_denormal(lim_coeff * channel.limiter_state + (1.0 - lim_coeff) * limiter_gc);

        channel.gr_state + channel.limiter_state
    }

    #[inline]
    fn process_with_level(
        &mut self,
        left: f32,
        right: f32,
        detect_l_db: f32,
        detect_r_db: f32,
    ) -> (f32, f32, f32) {
        let gr_l = self.channel_gain_db(detect_l_db, false);
        let gr_r = if self.detector.is_fully_linked() {
            gr_l
        } else {
            self.channel_gain_db(detect_r_db, true)
        };

        // Diode bridge nonlinearity at configurable oversampled rate. The
        // coloration tracks each channel's own compression depth.
        let bridge_l = |x: f32| -> f32 { diode_bridge_color(x, gr_l) };
        let bridge_r = |x: f32| -> f32 { diode_bridge_color(x, gr_r) };
        let wet_l = self.os_l.process(left * db_to_linear(gr_l), &bridge_l);
        let wet_r = self.os_r.process(right * db_to_linear(gr_r), &bridge_r);

        self.last_output_l = wet_l;
        self.last_output_r = wet_r;

        (wet_l, wet_r, gr_l.min(gr_r))
    }

    pub fn reset(&mut self) {
        self.channel_l = DiodeChannel::default();
        self.channel_r = DiodeChannel::default();
        self.detector.reset();
        self.last_output_l = 0.0;
        self.last_output_r = 0.0;
        self.os_l.reset();
        self.os_r.reset();
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
