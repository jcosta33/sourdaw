//! Frequency-dependent damping.
//!
//! Spec §1.5 — real strings have damping that grows with frequency. The
//! NESS approach uses an auxiliary state per spatial point; here we
//! approximate the perceptual effect with a simple high-shelf cut, which
//! shapes sustained samples to match the measured T60-vs-frequency profile
//! to within a few dB at typical block rates. The amount knob lets the
//! user dial in how aggressive the HF roll-off is.

use super::biquad::Biquad;

pub struct DampingFilter {
    shelf: Biquad,
    sample_rate: f32,
    /// Set by the orchestrator from the per-instrument preset; not user-tunable.
    pub(super) amount: f32,
}

impl DampingFilter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            shelf: Biquad::high_shelf(4000.0, 0.0, sample_rate),
            sample_rate,
            amount: 0.0,
        }
    }

    /// `amount` in [0,1] maps to a 0..−9 dB shelf above 4 kHz, matching
    /// the rough T60 falloff for violin strings (spec §1.5 table).
    pub fn set_amount(&mut self, amount: f32) {
        self.amount = amount.clamp(0.0, 1.0);
        let gain_db = -9.0 * self.amount;
        self.shelf = Biquad::high_shelf(4000.0, gain_db, self.sample_rate);
    }

    pub fn reset(&mut self) {
        self.shelf.reset();
    }

    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        if self.amount < 1e-4 {
            return x;
        }
        self.shelf.tick(x)
    }
}
