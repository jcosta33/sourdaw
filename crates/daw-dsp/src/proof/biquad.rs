//! Shared biquad filter — used across EQ, crossovers, and sidechain filters.
//! RBJ Audio EQ Cookbook coefficients. f64 for coefficient computation, f32 for processing.

use crate::primitives::flush_denormal;
use core::f64::consts::PI;

#[derive(Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
}

impl BiquadCoeffs {
    pub fn unity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
        }
    }

    pub fn peak(freq: f64, gain_db: f64, q: f64, sr: f64) -> Self {
        let a = 10.0_f64.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        Self::normalize(
            1.0 + alpha * a,
            -2.0 * w0.cos(),
            1.0 - alpha * a,
            a0,
            -2.0 * w0.cos(),
            1.0 - alpha / a,
        )
    }

    pub fn low_shelf(freq: f64, gain_db: f64, q: f64, sr: f64) -> Self {
        let a = 10.0_f64.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        Self::normalize(
            a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0),
            a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha),
            (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0),
            (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha,
        )
    }

    pub fn high_shelf(freq: f64, gain_db: f64, q: f64, sr: f64) -> Self {
        let a = 10.0_f64.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        Self::normalize(
            a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0),
            a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha),
            (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha,
            2.0 * ((a - 1.0) - (a + 1.0) * cos_w0),
            (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha,
        )
    }

    pub fn lowpass(freq: f64, q: f64, sr: f64) -> Self {
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        Self::normalize(
            (1.0 - cos_w0) / 2.0,
            1.0 - cos_w0,
            (1.0 - cos_w0) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        )
    }

    pub fn highpass(freq: f64, q: f64, sr: f64) -> Self {
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        Self::normalize(
            (1.0 + cos_w0) / 2.0,
            -(1.0 + cos_w0),
            (1.0 + cos_w0) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w0,
            1.0 - alpha,
        )
    }

    pub fn bandpass(freq: f64, q: f64, sr: f64) -> Self {
        let w0 = 2.0 * PI * freq / sr;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        Self::normalize(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos_w0, 1.0 - alpha)
    }

    fn normalize(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        let inv = 1.0 / a0;
        Self {
            b0: (b0 * inv) as f32,
            b1: (b1 * inv) as f32,
            b2: (b2 * inv) as f32,
            a1: (a1 * inv) as f32,
            a2: (a2 * inv) as f32,
        }
    }
}

/// Per-coefficient one-pole smoothing for a biquad section (DSP-4).
///
/// **Why interpolating the coefficients directly is safe here.** A biquad
/// denominator `1 + a1·z⁻¹ + a2·z⁻²` is stable exactly inside the triangle
/// `|a2| < 1`, `|a1| < 1 + a2` — vertices `(-2, 1)`, `(2, 1)`, `(0, -1)` in the
/// `(a1, a2)` plane. That region is **convex**, and a one-pole smoother only
/// ever emits convex combinations of the previous and target `(a1, a2)`. So
/// interpolating between any two stable coefficient sets stays stable by
/// construction, not by luck — which is what makes the cheap route legitimate
/// instead of the usual "don't interpolate biquad coefficients" warning. The
/// `b` coefficients do not affect stability at all.
///
/// This deliberately does **not** migrate Proof off Direct-Form-I: the
/// topology question is DSP-5, tracked as its own finding.
///
/// The ramp is a **counted linear** interpolation rather than a one-pole
/// approach. A one-pole never lands exactly: its per-sample increment falls
/// below the f32 ULP of the coefficient while the remaining delta is still
/// ~1e-4, so it stalls short of the target and a magnitude-threshold latch
/// becomes sample-rate and coefficient dependent. A counted ramp arrives on a
/// known sample, assigns the target exactly, and — being a literal convex
/// combination — is precisely the interpolation the stability argument above
/// is stated for.
///
/// Allocation-free: once the ramp finishes, per-sample cost is one integer
/// compare.
#[derive(Clone)]
pub struct SmoothedBiquadCoeffs {
    current: BiquadCoeffs,
    start: BiquadCoeffs,
    target: BiquadCoeffs,
    remaining: u32,
    ramp_samples: u32,
}

/// Coefficient ramp time. Long enough to bury a zipper edge below audibility,
/// short enough that an automated sweep still tracks the written curve.
const COEFF_SMOOTHING_SECONDS: f64 = 0.005;

#[inline]
fn lerp_coeffs(from: &BiquadCoeffs, to: &BiquadCoeffs, t: f32) -> BiquadCoeffs {
    BiquadCoeffs {
        b0: from.b0 + (to.b0 - from.b0) * t,
        b1: from.b1 + (to.b1 - from.b1) * t,
        b2: from.b2 + (to.b2 - from.b2) * t,
        a1: from.a1 + (to.a1 - from.a1) * t,
        a2: from.a2 + (to.a2 - from.a2) * t,
    }
}

