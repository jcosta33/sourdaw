//! Oversampling on a 15-tap half-band FIR.
//!
//! [`Oversampler2x`] is the shared half-band the Proof, Bacteria and Grinder
//! paths all run on; half-band filters are efficient because every other
//! coefficient is zero. It is not the crate’s only rate converter — Gluten
//! carries a separate, lighter 7-tap `gluten::oversample::Oversample2x` for
//! its own compressor nonlinearities.
//!
//! [`OversamplingChain`] cascades it into the 1x/2x/4x/8x factors a
//! nonlinearity actually asks for, and is the type to reach for — building an
//! ad-hoc cascade out of `Oversampler2x` is easy to get subtly wrong (see the
//! phase-split note on [`OversamplingChain`]).

use super::flush_denormal;

const HALFBAND_TAPS: usize = 15;

/// Half-band lowpass FIR coefficients (Kaiser window, β=5, 15-tap).
/// Every other coefficient (except center) is zero.
const HALFBAND_COEFFS: [f32; HALFBAND_TAPS] = [
    -0.006_903, 0.0, 0.039_377, 0.0, -0.120_882, 0.0, 0.600_408,
    1.0, // center tap (normalized)
    0.600_408, 0.0, -0.120_882, 0.0, 0.039_377, 0.0, -0.006_903,
];

/// DC sum of the half-band kernel (≈2 by half-band design; 2.024 here).
/// Zero-stuffed interpolation halves the signal energy, so the upsampler
/// normalizes by SUM/2 to land at ~unity gain; the decimator's anti-alias FIR
/// runs on the dense 2x-rate signal, so it normalizes by SUM.
const HALFBAND_COEFF_SUM: f32 = 2.0 * (-0.006_903 + 0.039_377 - 0.120_882 + 0.600_408) + 1.0;
const UPSAMPLE_GAIN: f32 = 2.0 / HALFBAND_COEFF_SUM;
const DOWNSAMPLE_GAIN: f32 = 1.0 / HALFBAND_COEFF_SUM;

/// 2x oversampler for a single channel.
///
/// Up- and down-sampling keep INDEPENDENT delay lines: the exciter runs both
/// directions through one instance, and a shared line would mix the two
/// rates' filter histories (audit #508 row 16 — corrupted wet path and a
/// 4.048x per-stage gain from dense-line filtering with a x2 compensation).
pub struct Oversampler2x {
    up_delay: [f32; HALFBAND_TAPS],
    up_pos: usize,
    down_delay: [f32; HALFBAND_TAPS],
    down_pos: usize,
}

impl Oversampler2x {
    pub fn new() -> Self {
        Self {
            up_delay: [0.0; HALFBAND_TAPS],
            up_pos: 0,
            down_delay: [0.0; HALFBAND_TAPS],
            down_pos: 0,
        }
    }

    /// Convolve the kernel over the circular delay line; `pos` sits just past
    /// the oldest sample. The kernel is symmetric, so read direction is moot.
    #[inline]
    fn fir(delay: &[f32; HALFBAND_TAPS], pos: usize) -> f32 {
        let mut sum = 0.0_f32;
        for (i, &c) in HALFBAND_COEFFS.iter().enumerate() {
            sum += delay[(pos + i) % HALFBAND_TAPS] * c;
        }
        sum
    }

    /// Upsample: zero-stuff (x, 0), then filter each phase at the 2x rate.
    /// Input: 1 sample. Output: 2 samples at double rate.
    #[inline]
    pub fn upsample(&mut self, x: f32) -> (f32, f32) {
        self.up_delay[self.up_pos] = x;
        self.up_pos = (self.up_pos + 1) % HALFBAND_TAPS;
        let aligned = Self::fir(&self.up_delay, self.up_pos) * UPSAMPLE_GAIN;

        self.up_delay[self.up_pos] = 0.0;
        self.up_pos = (self.up_pos + 1) % HALFBAND_TAPS;
        let interpolated = Self::fir(&self.up_delay, self.up_pos) * UPSAMPLE_GAIN;

        (aligned, interpolated)
    }

    /// Downsample: filter at the 2x rate, then decimate by 2.
    /// Input: 2 samples at double rate. Output: 1 sample.
    #[inline]
    pub fn downsample(&mut self, s0: f32, s1: f32) -> f32 {
        self.down_delay[self.down_pos] = s0;
        self.down_pos = (self.down_pos + 1) % HALFBAND_TAPS;
        self.down_delay[self.down_pos] = s1;
        self.down_pos = (self.down_pos + 1) % HALFBAND_TAPS;
        Self::fir(&self.down_delay, self.down_pos) * DOWNSAMPLE_GAIN
    }

