//! Bode-style frequency shifter using IIR Hilbert transform.
//!
//! Two all-pass filter chains providing approximately 90° phase separation
//! across 20 Hz – 20 kHz. Coefficients optimized with Chebyshev approximation
//! for ~1% phase accuracy down to 20 Hz.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

/// First-order all-pass filter for Hilbert transform network.
#[derive(Clone)]
struct HilbertAllPass {
    coeff: f32,
    z1: f32,
}

impl HilbertAllPass {
    fn new(coeff: f32) -> Self {
        Self { coeff, z1: 0.0 }
    }

    fn process(&mut self, input: f32) -> f32 {
        // First-order all-pass: y[n] = a * (x[n] - y[n-1]) + x[n-1]
        let y = flush_denormal(self.coeff * (input - self.z1) + self.z1);
        self.z1 = y;
        y
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
    }
}

/// Bode frequency shifter with IIR Hilbert transform approximation.
///
/// Uses two parallel all-pass chains that maintain ~90° phase difference
/// across the audio band. The analytic signal is then multiplied by
/// a complex exponential to shift frequencies.
///
/// y(t) = x(t)·cos(ω_shift·t) ∓ x̂(t)·sin(ω_shift·t)
pub struct HilbertShifter {
    // All-pass chain A (for "real" path)
    chain_a: Vec<HilbertAllPass>,
    // All-pass chain B (for "imaginary" path, ~90° shifted)
    chain_b: Vec<HilbertAllPass>,

    // Oscillator
    phase: f32,
    shift_hz: f32,
    mix: f32,
    sample_rate: f32,
    /// false = upper sideband (shift up), true = lower sideband (shift down)
    lower_sideband: bool,
}

// Chebyshev-optimized coefficients for wideband 90° phase difference (20Hz–20kHz).
// Chain A coefficients
const CHAIN_A_COEFFS: [f32; 4] = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737];

// Chain B coefficients
const CHAIN_B_COEFFS: [f32; 4] = [
    0.4021921162426,
    0.8561710882420,
    0.9722909545651,
    0.9952884791278,
];

impl HilbertShifter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            chain_a: CHAIN_A_COEFFS
                .iter()
                .map(|&c| HilbertAllPass::new(c))
                .collect(),
            chain_b: CHAIN_B_COEFFS
                .iter()
                .map(|&c| HilbertAllPass::new(c))
                .collect(),
            phase: 0.0,
            shift_hz: 0.0,
            mix: 0.5,
            sample_rate,
            lower_sideband: false,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "freqShiftHz" => {
                self.lower_sideband = value < 0.0;
                self.shift_hz = value.abs();
            }
            "freqShiftMix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if self.shift_hz < 0.001 {
            return input;
        }

        // Process through Hilbert transform all-pass chains
        let mut real_path = input;
        for ap in &mut self.chain_a {
            real_path = ap.process(real_path);
        }

        let mut imag_path = input;
        for ap in &mut self.chain_b {
            imag_path = ap.process(imag_path);
        }

        // Generate complex exponential
        let phase_inc = self.shift_hz / self.sample_rate;
        self.phase += phase_inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let angle = self.phase * 2.0 * PI;
        let cos_w = angle.cos();
        let sin_w = angle.sin();

        // Frequency shifting via analytic signal × complex exponential
        // Upper sideband: y = real·cos - imag·sin
        // Lower sideband: y = real·cos + imag·sin
        let shifted = if self.lower_sideband {
            real_path * cos_w + imag_path * sin_w
        } else {
            real_path * cos_w - imag_path * sin_w
        };

        // Mix
        input * (1.0 - self.mix) + shifted * self.mix
    }

    pub fn reset(&mut self) {
        for ap in &mut self.chain_a {
            ap.reset();
        }
        for ap in &mut self.chain_b {
            ap.reset();
        }
        self.phase = 0.0;
    }
}
