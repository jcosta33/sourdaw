//! VCA compressor topology — SSL G-Bus / API 2500 style.
//!
//! Feedback topology with dual-time-constant auto-release,
//! THAT 2181 VCA distortion modeling (2nd harmonic).

use super::detector::{DetectionMode, StereoDetector};
use super::gain_computer::{apply_range, db_to_linear, gain_computer};
use crate::primitives::flush_denormal;

/// SSL-style auto-release with dual RC networks.
#[derive(Clone)]
struct AutoRelease {
    env_fast: f32,
    env_slow: f32,
    coeff_release_fast: f32, // τ = 619ms
    coeff_release_slow: f32, // τ = 353ms
}

impl AutoRelease {
    fn new(sample_rate: f32) -> Self {
        Self {
            env_fast: 0.0,
            env_slow: 0.0,
            coeff_release_fast: (-1.0 / (0.619 * sample_rate)).exp(),
            coeff_release_slow: (-1.0 / (0.353 * sample_rate)).exp(),
        }
    }

    fn update_sample_rate(&mut self, sample_rate: f32) {
        self.coeff_release_fast = (-1.0 / (0.619 * sample_rate)).exp();
        self.coeff_release_slow = (-1.0 / (0.353 * sample_rate)).exp();
    }

    fn process(&mut self, rectified: f32, coeff_attack: f32) -> f32 {
        // Fast envelope
        if rectified > self.env_fast {
            self.env_fast += (1.0 - coeff_attack) * (rectified - self.env_fast);
        } else {
            self.env_fast = flush_denormal(
                self.coeff_release_fast * self.env_fast
                    + (1.0 - self.coeff_release_fast) * rectified,
            );
        }

        // Slow envelope
        if rectified > self.env_slow {
            self.env_slow += (1.0 - coeff_attack) * (rectified - self.env_slow);
        } else {
            self.env_slow = flush_denormal(
                self.coeff_release_slow * self.env_slow
                    + (1.0 - self.coeff_release_slow) * rectified,
            );
        }

        self.env_fast.max(self.env_slow)
    }

    fn reset(&mut self) {
        self.env_fast = 0.0;
        self.env_slow = 0.0;
    }
}

/// Everything a single channel's gain path carries. One per side, so an
/// unlinked detector gets two independent envelopes rather than one shared one.
#[derive(Clone)]
struct VcaChannel {
    gr_state: f32,
    auto_rel: AutoRelease,
}

impl VcaChannel {
    fn new(sample_rate: f32) -> Self {
        Self {
            gr_state: 0.0,
            auto_rel: AutoRelease::new(sample_rate),
        }
    }

    fn reset(&mut self) {
        self.gr_state = 0.0;
        self.auto_rel.reset();
    }
}

pub struct VcaCompressor {
    sample_rate: f32,
    threshold: f32,
    ratio: f32,
    attack_ms: f32,
    release_ms: f32,
    knee_width: f32,
    range: f32,
    auto_release: bool,
    attack_coeff: f32,
    release_coeff: f32,
    channel_l: VcaChannel,
    channel_r: VcaChannel,
    detector: StereoDetector,
    /// VCA type: 0 = Ideal (clean), 1 = THAT 2181 (subtle 2nd), 2 = DBX 202 (warmer)
    vca_type: u8,
    /// VCA 2nd harmonic distortion amount (0.001 – 0.01 typical).
    vca_k2: f32,
    last_output_l: f32,
    last_output_r: f32,
    /// Feed-forward mode (false = feedback/SSL default, true = feed-forward)
    feed_forward: bool,
}