    pub fn reset(&mut self) {
        self.up_delay = [0.0; HALFBAND_TAPS];
        self.up_pos = 0;
        self.down_delay = [0.0; HALFBAND_TAPS];
        self.down_pos = 0;
    }
}

/// Largest supported oversampling factor.
pub const MAX_FACTOR: usize = 8;

/// Round a requested factor down to a supported power of two in 1..=8.
///
/// A factor of 3, 5, 6 or 7 must not survive as itself: the chain only builds
/// stages for 1/2/4/8, and an odd factor would emit a slice no stage can
/// decimate.
fn normalize_factor(requested: usize) -> usize {
    if requested >= 8 {
        return 8;
    }
    if requested >= 4 {
        return 4;
    }
    if requested >= 2 {
        return 2;
    }
    1
}

/// Read an oversampled sample without panicking on a short slice.
///
/// Callers pass exactly `factor` samples; a short slice would be a caller bug,
/// but this runs on the audio thread where a panic is worse than a zero.
#[inline]
fn tap(samples: &[f32], index: usize) -> f32 {
    match samples.get(index) {
        Some(&sample) => sample,
        None => 0.0,
    }
}

/// Configurable oversampling: 1x (bypass), 2x, 4x, 8x.
///
/// Cascade shape — the part that is easy to get wrong: each stage uses ONE
/// [`Oversampler2x`] instance driven once per sample of *its own* input rate,
/// in time order. Stage 2 therefore runs twice per base sample and stage 3
/// four times, so each delay line advances at the rate it filters and each
/// cutoff sits an octave above the stage below it.
///
/// Giving each phase its own instance instead — one stage-2 filter fed only
/// the even 2x-rate samples, another fed only the odd — advances both delay
/// lines at the BASE rate. Every stage-2 cutoff then collapses back onto
/// stage 1's and the passband droop compounds: that arrangement measures
/// 0.936x at 7 kHz for a 4x round trip at 48 kHz where this cascade holds
/// 0.959x.
///
/// The filter is linear-phase and so has real group delay (see
/// [`Self::latency_samples`]); a polyphase IIR would be cheaper and
/// lower-latency at the cost of phase distortion.
///
/// Allocation-free — every stage and the interleave buffer are inline, so
/// rebuilding the chain when an oversampling parameter changes is safe on the
/// audio thread.
pub struct OversamplingChain {
    /// Base rate to 2x.
    stage1: Oversampler2x,
    /// 2x to 4x. Driven twice per base sample, so its delay line advances at
    /// the 2x rate and its cutoff sits an octave above stage 1's.
    stage2: Oversampler2x,
    /// 4x to 8x. Driven four times per base sample.
    stage3: Oversampler2x,
    factor: usize,
    buffer: [f32; MAX_FACTOR],
}

impl OversamplingChain {
    pub fn new(factor: usize) -> Self {
        Self {
            stage1: Oversampler2x::new(),
            stage2: Oversampler2x::new(),
            stage3: Oversampler2x::new(),
            factor: normalize_factor(factor),
            buffer: [0.0; MAX_FACTOR],
        }
    }

    pub fn factor(&self) -> usize {
        self.factor
    }

    /// Round-trip group delay in base-rate samples.
    ///
    /// One half-band round trip costs 6.5 samples at the rate the stage runs,
    /// and each stage runs at twice the rate of the one below it, so the
    /// stages contribute 6.5, 3.25 and 1.625 base-rate samples.
    pub fn latency_samples(&self) -> f32 {
        match self.factor {
            2 => 6.5,
            4 => 9.75,
            8 => 11.375,
            _ => 0.0,
        }
    }

