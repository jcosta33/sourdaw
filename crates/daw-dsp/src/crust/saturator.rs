//! Crust's saturation stage — the "BUILD" level of the panel.
//!
//! Sits **before** the limiter so it drives level into it. Putting a
//! nonlinearity after the gain stage would let it push samples back over the
//! ceiling the limiter had just enforced.
//!
//! Every curve is evaluated at the oversampled rate set by the panel's
//! `oversampling` control, because all five of them generate harmonics well
//! past Nyquist at high drive.

use super::oversample::CrustOversampler;

/// Saturation curves the panel's algorithm menu selects between.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SatAlgorithm {
    /// Symmetric soft clip. Odd harmonics only, no DC shift.
    Soft,
    /// Symmetric hard clip with a short parabolic corner, so the edge is
    /// bandlimited enough for oversampling to clean up.
    Hard,
    /// Asymmetric compressive curve with a gentle high-frequency loss, the
    /// audible half of tape.
    Tape,
    /// Asymmetric curve: the positive half compresses sooner than the negative,
    /// which is what puts second-harmonic content in a triode stage.
    Tube,
    /// Wavefolder — reflects at the rails instead of clipping at them.
    Fold,
}

impl SatAlgorithm {
    pub fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Hard,
            2 => Self::Tape,
            3 => Self::Tube,
            4 => Self::Fold,
            _ => Self::Soft,
        }
    }
}

/// Evaluate a curve at unit scale. Every curve is normalised so that a
/// small-signal input passes at approximately unity gain, which keeps the drive
/// control the only thing that changes level.
#[inline]
fn shape(algorithm: SatAlgorithm, x: f32, tape_state: &mut f32) -> f32 {
    match algorithm {
        SatAlgorithm::Soft => x.tanh(),
        SatAlgorithm::Hard => {
            // Zölzer's three-region cubic clip, pre-scaled by 0.5 so the linear
            // region's 2x gain lands at unity. Linear to |x| = 2/3, a parabolic
            // corner to |x| = 4/3, flat beyond. Continuous in value and first
            // derivative at both joins, which is what keeps the edge bandlimited
            // enough for the oversampling round trip to clean up.
            let scaled = x * 0.5;
            let magnitude = scaled.abs();
            if magnitude < 1.0 / 3.0 {
                2.0 * scaled
            } else if magnitude < 2.0 / 3.0 {
                let corner = 2.0 - 3.0 * magnitude;
                scaled.signum() * (3.0 - corner * corner) / 3.0
            } else {
                scaled.signum()
            }
        }
        SatAlgorithm::Tape => {
            // One-pole loss before the curve: tape's compression and its
            // high-frequency roll-off are not separable in the medium, and the
            // curve alone sounds like a diode.
            *tape_state = 0.82 * *tape_state + 0.18 * x;
            let shaped = *tape_state + (x - *tape_state) * 0.55;
            // Rail at exactly ±1: a `1 + 0.7|s|` denominator would asymptote to
            // ±1.43 instead, which is a curve that never stops growing where the
            // panel's meters say it has.
            shaped / (1.0 + shaped.abs())
        }
        SatAlgorithm::Tube => {
            // Asymmetric: the positive half saturates at 0.75 of the negative
            // half's headroom, so the transfer curve has an even-order term.
            if x >= 0.0 {
                (x * 1.35).tanh() / 1.1
            } else {
                (x * 0.75).tanh() / 1.1
            }
        }
        SatAlgorithm::Fold => {
            // Triangle fold: map onto a period-4 triangle so ±1 are the rails
            // and anything beyond reflects back.
            let folded = (x + 1.0).rem_euclid(4.0) - 1.0;
            if folded <= 1.0 {
                folded
            } else {
                2.0 - folded
            }
        }
    }
}

/// Stereo saturation stage with its own oversampling.
pub struct Saturator {
    left: CrustOversampler,
    right: CrustOversampler,
    tape_left: f32,
    tape_right: f32,
    algorithm: SatAlgorithm,
    drive: f32,
    mix: f32,
    enabled: bool,
    scratch: [f32; super::oversample::MAX_FACTOR],
}

