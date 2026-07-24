//! Modal percussion synthesis.
//!
//! Physical percussion sounds (tabla, bongos, woodblock, metal) via a bank
//! of 4-8 damped resonators (2-pole biquad bandpass each), excited by a
//! noise impulse or shaped transient. Each mode has independent frequency,
//! decay, and gain. Nonlinear damping: decay increases (rings longer) at
//! lower amplitudes for a more natural feel.

use crate::primitives::flush_denormal;
use std::f32::consts::TAU;

/// xorshift32 noise
fn noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as i32 as f32) / (i32::MAX as f32)
}

/// A single resonant mode (2-pole biquad bandpass).
struct ModalMode {
    freq: f32,
    decay: f32,
    gain: f32,
    s1: f32,
    s2: f32,
    // Precomputed biquad coefficients (RBJ bandpass)
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl ModalMode {
    fn new(freq: f32, decay: f32, gain: f32) -> Self {
        Self {
            freq,
            decay,
            gain,
            s1: 0.0,
            s2: 0.0,
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    /// Compute RBJ bandpass biquad coefficients.
    ///
    /// Based on Robert Bristow-Johnson's Audio EQ Cookbook:
    ///   BPF (constant 0 dB peak gain):
    ///     b0 =  alpha
    ///     b1 =  0
    ///     b2 = -alpha
    ///     a0 =  1 + alpha
    ///     a1 = -2*cos(w0)
    ///     a2 =  1 - alpha
    ///   where w0 = 2*pi*f0/Fs, alpha = sin(w0)/(2*Q)
    fn compute_coeffs(&mut self, freq: f32, q: f32, sample_rate: f32) {
        let w0 = TAU * freq / sample_rate;
        let sin_w0 = w0.sin();
        let cos_w0 = w0.cos();
        let alpha = sin_w0 / (2.0 * q);

        let a0 = 1.0 + alpha;
        self.b0 = alpha / a0;
        self.b1 = 0.0;
        self.b2 = -alpha / a0;
        self.a1 = -2.0 * cos_w0 / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    /// Process one sample through the biquad (direct form II transposed).
    #[inline]
    fn tick(&mut self, input: f32) -> f32 {
        // DSP-2: high-Q modal resonators ring longest of any Toaster engine.
        let out = flush_denormal(self.b0 * input + self.s1);
        self.s1 = flush_denormal(self.b1 * input - self.a1 * out + self.s2);
        self.s2 = flush_denormal(self.b2 * input - self.a2 * out);
        out * self.gain
    }

    fn reset(&mut self) {
        self.s1 = 0.0;
        self.s2 = 0.0;
    }
}

/// Preset IDs for quick modal configurations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModalPreset {
    Tabla,
    Bongo,
    Woodblock,
    Metal,
}

impl Default for ModalPreset {
    fn default() -> Self {
        Self::Tabla
    }
}

pub struct ModalEngine {
    modes: [ModalMode; 8],
    mode_count: usize,
    exciter_env: f32,
    exciter_decay_coeff: f32,
    noise_state: u32,
    // Overall amplitude envelope
    amp_env: f32,
    amp_decay_coeff: f32,
    // Parameters
    preset: ModalPreset,
    tune_ratio: f32,
    exciter_length: f32, // seconds, controls the noise impulse duration
    brightness: f32,     // scales higher mode gains
    damping: f32,        // nonlinear damping amount (0-1)
}

impl ModalEngine {
    pub fn new(_sample_rate: f32) -> Self {
        let mut engine = Self {
            modes: core::array::from_fn(|_| ModalMode::new(440.0, 0.1, 0.0)),
            mode_count: 4,
            exciter_env: 0.0,
            exciter_decay_coeff: 0.0,
            noise_state: 0xFACEFEED,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            preset: ModalPreset::Tabla,
            tune_ratio: 1.0,
            exciter_length: 0.002,
            brightness: 1.0,
            damping: 0.3,
        };
        engine.apply_preset(ModalPreset::Tabla);
        engine
    }

    /// Apply a preset configuration of mode frequencies, decays, and gains.
    fn apply_preset(&mut self, preset: ModalPreset) {
        self.preset = preset;
        match preset {
            ModalPreset::Tabla => {
                // Tabla: rich harmonic content, medium Q, warm resonance
                self.mode_count = 6;
                self.set_mode(0, 150.0, 0.20, 1.0);
                self.set_mode(1, 350.0, 0.15, 0.8);
                self.set_mode(2, 700.0, 0.12, 0.5);
                self.set_mode(3, 1200.0, 0.08, 0.3);
                self.set_mode(4, 1800.0, 0.06, 0.15);
                self.set_mode(5, 2600.0, 0.04, 0.08);
                self.exciter_length = 0.003;
                self.damping = 0.3;
            }
            ModalPreset::Bongo => {
                // Bongo: short, punchy, fewer modes
                self.mode_count = 4;
                self.set_mode(0, 200.0, 0.10, 1.0);
                self.set_mode(1, 500.0, 0.07, 0.6);
                self.set_mode(2, 900.0, 0.05, 0.3);
                self.set_mode(3, 1500.0, 0.03, 0.15);
                self.exciter_length = 0.002;
                self.damping = 0.5;
            }
            ModalPreset::Woodblock => {
                // Woodblock: high pitched, very short, high Q
                self.mode_count = 4;
                self.set_mode(0, 800.0, 0.04, 1.0);
                self.set_mode(1, 1600.0, 0.03, 0.7);
                self.set_mode(2, 3200.0, 0.02, 0.4);
                self.set_mode(3, 5000.0, 0.015, 0.2);
                self.exciter_length = 0.001;
                self.damping = 0.6;
            }
            ModalPreset::Metal => {
                // Metal: long decay, dense inharmonic spectrum
                self.mode_count = 8;
                self.set_mode(0, 400.0, 0.50, 1.0);
                self.set_mode(1, 900.0, 0.40, 0.8);
                self.set_mode(2, 1500.0, 0.35, 0.6);
                self.set_mode(3, 2800.0, 0.30, 0.45);
                self.set_mode(4, 5000.0, 0.25, 0.3);
                self.set_mode(5, 7200.0, 0.20, 0.2);
                self.set_mode(6, 9500.0, 0.15, 0.12);
                self.set_mode(7, 12000.0, 0.10, 0.07);
                self.exciter_length = 0.001;
                self.damping = 0.15;
            }
        }
    }

    fn set_mode(&mut self, index: usize, freq: f32, decay: f32, gain: f32) {
        if index < 8 {
            self.modes[index].freq = freq;
            self.modes[index].decay = decay;
            self.modes[index].gain = gain;
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.exciter_env = velocity;
        self.amp_env = velocity;
        self.noise_state = 0xFACEFEED;

        // Exciter decay: very fast (1-5ms noise burst)
        self.exciter_decay_coeff = (-1.0 / (self.exciter_length * sample_rate)).exp();

        // Overall amplitude envelope: use the longest mode decay + headroom
        let max_decay = self.modes[..self.mode_count]
            .iter()
            .map(|m| m.decay)
            .fold(0.0_f32, f32::max);
        self.amp_decay_coeff = (-1.0 / ((max_decay + 0.05) * sample_rate)).exp();

        // Reset and compute coefficients for all active modes
        for i in 0..self.mode_count {
            self.modes[i].reset();
            let freq = self.modes[i].freq * self.tune_ratio;
            // Q derived from decay: longer decay = higher Q
            let q = 10.0 + self.modes[i].decay * 200.0;
            self.modes[i].compute_coeffs(freq, q, sample_rate);
        }
    }

    pub fn release(&mut self) {
        // Accelerate decay on release (choke)
        self.amp_decay_coeff *= 0.999;
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if self.amp_env < 1e-6 {
            return 0.0;
        }

        // Exciter: short noise burst
        let exciter = if self.exciter_env > 0.001 {
            let n = noise(&mut self.noise_state) * self.exciter_env;
            self.exciter_env *= self.exciter_decay_coeff;
            n
        } else {
            0.0
        };

        // Sum all active modes
        let mut sum = 0.0_f32;
        for i in 0..self.mode_count {
            let mode_out = self.modes[i].tick(exciter);

            // Nonlinear damping: at higher amplitudes, reduce output slightly.
            // This causes louder hits to decay faster, adding realism.
            let damped = if self.damping > 0.001 {
                let abs_out = mode_out.abs();
                let reduction = 1.0 - self.damping * abs_out * 0.5;
                mode_out * reduction.max(0.5)
            } else {
                mode_out
            };

            // Apply brightness scaling to higher modes
            let brightness_scale = if i > 0 { self.brightness } else { 1.0 };

            sum += damped * brightness_scale;
        }

        // Overall amplitude envelope
        self.amp_env *= self.amp_decay_coeff;

        // Soft-clip to prevent overloads from resonant modes
        let _ = sample_rate; // used at trigger time
        let clamped = sum.clamp(-1.5, 1.5);
        clamped * self.amp_env
    }

    pub fn is_active(&self) -> bool {
        self.amp_env > 1e-6
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => {
                // Normalize 0-1 to a global decay multiplier (0.2x to 3.0x)
                // that scales all mode decay times
                let v = value.clamp(0.0, 1.0);
                let multiplier = 0.2 + v * 2.8;
                for i in 0..self.mode_count {
                    let base_decay = self.modes[i].decay;
                    self.modes[i].decay = base_decay * multiplier;
                }
            }
            "tune" => {
                // Shift all mode frequencies by semitone ratio
                self.tune_ratio = 2.0f32.powf(value.clamp(-24.0, 24.0) / 12.0);
            }
            "tone" => {
                // Map 0-1 to brightness (higher modes gain)
                self.brightness = value.clamp(0.0, 1.0) * 2.0;
            }
            "drive" => {
                // 0-10 drive: map to damping reduction (less damping = more ring)
                let v = value.clamp(0.0, 10.0);
                self.damping = 1.0 - (v / 10.0);
            }
            "preset" => {
                let preset = match value as u32 {
                    0 => ModalPreset::Tabla,
                    1 => ModalPreset::Bongo,
                    2 => ModalPreset::Woodblock,
                    3 => ModalPreset::Metal,
                    _ => ModalPreset::Tabla,
                };
                self.apply_preset(preset);
            }
            "exciter_length" => {
                self.exciter_length = value.clamp(0.0005, 0.02);
            }
            "brightness" => {
                self.brightness = value.clamp(0.0, 2.0);
            }
            "damping" => {
                self.damping = value.clamp(0.0, 1.0);
            }
            _ => {}
        }
    }
}