    /// Upsample one input sample into `factor` output samples, in time order.
    pub fn upsample(&mut self, input: f32) -> &[f32] {
        match self.factor {
            2 => {
                let (first, second) = self.stage1.upsample(input);
                self.buffer[0] = first;
                self.buffer[1] = second;
            }
            4 => {
                let (first, second) = self.stage1.upsample(input);
                let (a0, a1) = self.stage2.upsample(first);
                let (b0, b1) = self.stage2.upsample(second);
                self.buffer[0] = a0;
                self.buffer[1] = a1;
                self.buffer[2] = b0;
                self.buffer[3] = b1;
            }
            8 => {
                let (first, second) = self.stage1.upsample(input);
                let (a0, a1) = self.stage2.upsample(first);
                let (b0, b1) = self.stage2.upsample(second);
                let (a00, a01) = self.stage3.upsample(a0);
                let (a10, a11) = self.stage3.upsample(a1);
                let (b00, b01) = self.stage3.upsample(b0);
                let (b10, b11) = self.stage3.upsample(b1);
                self.buffer[0] = a00;
                self.buffer[1] = a01;
                self.buffer[2] = a10;
                self.buffer[3] = a11;
                self.buffer[4] = b00;
                self.buffer[5] = b01;
                self.buffer[6] = b10;
                self.buffer[7] = b11;
            }
            _ => {
                self.buffer[0] = input;
            }
        }
        &self.buffer[..self.factor]
    }

    /// Downsample `factor` processed samples back to one output sample.
    ///
    /// Mirrors [`Self::upsample`]: each stage decimates the pairs its own
    /// upsampling direction produced, in the same order.
    pub fn downsample(&mut self, samples: &[f32]) -> f32 {
        let output = match self.factor {
            2 => self.stage1.downsample(tap(samples, 0), tap(samples, 1)),
            4 => {
                let first = self.stage2.downsample(tap(samples, 0), tap(samples, 1));
                let second = self.stage2.downsample(tap(samples, 2), tap(samples, 3));
                self.stage1.downsample(first, second)
            }
            8 => {
                let a0 = self.stage3.downsample(tap(samples, 0), tap(samples, 1));
                let a1 = self.stage3.downsample(tap(samples, 2), tap(samples, 3));
                let b0 = self.stage3.downsample(tap(samples, 4), tap(samples, 5));
                let b1 = self.stage3.downsample(tap(samples, 6), tap(samples, 7));
                let first = self.stage2.downsample(a0, a1);
                let second = self.stage2.downsample(b0, b1);
                self.stage1.downsample(first, second)
            }
            _ => tap(samples, 0),
        };
        flush_denormal(output)
    }

    pub fn reset(&mut self) {
        self.stage1.reset();
        self.stage2.reset();
        self.stage3.reset();
        self.buffer = [0.0; MAX_FACTOR];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_1khz(n: usize) -> f32 {
        (2.0 * std::f32::consts::PI * 1000.0 * n as f32 / 48000.0).sin()
    }

    /// Cascade gain: a 0 dBFS sine whose peak lands on a sample must stay at
    /// ~0 dB through the 4x cascade, not gain +24 dB from zero-stuffing.
    /// (dBTP measurement itself lives in `true_peak.rs` — this half-band
    /// cascade under-reconstructs the continuous peak and is not a true-peak
    /// oracle.)
    #[test]
    fn upsampled_true_peak_of_full_scale_sine_stays_near_unity() {
        let mut chain = OversamplingChain::new(4);
        let mut peak = 0.0_f32;
        for n in 0..4800 {
            for &s in chain.upsample(sine_1khz(n)) {
                peak = peak.max(s.abs());
            }
        }
        assert!(
            (0.97..=1.05).contains(&peak),
            "true peak of 0 dBFS sine must stay near 1.0, got {:.4} ({:+.2} dBTP)",
            peak,
            20.0 * peak.log10()
        );
    }

    /// Exciter path (exciter.rs): up -> process -> down through ONE instance
    /// must be level-neutral and stable (pre-fix it diverged to NaN).
    #[test]
    fn round_trip_through_one_instance_preserves_level_and_stays_finite() {
        let mut os = Oversampler2x::new();
        let mut in_energy = 0.0_f32;
        let mut out_energy = 0.0_f32;
        for n in 0..4800 {
            let x = sine_1khz(n);
            let (s0, s1) = os.upsample(x);
            let y = os.downsample(s0, s1);
            assert!(y.is_finite(), "round trip diverged at sample {}", n);
            if n >= 400 {
                in_energy += x * x;
                out_energy += y * y;
            }
        }
        let ratio = (out_energy / in_energy).sqrt();
        assert!(
            (0.95..=1.05).contains(&ratio),
            "round-trip RMS ratio must be ~1, got {:.4}x",
            ratio
        );
    }

    /// The up and down filter histories are independent: interleaving
    /// downsample calls (any content) must not disturb the upsample output.
    #[test]
    fn downsample_calls_do_not_clobber_upsample_state() {
        let mut interleaved = Oversampler2x::new();
        let mut reference = Oversampler2x::new();
        for _ in 0..64 {
            let actual = interleaved.upsample(0.5);
            let _ = interleaved.downsample(100.0, -100.0);
            let expected = reference.upsample(0.5);
            assert_eq!(actual, expected);
        }
    }

    /// Zero-stuffed half-band interpolation: both output phases sit within a
    /// small bound of the input level at DC (kernel ripple only).
    #[test]
    fn upsample_dc_gain_per_phase_stays_near_unity() {
        let mut os = Oversampler2x::new();
        let mut aligned = 0.0_f32;
        let mut interpolated = 0.0_f32;
        for _ in 0..64 {
            let (a, i) = os.upsample(0.5);
            aligned = a;
            interpolated = i;
        }
        assert!(
            (0.48..=0.52).contains(&aligned),
            "aligned phase DC gain out of bounds: {:.4}",
            aligned * 2.0
        );
        assert!(
            (0.48..=0.52).contains(&interpolated),
            "interpolated phase DC gain out of bounds: {:.4}",
            interpolated * 2.0
        );
    }
}

#[cfg(test)]
mod group_delay_tests {
    use super::*;

