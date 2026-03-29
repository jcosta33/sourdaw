//! Cymbal/ride synthesis.
//!
//! 8 square oscillators at inharmonic ratios (wider spread than hi-hat)
//! through two bandpass filters. Very long decay for ride/crash character.
//! Shimmer: slow LFO modulates the bandpass frequency for movement in the
//! decay tail.

use std::f32::consts::TAU;

/// Inharmonic frequency ratios for metallic cymbal spectrum.
/// Wider spread than hi-hat ratios for a more complex, washy sound.
const RATIOS: [f32; 8] = [1.0, 1.34, 1.65, 1.98, 2.37, 2.83, 3.36, 3.92];

pub struct CymbalEngine {
    oscillators: [f32; 8], // phases
    freqs: [f32; 8],
    // Bandpass filter states (SVF)
    bp1_state: [f32; 2],
    bp2_state: [f32; 2],
    amp_env: f32,
    decay_coeff: f32,
    shimmer_phase: f32,
    shimmer_rate: f32,
    // Parameters
    base_freq: f32,
    decay: f32,      // seconds
    tone: f32,       // mix between low and high bandpass (0-1)
    shimmer_depth: f32, // how much the LFO modulates bandpass freq
    bp1_freq: f32,   // lower bandpass center
    bp2_freq: f32,   // upper bandpass center
}

impl CymbalEngine {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            oscillators: [0.0; 8],
            freqs: [0.0; 8],
            bp1_state: [0.0; 2],
            bp2_state: [0.0; 2],
            amp_env: 0.0,
            decay_coeff: 0.0,
            shimmer_phase: 0.0,
            shimmer_rate: 0.7, // ~0.7Hz LFO
            base_freq: 260.0,
            decay: 2.0,
            tone: 0.5,
            shimmer_depth: 0.15,
            bp1_freq: 2500.0,
            bp2_freq: 5500.0,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.oscillators = [0.0; 8];
        self.bp1_state = [0.0; 2];
        self.bp2_state = [0.0; 2];
        self.amp_env = velocity;
        self.shimmer_phase = 0.0;

        // Compute per-oscillator frequencies from ratios
        for i in 0..8 {
            self.freqs[i] = self.base_freq * RATIOS[i];
        }

        let safe_decay = self.decay.max(0.001);
        self.decay_coeff = (-1.0 / (safe_decay * sample_rate)).exp();
    }

    pub fn release(&mut self) {
        // For crash cymbals, release can choke to a fast decay
        // Roughly ~20ms fade
        self.decay_coeff = 0.9995;
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if self.amp_env < 1e-6 {
            return 0.0;
        }

        // Sum 8 square oscillators at metallic inharmonic ratios
        let mut sum = 0.0_f32;
        for i in 0..8 {
            self.oscillators[i] += self.freqs[i] / sample_rate;
            if self.oscillators[i] >= 1.0 {
                self.oscillators[i] -= 1.0;
            }
            // Square wave: sign of sine
            let sq = if (self.oscillators[i] * TAU).sin() >= 0.0 {
                1.0
            } else {
                -1.0
            };
            sum += sq;
        }
        sum /= 8.0;

        // Shimmer: slow LFO modulates bandpass center frequencies
        self.shimmer_phase += self.shimmer_rate / sample_rate;
        if self.shimmer_phase >= 1.0 {
            self.shimmer_phase -= 1.0;
        }
        let lfo = (self.shimmer_phase * TAU).sin() * self.shimmer_depth;

        // Bandpass 1 (lower, more body)
        let bp1_center = self.bp1_freq * (1.0 + lfo);
        let bp1_out =
            self.svf_bandpass(sum, bp1_center, 1.5, sample_rate, true);

        // Bandpass 2 (higher, shimmer)
        let bp2_center = self.bp2_freq * (1.0 + lfo * 0.7);
        let bp2_out =
            self.svf_bandpass(sum, bp2_center, 1.5, sample_rate, false);

        // Mix bandpasses based on tone
        let filtered = bp1_out * (1.0 - self.tone) + bp2_out * self.tone;

        // Amplitude envelope
        self.amp_env *= self.decay_coeff;

        filtered * self.amp_env
    }

    /// SVF bandpass using two independent state pairs.
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

        let state = if is_first {
            &mut self.bp1_state
        } else {
            &mut self.bp2_state
        };

        let v3 = input - state[1];
        let v1 = a1 * state[0] + a2 * v3;
        let v2 = state[1] + a2 * state[0] + a3 * v3;
        state[0] = 2.0 * v1 - state[0];
        state[1] = 2.0 * v2 - state[1];

        v1 // bandpass output
    }

    pub fn is_active(&self) -> bool {
        self.amp_env > 1e-6
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => {
                // Normalize 0-1 to amp decay range 0.5-8.0s
                let v = value.clamp(0.0, 1.0);
                self.decay = 0.5 + v * 7.5;
            }
            "tune" => {
                // Shift all oscillator frequencies by semitones from default 260Hz
                let ratio = 2.0f32.powf(value.clamp(-24.0, 24.0) / 12.0);
                self.base_freq = (260.0 * ratio).clamp(100.0, 600.0);
            }
            "tone" => self.tone = value.clamp(0.0, 1.0),
            "drive" => {
                // 0-10 drive: increase shimmer depth for more aggressive character
                let v = value.clamp(0.0, 10.0);
                self.shimmer_depth = v / 10.0 * 0.5;
            }
            "shimmer_rate" => self.shimmer_rate = value.clamp(0.1, 5.0),
            "shimmer_depth" => self.shimmer_depth = value.clamp(0.0, 0.5),
            "bp1_freq" => self.bp1_freq = value.clamp(500.0, 5000.0),
            "bp2_freq" => self.bp2_freq = value.clamp(3000.0, 12000.0),
            _ => {}
        }
    }
}
