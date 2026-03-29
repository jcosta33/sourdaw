//! Hi-hat synthesis.
//!
//! Six square oscillators at inharmonic metallic ratios mixed through
//! two bandpass filters for that characteristic shimmer. Supports both
//! closed (short decay) and open (long decay) modes.

use std::f32::consts::TAU;

/// Metallic frequency ratios (inharmonic overtones of metal shells).
const RATIOS: [f32; 6] = [1.0, 1.4, 1.68, 2.0, 2.4, 2.82];

#[inline]
fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

pub struct HiHatEngine {
    phases: [f32; 6],
    y_prevs: [f32; 6],
    amp_env: f32,
    amp_decay_coeff: f32,
    // Bandpass filters (SVF)
    bp1_ic1: f32,
    bp1_ic2: f32,
    bp2_ic1: f32,
    bp2_ic2: f32,
    // Parameters
    tune: f32,         // semitones
    decay: f32,        // seconds
    tone: f32,         // mix between low and high bandpass (0-1)
    is_open: bool,     // open vs closed
    drive: f32,
    base_freq: f32,
    sample_rate: f32,
}

impl HiHatEngine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            phases: [0.0; 6],
            y_prevs: [0.0; 6],
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            bp1_ic1: 0.0,
            bp1_ic2: 0.0,
            bp2_ic1: 0.0,
            bp2_ic2: 0.0,
            tune: 0.0,
            decay: 0.05,
            tone: 0.5,
            is_open: false,
            drive: 0.0,
            base_freq: 320.0,
            sample_rate,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.phases = [0.0; 6];
        self.y_prevs = [0.0; 6];
        self.amp_env = velocity;
        self.bp1_ic1 = 0.0;
        self.bp1_ic2 = 0.0;
        self.bp2_ic1 = 0.0;
        self.bp2_ic2 = 0.0;

        let actual_decay = if self.is_open {
            self.decay.clamp(0.25, 0.8)
        } else {
            self.decay.clamp(0.01, 0.06)
        };
        self.amp_decay_coeff = (-1.0 / (actual_decay * sample_rate)).exp();
    }

    pub fn release(&mut self) {
        // For open hi-hat, release chokes to a fast 20ms decay
        if self.is_open {
            self.amp_decay_coeff = (-1.0 / (0.02 * self.sample_rate)).exp();
        }
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if self.amp_env < 1e-6 {
            return 0.0;
        }

        let tune_ratio = (self.tune / 12.0).exp2();

        // Loopback FM (Phase Mod with feedback). 
        // High indices create dense, noisy, metallic spectra without raw square aliasing.
        let fm_index = 4.0; // Heavy metallic mod index
        let mut mixed = 0.0;

        for i in 0..6 {
            let freq = self.base_freq * RATIOS[i] * tune_ratio;
            self.phases[i] += freq / sample_rate;
            if self.phases[i] >= 1.0 { self.phases[i] -= 1.0; }
            let pm = fm_index * self.y_prevs[i];
            let y = ((self.phases[i] + pm) * TAU).sin();
            self.y_prevs[i] = y;
            mixed += y;
        }
        mixed /= 6.0;

        // Bandpass 1 at ~3.5kHz scaled by tune ratio
        let bp1_freq = (3500.0 * tune_ratio).clamp(500.0, 18000.0);
        let bp1_out = self.svf_bandpass(mixed, bp1_freq, 2.0, sample_rate, true);
        // Bandpass 2 at ~7kHz scaled by tune ratio
        let bp2_freq = (7000.0 * tune_ratio).clamp(500.0, 19000.0);
        let bp2_out = self.svf_bandpass(mixed, bp2_freq, 2.0, sample_rate, false);

        // Mix bandpasses
        let filtered = bp1_out * (1.0 - self.tone) + bp2_out * self.tone;

        let output = if self.drive > 0.001 {
            fast_tanh(filtered * (1.0 + self.drive * 4.0))
        } else {
            filtered
        };

        // Amplitude envelope
        self.amp_env *= self.amp_decay_coeff;

        output * self.amp_env
    }

    /// SVF bandpass, two separate state pairs for the two filters.
    fn svf_bandpass(
        &mut self,
        input: f32,
        freq: f32,
        q: f32,
        sample_rate: f32,
        is_first: bool,
    ) -> f32 {
        let g = (TAU * freq / sample_rate * 0.5).tan();
        let k = 1.0 / q;
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let (ic1, ic2) = if is_first {
            (&mut self.bp1_ic1, &mut self.bp1_ic2)
        } else {
            (&mut self.bp2_ic1, &mut self.bp2_ic2)
        };

        let v3 = input - *ic2;
        let v1 = a1 * (*ic1) + a2 * v3;
        let v2 = *ic2 + a2 * (*ic1) + a3 * v3;
        *ic1 = 2.0 * v1 - *ic1;
        *ic2 = 2.0 * v2 - *ic2;

        v1 // bandpass output
    }

    pub fn is_active(&self) -> bool {
        self.amp_env > 1e-6
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "tune" => self.tune = value.clamp(-24.0, 24.0),
            "decay" => {
                // Normalize 0-1 to amp decay range 0.01-0.8s
                let v = value.clamp(0.0, 1.0);
                self.decay = 0.01 + v * 0.79;
            }
            "tone" => self.tone = value.clamp(0.0, 1.0),
            "drive" => self.drive = value.clamp(0.0, 10.0),
            "open" => self.is_open = value > 0.5,
            _ => {}
        }
    }
}