    /// The exciter's dry-path compensation is built on this number: the
    /// round-trip impulse centroid must stay at 6.5 base-rate samples
    /// (7 per direction at the 2x rate, split across base samples 6 and 7).
    #[test]
    fn round_trip_group_delay_is_six_and_a_half_base_samples() {
        let mut os = Oversampler2x::new();
        let mut numerator = 0.0_f32;
        let mut denominator = 0.0_f32;
        for n in 0..64 {
            let x = if n == 0 { 1.0 } else { 0.0 };
            let (s0, s1) = os.upsample(x);
            let y = os.downsample(s0, s1);
            numerator += n as f32 * y.abs();
            denominator += y.abs();
        }
        let centroid = numerator / denominator;
        assert!(
            (6.4..=6.6).contains(&centroid),
            "round-trip group delay must stay at 6.5 base samples, got {:.3}",
            centroid
        );
    }
}

#[cfg(test)]
mod chain_tests {
    use super::*;
    use crate::primitives::alias_probe::{
        alias_to_harmonic_ratio, bin_magnitude, drive_tone, HARMONIC_BINS_HZ, PROBE_FUNDAMENTAL_HZ,
    };

    const SAMPLE_RATE: f32 = 48_000.0;
    const RENDER_LEN: usize = 8_192;
    const DRIVE_AMPLITUDE: f32 = 0.9;

    /// Memoryless stand-in for a waveshaper: the fold-back it makes is the
    /// same class any band distortion produces.
    fn hard_drive(x: f32) -> f32 {
        (x * 6.0).tanh()
    }

    fn identity(x: f32) -> f32 {
        x
    }

    /// Render the probe tone through the chain the way a host stage drives
    /// it: upsample, run the stage on every oversampled sample, decimate.
    fn render_chain(factor: usize, mut stage: impl FnMut(f32) -> f32) -> Vec<f32> {
        let mut chain = OversamplingChain::new(factor);
        let mut processed = [0.0_f32; MAX_FACTOR];
        (0..RENDER_LEN)
            .map(|n| {
                let input = drive_tone(n, SAMPLE_RATE, DRIVE_AMPLITUDE);
                let len = {
                    let up = chain.upsample(input);
                    for (i, &sample) in up.iter().enumerate() {
                        processed[i] = stage(sample);
                    }
                    up.len()
                };
                chain.downsample(&processed[..len])
            })
            .collect()
    }

    /// The nonlinearity with no rate conversion at all — the floor any real
    /// oversampler has to beat by a wide margin.
    fn render_naive() -> Vec<f32> {
        (0..RENDER_LEN)
            .map(|n| hard_drive(drive_tone(n, SAMPLE_RATE, DRIVE_AMPLITUDE)))
            .collect()
    }

    /// Red-first anchor: the undersampled nonlinearity must alias badly, or
    /// the comparisons below prove nothing. Measured 0.173.
    #[test]
    fn undersampled_nonlinearity_aliases_badly() {
        let ratio = alias_to_harmonic_ratio(&render_naive(), SAMPLE_RATE);
        assert!(
            ratio > 0.1,
            "the un-oversampled tanh is supposed to fold back hard (ratio={ratio:.4})"
        );
    }

