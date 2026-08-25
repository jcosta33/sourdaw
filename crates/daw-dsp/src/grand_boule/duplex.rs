//! Duplex-scale resonance bank.
//!
//! The duplex scale is the short segment of string between the bridge and
//! the hitch pin (or capo d'astro). On a grand it is deliberately tuned to
//! an octave, 12th, or double-octave above the speaking length to add a
//! shimmer of high-frequency sympathetic resonance.
//!
//! We model it as a pair of very high-Q biquad resonators at 2× and 3× the
//! fundamental frequency, active only for keys C4 and above, at roughly
//! -35 dB.

use super::parameters::{has_duplex_resonance, key_fundamental_hz};
use crate::primitives::flush_denormal;

/// Number of duplex resonators per voice.
pub const DUPLEX_MODES: usize = 2;

/// Duplex bandwidth. Narrow (high Q) — duplex resonances ring for several
/// seconds, though their audible level is low.
const BANDWIDTH_HZ: f32 = 2.0;

/// Output level (linear). Roughly −35 dB.
const LEVEL: f32 = 0.018;

#[derive(Clone, Debug)]
pub struct DuplexBank {
    c0: [f32; DUPLEX_MODES],
    c1: [f32; DUPLEX_MODES],
    c2: [f32; DUPLEX_MODES],
    x1: [f32; DUPLEX_MODES],
    x2: [f32; DUPLEX_MODES],
    y1: [f32; DUPLEX_MODES],
    y2: [f32; DUPLEX_MODES],
    active: bool,
}

impl DuplexBank {
    pub fn new() -> Self {
        Self {
            c0: [0.0; DUPLEX_MODES],
            c1: [0.0; DUPLEX_MODES],
            c2: [0.0; DUPLEX_MODES],
            x1: [0.0; DUPLEX_MODES],
            x2: [0.0; DUPLEX_MODES],
            y1: [0.0; DUPLEX_MODES],
            y2: [0.0; DUPLEX_MODES],
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

    pub fn configure(&mut self, key: u32, sample_rate: f32) {
        use core::f32::consts::{PI, TAU};
        if !has_duplex_resonance(key) {
            self.active = false;
            return;
        }
        self.active = true;

        let f1 = key_fundamental_hz(key);
        // Tune to the octave (2×) and the 12th (3×).
        let ratios = [2.0_f32, 3.0_f32];
        let nyquist = sample_rate * 0.5;
        for (index, ratio) in ratios.iter().enumerate().take(DUPLEX_MODES) {
            let freq = f1 * ratio;
            if freq >= nyquist * 0.98 {
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                continue;
            }
            let theta = TAU * freq / sample_rate;
            let r = (-PI * BANDWIDTH_HZ / sample_rate).exp();
            self.c0[index] = LEVEL * (1.0 - r * r) * theta.sin() * 0.5;
            self.c1[index] = 2.0 * r * theta.cos();
            self.c2[index] = -(r * r);
        }
    }

    #[inline]
    pub fn tick(&mut self, bridge_sample: f32) -> f32 {
        if !self.active {
            return 0.0;
        }
        let mut output = 0.0_f32;
        for index in 0..DUPLEX_MODES {
            let y = self.c0[index] * (bridge_sample - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = bridge_sample;
            self.y2[index] = self.y1[index];
            self.y1[index] = flush_denormal(y);
            output += y;
        }
        output
    }
}

impl Default for DuplexBank {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn c4_and_above_is_active() {
        let mut bank = DuplexBank::new();
        bank.configure(40, 48_000.0);
        assert!(bank.is_active());
    }

    #[test]
    fn bass_is_inactive() {
        let mut bank = DuplexBank::new();
        bank.configure(10, 48_000.0);
        assert!(!bank.is_active());
        assert_eq!(bank.tick(1.0), 0.0);
    }

    #[test]
    fn duplex_rings_after_burst() {
        let mut bank = DuplexBank::new();
        bank.configure(49, 48_000.0);
        for _ in 0..50 {
            let _ = bank.tick(1.0);
        }
        let mut energy = 0.0_f32;
        for _ in 0..2_000 {
            energy += bank.tick(0.0).abs();
        }
        assert!(energy > 0.0);
    }
}
