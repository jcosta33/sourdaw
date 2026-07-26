//! 2x oversampling for Grinder's nonlinear stages (DSP-3).
//!
//! Every Grinder nonlinearity that claimed to be oversampled previously ran
//! linear interpolation on the way up and a **2-tap box average** on the way
//! down. A 2-tap box is a first-order FIR with a single null at the 2x-rate
//! Nyquist; across the fs/2..fs band that decimation actually has to reject it
//! is worth a few dB, so the "oversampling" removed almost none of the
//! harmonics the nonlinearity folded back.
//!
//! This module keeps the ODE substepping the stages already did and swaps the
//! rate conversion for the crate's existing, tested half-band FIR
//! (`primitives::oversample::Oversampler2x` — 15-tap Kaiser half-band, unity-gain
//! normalized, with independent up/down delay lines). No new filter math is
//! introduced here: the kernel, its gain normalization and its 6.5-sample
//! round-trip group delay are already covered by that module's own tests.
//!
//! ADAA (`toaster::adaa`) is the other in-crate precedent and is deliberately
//! **not** used here: it is defined for *memoryless* nonlinearities, and every
//! Grinder stage that needed fixing carries state across the nonlinearity
//! (triode coupling-cap charge and Miller low-pass, power-amp supply sag and
//! the negative-feedback loop). Antiderivative antialiasing has no meaning for
//! a stateful ODE substep, so the half-band route is the only one of the two
//! precedents that applies.

use crate::primitives::oversample::Oversampler2x;

/// Runs a per-sample stage at twice the host rate behind a real half-band
/// anti-imaging/anti-aliasing pair.
///
/// One instance drives both directions; `Oversampler2x` keeps separate up and
/// down delay lines precisely so a single instance can be used this way.
pub struct StageOversampler2x {
    halfband: Oversampler2x,
}

impl StageOversampler2x {
    pub fn new() -> Self {
        Self {
            halfband: Oversampler2x::new(),
        }
    }

    /// Upsample one host-rate sample, run `stage` on both 2x-rate samples, and
    /// decimate the pair back down.
    ///
    /// `stage` is called exactly twice per host sample — the same substep count
    /// the box-average code used, so stage-internal `dt` stays `0.5 / sr`.
    #[inline]
    pub fn process(&mut self, input: f32, mut stage: impl FnMut(f32) -> f32) -> f32 {
        let (first, second) = self.upsample(input);
        let processed_first = stage(first);
        let processed_second = stage(second);
        self.downsample(processed_first, processed_second)
    }

    /// Split half of [`Self::process`], for stages whose substep borrows `self`
    /// and therefore cannot be expressed as a closure.
    #[inline]
    pub fn upsample(&mut self, input: f32) -> (f32, f32) {
        self.halfband.upsample(input)
    }

    /// Decimating half of [`Self::process`]. Must be called once per
    /// [`Self::upsample`], with the two processed 2x-rate samples in order.
    #[inline]
    pub fn downsample(&mut self, first: f32, second: f32) -> f32 {
        self.halfband.downsample(first, second)
    }

    pub fn reset(&mut self) {
        self.halfband.reset();
    }
}

impl Default for StageOversampler2x {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::StageOversampler2x;
    use crate::primitives::alias_probe::*;

    /// The box average this module replaces, kept verbatim in the test so the
    /// improvement is measured against the real previous behaviour rather than
    /// asserted from memory.
    fn box_average_2x(previous_input: &mut f32, input: f32, mut stage: impl FnMut(f32) -> f32) -> f32 {
        let midpoint = 0.5 * (*previous_input + input);
        let first = stage(midpoint);
        let second = stage(input);
        *previous_input = input;
        (first + second) * 0.5
    }

    /// Memoryless stand-in for the tube curve: the fold-back it generates is
    /// the same class the triode and power amp produce.
    fn hard_drive(x: f32) -> f32 {
        (x * 6.0).tanh()
    }

    const SAMPLE_RATE: f32 = 48_000.0;
    const RENDER_LEN: usize = 8_192;

