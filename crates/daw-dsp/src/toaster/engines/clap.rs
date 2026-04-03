//! Clap synthesis.
//!
//! Multiple rapid noise bursts spaced ~10ms apart to simulate the
//! staggered hand-clap effect, followed by a longer reverb-like tail.
//! All noise is bandpass-filtered around 1kHz.

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

/// Maximum number of sub-bursts.
const MAX_BURSTS: usize = 7;

pub struct ClapEngine {
    noise_state: u32,
    // Burst tracking
    sample_counter: u32,
    burst_index: usize,
    burst_envs: [f32; MAX_BURSTS],
    // Tail envelope
    tail_env: f32,
    tail_decay_coeff: f32,
    // Bandpass state (SVF)
    bp_ic1: f32,
    bp_ic2: f32,
    // Parameters
    spacing: f32,       // seconds between bursts (~0.01)
    count: usize,       // number of bursts (3-7)
    tone: f32,          // bandpass center frequency factor
    reverb_amount: f32, // tail length
    velocity: f32,
}

impl ClapEngine {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            noise_state: 0xCAFEBABE,
            sample_counter: 0,
            burst_index: 0,
            burst_envs: [0.0; MAX_BURSTS],
            tail_env: 0.0,
            tail_decay_coeff: 0.0,
            bp_ic1: 0.0,
            bp_ic2: 0.0,
            spacing: 0.01,
            count: 4,
            tone: 0.5,
            reverb_amount: 0.5,
            velocity: 0.0,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.velocity = velocity;
        self.sample_counter = 0;
        self.burst_index = 0;
        self.burst_envs = [0.0; MAX_BURSTS];
        self.burst_envs[0] = velocity;
        self.noise_state = 0xCAFEBABE;
        self.bp_ic1 = 0.0;
        self.bp_ic2 = 0.0;
        // Tail decay: 80-200ms based on reverb_amount
        let tail_time = (0.08 + self.reverb_amount * 0.12).max(0.001);
        self.tail_decay_coeff = (-1.0 / (tail_time * sample_rate)).exp();
        self.tail_env = 0.0; // tail starts after bursts complete
    }

    pub fn release(&mut self) {
        // Envelope-driven.
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        let spacing_samples = (self.spacing * sample_rate) as u32;

        // Check if a new burst should fire
        self.sample_counter += 1;
        if self.burst_index < self.count.saturating_sub(1) {
            if self.sample_counter >= spacing_samples {
                self.sample_counter = 0;
                self.burst_index += 1;
                if self.burst_index < self.count && self.burst_index < MAX_BURSTS {
                    // Each subsequent burst is slightly quieter
                    let atten = 1.0 - (self.burst_index as f32 * 0.15);
                    self.burst_envs[self.burst_index] = self.velocity * atten.max(0.3);
                }
                // Start tail after last burst
                if self.burst_index >= self.count - 1 {
                    self.tail_env = self.velocity * 0.5;
                }
            }
        }

        // Generate noise
        let raw = noise(&mut self.noise_state);

        // Sum burst envelopes (each decays very quickly ~2ms)
        let mut burst_amp = 0.0_f32;
        for env in self.burst_envs.iter_mut() {
            if *env > 1e-5 {
                burst_amp += *env;
                *env *= 0.995; // ~2ms decay
            }
        }

        // Tail
        let tail_amp = self.tail_env;
        self.tail_env *= self.tail_decay_coeff;

        let total_amp = burst_amp + tail_amp;
        if total_amp < 1e-6 {
            return 0.0;
        }

        let signal = raw * total_amp;

        // Bandpass at ~1kHz (shifted by tone)
        let bp_freq = 800.0 + self.tone * 1400.0;
        let g = (TAU * bp_freq / sample_rate * 0.5).tan();
        let k = 1.0 / 1.8_f32; // moderate Q
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let v3 = signal - self.bp_ic2;
        let v1 = a1 * self.bp_ic1 + a2 * v3;
        let v2 = self.bp_ic2 + a2 * self.bp_ic1 + a3 * v3;
        self.bp_ic1 = 2.0 * v1 - self.bp_ic1;
        self.bp_ic2 = 2.0 * v2 - self.bp_ic2;

        v1
    }

    pub fn is_active(&self) -> bool {
        self.tail_env > 1e-6 || self.burst_envs.iter().any(|e| *e > 1e-5)
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => {
                // Normalize 0-1 to tail decay via reverb_amount 0-1
                self.reverb_amount = value.clamp(0.0, 1.0);
            }
            "tune" => {
                // Shift the noise bandpass filter center frequency by semitones
                let ratio = 2.0f32.powf(value.clamp(-24.0, 24.0) / 12.0);
                self.tone = (0.5 * ratio).clamp(0.0, 1.0);
            }
            "tone" => self.tone = value.clamp(0.0, 1.0),
            "drive" => {
                // 0-10 drive: map to burst count (more bursts = thicker clap)
                let v = value.clamp(0.0, 10.0);
                self.count = (3.0 + v * 0.4) as usize;
                if self.count > MAX_BURSTS {
                    self.count = MAX_BURSTS;
                }
            }
            "spacing" => self.spacing = value.clamp(0.005, 0.03),
            "count" => self.count = (value as usize).clamp(3, MAX_BURSTS),
            "reverb_amount" => self.reverb_amount = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}