impl VcaCompressor {
    pub fn new(sample_rate: f32) -> Self {
        let mut c = Self {
            sample_rate,
            threshold: -18.0,
            ratio: 4.0,
            attack_ms: 10.0,
            release_ms: 300.0,
            knee_width: 6.0,
            range: 15.0,
            auto_release: true,
            attack_coeff: 0.0,
            release_coeff: 0.0,
            channel_l: VcaChannel::new(sample_rate),
            channel_r: VcaChannel::new(sample_rate),
            detector: StereoDetector::new(sample_rate),
            vca_type: 1, // THAT 2181 default
            vca_k2: 0.003,
            last_output_l: 0.0,
            last_output_r: 0.0,
            feed_forward: false,
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
                self.attack_ms = value.clamp(0.02, 250.0);
                self.update_coeffs();
            }
            "release" => {
                self.release_ms = value.clamp(25.0, 5000.0);
                self.update_coeffs();
            }
            "knee" => self.knee_width = value.clamp(0.0, 30.0),
            "range" => self.range = value.clamp(0.0, 60.0),
            "auto_release" => self.auto_release = value > 0.5,
            "vca_character" => self.vca_k2 = value.clamp(0.0, 0.02),
            "vca_type" => {
                self.vca_type = (value as u8).clamp(0, 2);
                // Preset k2 values per VCA type
                self.vca_k2 = match self.vca_type {
                    0 => 0.0,   // Ideal: no distortion
                    1 => 0.003, // THAT 2181: subtle 2nd harmonic
                    2 => 0.008, // DBX 202: warmer, more colored
                    _ => 0.003,
                };
            }
            "feed_forward" => self.feed_forward = value > 0.5,
            _ => {}
        }
    }

    pub fn set_detection(&mut self, mode: DetectionMode) {
        self.detector.set_mode(mode);
    }

    /// Set stereo link. Leaving the fully-linked state seeds the right
    /// channel's envelope from the left one, so the moment the two gain paths
    /// separate they separate from a settled value rather than from whatever
    /// the right channel was left holding — otherwise turning Link down under
    /// programme steps the right channel's gain and clicks. This runs at
    /// control rate, so the audio path never pays for it.
    pub fn set_stereo_link(&mut self, link: f32) {
        if self.detector.is_fully_linked() && link < 1.0 {
            self.channel_r = self.channel_l.clone();
        }
        self.detector.set_link(link);
    }

    #[inline]
    fn channel_gain_db(&mut self, input_db: f32, right_channel: bool) -> f32 {
        let gc = gain_computer(input_db, self.threshold, self.ratio, self.knee_width);
        let gc = apply_range(gc, self.range);

        let attack_coeff = self.attack_coeff;
        let release_coeff = self.release_coeff;
        let auto_release = self.auto_release;
        let channel = if right_channel {
            &mut self.channel_r
        } else {
            &mut self.channel_l
        };

        if auto_release {
            // Dual-time-constant auto-release. Positive for the envelope logic,
            // back to negative dB on the way out.
            let env = channel.auto_rel.process(-gc, attack_coeff);
            return -env;
        }

        // Standard branching smoother
        let coeff = if gc <= channel.gr_state {
            attack_coeff
        } else {
            release_coeff
        };
        channel.gr_state = flush_denormal(coeff * channel.gr_state + (1.0 - coeff) * gc);
        channel.gr_state
    }

    pub(crate) fn detector_source(&self, left: f32, right: f32) -> (f32, f32) {
        if self.feed_forward {
            (left, right)
        } else {
            (self.last_output_l, self.last_output_r)
        }
    }

    /// Process one sample pair. Returns (left, right, gain_reduction_db).
    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32, f32) {
        let detector = self.detector_source(left, right);
        self.process_sample_with_detector(left, right, detector.0, detector.1)
    }

    #[inline]
    pub(crate) fn process_sample_with_detector(
        &mut self,
        left: f32,
        right: f32,
        detector_l: f32,
        detector_r: f32,
    ) -> (f32, f32, f32) {
        let (detect_l_db, detect_r_db) = self.detector.detect_db(detector_l, detector_r);

        let smoothed_l = self.channel_gain_db(detect_l_db, false);
        let smoothed_r = if self.detector.is_fully_linked() {
            smoothed_l
        } else {
            self.channel_gain_db(detect_r_db, true)
        };

        // VCA distortion: subtle 2nd harmonic
        let out_l = vca_distortion(left * db_to_linear(smoothed_l), self.vca_k2, smoothed_l);
        let out_r = vca_distortion(right * db_to_linear(smoothed_r), self.vca_k2, smoothed_r);

        self.last_output_l = out_l;
        self.last_output_r = out_r;

        // Report the deeper of the two reductions to the meter — identical to
        // the single value while linked, and the one an engineer reads for.
        (out_l, out_r, smoothed_l.min(smoothed_r))
    }

    pub fn reset(&mut self) {
        self.channel_l.reset();
        self.channel_r.reset();
        self.detector.reset();
        self.last_output_l = 0.0;
        self.last_output_r = 0.0;
    }
}

/// THAT 2181 VCA distortion — predominantly 2nd harmonic.
#[inline]
fn vca_distortion(x: f32, k2: f32, gr_db: f32) -> f32 {
    // Distortion increases with gain change (parasitic effects)
    let k_dynamic = k2 * (1.0 + 0.02 * gr_db.abs());
    x + k_dynamic * x * x
}
