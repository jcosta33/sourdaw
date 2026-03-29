/// Reference tone generator — sine wave at the target note frequency.

use std::f32::consts::TAU;

pub struct ToneGenerator {
    phase: f32,
    freq: f32,
    amplitude: f32,
    target_amplitude: f32,
    enabled: bool,
    sample_rate: f32,
    smooth_coeff: f32,
}

impl ToneGenerator {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            freq: 440.0,
            amplitude: 0.0,
            target_amplitude: 0.0,
            enabled: false,
            sample_rate,
            smooth_coeff: 1.0 - (-1.0 / (0.01 * sample_rate)).exp(), // 10ms ramp
        }
    }

    pub fn set_freq(&mut self, freq: f32) {
        self.freq = freq.clamp(20.0, 20000.0);
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.target_amplitude = if enabled { 0.15 } else { 0.0 };
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        self.amplitude += self.smooth_coeff * (self.target_amplitude - self.amplitude);

        if self.amplitude < 1e-6 {
            return 0.0;
        }

        self.phase += self.freq / self.sample_rate;
        if self.phase >= 1.0 { self.phase -= 1.0; }

        (self.phase * TAU).sin() * self.amplitude
    }
}
