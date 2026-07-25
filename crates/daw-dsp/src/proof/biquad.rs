//! Shared biquad filter — used across EQ, crossovers, and sidechain filters.
//! RBJ Audio EQ Cookbook coefficients. f64 for coefficient computation, f32 for processing.

use crate::primitives::DENORMAL_THRESHOLD;
use core::f64::consts::PI;

/// RBJ coefficients, stored in f64.
///
/// DSP-5: f32 storage moved the pole enough to cost 0.26 dB of a written
/// +18 dB / 20 Hz / Q=10 band. Near that corner `a1 ≈ −2` and `a2 ≈ 1`, where
/// an f32 ULP is ~2.4e-7 against a pole sitting 4.6e-5 inside the unit circle,
/// so the quantization is a measurable fraction of the pole's distance from
/// the circle. See `low_frequency_precision_tests` for the full error budget.
#[derive(Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
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
            b0: b0 * inv,
            b1: b1 * inv,
            b2: b2 * inv,
            a1: a1 * inv,
            a2: a2 * inv,
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
fn lerp_coeffs(from: &BiquadCoeffs, to: &BiquadCoeffs, t: f64) -> BiquadCoeffs {
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

        let progress = 1.0 - f64::from(self.remaining) / f64::from(self.ramp_samples);
        self.current = lerp_coeffs(&self.start, &self.target, progress);
        self.current
    }

    pub fn is_settled(&self) -> bool {
        self.remaining == 0
    }
}

