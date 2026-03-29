//! Snare drum synthesis.
//!
//! Two sine body resonators (~180Hz, ~330Hz) with fast decay,
//! plus bandpass-filtered white noise for the snare wire "snap".

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

pub struct SnareEngine {
    // Body oscillators
    phase1: f32,
    phase2: f32,
    body_env: f32,
    body_decay_coeff: f32,
    // Noise
    noise_env: f32,
    noise_decay_coeff: f32,
    noise_state: u32,
    // Bandpass state (2-pole SVF)
    bp_ic1: f32,
    bp_ic2: f32,
    // Parameters
    tune: f32,           // semitone offset
    body_decay: f32,     // seconds
    snappy: f32,         // noise amount 0-1
    noise_color: f32,    // bandpass center freq factor
    tone: f32,           // body/noise balance
    noise_decay: f32,    // seconds
}

impl SnareEngine {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            phase1: 0.0,
            phase2: 0.0,
            body_env: 0.0,
            body_decay_coeff: 0.0,
            noise_env: 0.0,
            noise_decay_coeff: 0.0,
            noise_state: 0xDEADBEEF,
            bp_ic1: 0.0,
            bp_ic2: 0.0,
            tune: 0.0,
            body_decay: 0.08,
            snappy: 0.6,
            noise_color: 0.5,
            tone: 0.5,
            noise_decay: 0.15,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.phase1 = 0.0;
        self.phase2 = 0.0;
        self.body_env = velocity;
        self.noise_env = velocity;
        self.noise_state = 0xDEADBEEF;
        self.bp_ic1 = 0.0;
        self.bp_ic2 = 0.0;
        let safe_body_decay = self.body_decay.max(0.001);
        let safe_noise_decay = self.noise_decay.max(0.001);
        self.body_decay_coeff = (-1.0 / (safe_body_decay * sample_rate)).exp();
        self.noise_decay_coeff = (-1.0 / (safe_noise_decay * sample_rate)).exp();
    }

    pub fn release(&mut self) {
        // Envelope-driven, no special release behaviour.
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if self.body_env < 1e-6 && self.noise_env < 1e-6 {
            return 0.0;
        }

        // Tune ratio
        let tune_ratio = (self.tune / 12.0).exp2();

        // Body: two sine resonators
        let freq1 = 180.0 * tune_ratio;
        let freq2 = 330.0 * tune_ratio;
        self.phase1 += freq1 / sample_rate;
        if self.phase1 >= 1.0 { self.phase1 -= 1.0; }
        self.phase2 += freq2 / sample_rate;
        if self.phase2 >= 1.0 { self.phase2 -= 1.0; }

        let body = ((self.phase1 * TAU).sin() * 0.7
            + (self.phase2 * TAU).sin() * 0.3)
            * self.body_env;
        self.body_env *= self.body_decay_coeff;

        // Noise through SVF bandpass
        let raw_noise = noise(&mut self.noise_state);
        // Bandpass center: 2kHz to 8kHz based on noise_color
        let bp_freq = 2000.0 + self.noise_color * 6000.0;
        let g = (TAU * bp_freq / sample_rate * 0.5).tan();
        let q = 1.5; // moderate resonance
        let k = 1.0 / q;
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let v3 = raw_noise - self.bp_ic2;
        let v1 = a1 * self.bp_ic1 + a2 * v3;
        let v2 = self.bp_ic2 + a2 * self.bp_ic1 + a3 * v3;
        self.bp_ic1 = 2.0 * v1 - self.bp_ic1;
        self.bp_ic2 = 2.0 * v2 - self.bp_ic2;
        // Bandpass output = v1
        let filtered_noise = v1 * self.noise_env * self.snappy;
        self.noise_env *= self.noise_decay_coeff;

        // Mix body and noise
        body * self.tone + filtered_noise * (1.0 - self.tone * 0.5)
    }

    pub fn is_active(&self) -> bool {
        self.body_env > 1e-6 || self.noise_env > 1e-6
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "tune" => self.tune = value.clamp(-24.0, 24.0),
            "decay" => {
                // Normalize 0-1 to body decay 0.02-0.5s and noise decay 0.03-0.5s
                let v = value.clamp(0.0, 1.0);
                self.body_decay = 0.02 + v * 0.48;
                self.noise_decay = 0.03 + v * 0.47;
            }
            "tone" => self.tone = value.clamp(0.0, 1.0),
            "drive" => self.snappy = value.clamp(0.0, 10.0) / 10.0,
            "body_decay" => self.body_decay = value.clamp(0.02, 0.5),
            "snappy" => self.snappy = value.clamp(0.0, 1.0),
            "noise_color" => self.noise_color = value.clamp(0.0, 1.0),
            "noise_decay" => self.noise_decay = value.clamp(0.03, 0.5),
            _ => {}
        }
    }
}
