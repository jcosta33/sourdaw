//! Sympathetic resonance bank for the Grand Boule piano.
//!
//! A global bank of 24 high-Q biquad resonators is tuned to a
//! selection of piano fundamentals. It is driven by the aggregate bridge
//! force of all active voices and contributes its summed output back into
//! the soundboard / mix bus.
//!
//! The damping of every resonator is controlled by an undamped factor in
//! [0, 1] that scales the per-resonator extra bandwidth. When the sustain
//! pedal is fully down, damping goes to zero and the bank rings freely;
//! when up, the bank is heavily damped and contributes only a short
//! after-ring.

use super::parameters::key_fundamental_hz;
use crate::primitives::flush_denormal;

/// Number of sympathetic resonators. 24 = 8-wide SIMD × 3 lanes and covers
/// 2 resonators per octave across the piano range.
pub const SYMPATHETIC_MODES: usize = 24;

/// Resonator base bandwidth when fully undamped (Hz). Very narrow — these
/// are supposed to ring for seconds.
const UNDAMPED_BANDWIDTH_HZ: f32 = 0.8;

/// Resonator bandwidth added when fully damped (Hz). Gives a short,
/// harmonic-ish "after ring" when the sustain pedal is up.
const DAMPED_BANDWIDTH_HZ: f32 = 40.0;

/// Aggregate drive gain applied to the input bridge force.
const DRIVE: f32 = 0.05;

#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct Sympathetic {
    c0: [f32; SYMPATHETIC_MODES],
    c1: [f32; SYMPATHETIC_MODES],
    c2: [f32; SYMPATHETIC_MODES],
    x1: [f32; SYMPATHETIC_MODES],
    x2: [f32; SYMPATHETIC_MODES],
    y1: [f32; SYMPATHETIC_MODES],
    y2: [f32; SYMPATHETIC_MODES],
    /// Piano key that each resonator is tuned to.
    keys: [u32; SYMPATHETIC_MODES],
    sample_rate: f32,
    /// 0.0 = fully undamped (pedal down), 1.0 = fully damped (pedal up).
    damping_mix: f32,
}

impl Sympathetic {
    pub fn new(sample_rate: f32) -> Self {
        let mut bank = Self {
            c0: [0.0; SYMPATHETIC_MODES],
            c1: [0.0; SYMPATHETIC_MODES],
            c2: [0.0; SYMPATHETIC_MODES],
            x1: [0.0; SYMPATHETIC_MODES],
            x2: [0.0; SYMPATHETIC_MODES],
            y1: [0.0; SYMPATHETIC_MODES],
            y2: [0.0; SYMPATHETIC_MODES],
            keys: [0; SYMPATHETIC_MODES],
            sample_rate,
            damping_mix: 1.0,
        };
        // Spread the resonators across the piano keyboard: roughly every
        // 88/24 ≈ 3.6 semitones. Keeps them out of every note's harmonic
        // lattice so they do not exactly align with played pitches.
        for index in 0..SYMPATHETIC_MODES {
            let key = 1 + ((index as f32 + 0.5) * 88.0 / SYMPATHETIC_MODES as f32) as u32;
            bank.keys[index] = key.clamp(1, 88);
        }
        bank.rebuild_modes();
        bank
    }

    /// Clear filter state.
    pub fn reset(&mut self) {
        self.x1.fill(0.0);
        self.x2.fill(0.0);
        self.y1.fill(0.0);
        self.y2.fill(0.0);
    }

    /// Set the damping mix. 0 = fully rings (sustain pedal down), 1 = fully
    /// damped (no pedal).
    pub fn set_damping(&mut self, damping_mix: f32) {
        let clamped = damping_mix.clamp(0.0, 1.0);
        if (clamped - self.damping_mix).abs() < 1.0e-4 {
            return;
        }
        self.damping_mix = clamped;
        self.rebuild_modes();
    }

    pub fn damping(&self) -> f32 {
        self.damping_mix
    }

    fn rebuild_modes(&mut self) {
        use core::f32::consts::{PI, TAU};
        let nyquist = self.sample_rate * 0.5;
        let bandwidth = UNDAMPED_BANDWIDTH_HZ
            + self.damping_mix * (DAMPED_BANDWIDTH_HZ - UNDAMPED_BANDWIDTH_HZ);

        for index in 0..SYMPATHETIC_MODES {
            let key = self.keys[index];
            let freq = key_fundamental_hz(key);
            if freq >= nyquist * 0.98 {
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                continue;
            }
            let theta = TAU * freq / self.sample_rate;
            let r = (-PI * bandwidth / self.sample_rate).exp();
            self.c0[index] = DRIVE * (1.0 - r * r) * theta.sin() * 0.5;
            self.c1[index] = 2.0 * r * theta.cos();
            self.c2[index] = -(r * r);
        }
    }

    /// Process one sample of aggregate bridge force; returns the summed
    /// sympathetic response (mono — the soundboard adds stereo spread).
    #[inline]
    pub fn tick(&mut self, input: f32) -> f32 {
        let mut output = 0.0_f32;
        for index in 0..SYMPATHETIC_MODES {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undamped_rings_longer_than_damped() {
        let sample_rate = 48_000.0;
        let mut undamped = Sympathetic::new(sample_rate);
        let mut damped = Sympathetic::new(sample_rate);
        undamped.set_damping(0.0);
        damped.set_damping(1.0);

        // Excite with a burst then measure late-window energy. A high-Q
        // narrow resonator responds with a *smaller peak* than a low-Q
        // broad resonator but sustains for much longer, so we have to skip
        // past the initial transient.
        let late_energy = |bank: &mut Sympathetic| -> f32 {
            for _ in 0..100 {
                bank.tick(1.0);
            }
            for _ in 0..4_800 {
                let _ = bank.tick(0.0);
            }
            let mut total = 0.0_f32;
            for _ in 0..12_000 {
                total += bank.tick(0.0).abs();
            }
            total
        };
        let u = late_energy(&mut undamped);
        let d = late_energy(&mut damped);
        assert!(u > d, "undamped={u}, damped={d}");
    }

    #[test]
    fn keys_cover_piano_range() {
        let bank = Sympathetic::new(48_000.0);
        let min_key = *bank.keys.iter().min().unwrap();
        let max_key = *bank.keys.iter().max().unwrap();
        assert!(min_key >= 1);
        assert!(max_key <= 88);
        assert!(max_key - min_key > 60);
    }
}