impl SmoothedBiquadCoeffs {
    pub fn new(initial: BiquadCoeffs, sample_rate: f64) -> Self {
        let ramp_samples = (COEFF_SMOOTHING_SECONDS * sample_rate.max(1.0)).round() as u32;
        Self {
            current: initial,
            start: initial,
            target: initial,
            remaining: 0,
            ramp_samples: ramp_samples.max(1),
        }
    }

    /// Jump straight to `coeffs` with no ramp — construction, `reset`, and
    /// sample-rate changes, where there is no continuous signal to protect.
    pub fn snap(&mut self, coeffs: BiquadCoeffs) {
        self.current = coeffs;
        self.start = coeffs;
        self.target = coeffs;
        self.remaining = 0;
    }

    /// Aim at `coeffs`; the ramp runs on subsequent [`Self::next`] calls.
    ///
    /// Re-targeting mid-ramp restarts from wherever the ramp currently sits, so
    /// a stream of automation updates stays continuous.
    pub fn set_target(&mut self, coeffs: BiquadCoeffs) {
        self.start = self.current;
        self.target = coeffs;
        self.remaining = self.ramp_samples;
    }

    /// Advance one sample and return the coefficients to filter with.
    ///
    /// Returned by value so callers can hold the coefficients and the filter
    /// state mutably at the same time; `BiquadCoeffs` is five `f32`s.
    #[inline]
    pub fn next(&mut self) -> BiquadCoeffs {
        if self.remaining == 0 {
            return self.current;
        }

        self.remaining -= 1;
        if self.remaining == 0 {
            self.current = self.target;
            return self.current;
        }

        let progress = 1.0 - self.remaining as f32 / self.ramp_samples as f32;
        self.current = lerp_coeffs(&self.start, &self.target, progress);
        self.current
    }

    pub fn is_settled(&self) -> bool {
        self.remaining == 0
    }
}