    /// Every factor has to earn its cost against doing nothing at all.
    #[test]
    fn every_factor_rejects_far_more_aliasing_than_no_oversampling() {
        let naive = alias_to_harmonic_ratio(&render_naive(), SAMPLE_RATE);
        for factor in [2_usize, 4, 8] {
            let ratio = alias_to_harmonic_ratio(&render_chain(factor, hard_drive), SAMPLE_RATE);
            assert!(
                ratio * 5.0 < naive,
                "{factor}x oversampling must reject at least 5x more fold-back \
                 than no oversampling (naive={naive:.4}, {factor}x={ratio:.4})"
            );
        }
    }

    /// Rejection must improve with the factor. A dead top stage flattens this
    /// out — pre-#801 the 8x path was bit-identical to 4x. It does NOT catch a
    /// stage whose cutoff collapsed onto the one below it: measured, the
    /// phase-split cascade rejects *more* fold-back, not less, because its
    /// extra droop eats the aliases along with them. Passband droop is what
    /// catches that shape — see `droop_per_stage_stays_flat_across_factors`.
    #[test]
    fn higher_factors_reject_more_than_lower_factors() {
        let two = alias_to_harmonic_ratio(&render_chain(2, hard_drive), SAMPLE_RATE);
        let four = alias_to_harmonic_ratio(&render_chain(4, hard_drive), SAMPLE_RATE);
        let eight = alias_to_harmonic_ratio(&render_chain(8, hard_drive), SAMPLE_RATE);
        assert!(four < two, "4x must beat 2x (2x={two:.5}, 4x={four:.5})");
        assert!(
            eight < four,
            "8x must beat 4x (4x={four:.5}, 8x={eight:.5})"
        );
    }

    /// 7 kHz round-trip gain, referenced to the 1x bypass path so the probe's
    /// own windowing cancels out.
    fn passband_gain_at_probe(factor: usize) -> f32 {
        let reference = bin_magnitude(
            &render_chain(1, identity),
            PROBE_FUNDAMENTAL_HZ,
            SAMPLE_RATE,
        );
        let measured = bin_magnitude(
            &render_chain(factor, identity),
            PROBE_FUNDAMENTAL_HZ,
            SAMPLE_RATE,
        );
        measured / reference
    }

    /// Rate conversion must not eat the passband. This is an absolute
    /// level-neutrality bound, not a cascade-shape check: the correct cascade
    /// already sits at 0.959x (−0.36 dB) at 4x, so there is under 1% of
    /// headroom and the measured value drifts with probe length (0.9556x at
    /// RENDER_LEN 2048, 0.9599x at 32768). Weak as a separator — see
    /// `droop_per_stage_stays_flat_across_factors` for that.
    #[test]
    fn passband_gain_stays_near_unity_at_every_factor() {
        for factor in [2_usize, 4, 8] {
            let gain = passband_gain_at_probe(factor);
            assert!(
                (0.95..=1.05).contains(&gain),
                "{factor}x round trip must keep the 7 kHz passband within 5%, got {gain:.4}x"
            );
        }
    }

    /// THE cascade-shape separator. Each stage runs an octave above the one
    /// below it, so stacking stages must cost almost nothing extra at 7 kHz.
    /// Giving each phase its own stage-2 instance collapses every cutoff back
    /// onto stage 1's and the droop compounds per stage instead.
    ///
    /// The assertion is a ratio against the same run's 2x reading, not an
    /// absolute gain, so it does not drift with probe length the way the
    /// absolute bound above does.
    #[test]
    fn droop_per_stage_stays_flat_across_factors() {
        let two = passband_gain_at_probe(2);
        for factor in [4_usize, 8] {
            let ratio = passband_gain_at_probe(factor) / two;
            assert!(
                ratio > 0.975,
                "{factor}x must not compound stage droop against 2x \
                 (2x={two:.4}x, {factor}x/2x={ratio:.4}) — a per-phase stage \
                 split collapses the cutoffs and reads far below this"
            );
        }
    }

    /// Anti-aliasing must not eat the wanted harmonics along with the
    /// fold-back.
    #[test]
    fn wanted_harmonics_survive_the_rate_conversion() {
        let harmonic_energy = |samples: &[f32]| -> f32 {
            HARMONIC_BINS_HZ
                .iter()
                .map(|&f| bin_magnitude(samples, f, SAMPLE_RATE))
                .sum()
        };
        let naive = harmonic_energy(&render_naive());
        for factor in [2_usize, 4, 8] {
            let retention = harmonic_energy(&render_chain(factor, hard_drive)) / naive;
            assert!(
                (0.75..=1.25).contains(&retention),
                "{factor}x must keep the in-band harmonics (retention={retention:.3}x)"
            );
        }
    }

