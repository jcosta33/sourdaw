//! 808-style kick drum synthesis.
//!
//! Sine oscillator with exponential pitch envelope, filtered noise click,
//! tanh drive saturation, and one-pole lowpass tone shaping.

use std::f32::consts::TAU;

const DEFAULT_BASE_FREQ: f32 = 50.0;

/// Simple xorshift32 noise generator (deterministic, no alloc).
fn noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    // Convert to -1..1
    (x as i32 as f32) / (i32::MAX as f32)
}

/// Fast tanh approximation using rational polynomial.
#[inline]
fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

pub struct KickEngine {
    phase: f32,
    amp_env: f32,
    pitch_env: f32,
    click_env: f32,
    click_decay_coeff: f32,
    noise_state: u32,
    // Parameters
    base_freq: f32,
    tune_ratio: f32,
    pitch_amount: f32,
    pitch_decay: f32,
    pitch_decay_coeff: f32,
    amp_decay: f32,
    amp_decay_coeff: f32,
    click_level: f32,
    drive: f32,
    tone_state: f32,
    tone_cutoff: f32,
}

impl KickEngine {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            amp_env: 0.0,
            pitch_env: 0.0,
            click_env: 0.0,
            click_decay_coeff: 0.0,
            noise_state: 0x12345678,
            base_freq: DEFAULT_BASE_FREQ,
            tune_ratio: 1.0,
            pitch_amount: 0.5,
            pitch_decay: 0.06,
            pitch_decay_coeff: 0.0,
            amp_decay: 0.3,
            amp_decay_coeff: 0.0,
            click_level: 0.3,
            drive: 0.0,
            tone_state: 0.0,
            tone_cutoff: 0.8,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.phase = 0.0;
        self.amp_env = velocity;
        self.pitch_env = 1.0;
        self.click_env = 1.0;
        self.noise_state = 0x12345678;
        // Recalculate coefficients (clamp decay times to avoid division by zero)
        let safe_pitch_decay = self.pitch_decay.max(0.001);
        let safe_amp_decay = self.amp_decay.max(0.001);
        self.pitch_decay_coeff = (-1.0 / (safe_pitch_decay * sample_rate)).exp();
        self.amp_decay_coeff = (-1.0 / (safe_amp_decay * sample_rate)).exp();
        self.click_decay_coeff = (-1.0 / (0.005 * sample_rate)).exp(); // 5ms snap
    }

    pub fn release(&mut self) {
        // Kick is purely envelope-driven, release does nothing special.
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if self.amp_env < 1e-6 {
            return 0.0;
        }

        // Pitch envelope (exponential decay)
        self.pitch_env *= self.pitch_decay_coeff;
        let freq =
            self.base_freq * self.tune_ratio * (1.0 + self.pitch_amount * self.pitch_env * 5.0);

        // Phase accumulator
        self.phase += freq / sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        // Body = sine
        let body = (self.phase * TAU).sin();

        // Click = filtered noise burst
        self.click_env *= self.click_decay_coeff;
        let click = if self.click_env > 0.001 {
            noise(&mut self.noise_state) * self.click_env * self.click_level
        } else {
            0.0
        };

        // Amplitude envelope
        self.amp_env *= self.amp_decay_coeff;

        // Mix and drive
        let raw = (body + click) * self.amp_env;
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
            "base_freq" => self.base_freq = value.clamp(30.0, 200.0),
            "pitch_amount" => self.pitch_amount = value.clamp(0.0, 1.0),
            "pitch_decay" => self.pitch_decay = value.clamp(0.01, 0.2),
            "amp_decay" | "decay" => self.amp_decay = 0.05 + value.clamp(0.0, 1.0) * 0.75,
            "click_level" => self.click_level = value.clamp(0.0, 1.0),
            "drive" => self.drive = value.clamp(0.0, 10.0),
            "tone" => self.tone_cutoff = value.clamp(0.01, 1.0),
            "tune" => self.tune_ratio = 2.0f32.powf(value.clamp(-24.0, 24.0) / 12.0),
            _ => {}
        }
    }
}
