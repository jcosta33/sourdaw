//! Generic percussion synthesis.
//!
//! Covers a range of percussion sounds: cowbell (two square oscillators
//! at a minor 3rd), clave (short resonant bandpass impulse), shaker
//! (shaped noise grains), and rim (short sine + noise burst).

use std::f32::consts::TAU;

const DEFAULT_BASE_FREQ: f32 = 800.0;

/// xorshift32 noise
fn noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as i32 as f32) / (i32::MAX as f32)
}

/// Fast tanh approximation.
#[inline]
fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PercType {
    Cowbell,
    Clave,
    Shaker,
    Rim,
}

impl Default for PercType {
    fn default() -> Self {
        Self::Cowbell
    }
}

pub struct PercEngine {
    // Oscillators
    phase1: f32,
    phase2: f32,
    // Envelopes
    amp_env: f32,
    amp_decay_coeff: f32,
    // Noise
    noise_state: u32,
    // Bandpass state
    bp_ic1: f32,
    bp_ic2: f32,
    // Parameters
    perc_type: PercType,
    base_freq: f32,
    tune_ratio: f32,
    tone: f32, // 0-1 parameter
    noise_level: f32,
    decay: f32,
    drive: f32,
}

impl PercEngine {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            phase1: 0.0,
            phase2: 0.0,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            noise_state: 0xBAADF00D,
            bp_ic1: 0.0,
            bp_ic2: 0.0,
            perc_type: PercType::Cowbell,
            base_freq: DEFAULT_BASE_FREQ,
            tune_ratio: 1.0,
            tone: 0.5,
            noise_level: 0.5,
            decay: 0.1,
            drive: 0.0,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.phase1 = 0.0;
        self.phase2 = 0.0;
        self.amp_env = velocity;
        self.noise_state = 0xBAADF00D;
        self.bp_ic1 = 0.0;
        self.bp_ic2 = 0.0;
        self.amp_decay_coeff = (-1.0 / (self.decay * sample_rate)).exp();
    }

    pub fn release(&mut self) {
        // Envelope-driven, no special release.
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if self.amp_env < 1e-6 {
            return 0.0;
        }

        let signal = match self.perc_type {
            PercType::Cowbell => self.tick_cowbell(sample_rate),
            PercType::Clave => self.tick_clave(sample_rate),
            PercType::Shaker => self.tick_shaker(sample_rate),
            PercType::Rim => self.tick_rim(sample_rate),
        };

        self.amp_env *= self.amp_decay_coeff;

        // Drive
        let output = if self.drive > 0.001 {
            fast_tanh(signal * (1.0 + self.drive * 3.0))
        } else {
            signal
        };

        output * self.amp_env
    }

    /// Cowbell: two saturated sines at minor 3rd (~540Hz and ~800Hz)
    /// Using fast_tanh(sine * 10) creates a bandlimited square-like wave without hard aliasing.
    fn tick_cowbell(&mut self, sample_rate: f32) -> f32 {
        let freq1 = self.base_freq * self.tune_ratio;
        let freq2 = freq1 * 1.4833; // minor 3rd + octave ratio
        self.phase1 += freq1 / sample_rate;
        if self.phase1 >= 1.0 {
            self.phase1 -= 1.0;
        }
        self.phase2 += freq2 / sample_rate;
        if self.phase2 >= 1.0 {
            self.phase2 -= 1.0;
        }

        let s1 = (self.phase1 * TAU).sin();
        let s2 = (self.phase2 * TAU).sin();

        // Tanh drive to approximate a bandlimited square wave
        let sq1 = fast_tanh(s1 * 10.0);
        let sq2 = fast_tanh(s2 * 10.0);

        // tone controls high frequency softening
        let mix = (sq1 + sq2) * 0.5;
        let lpf = self.bandpass(mix, 5000.0 * (self.tone + 0.1), 0.5, sample_rate);
        lpf
    }

    /// Clave: high-Q resonant bandpass excited by a tiny noise burst (Modal Resonator).
    fn tick_clave(&mut self, sample_rate: f32) -> f32 {
        // Use phase2 as a simple timer (in seconds)
        self.phase2 += 1.0 / sample_rate;

        // 5ms noise burst exciter
        let click_env = if self.phase2 < 0.005 { 1.0 } else { 0.0 };
        let impulse = noise(&mut self.noise_state) * click_env;

        let tone_hz = self.base_freq * self.tune_ratio;
        let bp_freq = tone_hz * (0.5 + self.tone);

        // Modal resonance (high Q)
        self.bandpass(impulse, bp_freq, 25.0, sample_rate) * 15.0 // Gain compensate high Q
    }

    /// Shaker: shaped noise grains.
    fn tick_shaker(&mut self, sample_rate: f32) -> f32 {
        let raw = noise(&mut self.noise_state);
        // Simple bandpass filter reacting to tune and tone
        let bp_freq = 2000.0 * self.tune_ratio * (0.5 + self.tone * 2.0);
        let bp = self.bandpass(raw, bp_freq, 1.0, sample_rate);
        bp * 0.7 + raw * self.noise_level
    }

    /// Rim: short sine + noise burst.
    fn tick_rim(&mut self, sample_rate: f32) -> f32 {
        let tone_hz = self.base_freq * self.tune_ratio * 0.5;
        self.phase1 += tone_hz / sample_rate;
        if self.phase1 >= 1.0 {
            self.phase1 -= 1.0;
        }
        let sine = (self.phase1 * TAU).sin();
        let n = noise(&mut self.noise_state) * self.noise_level;

        let mixed = sine * 0.7 + n * 0.3;
        self.bandpass(mixed, tone_hz * (1.0 + self.tone * 2.0), 1.0, sample_rate)
    }

    /// SVF bandpass helper.
    fn bandpass(&mut self, input: f32, freq: f32, q: f32, sample_rate: f32) -> f32 {
        let g = (TAU * freq / sample_rate * 0.5).tan();
        let k = 1.0 / q;
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let v3 = input - self.bp_ic2;
        let v1 = a1 * self.bp_ic1 + a2 * v3;
        let v2 = self.bp_ic2 + a2 * self.bp_ic1 + a3 * v3;
        self.bp_ic1 = 2.0 * v1 - self.bp_ic1;
        self.bp_ic2 = 2.0 * v2 - self.bp_ic2;

        v1
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
                // Normalize 0-1 to amp decay range 0.005-1.0s
                let v = value.clamp(0.0, 1.0);
                self.decay = 0.005 + v * 0.995;
            }
            "tune" => {
                // Determine tune ratio from base 800Hz
                self.tune_ratio = 2.0f32.powf(value.clamp(-24.0, 24.0) / 12.0);
            }
            "tone" => {
                // 0-1 tone parameter
                self.tone = value.clamp(0.0, 1.0);
            }
            "drive" => self.drive = value.clamp(0.0, 10.0),
            "base_freq" => self.base_freq = value.clamp(100.0, 8000.0),
            "noise_level" => self.noise_level = value.clamp(0.0, 1.0),
            "type" => {
                self.perc_type = match value as u32 {
                    0 => PercType::Cowbell,
                    1 => PercType::Clave,
                    2 => PercType::Shaker,
                    3 => PercType::Rim,
                    _ => PercType::Cowbell,
                };
            }
            _ => {}
        }
    }
}