    /// Silence in, exact silence out — no DC or denormal residue leaking into
    /// whatever runs downstream.
    #[test]
    fn silence_in_produces_silence_out() {
        for factor in [1_usize, 2, 4, 8] {
            let mut chain = OversamplingChain::new(factor);
            let mut processed = [0.0_f32; MAX_FACTOR];
            for n in 0..512 {
                let len = {
                    let up = chain.upsample(0.0);
                    for (i, &sample) in up.iter().enumerate() {
                        processed[i] = sample;
                    }
                    up.len()
                };
                let out = chain.downsample(&processed[..len]);
                assert_eq!(out, 0.0, "{factor}x leaked {out} at sample {n}");
            }
        }
    }

    /// `reset` must clear every stage's history, so a used chain and a fresh
    /// one track sample-for-sample afterwards.
    #[test]
    fn reset_clears_every_stage_history() {
        let mut processed = [0.0_f32; MAX_FACTOR];
        let mut run = |chain: &mut OversamplingChain, n: usize, amplitude: f32| -> f32 {
            let len = {
                let up = chain.upsample(drive_tone(n, SAMPLE_RATE, amplitude));
                for (i, &sample) in up.iter().enumerate() {
                    processed[i] = hard_drive(sample);
                }
                up.len()
            };
            chain.downsample(&processed[..len])
        };

        let mut used = OversamplingChain::new(8);
        for n in 0..256 {
            run(&mut used, n, 0.9);
        }
        used.reset();

        let mut fresh = OversamplingChain::new(8);
        for n in 0..256 {
            let from_used = run(&mut used, n, 0.4);
            let from_fresh = run(&mut fresh, n, 0.4);
            assert_eq!(
                from_used, from_fresh,
                "reset must clear history at sample {n}"
            );
        }
    }

    /// A non-power-of-two factor must round down to a supported factor and
    /// emit that many samples, not keep the odd factor and panic.
    #[test]
    fn non_power_of_two_factors_round_down_instead_of_panicking() {
        for (requested, expected) in [(3_usize, 2_usize), (5, 4), (6, 4), (7, 4), (99, 8), (0, 1)] {
            let mut chain = OversamplingChain::new(requested);
            assert_eq!(
                chain.factor(),
                expected,
                "factor {requested} must normalize to {expected}"
            );
            assert_eq!(
                chain.upsample(0.5).len(),
                expected,
                "factor {requested} must emit {expected} samples"
            );
        }
    }

    /// The reported group delay must match the impulse the chain actually
    /// produces, so a host compensating on this number stays aligned. A
    /// per-phase stage split shifts the 4x centroid off 9.75 by 3.25 samples.
    ///
    /// The centroid is SIGNED, not `abs()`-weighted: rectifying a linear-phase
    /// impulse lets the sidelobes drag the estimate (4x reads 9.5425 rectified
    /// against a true 9.7501), which burned 41% of a 0.5-sample tolerance on
    /// pure measurement error. Signed, the residual is under 1e-4, so the
    /// tolerance can be 0.01 and this actually pins the reported number.
    #[test]
    fn reported_latency_matches_the_measured_impulse_centroid() {
        for factor in [2_usize, 4, 8] {
            let mut chain = OversamplingChain::new(factor);
            let mut processed = [0.0_f32; MAX_FACTOR];
            let mut numerator = 0.0_f32;
            let mut denominator = 0.0_f32;
            for n in 0..128 {
                let input = if n == 0 { 1.0 } else { 0.0 };
                let len = {
                    let up = chain.upsample(input);
                    for (i, &sample) in up.iter().enumerate() {
                        processed[i] = sample;
                    }
                    up.len()
                };
                let out = chain.downsample(&processed[..len]);
                numerator += n as f32 * out;
                denominator += out;
            }
            let centroid = numerator / denominator;
            let reported = chain.latency_samples();
            assert!(
                (centroid - reported).abs() < 0.01,
                "{factor}x reports {reported} samples of latency but the impulse \
                 centroid sits at {centroid:.4}"
            );
        }
    }
}
