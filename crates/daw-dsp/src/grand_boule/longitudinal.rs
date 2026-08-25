//! Longitudinal partial generator for bass strings.
//!
//! Bass piano strings exhibit longitudinal vibration modes coupled
//! nonlinearly to the transverse modes. This project approximation excites
//! sum-frequency components from transverse-mode pairs:
//!
//! ```text
//! f_phantom ≈ f_m + f_n  (and difference frequencies)
//! ```
//!
//! Each phantom resonator uses one-quarter of the project inharmonicity
//! coefficient and is tuned to a sum-frequency in
//! `f_p ≈ f₀·p·√(1 + ¼·B·p²)` rather than to the steel
//! longitudinal-wave frequencies (which produce a single fixed formant
//! rather than the project voicing's harmonic shimmer).
//!
//! The project voicing enables the bank only in the lower register.

use super::parameters::{has_longitudinal_modes, inharmonicity_b, key_fundamental_hz};
use crate::primitives::flush_denormal;

/// Number of phantom-partial resonators per voice.
///
/// Six project-tuned phantom components balance richness and CPU cost.
pub const LONGITUDINAL_MODES: usize = 6;

/// Overall amplitude of the phantom partials relative to the transverse
/// signal. Subtle metallic shimmer — the bass character of a grand.
const DRIVE: f32 = 0.006;

/// Project bandwidth of every phantom resonator (Hz).
const BANDWIDTH_HZ: f32 = 22.0;

#[derive(Clone, Debug)]
pub struct LongitudinalBank {
    c0: [f32; LONGITUDINAL_MODES],
    c1: [f32; LONGITUDINAL_MODES],
    c2: [f32; LONGITUDINAL_MODES],
    x1: [f32; LONGITUDINAL_MODES],
    x2: [f32; LONGITUDINAL_MODES],
    y1: [f32; LONGITUDINAL_MODES],
    y2: [f32; LONGITUDINAL_MODES],
    active: bool,
}

impl LongitudinalBank {
    pub fn new() -> Self {
        Self {
            c0: [0.0; LONGITUDINAL_MODES],
            c1: [0.0; LONGITUDINAL_MODES],
            c2: [0.0; LONGITUDINAL_MODES],
            x1: [0.0; LONGITUDINAL_MODES],
            x2: [0.0; LONGITUDINAL_MODES],
            y1: [0.0; LONGITUDINAL_MODES],
            y2: [0.0; LONGITUDINAL_MODES],
            active: false,
        }
    }

    pub fn reset(&mut self) {
        self.x1.fill(0.0);
        self.x2.fill(0.0);
        self.y1.fill(0.0);
        self.y2.fill(0.0);
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Configure the bank for a given key. If the key lies above C5 the
    /// bank deactivates and `tick` becomes a no-op.
    ///
    /// Phantom partial frequencies use the project's quarter-inharmonicity
    /// rule: `f_p ≈ f₀·p·√(1 + ¼·B·p²)`. We tune resonator `k` to the
    /// (k+1)th sum-frequency pair (`m=1`, `n=k+1`), which captures the
    /// selected project phantoms without enumerating every pair.
    pub fn configure(&mut self, key: u32, sample_rate: f32) {
        use core::f32::consts::{PI, TAU};
        if !has_longitudinal_modes(key) {
            self.active = false;
            return;
        }
        self.active = true;

        let f1 = key_fundamental_hz(key);
        let b = inharmonicity_b(key);
        // Quarter-strength inharmonicity for the project voicing.
        let phantom_b = b * 0.25;
        let nyquist = sample_rate * 0.5;
        for index in 0..LONGITUDINAL_MODES {
            // Partial index for the phantom mode. We sweep p = 2..=K+1 so
            // the first phantom sits one octave above the fundamental.
            let partial = (index as f32) + 2.0;
            let freq = f1 * partial * (1.0 + phantom_b * partial * partial).sqrt();
            if freq >= nyquist * 0.98 {
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                continue;
            }
            let theta = TAU * freq / sample_rate;
            let r = (-PI * BANDWIDTH_HZ / sample_rate).exp();
            // Phantom amplitudes use a simple 1/p² project rolloff.
            let amp = 1.0 / (partial * partial);
            self.c0[index] = DRIVE * amp * (1.0 - r * r) * theta.sin() * 0.5;
            self.c1[index] = 2.0 * r * theta.cos();
            self.c2[index] = -(r * r);
        }
    }

    /// Process one sample. `transverse_sample` is the transverse string
    /// output; it is squared before being fed into the longitudinal bank.
    #[inline]
    pub fn tick(&mut self, transverse_sample: f32) -> f32 {
        if !self.active {
            return 0.0;
        }
        let input = transverse_sample * transverse_sample;
        let mut output = 0.0_f32;
        for index in 0..LONGITUDINAL_MODES {
            let y = self.c0[index] * (input - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = input;
            self.y2[index] = self.y1[index];
            self.y1[index] = flush_denormal(y);
            output += y;
        }
        output
    }
}

impl Default for LongitudinalBank {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bass_key_activates_bank() {
        let mut bank = LongitudinalBank::new();
        bank.configure(10, 48_000.0);
        assert!(bank.is_active());
    }

    #[test]
    fn treble_key_deactivates_bank() {
        let mut bank = LongitudinalBank::new();
        bank.configure(70, 48_000.0);
        assert!(!bank.is_active());
        // And tick returns zero.
        assert_eq!(bank.tick(1.0), 0.0);
    }

    #[test]
    fn squared_drive_is_nonlinear() {
        // Squared input => doubling transverse amplitude quadruples the
        // instantaneous drive, not doubles it.
        let mut bank = LongitudinalBank::new();
        bank.configure(20, 48_000.0);
        let first = bank.tick(0.1).abs();
        bank.reset();
        let second = bank.tick(0.2).abs();
        assert!(second > 2.0 * first || first == 0.0);
    }
}