    fn render_box_average() -> Vec<f32> {
        let mut previous = 0.0_f32;
        (0..RENDER_LEN)
            .map(|n| {
                box_average_2x(&mut previous, drive_tone(n, SAMPLE_RATE, 0.9), hard_drive)
            })
            .collect()
    }

    fn render_halfband() -> Vec<f32> {
        let mut os = StageOversampler2x::new();
        (0..RENDER_LEN)
            .map(|n| os.process(drive_tone(n, SAMPLE_RATE, 0.9), hard_drive))
            .collect()
    }

    /// Red-first: the 2-tap box average leaves a large fold-back residue.
    /// This is the defect DSP-3 names, pinned as a measurement.
    #[test]
    fn box_average_downsampling_leaves_substantial_aliasing() {
        let ratio = alias_to_harmonic_ratio(&render_box_average(), SAMPLE_RATE);
        assert!(
            ratio > 0.05,
            "the 2-tap box average is supposed to alias badly — if this stops \
             being true the comparison below proves nothing (ratio={ratio:.4})"
        );
    }

    /// The half-band replacement must cut fold-back by a wide margin on the
    /// same signal, same nonlinearity, same substep count.
    ///
    /// Measured on this fixture: box average 0.0544, half-band 0.0060 — a 9.1x
    /// reduction. The bound is set at 4x so platform float differences cannot
    /// flap it while still failing outright if the half-band path regresses to
    /// anything box-average-shaped.
    #[test]
    fn halfband_oversampling_rejects_far_more_aliasing_than_the_box_average() {
        let box_ratio = alias_to_harmonic_ratio(&render_box_average(), SAMPLE_RATE);
        let halfband_ratio = alias_to_harmonic_ratio(&render_halfband(), SAMPLE_RATE);

        assert!(
            halfband_ratio * 4.0 < box_ratio,
            "half-band oversampling must reject at least 4x more fold-back than \
             the box average (box={box_ratio:.4}, halfband={halfband_ratio:.4})"
        );
    }

    /// Anti-aliasing must not come at the cost of the wanted harmonics: the
    /// in-band harmonic energy has to survive.
    fn harmonic_energy(samples: &[f32]) -> f32 {
        HARMONIC_BINS_HZ
            .iter()
            .map(|&f| bin_magnitude(samples, f, SAMPLE_RATE))
            .sum()
    }

    #[test]
    fn halfband_oversampling_preserves_the_wanted_harmonics() {
        let box_harmonics = harmonic_energy(&render_box_average());
        let halfband_harmonics = harmonic_energy(&render_halfband());
        let retention = halfband_harmonics / box_harmonics;

        assert!(
            (0.75..=1.25).contains(&retention),
            "in-band harmonic energy must survive the new rate conversion \
             (box={box_harmonics:.5}, halfband={halfband_harmonics:.5}, \
              retention={retention:.3}x)"
        );
    }

    /// A silent input must produce exact silence — no DC offset leaking out of
    /// the half-band delay lines into a downstream feedback stage.
    #[test]
    fn silence_in_produces_silence_out() {
        let mut os = StageOversampler2x::new();
        for _ in 0..512 {
            assert_eq!(os.process(0.0, hard_drive), 0.0);
        }
    }

    /// `reset` must clear the filter history, so two instances fed identically
    /// after a reset stay sample-identical.
    #[test]
    fn reset_clears_filter_history() {
        let mut used = StageOversampler2x::new();
        for n in 0..256 {
            used.process(drive_tone(n, SAMPLE_RATE, 0.9), hard_drive);
        }
        used.reset();

        let mut fresh = StageOversampler2x::new();
        for n in 0..256 {
            let from_used = used.process(drive_tone(n, SAMPLE_RATE, 0.4), hard_drive);
            let from_fresh = fresh.process(drive_tone(n, SAMPLE_RATE, 0.4), hard_drive);
            assert_eq!(from_used, from_fresh, "reset must clear history at sample {n}");
        }
    }
}
