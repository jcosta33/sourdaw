//! Tom drum synthesis.
//!
//! Sine oscillator with pitch envelope (similar to kick but higher pitched,
//! shorter decay). Supports low, mid, and hi tom tunings (80-400Hz).
//! Optional noise layer for stick attack and tanh drive for analog warmth.

use std::f32::consts::TAU;

const DEFAULT_BASE_FREQ: f32 = 150.0;

/// xorshift32 noise
fn noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as i32 as f32) / (i32::MAX as f32)
}

/// Fast tanh approximation using rational polynomial.
#[inline]
fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

pub struct TomEngine {
    phase: f32,
    amp_env: f32,
    pitch_env: f32,
    noise_state: u32,
    noise_env: f32,
    // Parameters
    base_freq: f32,
    tune_ratio: f32,
    pitch_amount: f32,
    pitch_decay_coeff: f32,
    pitch_decay: f32,
    amp_decay_coeff: f32,
    amp_decay: f32,
    noise_level: f32,
    drive: f32,
    tone_state: f32,
    tone_cutoff: f32,
}

impl TomEngine {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            amp_env: 0.0,
            pitch_env: 0.0,
            noise_state: 0xABCD1234,
            noise_env: 0.0,
            base_freq: DEFAULT_BASE_FREQ,
            tune_ratio: 1.0,
            pitch_amount: 0.5,
            pitch_decay_coeff: 0.0,
            pitch_decay: 0.03,
            amp_decay_coeff: 0.0,
            amp_decay: 0.15,
            noise_level: 0.2,
            drive: 0.0,
            tone_state: 0.0,
            tone_cutoff: 0.7,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.phase = 0.0;
        self.amp_env = velocity;
        self.pitch_env = 1.0;
        self.noise_env = 1.0;
        self.noise_state = 0xABCD1234;
        self.tone_state = 0.0;
        // Recalculate coefficients (clamp decay times to avoid division by zero)
        let safe_pitch_decay = self.pitch_decay.max(0.001);
        let safe_amp_decay = self.amp_decay.max(0.001);
        self.pitch_decay_coeff = (-1.0 / (safe_pitch_decay * sample_rate)).exp();
        self.amp_decay_coeff = (-1.0 / (safe_amp_decay * sample_rate)).exp();
    }

    pub fn release(&mut self) {
        // Envelope-driven, no special release behaviour.
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if self.amp_env < 1e-6 {
            return 0.0;
        }

        // Pitch envelope: fast drop from up to +300% above base to base
        self.pitch_env *= self.pitch_decay_coeff;
        let freq =
            self.base_freq * self.tune_ratio * (1.0 + self.pitch_amount * self.pitch_env * 3.0);

        // Phase accumulator
        self.phase += freq / sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        // Body = sine
        let body = (self.phase * TAU).sin();

        // Noise layer for stick attack (fast decay)
        self.noise_env *= 0.993; // ~5ms decay
        let stick = if self.noise_env > 0.001 {
            noise(&mut self.noise_state) * self.noise_env * self.noise_level
        } else {
            0.0
        };

        // Amplitude envelope
        self.amp_env *= self.amp_decay_coeff;

        // Mix body and stick
        let raw = (body + stick) * self.amp_env;

        // Drive (tanh saturation)
        let driven = if self.drive > 0.001 {
            fast_tanh(raw * (1.0 + self.drive * 3.0))
        } else {
            raw
        };

        // Tone (one-pole lowpass)
        self.tone_state += self.tone_cutoff * (driven - self.tone_state);
        self.tone_state
    }

    pub fn is_active(&self) -> bool {
        self.amp_env > 1e-6
    }

    pub fn reset_base_freq(&mut self) {
        self.base_freq = DEFAULT_BASE_FREQ;
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => {
                // Normalize 0-1 to amp decay range 0.05-0.5s
                let v = value.clamp(0.0, 1.0);
                self.amp_decay = 0.05 + v * 0.45;
            }
            "tune" => {
                self.tune_ratio = 2.0f32.powf(value.clamp(-24.0, 24.0) / 12.0);
            }
            "tone" => self.tone_cutoff = value.clamp(0.0, 1.0),
            "drive" => self.drive = value.clamp(0.0, 10.0),
            "base_freq" => self.base_freq = value.clamp(80.0, 400.0),
            "pitch_amount" => self.pitch_amount = value.clamp(0.0, 1.0),
            "pitch_decay" => self.pitch_decay = value.clamp(0.005, 0.1),
            "amp_decay" => self.amp_decay = value.clamp(0.05, 0.5),
            "noise_level" => self.noise_level = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}
