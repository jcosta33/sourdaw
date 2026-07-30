//! Bow noise + release noise burst.
//!
//! Spec §7.1 (continuous bow-hair scrape) and §8.2 (filtered noise burst on
//! release). The continuous component scales with the current dynamic level
//! (CC1) and is bandpassed around 2–5 kHz to mimic the rosin/hair contact;
//! the burst uses the spec's `t · exp(−t/τ)` shape — rises linearly from
//! zero, peaks at `t = τ`, then decays exponentially. We compute it
//! incrementally so the audio thread does no `exp` calls per sample:
//! `ramp` carries `t/τ` and `decay` carries `exp(−t/τ)` updated by
//! repeated multiplication.

use super::super::humanize::Rng;
use super::biquad::Biquad;

/// Normalisation constant — `t·exp(−t/τ)` peaks at `1/e` when `t = τ`,
/// so multiplying by `e` gives a peak of 1.
const PEAK_NORM_E: f32 = std::f32::consts::E;

pub struct BowNoise {
    rng: Rng,
    bandpass: Biquad,
    /// Linear ramp `t/τ` since the most recent trigger. Inactive when `decay == 0`.
    burst_ramp: f32,
    /// Per-sample increment of `burst_ramp` (= `1 / (τ · fs)`).
    burst_ramp_inc: f32,
    /// Current value of `exp(−t/τ)` since the most recent trigger.
    burst_decay: f32,
    /// Per-sample decay multiplier (= `exp(−1 / (τ · fs))`).
    burst_decay_step: f32,
    /// Continuous noise level (CC1-driven, 0..1).
    cc1: f32,
    /// Master amount in [0,1].
    /// Set by the orchestrator from the per-instrument preset; not user-tunable.
    pub(super) amount: f32,
    sample_rate: f32,
}

impl BowNoise {
    pub fn new(sample_rate: f32) -> Self {
        let mut me = Self {
            rng: Rng::new(0xB0A1A1A1),
            bandpass: Biquad::bandpass(3500.0, 2.0, sample_rate),
            burst_ramp: 0.0,
            burst_ramp_inc: 0.0,
            burst_decay: 0.0,
            burst_decay_step: 0.0,
            cc1: 0.5,
            amount: 0.0,
            sample_rate,
        };
        me.recompute_burst_constants();
        me
    }

    fn recompute_burst_constants(&mut self) {
        // ~5 ms burst time constant per spec §8.2.
        const TAU_SECONDS: f32 = 0.005;
        let tau_samples = (TAU_SECONDS * self.sample_rate).max(1.0);
        self.burst_ramp_inc = 1.0 / tau_samples;
        self.burst_decay_step = (-1.0 / tau_samples).exp();
    }

    pub fn reset(&mut self) {
        self.bandpass.reset();
        self.burst_ramp = 0.0;
        self.burst_decay = 0.0;
    }

    pub fn set_cc1(&mut self, cc1_normalized: f32) {
        self.cc1 = cc1_normalized.clamp(0.0, 1.0);
    }

    /// Trigger a release/onset noise burst. Resets the rising edge so the
    /// envelope starts at zero, peaks one `τ` later, then decays.
    pub fn trigger_burst(&mut self) {
        self.burst_ramp = 0.0;
        self.burst_decay = 1.0;
    }

    pub fn has_active_burst(&self) -> bool {
        self.burst_decay > 1e-5
    }

    /// Reconfigure for a new sample rate (e.g. when engine reinitializes).
    #[allow(dead_code)]
    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.recompute_burst_constants();
        self.bandpass = Biquad::bandpass(3500.0, 2.0, sample_rate);
    }

    /// Generate one sample of bow noise to add to the bridge signal.
    ///
    /// `voices_active` gates the continuous bow-scrape component: a real
    /// instrument makes no bow-hair sound when no one is playing it. The
    /// release burst still fires on note-off (it is triggered from the
    /// still-active voice's note-off path), so its envelope is advanced
    /// unconditionally.
    #[inline]
    pub fn tick(&mut self, voices_active: bool) -> f32 {
        // Advance the burst envelope unconditionally so it stays in sync
        // with wall-clock time even when `amount` is zero (e.g. while a
        // patch is mid-load and the orchestrator hasn't set the family yet).
        let burst_env = if self.burst_decay > 1e-5 {
            let env = PEAK_NORM_E * self.burst_ramp * self.burst_decay;
            self.burst_ramp += self.burst_ramp_inc;
            self.burst_decay *= self.burst_decay_step;
            env
        } else {
            0.0
        };

        if self.amount < 1e-4 {
            return 0.0;
        }

        // If no voices are sounding AND no burst is in flight, emit silence
        // and skip the bandpass tick entirely — nothing downstream cares.
        if !voices_active && burst_env == 0.0 {
            return 0.0;
        }

        let white = self.rng.next_bipolar();
        let bandpassed = self.bandpass.tick(white);

        // Continuous bow scrape — quiet, scaled by CC1^2 so it only blooms
        // at high dynamics. Gated on voice activity so a silent instrument
        // stays silent.
        let continuous = if voices_active {
            bandpassed * 0.04 * self.cc1 * self.cc1
        } else {
            0.0
        };

        // Release/onset burst — t·exp(−t/τ), peak normalized to 1.
        let burst = bandpassed * 0.25 * burst_env;

        (continuous + burst) * self.amount
    }
}
