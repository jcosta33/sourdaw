//! Longitudinal (phantom) partial generator for bass strings (§7.1).
//!
//! Bass piano strings exhibit longitudinal vibration modes at frequencies
//! determined by the steel wave speed `c_L ≈ 5100 m/s`:
//!
//! ```text
//! f_L,k = k · c_L / (2L)
//! ```
//!
//! These modes are normally inaudible by themselves but are coupled
//! nonlinearly by the transverse partials: their excitation amplitude is
//! proportional to the *squared* transverse displacement. That manifests
//! sonically as the metallic "phantom partials" heard on a concert grand's
//! lowest notes.
//!
//! We implement this with 4 biquad resonators driven by `force^2`, active
//! only for keys below C5 (key < 52).

use super::parameters::{has_longitudinal_modes, key_fundamental_hz};

/// Number of longitudinal modes per voice. 4 is enough to give the bass its
/// characteristic twang without dominating the spectrum.
pub const LONGITUDINAL_MODES: usize = 4;

/// Steel longitudinal wave speed (m/s).
const C_LONGITUDINAL: f32 = 5_100.0;

/// Approximate speed of the transverse wave at the fundamental. Used to
/// estimate string length from the fundamental frequency via `L = c_T / (2·f1)`.
/// For a grand piano bass string, `c_T` varies but ~80 m/s is a reasonable
/// average — exact values are less important than the *ratio* between the
/// two wave speeds.
const C_TRANSVERSE_BASS: f32 = 80.0;

/// Overall amplitude of the longitudinal contribution relative to the
/// transverse signal. Longitudinal modes are a subtle metallic shimmer.
const DRIVE: f32 = 0.004;

/// Bandwidth of every longitudinal resonator (Hz). Longitudinal modes are
/// highly damped because they couple strongly to the bridge.
const BANDWIDTH_HZ: f32 = 18.0;

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
    pub fn configure(&mut self, key: u32, sample_rate: f32) {
        use core::f32::consts::{PI, TAU};
        if !has_longitudinal_modes(key) {
            self.active = false;
            return;
        }
        self.active = true;

        // Estimate string length from the transverse fundamental.
        let f1 = key_fundamental_hz(key);
        let length_m = C_TRANSVERSE_BASS / (2.0 * f1);
        let f_base = C_LONGITUDINAL / (2.0 * length_m);

        let nyquist = sample_rate * 0.5;
        for index in 0..LONGITUDINAL_MODES {
            let partial = (index + 1) as f32;
            let freq = f_base * partial;
            if freq >= nyquist * 0.98 {
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                continue;
            }
            let theta = TAU * freq / sample_rate;
            let r = (-PI * BANDWIDTH_HZ / sample_rate).exp();
            let amp = 1.0 / partial;
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
            self.y1[index] = y;
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