impl Saturator {
    pub fn new() -> Self {
        Self {
            left: CrustOversampler::new(4),
            right: CrustOversampler::new(4),
            tape_left: 0.0,
            tape_right: 0.0,
            algorithm: SatAlgorithm::Soft,
            drive: 1.0,
            mix: 0.0,
            enabled: false,
            scratch: [0.0; super::oversample::MAX_FACTOR],
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn set_algorithm(&mut self, algorithm: SatAlgorithm) {
        self.algorithm = algorithm;
    }

    /// Drive in dB (0..18 on the panel).
    pub fn set_drive_db(&mut self, drive_db: f32) {
        self.drive = 10.0_f32.powf(drive_db.clamp(0.0, 24.0) / 20.0);
    }

    /// Wet/dry mix, 0..1.
    pub fn set_mix(&mut self, mix: f32) {
        self.mix = mix.clamp(0.0, 1.0);
    }

    pub fn set_oversampling(&mut self, factor: usize) {
        self.left.set_factor(factor);
        self.right.set_factor(factor);
    }

    pub fn reset(&mut self) {
        self.left.reset();
        self.right.reset();
        self.tape_left = 0.0;
        self.tape_right = 0.0;
    }

    /// True when the stage would leave the signal untouched, so the engine can
    /// skip the oversampling round trip and its group delay entirely.
    pub fn is_idle(&self) -> bool {
        !self.enabled || self.mix <= 0.0
    }

    #[inline]
    fn process_channel(
        chain: &mut CrustOversampler,
        scratch: &mut [f32; super::oversample::MAX_FACTOR],
        tape_state: &mut f32,
        algorithm: SatAlgorithm,
        drive: f32,
        input: f32,
    ) -> f32 {
        let factor = chain.factor();
        {
            let upsampled = chain.upsample(input);
            for (index, sample) in upsampled.iter().enumerate() {
                scratch[index] = shape(algorithm, *sample * drive, tape_state);
            }
        }
        chain.downsample(&scratch[..factor])
    }

    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32) {
        if self.is_idle() {
            return (left, right);
        }

        let wet_left = Self::process_channel(
            &mut self.left,
            &mut self.scratch,
            &mut self.tape_left,
            self.algorithm,
            self.drive,
            left,
        );
        let wet_right = Self::process_channel(
            &mut self.right,
            &mut self.scratch,
            &mut self.tape_right,
            self.algorithm,
            self.drive,
            right,
        );

        (
            left + (wet_left - left) * self.mix,
            right + (wet_right - right) * self.mix,
        )
    }
}

impl Default for Saturator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{shape, SatAlgorithm, Saturator};

    #[test]
    fn every_curve_is_bounded_far_past_its_rails() {
        for algorithm in [
            SatAlgorithm::Soft,
            SatAlgorithm::Hard,
            SatAlgorithm::Tape,
            SatAlgorithm::Tube,
            SatAlgorithm::Fold,
        ] {
            let mut tape = 0.0_f32;
            for step in -400..=400 {
                let x = step as f32 * 0.25;
                let y = shape(algorithm, x, &mut tape);
                assert!(y.abs() <= 1.05, "curve escaped its rails at x={x}: y={y}");
            }
        }
    }

    /// The tube curve's whole reason to exist is its even-order term: the
    /// positive and negative halves must not be mirror images.
    #[test]
    fn the_tube_curve_is_asymmetric_where_the_soft_curve_is_not() {
        let mut tape = 0.0_f32;
        let tube_positive = shape(SatAlgorithm::Tube, 0.8, &mut tape);
        let tube_negative = shape(SatAlgorithm::Tube, -0.8, &mut tape);
        let soft_positive = shape(SatAlgorithm::Soft, 0.8, &mut tape);
        let soft_negative = shape(SatAlgorithm::Soft, -0.8, &mut tape);

        assert!(
            (tube_positive + tube_negative).abs() > 0.1,
            "tube halves matched: {tube_positive} vs {tube_negative}"
        );
        assert!(
            (soft_positive + soft_negative).abs() < 1e-6,
            "soft clip must stay symmetric: {soft_positive} vs {soft_negative}"
        );
    }

    #[test]
    fn a_disabled_stage_passes_the_signal_through_unchanged() {
        let mut saturator = Saturator::new();
        saturator.set_drive_db(18.0);
        saturator.set_mix(1.0);

        assert_eq!(saturator.process_sample(0.9, -0.4), (0.9, -0.4));
    }

    #[test]
    fn mix_scales_how_far_the_output_moves_toward_the_curve() {
        let mut dry_heavy = Saturator::new();
        dry_heavy.set_enabled(true);
        dry_heavy.set_algorithm(SatAlgorithm::Soft);
        dry_heavy.set_drive_db(12.0);
        dry_heavy.set_oversampling(1);
        dry_heavy.set_mix(0.25);

        let mut wet = Saturator::new();
        wet.set_enabled(true);
        wet.set_algorithm(SatAlgorithm::Soft);
        wet.set_drive_db(12.0);
        wet.set_oversampling(1);
        wet.set_mix(1.0);

        let input = 0.6_f32;
        let (quarter, _) = dry_heavy.process_sample(input, input);
        let (full, _) = wet.process_sample(input, input);

        let quarter_move = quarter - input;
        let full_move = full - input;
        assert!(
            (quarter_move / full_move - 0.25).abs() < 1e-4,
            "25% mix moved {quarter_move} where 100% moved {full_move}"
        );
    }
}