/// Direct-Form-I state, carried in f64.
///
/// DSP-5: the recursion `−a1·y1 − a2·y2` subtracts two large near-equal terms
/// once `a1 ≈ −2` and `a2 ≈ 1`, so an f32 accumulator loses the difference to
/// cancellation. Measured on a +18 dB / 20 Hz / Q=10 band that cost 2.121 dB
/// of realized gain at 96 kHz and left a −55 dB roundoff floor at 48 kHz.
///
/// The topology stays Direct-Form-I on purpose. Transposed Direct Form II was
/// measured as the alternative and rejected: it recovers 1.93 dB at the 96 kHz
/// corner but gives up 15.96 dB of noise floor at the 48 kHz cut corner, and
/// DF-I's state — actual past inputs and outputs — stays bounded by signal
/// level under the per-sample coefficient ramping #787 added. Widening fixes
/// both corners without trading either.
#[derive(Clone)]
pub struct BiquadState {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
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
        let input = f64::from(input);
        let raw = c.b0 * input + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
        // DSP-2: the recursive y-state decays geometrically into the subnormal
        // range once input goes silent. Flushing `raw` once keeps both the
        // stored state and the returned sample out of microcode-trap territory.
        //
        // The threshold stays `DENORMAL_THRESHOLD` (f32::MIN_POSITIVE) even
        // though the accumulator is now f64. A value in the f32-subnormal range
        // is a perfectly normal f64 and traps nothing internally — but this
        // function returns f32 and every downstream consumer is f32, so it is
        // still exactly the boundary that must not be crossed. Flushing at
        // f64::MIN_POSITIVE instead would let the state ring ~270 orders of
        // magnitude below audibility and would emit subnormal f32 the whole
        // way down, which is the trap DSP-2 closed.
        let out = if raw.abs() < f64::from(DENORMAL_THRESHOLD) {
            0.0
        } else {
            raw
        };
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = out;
        out as f32
    }

    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }

    /// The stored recursive state, for tests that assert the DSP-2 flush.
    #[cfg(test)]
    pub(crate) fn recursive_state(&self) -> (f64, f64) {
        (self.y1, self.y2)
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
    fn pole_radius(coeffs: &BiquadCoeffs) -> f64 {
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
    ///
    /// It carries f64 state because production does (DSP-5). This reference
    /// exists to isolate exactly one difference from production — the denormal
    /// flush — so it has to track every other change. Holding it at f32 would
    /// turn `guard_is_bit_exact_while_the_signal_stays_in_normal_range` into a
    /// precision comparison, which is not what that test guards.
    #[derive(Default)]
    struct UnguardedDf1 {
        x1: f64,
        x2: f64,
        y1: f64,
        y2: f64,
    }

    impl UnguardedDf1 {
        fn process(&mut self, input: f32, c: &BiquadCoeffs) -> f32 {
            let input = f64::from(input);
            let out =
                c.b0 * input + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
            self.x2 = self.x1;
            self.x1 = input;
            self.y2 = self.y1;
            self.y1 = out;
            out as f32
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
            unguarded.y1 != 0.0 && !(unguarded.y1 as f32).is_normal(),
            "the stored state itself narrows to a subnormal f32 ({:e}), not just one \
             output sample — this is why the flush threshold is f32::MIN_POSITIVE and \
             not f64::MIN_POSITIVE",
            unguarded.y1
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

        let (y1, y2) = guarded.recursive_state();
        assert_eq!(y1, 0.0, "recursive state must reach exact zero");
        assert_eq!(y2, 0.0);
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




#[cfg(test)]
mod low_frequency_precision_tests {
    //! DSP-5. The audit filed this as "Proof mastering biquads are
    //! Direct-Form-I (topology note)" and proposed migrating off DF-I. These
    //! tests measure the actual error budget instead of accepting that framing,
    //! because the measurement does not support it.
    //!
    //! Three error terms were separated at the parameter extremes reachable
    //! from `MasteringEq::set_param` (freq clamps to 20 Hz, Q to 10, gain to
    //! ±18 dB), by comparing the shipped filter against the same difference
    //! equation evaluated in f64, tone-by-tone with a single-bin DFT after
    //! settling 20 pole time constants:
    //!
    //! | case (peak, Q=10, +18 dB, 20 Hz)  | DF-I f32 | TDF-II f32 | coeff quantization |
    //! |-----------------------------------|----------|------------|--------------------|
    //! | realized gain error @ 48 kHz      | −0.230 dB| −0.238 dB  | −0.256 dB          |
    //! | realized gain error @ 96 kHz      | −2.121 dB| −0.195 dB  | −0.154 dB          |
    //! | noise floor @ 48 kHz, rel. tone   | −55.45 dB| −55.16 dB  | (f64: −194.65 dB)  |
    //! | noise floor @ 48 kHz, −18 dB cut  | −64.84 dB| −48.88 dB  | (f64: −186.00 dB)  |
    //!
    //! **The topology swap is not the fix, and this is measured, not assumed.**
    //! Transposed Direct Form II — the standard "better for float" alternative —
    //! is worth 1.93 dB of realized gain at the 96 kHz corner but *costs*
    //! 15.96 dB of noise floor at the 48 kHz −18 dB corner, and is within
    //! 0.007 dB of DF-I on realized gain everywhere at 48 kHz. Swapping
    //! topologies trades one reachable corner for another.
    //!
    //! What the error budget actually says is that both remaining terms are
    //! **precision**, not arrangement: f32 state loses the recursion to
    //! catastrophic cancellation (`a1 ≈ −2`, `a2 ≈ 1`, so `−a1·y1 − a2·y2`
    //! subtracts two large near-equal terms), and f32 coefficient storage moves
    //! the pole. Both are fixed by widening, which keeps Direct-Form-I — and so
    //! keeps DF-I's bounded state under the coefficient modulation #787
    //! introduced, and keeps that PR's convexity stability proof applicable
    //! unchanged, since it is a statement about pole locations and not about
    //! how they are realized.
    //!
    //! These tests are bidirectional guards. Narrowing `BiquadCoeffs` or
    //! `BiquadState` back to f32 puts the numbers in the table back and trips
    //! them; so does a topology change that regresses either corner.

    use super::{BiquadCoeffs, BiquadState};
    use core::f64::consts::PI;

    /// Complex amplitude of `signal` at `hz` via a single-bin DFT.
    /// Returns (magnitude, phase_radians).
    fn bin(signal: &[f64], hz: f64, sr: f64) -> (f64, f64) {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (n, &s) in signal.iter().enumerate() {
            let w = 2.0 * PI * hz * n as f64 / sr;
            re += s * w.cos();
            im -= s * w.sin();
        }
        let n = signal.len() as f64;
        ((re * re + im * im).sqrt() * 2.0 / n, im.atan2(re))
    }

    fn rms(v: &[f64]) -> f64 {
        (v.iter().map(|s| s * s).sum::<f64>() / v.len() as f64).sqrt()
    }

    /// Everything in `signal` that is not the tone at `hz`, in dB relative to
    /// the tone: subtract the best-fit sinusoid and measure what is left.
    fn noise_floor_db(signal: &[f64], hz: f64, sr: f64) -> f64 {
        let (mag, phase) = bin(signal, hz, sr);
        assert!(mag > 0.0, "probe tone vanished — the filter output is silent");
        let residual: Vec<f64> = signal
            .iter()
            .enumerate()
            .map(|(n, &s)| s - mag * (2.0 * PI * hz * n as f64 / sr + phase).cos())
            .collect();
        let r = rms(&residual);
        if r <= 0.0 {
            return -300.0;
        }
        20.0 * (r / (mag / 2.0_f64.sqrt())).log10()
    }

    /// Pole radius of the coefficient set, used to size the settling run.
    fn pole_radius(c: &BiquadCoeffs) -> f64 {
        let (a1, a2) = (c.a1 as f64, c.a2 as f64);
        let disc = a1 * a1 - 4.0 * a2;
        if disc < 0.0 {
            a2.sqrt()
        } else {
            ((-a1 + disc.sqrt()) / 2.0)
                .abs()
                .max(((-a1 - disc.sqrt()) / 2.0).abs())
        }
    }

    /// Drive the **production** `BiquadState` with a −6 dBFS tone, discard 20
    /// pole time constants of transient, and return the settled tail.
    fn settled_response(coeffs: &BiquadCoeffs, tone_hz: f64, sr: f64) -> (Vec<f64>, f64) {
        let settle = (20.0 / (1.0 - pole_radius(coeffs))).ceil() as usize;
        let analyse = (200.0 * sr / tone_hz).round() as usize;
        let mut state = BiquadState::new();
        let mut out = Vec::with_capacity(analyse);
        let mut input_tail = Vec::with_capacity(analyse);
        for n in 0..settle + analyse {
            let x = 0.5 * (2.0 * PI * tone_hz * n as f64 / sr).sin();
            let y = state.process(x as f32, coeffs) as f64;
            if n >= settle {
                out.push(y);
                input_tail.push(x);
            }
        }
        let (m_in, _) = bin(&input_tail, tone_hz, sr);
        (out, m_in)
    }

    fn realized_gain_db(coeffs: &BiquadCoeffs, tone_hz: f64, sr: f64) -> f64 {
        let (out, m_in) = settled_response(coeffs, tone_hz, sr);
        let (m_out, _) = bin(&out, tone_hz, sr);
        20.0 * (m_out / m_in).log10()
    }

    /// The band a mastering engineer can actually dial: the freq floor, the Q
    /// ceiling and the gain ceiling at once. This is the worst conditioned
    /// coefficient set `MasteringEq` can be asked to realize.
    const EXTREME_HZ: f64 = 20.0;
    const EXTREME_Q: f64 = 10.0;
    const EXTREME_GAIN_DB: f64 = 18.0;

    /// A mastering EQ must land the gain it was written. 0.05 dB is far below
    /// audibility and far above the residual of a correctly conditioned filter.
    const GAIN_TOLERANCE_DB: f64 = 0.05;

    #[test]
    fn extreme_low_band_realizes_its_written_gain_at_48k() {
        let sr = 48_000.0;
        let coeffs = BiquadCoeffs::peak(EXTREME_HZ, EXTREME_GAIN_DB, EXTREME_Q, sr);
        let realized = realized_gain_db(&coeffs, EXTREME_HZ, sr);
        let error = realized - EXTREME_GAIN_DB;
        assert!(
            error.abs() < GAIN_TOLERANCE_DB,
            "a +{EXTREME_GAIN_DB} dB / {EXTREME_HZ} Hz / Q={EXTREME_Q} band realized \
             {realized:.3} dB ({error:+.3} dB error) at {sr} Hz; f32 DF-I measured −0.230 dB \
             before the widening"
        );
    }

    #[test]
    fn extreme_low_band_realizes_its_written_gain_at_96k() {
        // The conditioning gets strictly worse with sample rate: w0 halves, so
        // the poles crowd the unit circle. This corner is where f32 DF-I lost
        // 2.121 dB of an 18 dB boost — the single worst number in the audit's
        // whole precision claim.
        let sr = 96_000.0;
        let coeffs = BiquadCoeffs::peak(EXTREME_HZ, EXTREME_GAIN_DB, EXTREME_Q, sr);
        let realized = realized_gain_db(&coeffs, EXTREME_HZ, sr);
        let error = realized - EXTREME_GAIN_DB;
        assert!(
            error.abs() < GAIN_TOLERANCE_DB,
            "a +{EXTREME_GAIN_DB} dB / {EXTREME_HZ} Hz / Q={EXTREME_Q} band realized \
             {realized:.3} dB ({error:+.3} dB error) at {sr} Hz; f32 DF-I measured −2.121 dB \
             before the widening"
        );
    }

    /// An ideal realization: the same coefficients evaluated in f64, fed the
    /// same f32 sample stream the engine delivers, emitting f32. Nothing that
    /// consumes and produces f32 samples can do better than this, so it is the
    /// floor to measure the shipped filter against — rather than a hand-picked
    /// dB constant that would need re-tuning whenever the probe changes.
    fn ideal_reference_response(coeffs: &BiquadCoeffs, tone_hz: f64, sr: f64) -> Vec<f64> {
        let settle = (20.0 / (1.0 - pole_radius(coeffs))).ceil() as usize;
        let analyse = (200.0 * sr / tone_hz).round() as usize;
        let (mut x1, mut x2, mut y1, mut y2) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
        let mut out = Vec::with_capacity(analyse);
        for n in 0..settle + analyse {
            let x = f64::from((0.5 * (2.0 * PI * tone_hz * n as f64 / sr).sin()) as f32);
            let y = coeffs.b0 * x + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1
                - coeffs.a2 * y2;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            if n >= settle {
                out.push(f64::from(y as f32));
            }
        }
        out
    }

    /// Headroom over the ideal reference. The shipped filter is expected to sit
    /// *on* the reference (measured: 0.00 dB in every case below); 1 dB leaves
    /// room for probe jitter without leaving room for a precision regression,
    /// which costs tens of dB.
    const EXCESS_NOISE_TOLERANCE_DB: f64 = 1.0;

    fn assert_adds_no_noise(coeffs: &BiquadCoeffs, tone_hz: f64, sr: f64, pre_fix: &str) {
        let (shipped, _) = settled_response(coeffs, tone_hz, sr);
        let shipped_floor = noise_floor_db(&shipped, tone_hz, sr);
        let ideal_floor = noise_floor_db(&ideal_reference_response(coeffs, tone_hz, sr), tone_hz, sr);
        let excess = shipped_floor - ideal_floor;
        assert!(
            excess < EXCESS_NOISE_TOLERANCE_DB,
            "filter adds {excess:.2} dB of roundoff over an ideal f64 realization on the \
             same f32 transport (shipped {shipped_floor:.2} dB, ideal {ideal_floor:.2} dB, \
             both rel. tone); f32 DF-I measured {pre_fix} before the widening"
        );
    }

    #[test]
    fn extreme_low_band_adds_no_roundoff_above_the_sample_format_on_boost() {
        let sr = 48_000.0;
        assert_adds_no_noise(
            &BiquadCoeffs::peak(EXTREME_HZ, EXTREME_GAIN_DB, EXTREME_Q, sr),
            EXTREME_HZ,
            sr,
            "−55.45 dB against a −153.18 dB ideal (97.7 dB of excess)",
        );
    }

    #[test]
    fn extreme_low_band_adds_no_roundoff_above_the_sample_format_on_cut() {
        // Kept as its own case because the cut direction is where TDF-II
        // measured 15.96 dB *worse* than DF-I — the measurement that rules the
        // topology swap out. Its ideal floor is 17 dB higher than the boost
        // case's because a 20 Hz notch attenuates the tone by 18 dB while
        // passing the input's own f32 quantization noise at full level; that
        // is the sample format, not the filter, which is exactly why this
        // asserts against the ideal rather than an absolute number.
        let sr = 48_000.0;
        assert_adds_no_noise(
            &BiquadCoeffs::peak(EXTREME_HZ, -EXTREME_GAIN_DB, EXTREME_Q, sr),
            EXTREME_HZ,
            sr,
            "−64.84 dB against a −135.24 dB ideal (70.4 dB of excess)",
        );
    }

    #[test]
    fn ordinary_midband_band_was_already_accurate_and_stays_so() {
        // Guards against "fixing" the extremes by disturbing the common case:
        // f32 DF-I already realized this within 0.000 dB at a −118.50 dB floor.
        let sr = 48_000.0;
        let coeffs = BiquadCoeffs::peak(1_000.0, 6.0, 1.0, sr);
        let realized = realized_gain_db(&coeffs, 1_000.0, sr);
        assert!(
            (realized - 6.0).abs() < 0.01,
            "a +6 dB / 1 kHz / Q=1 band realized {realized:.4} dB"
        );
        assert_adds_no_noise(
            &coeffs,
            1_000.0,
            sr,
            "−118.50 dB against a −156.13 dB ideal (37.6 dB of excess)",
        );
    }
}

#[cfg(test)]
mod rejected_topology_measurement {
    //! DSP-5's rejected alternative, kept measurable.
    //!
    //! The finding proposed migrating Proof off Direct-Form-I. That was
    //! rejected on measurement rather than opinion, but the measurement lived
    //! only in a comment — so a reviewer had to rebuild Transposed Direct Form
    //! II from scratch to check it, and so would anyone revisiting the choice.
    //! Both f32 topologies are implemented here as fixtures and compared on the
    //! corners that decided it. Neither is production code: production is
    //! Direct-Form-I with f64 coefficients and state.
    //!
    //! The result, re-derived on every run:
    //!
    //! | corner | f32 DF-I | f32 TDF-II | production (f64 DF-I) |
    //! |---|---|---|---|
    //! | gain error, 20 Hz Q=10 +18 dB @ 96 kHz | −2.121 dB | −0.195 dB | ~0 dB |
    //! | gain error, same band @ 48 kHz | −0.230 dB | −0.238 dB | ~0 dB |
    //! | noise floor, 48 kHz −18 dB cut | −64.84 dB | −48.88 dB | at the f32 transport floor |
    //!
    //! TDF-II buys ~1.9 dB at the 96 kHz corner and gives up ~16 dB of noise
    //! floor at the 48 kHz cut corner. Widening wins both.

    use super::BiquadCoeffs;
    use core::f64::consts::PI;

    /// Direct-Form-I with f32 coefficients and f32 state — Proof before the
    /// DSP-5 widening.
    #[derive(Default)]
    struct Df1F32 {
        x1: f32,
        x2: f32,
        y1: f32,
        y2: f32,
    }

    /// Transposed Direct Form II with f32 coefficients and f32 state — the
    /// migration DSP-5 proposed.
    #[derive(Default)]
    struct Tdf2F32 {
        s1: f32,
        s2: f32,
    }

    /// The five coefficients narrowed to f32, as both rejected topologies would
    /// have stored them.
    struct NarrowCoeffs {
        b0: f32,
        b1: f32,
        b2: f32,
        a1: f32,
        a2: f32,
    }

    impl NarrowCoeffs {
        fn of(c: &BiquadCoeffs) -> Self {
            Self {
                b0: c.b0 as f32,
                b1: c.b1 as f32,
                b2: c.b2 as f32,
                a1: c.a1 as f32,
                a2: c.a2 as f32,
            }
        }
    }

    impl Df1F32 {
        fn process(&mut self, x: f32, c: &NarrowCoeffs) -> f32 {
            let y = c.b0 * x + c.b1 * self.x1 + c.b2 * self.x2 - c.a1 * self.y1 - c.a2 * self.y2;
            self.x2 = self.x1;
            self.x1 = x;
            self.y2 = self.y1;
            self.y1 = y;
            y
        }
    }

    impl Tdf2F32 {
        fn process(&mut self, x: f32, c: &NarrowCoeffs) -> f32 {
            let y = c.b0 * x + self.s1;
            self.s1 = c.b1 * x - c.a1 * y + self.s2;
            self.s2 = c.b2 * x - c.a2 * y;
            y
        }
    }

    fn bin(signal: &[f64], hz: f64, sr: f64) -> (f64, f64) {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (n, &s) in signal.iter().enumerate() {
            let w = 2.0 * PI * hz * n as f64 / sr;
            re += s * w.cos();
            im -= s * w.sin();
        }
        let n = signal.len() as f64;
        ((re * re + im * im).sqrt() * 2.0 / n, im.atan2(re))
    }

    fn noise_floor_db(signal: &[f64], hz: f64, sr: f64) -> f64 {
        let (mag, phase) = bin(signal, hz, sr);
        let residual: Vec<f64> = signal
            .iter()
            .enumerate()
            .map(|(n, &s)| s - mag * (2.0 * PI * hz * n as f64 / sr + phase).cos())
            .collect();
        let rms = (residual.iter().map(|s| s * s).sum::<f64>() / residual.len() as f64).sqrt();
        20.0 * (rms / (mag / 2.0_f64.sqrt())).log10()
    }

    fn settle_samples(c: &BiquadCoeffs) -> usize {
        let disc = c.a1 * c.a1 - 4.0 * c.a2;
        let radius = if disc < 0.0 {
            c.a2.sqrt()
        } else {
            ((-c.a1 + disc.sqrt()) / 2.0)
                .abs()
                .max(((-c.a1 - disc.sqrt()) / 2.0).abs())
        };
        (20.0 / (1.0 - radius)).ceil() as usize
    }

    /// Render a −6 dBFS tone through `step`, discard the transient, and return
    /// (realized gain in dB, noise floor in dB relative to the tone).
    fn measure(coeffs: &BiquadCoeffs, tone_hz: f64, sr: f64, mut step: impl FnMut(f32) -> f32)
        -> (f64, f64)
    {
        let settle = settle_samples(coeffs);
        let analyse = (200.0 * sr / tone_hz).round() as usize;
        let mut out = Vec::with_capacity(analyse);
        let mut input = Vec::with_capacity(analyse);
        for n in 0..settle + analyse {
            let x = 0.5 * (2.0 * PI * tone_hz * n as f64 / sr).sin();
            let y = f64::from(step(x as f32));
            if n >= settle {
                out.push(y);
                input.push(x);
            }
        }
        let (m_in, _) = bin(&input, tone_hz, sr);
        let (m_out, _) = bin(&out, tone_hz, sr);
        (
            20.0 * (m_out / m_in).log10(),
            noise_floor_db(&out, tone_hz, sr),
        )
    }

    fn df1(coeffs: &BiquadCoeffs, tone_hz: f64, sr: f64) -> (f64, f64) {
        let narrow = NarrowCoeffs::of(coeffs);
        let mut state = Df1F32::default();
        measure(coeffs, tone_hz, sr, |x| state.process(x, &narrow))
    }

    fn tdf2(coeffs: &BiquadCoeffs, tone_hz: f64, sr: f64) -> (f64, f64) {
        let narrow = NarrowCoeffs::of(coeffs);
        let mut state = Tdf2F32::default();
        measure(coeffs, tone_hz, sr, |x| state.process(x, &narrow))
    }

    const HZ: f64 = 20.0;
    const Q: f64 = 10.0;
    const GAIN_DB: f64 = 18.0;

    #[test]
    fn tdf2_beats_df1_on_realized_gain_at_96k_but_only_there() {
        let sr = 96_000.0;
        let coeffs = BiquadCoeffs::peak(HZ, GAIN_DB, Q, sr);
        let (df1_gain, _) = df1(&coeffs, HZ, sr);
        let (tdf2_gain, _) = tdf2(&coeffs, HZ, sr);
        let advantage = (tdf2_gain - GAIN_DB).abs();
        let deficit = (df1_gain - GAIN_DB).abs();
        assert!(
            deficit - advantage > 1.5,
            "TDF-II's 96 kHz advantage collapsed: f32 DF-I error {deficit:.3} dB vs \
             f32 TDF-II {advantage:.3} dB (measured 2.121 vs 0.195, a 1.93 dB advantage)"
        );
    }

    #[test]
    fn tdf2_costs_more_noise_than_it_saves_at_the_48k_cut_corner() {
        // The measurement that rejects the migration. Same band, cut instead of
        // boost, at the rate the app actually runs.
        let sr = 48_000.0;
        let coeffs = BiquadCoeffs::peak(HZ, -GAIN_DB, Q, sr);
        let (_, df1_floor) = df1(&coeffs, HZ, sr);
        let (_, tdf2_floor) = tdf2(&coeffs, HZ, sr);
        let cost = tdf2_floor - df1_floor;
        assert!(
            cost > 10.0,
            "TDF-II's noise penalty at the 48 kHz cut corner has changed: DF-I floor \
             {df1_floor:.2} dB, TDF-II floor {tdf2_floor:.2} dB, penalty {cost:.2} dB \
             (measured 15.96 dB). If this ever goes away the topology swap deserves \
             re-examining."
        );
    }

    #[test]
    fn the_two_topologies_are_indistinguishable_on_gain_at_48k() {
        let sr = 48_000.0;
        let coeffs = BiquadCoeffs::peak(HZ, GAIN_DB, Q, sr);
        let (df1_gain, _) = df1(&coeffs, HZ, sr);
        let (tdf2_gain, _) = tdf2(&coeffs, HZ, sr);
        assert!(
            (df1_gain - tdf2_gain).abs() < 0.02,
            "the topologies differ by {:.4} dB on realized gain at 48 kHz (measured 0.007 dB)",
            (df1_gain - tdf2_gain).abs()
        );
    }

    #[test]
    fn widening_beats_both_rejected_topologies_on_every_corner() {
        // The payoff: production is not a compromise between the two, it
        // dominates both. `BiquadState` is the shipped f64 Direct-Form-I.
        use super::BiquadState;
        for (sr, gain_db) in [(96_000.0, GAIN_DB), (48_000.0, GAIN_DB), (48_000.0, -GAIN_DB)] {
            let coeffs = BiquadCoeffs::peak(HZ, gain_db, Q, sr);
            let (df1_gain, df1_floor) = df1(&coeffs, HZ, sr);
            let (tdf2_gain, tdf2_floor) = tdf2(&coeffs, HZ, sr);

            let mut shipped = BiquadState::new();
            let (gain, floor) = measure(&coeffs, HZ, sr, |x| shipped.process(x, &coeffs));

            let error = (gain - gain_db).abs();
            assert!(
                error < (df1_gain - gain_db).abs() || error < 0.05,
                "at {sr} Hz / {gain_db:+} dB the shipped filter's gain error {error:.4} dB \
                 is not better than f32 DF-I's {:.4} dB",
                (df1_gain - gain_db).abs()
            );
            assert!(
                error < (tdf2_gain - gain_db).abs() || error < 0.05,
                "at {sr} Hz / {gain_db:+} dB the shipped filter's gain error {error:.4} dB \
                 is not better than f32 TDF-II's {:.4} dB",
                (tdf2_gain - gain_db).abs()
            );
            assert!(
                floor < df1_floor && floor < tdf2_floor,
                "at {sr} Hz / {gain_db:+} dB the shipped floor {floor:.2} dB is not below \
                 f32 DF-I {df1_floor:.2} dB and f32 TDF-II {tdf2_floor:.2} dB"
            );
        }
    }
}