#[derive(Clone)]
pub struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadState {
    pub fn new() -> Self {
        Self {
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    #[inline]
    pub fn process(&mut self, input: f32, c: &BiquadCoeffs) -> f32 {
        let raw = c.b0 * input + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        // DSP-2: the recursive y-state decays geometrically into the subnormal
        // range once input goes silent. Flushing `raw` once keeps both the
        // stored state and the returned sample out of microcode-trap territory.
        let out = flush_denormal(raw);
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = out;
        out
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

#[cfg(test)]
mod coefficient_smoothing_tests {
    use super::{BiquadCoeffs, BiquadState, SmoothedBiquadCoeffs};

    const SAMPLE_RATE: f64 = 48_000.0;
    /// A low probe tone under a low shelf that acts squarely on it: the band's
    /// gain at 100 Hz really does move 0 dB → +18 dB, which is what automation
    /// does. A 100 Hz sine slews slowly (~0.0065 per sample at 0.5 amplitude),
    /// so an abrupt band-gain change stands out against the carrier instead of
    /// being buried in it.
    const PROBE_HZ: f32 = 100.0;
    const SWITCH_AT: usize = 4_000;
    const RENDER_LEN: usize = 8_000;

    fn flat() -> BiquadCoeffs {
        BiquadCoeffs::low_shelf(400.0, 0.0, 0.707, SAMPLE_RATE)
    }

    fn boosted() -> BiquadCoeffs {
        BiquadCoeffs::low_shelf(400.0, 18.0, 0.707, SAMPLE_RATE)
    }

    fn probe(index: usize) -> f32 {
        (2.0 * std::f32::consts::PI * PROBE_HZ * index as f32 / SAMPLE_RATE as f32).sin() * 0.5
    }

    /// Largest single-sample jump inside a window — a zipper shows up here as a
    /// spike well above the tone's own natural slew.
    fn largest_step(samples: &[f32], from: usize, to: usize) -> f32 {
        (from..to).fold(0.0_f32, |worst, i| worst.max((samples[i] - samples[i - 1]).abs()))
    }

    fn render_instant_swap() -> Vec<f32> {
        let mut state = BiquadState::new();
        let mut coeffs = flat();
        (0..RENDER_LEN)
            .map(|n| {
                if n == SWITCH_AT {
                    coeffs = boosted();
                }
                state.process(probe(n), &coeffs)
            })
            .collect()
    }

    fn render_smoothed() -> Vec<f32> {
        let mut state = BiquadState::new();
        let mut smoothed = SmoothedBiquadCoeffs::new(flat(), SAMPLE_RATE);
        (0..RENDER_LEN)
            .map(|n| {
                if n == SWITCH_AT {
                    smoothed.set_target(boosted());
                }
                let coeffs = smoothed.next();
                state.process(probe(n), &coeffs)
            })
            .collect()
    }

    /// Red-first: an instant coefficient swap puts a real discontinuity in the
    /// output — measured as sample deltas, not inferred.
    #[test]
    fn instant_coefficient_swap_produces_an_output_discontinuity() {
        let rendered = render_instant_swap();
        let steady_step = largest_step(&rendered, SWITCH_AT - 500, SWITCH_AT - 1);
        let switch_step = largest_step(&rendered, SWITCH_AT, SWITCH_AT + 64);

        assert!(
            switch_step > steady_step * 3.0,
            "an instant swap is supposed to click — if it stopped, the smoothing \
             test below proves nothing (steady={steady_step:.6}, switch={switch_step:.6})"
        );
    }

    /// Green: smoothing the same swap keeps the output slew inside the tone's
    /// own steady-state slew.
    #[test]
    fn smoothed_coefficient_change_removes_the_discontinuity() {
        let rendered = render_smoothed();
        let steady_step = largest_step(&rendered, SWITCH_AT - 500, SWITCH_AT - 1);
        let switch_step = largest_step(&rendered, SWITCH_AT, SWITCH_AT + 64);

        assert!(
            switch_step < steady_step * 1.5,
            "smoothed coefficients must not step (steady={steady_step:.6}, \
             switch={switch_step:.6})"
        );
    }

    /// The smoothed path must be strictly better than the instant one on the
    /// same material — the actual DSP-4 claim.
    #[test]
    fn smoothing_beats_instant_swap_on_the_same_transition() {
        let instant = render_instant_swap();
        let smoothed = render_smoothed();
        let instant_step = largest_step(&instant, SWITCH_AT, SWITCH_AT + 64);
        let smoothed_step = largest_step(&smoothed, SWITCH_AT, SWITCH_AT + 64);

        assert!(
            smoothed_step * 2.0 < instant_step,
            "smoothing must at least halve the switch-point step \
             (instant={instant_step:.6}, smoothed={smoothed_step:.6})"
        );
    }

    /// The ramp has to actually arrive, or an automated sweep would lag forever.
    #[test]
    fn smoother_reaches_its_target_and_latches() {
        let mut smoothed = SmoothedBiquadCoeffs::new(flat(), SAMPLE_RATE);
        smoothed.set_target(boosted());
        assert!(!smoothed.is_settled(), "a fresh target must not read as settled");

        for _ in 0..RENDER_LEN {
            smoothed.next();
        }

        assert!(smoothed.is_settled(), "smoother must latch once it arrives");
        let arrived = smoothed.next();
        let target = boosted();
        assert_eq!(arrived.b0.to_bits(), target.b0.to_bits());
        assert_eq!(arrived.a1.to_bits(), target.a1.to_bits());
        assert_eq!(arrived.a2.to_bits(), target.a2.to_bits());
    }

    /// `snap` is the reset/construction path: no ramp, no intermediate states.
    #[test]
    fn snap_applies_the_target_immediately() {
        let mut smoothed = SmoothedBiquadCoeffs::new(flat(), SAMPLE_RATE);
        smoothed.snap(boosted());
        let applied = smoothed.next();
        assert_eq!(applied.b0.to_bits(), boosted().b0.to_bits());
        assert!(smoothed.is_settled());
    }

    /// Pole radius of `1 + a1·z⁻¹ + a2·z⁻²`; < 1 means stable.
    fn pole_radius(coeffs: &BiquadCoeffs) -> f32 {
        let discriminant = coeffs.a1 * coeffs.a1 - 4.0 * coeffs.a2;
        if discriminant >= 0.0 {
            let root = discriminant.sqrt();
            let first = (-coeffs.a1 + root) * 0.5;
            let second = (-coeffs.a1 - root) * 0.5;
            first.abs().max(second.abs())
        } else {
            // Complex pair: |p| = sqrt(a2).
            coeffs.a2.abs().sqrt()
        }
    }

    /// The stability claim in the doc comment, exercised rather than asserted:
    /// ramping between widely different *stable* designs never leaves the
    /// stable region on any intermediate sample.
    #[test]
    fn every_intermediate_coefficient_set_stays_stable() {
        let designs = [
            BiquadCoeffs::peak(40.0, 18.0, 10.0, SAMPLE_RATE),
            BiquadCoeffs::peak(18_000.0, -18.0, 0.1, SAMPLE_RATE),
            BiquadCoeffs::highpass(30.0, 8.0, SAMPLE_RATE),
            BiquadCoeffs::lowpass(19_000.0, 0.2, SAMPLE_RATE),
            BiquadCoeffs::high_shelf(12_000.0, 18.0, 0.3, SAMPLE_RATE),
            BiquadCoeffs::low_shelf(25.0, -18.0, 6.0, SAMPLE_RATE),
        ];

        let mut checked = 0;
        for from in &designs {
            for to in &designs {
                let mut smoothed = SmoothedBiquadCoeffs::new(*from, SAMPLE_RATE);
                smoothed.set_target(*to);
                for step in 0..2_000 {
                    let intermediate = smoothed.next();
                    let radius = pole_radius(&intermediate);
                    assert!(
                        radius < 1.0,
                        "intermediate coefficients went unstable at step {step} \
                         (radius={radius}, a1={}, a2={})",
                        intermediate.a1,
                        intermediate.a2
                    );
                    checked += 1;
                }
            }
        }
        assert_eq!(checked, designs.len() * designs.len() * 2_000);
    }
}

#[cfg(test)]
mod denormal_tests {
    use super::{BiquadCoeffs, BiquadState};

    /// Unguarded Direct-Form-I recursion — what `BiquadState::process` was
    /// before DSP-2. Kept in the test so the failure mode is demonstrated, not
    /// asserted from memory.
    #[derive(Default)]
    struct UnguardedDf1 {
        x1: f32,
        x2: f32,
        y1: f32,
        y2: f32,
    }

    impl UnguardedDf1 {
        fn process(&mut self, input: f32, c: &BiquadCoeffs) -> f32 {
            let out =
                c.b0 * input + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
            self.x2 = self.x1;
            self.x1 = input;
            self.y2 = self.y1;
            self.y1 = out;
            out
        }
    }

    fn ringing_coeffs() -> BiquadCoeffs {
        BiquadCoeffs::lowpass(2_000.0, 4.0, 48_000.0)
    }

    const SILENT_TAIL: usize = 60_000;

    #[test]
    fn unguarded_feedback_state_decays_into_the_subnormal_range() {
        let coeffs = ringing_coeffs();
        let mut unguarded = UnguardedDf1::default();
        unguarded.process(1.0, &coeffs);

        let mut first_subnormal = None;
        for _ in 0..SILENT_TAIL {
            let out = unguarded.process(0.0, &coeffs);
            if out != 0.0 && !out.is_normal() && first_subnormal.is_none() {
                first_subnormal = Some(out);
            }
        }

        let value = first_subnormal.expect(
            "an unguarded IIR fed to silence must land in the subnormal range — \
             if this stops happening the guard below is testing nothing",
        );
        assert!(
            value.abs() < f32::MIN_POSITIVE,
            "raw unguarded state {value:e} must be below the normal boundary {:e}",
            f32::MIN_POSITIVE
        );
        assert!(value != 0.0, "raw unguarded state must be a nonzero subnormal");
        assert!(
            !unguarded.y1.is_normal(),
            "the stored state itself ends subnormal, not just one output sample"
        );
    }

    #[test]
    fn guarded_feedback_state_flushes_to_exact_zero() {
        let coeffs = ringing_coeffs();
        let mut guarded = BiquadState::new();
        guarded.process(1.0, &coeffs);

        for _ in 0..SILENT_TAIL {
            let out = guarded.process(0.0, &coeffs);
            assert!(
                out == 0.0 || out.is_normal(),
                "guarded output {out:e} must never be subnormal"
            );
        }

        assert_eq!(guarded.y1, 0.0, "recursive state must reach exact zero");
        assert_eq!(guarded.y2, 0.0);
    }

    #[test]
    fn guard_is_bit_exact_while_the_signal_stays_in_normal_range() {
        // Transparency companion to the #732 sanitize guard: for every sample
        // where the unguarded reference is still normal, guarded output must
        // match it bit for bit.
        let coeffs = ringing_coeffs();
        let mut guarded = BiquadState::new();
        let mut unguarded = UnguardedDf1::default();

        let mut compared = 0;
        for index in 0..SILENT_TAIL {
            let input = if index == 0 { 1.0 } else { 0.0 };
            let reference = unguarded.process(input, &coeffs);
            let actual = guarded.process(input, &coeffs);
            if reference == 0.0 || reference.is_normal() {
                assert_eq!(
                    actual.to_bits(),
                    reference.to_bits(),
                    "sample {index} diverged while still in normal range"
                );
                compared += 1;
            } else {
                break;
            }
        }

        assert!(
            compared > 100,
            "expected a long normal-range run to compare, got {compared} samples"
        );
    }
}
