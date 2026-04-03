//! VCA compressor topology — SSL G-Bus / API 2500 style.
//!
//! Feedback topology with dual-time-constant auto-release,
//! THAT 2181 VCA distortion modeling (2nd harmonic).

use super::gain_computer::{apply_range, db_to_linear, gain_computer, linear_to_db};

/// SSL-style auto-release with dual RC networks.
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
            self.env_fast = self.coeff_release_fast * self.env_fast
                + (1.0 - self.coeff_release_fast) * rectified;
        }

        // Slow envelope
        if rectified > self.env_slow {
            self.env_slow += (1.0 - coeff_attack) * (rectified - self.env_slow);
        } else {
            self.env_slow = self.coeff_release_slow * self.env_slow
                + (1.0 - self.coeff_release_slow) * rectified;
        }

        self.env_fast.max(self.env_slow)
    }

    fn reset(&mut self) {
        self.env_fast = 0.0;
        self.env_slow = 0.0;
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
    gr_state: f32,
    auto_rel: AutoRelease,
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
            gr_state: 0.0,
            auto_rel: AutoRelease::new(sample_rate),
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

    /// Process one sample pair. Returns (left, right, gain_reduction_db).
    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32, f32) {
        // Detection: feedback (SSL default) or feed-forward
        let detect = if self.feed_forward {
            left.abs().max(right.abs())
        } else {
            self.last_output_l.abs().max(self.last_output_r.abs())
        };
        let input_db = linear_to_db(detect);

        // Gain computer
        let gc = gain_computer(input_db, self.threshold, self.ratio, self.knee_width);
        let gc = apply_range(gc, self.range);

        // Smoothing
        let smoothed = if self.auto_release {
            // Use dual-time-constant auto-release
            let rectified = -gc; // positive for auto-release logic
            let env = self.auto_rel.process(rectified, self.attack_coeff);
            -env // back to negative dB
        } else {
            // Standard branching smoother
            let coeff = if gc <= self.gr_state {
                self.attack_coeff
            } else {
                self.release_coeff
            };
            self.gr_state = coeff * self.gr_state + (1.0 - coeff) * gc;
            self.gr_state
        };

        // Apply gain reduction
        let gr_linear = db_to_linear(smoothed);

        // VCA distortion: subtle 2nd harmonic
        let out_l = vca_distortion(left * gr_linear, self.vca_k2, smoothed);
        let out_r = vca_distortion(right * gr_linear, self.vca_k2, smoothed);

        self.last_output_l = out_l;
        self.last_output_r = out_r;

        (out_l, out_r, smoothed)
    }

    pub fn reset(&mut self) {
        self.gr_state = 0.0;
        self.auto_rel.reset();
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
