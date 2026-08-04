//! Configurable oversampling (1x/2x/4x) for nonlinear distortion elements.
//!
//! Uses half-band polyphase FIR filters for up/downsampling.
//! Applied only around the nonlinear elements (JFET, transformer, diode bridge),
//! not the entire signal chain, to minimize CPU cost.

/// Simple 2x oversampler with half-band FIR anti-alias filter.
/// 7-tap half-band: only 2 non-trivial multiplies per sample.
///
/// Up and down keep independent delay lines, and the two directions store
/// different things: the interpolator only ever needs base-rate input history,
/// while the decimator needs the 2x-rate history split by phase.
pub struct Oversample2x {
    /// Base-rate input history: `[x[n-1], x[n-2], x[n-3]]`.
    up_z: [f32; 3],
    /// Interpolated-phase history at the 2x rate: `[s1[m-1], s1[m-2], s1[m-3]]`.
    down_odd_z: [f32; 3],
    /// Aligned-phase history at the 2x rate: `s0[m-1]`.
    down_even_z: f32,
}

/// 7-tap half-band kernel `h = [HA, 0, HB, 1, HB, 0, HA]`, centre tap 1.
/// Half-band means every even-offset tap except the centre is zero, which is
/// what makes one polyphase branch a pure delay.
const HA: f32 = -0.0625; // -1/16
const HB: f32 = 0.5625; //  9/16

/// DC sum of the kernel: `2*(HA + HB) + 1` = exactly 2.
///
/// This constant is the whole normalization argument, and it is why the two
/// directions do NOT share a scale factor:
///
/// * **Interpolation** zero-stuffs `(x, 0)` before filtering. Half the samples
///   are zero, so the filter must have DC gain `L = 2` to put the passband back
///   at unity — i.e. normalize the kernel by `SUM / L`. Here `SUM == L == 2`,
///   so the correct factor is exactly 1.0 and the kernel as written is already
///   interpolation-normalized. It is spelled out rather than omitted because
///   the bug this replaced was a stray `* 2.0` applied to one phase only
///   (+6.31 dB round trip, and asymmetric between the phases on top of that).
/// * **Decimation** filters the *dense* 2x-rate stream — no zeros — so its FIR
///   must have DC gain 1, i.e. normalize by `SUM`, giving 0.5.
///
/// Same reasoning, same constant names, as `primitives::oversample`, whose
/// 15-tap Kaiser kernel sums to 2.024 instead of exactly 2.
const HALFBAND_SUM: f32 = 2.0 * (HA + HB) + 1.0;
const UPSAMPLE_GAIN: f32 = 2.0 / HALFBAND_SUM;
const DOWNSAMPLE_GAIN: f32 = 1.0 / HALFBAND_SUM;

impl Oversample2x {
    pub fn new() -> Self {
        Self {
            up_z: [0.0; 3],
            down_odd_z: [0.0; 3],
            down_even_z: 0.0,
        }
    }

    /// Zero-stuff and filter, as two polyphase branches.
    ///
    /// Returns `(aligned, interpolated)` in time order: the aligned sample sits
    /// at base time `n-2` and the interpolated one halfway between `n-2` and
    /// `n-1`, so successive calls emit a uniformly spaced 2x-rate stream. That
    /// ordering is not arbitrary — it is the one that makes the interpolator's
    /// group delay a whole 2 base samples, which is what lets the round trip
    /// land on an integer sample and stay symmetric.
    #[inline]
    pub fn upsample(&mut self, x: f32) -> (f32, f32) {
        // Aligned branch: the kernel's even taps are all zero except the
        // centre, so this branch is a pure delay of gain 1 — no multiply-add.
        let aligned = self.up_z[1];
        // Interpolated branch: the odd taps, paired symmetrically about the
        // midpoint of x[n-1] and x[n-2]. Symmetric pairing is what makes the
        // branch linear-phase; DC gain is 2*(HA + HB) = 1.
        let interpolated = HA * (x + self.up_z[2]) + HB * (self.up_z[0] + self.up_z[1]);
        self.up_z[2] = self.up_z[1];
        self.up_z[1] = self.up_z[0];
        self.up_z[0] = x;
        (aligned * UPSAMPLE_GAIN, interpolated * UPSAMPLE_GAIN)
    }

    /// Filter the dense 2x stream and keep every second sample.
    ///
    /// The retained sample is the aligned phase, so the centre tap lands on an
    /// `s0` and every wing tap on an `s1`; mixing the two phases inside one
    /// symmetric pair is not a half-band decimator at all. The kernel reaches
    /// one 2x-sample past the retained one, so the emitted value is the
    /// previous call's — one base sample of delay, 3 for the round trip.
    #[inline]
    pub fn downsample(&mut self, s0: f32, s1: f32) -> f32 {
        let filtered = self.down_even_z
            + HB * (self.down_odd_z[0] + self.down_odd_z[1])
            + HA * (self.down_odd_z[2] + s1);
        self.down_odd_z[2] = self.down_odd_z[1];
        self.down_odd_z[1] = self.down_odd_z[0];
        self.down_odd_z[0] = s1;
        self.down_even_z = s0;
        filtered * DOWNSAMPLE_GAIN
    }

    pub fn reset(&mut self) {
        self.up_z = [0.0; 3];
        self.down_odd_z = [0.0; 3];
        self.down_even_z = 0.0;
    }
}

/// Process a nonlinear function at 2x oversampled rate.
#[inline]
pub fn process_oversampled<F: Fn(f32) -> f32>(os: &mut Oversample2x, input: f32, f: F) -> f32 {
    let (s0, s1) = os.upsample(input);
    let p0 = f(s0);
    let p1 = f(s1);
    os.downsample(p0, p1)
}

/// Configurable oversampler: supports 1x (bypass), 2x, or 4x.
/// 4x cascades two 2x stages.
pub struct ConfigurableOversample {
    stage1: Oversample2x,
    stage2: Oversample2x, // only used for 4x
    pub rate: u8,         // 1, 2, or 4
}

impl ConfigurableOversample {
    pub fn new(rate: u8) -> Self {
        Self {
            stage1: Oversample2x::new(),
            stage2: Oversample2x::new(),
            rate: rate.clamp(1, 4),
        }
    }

    pub fn set_rate(&mut self, rate: u8) {
        self.rate = match rate {
            0 | 1 => 1,
            2 => 2,
            _ => 4,
        };
        self.reset();
    }

    /// Process a nonlinear function at the configured oversampled rate.
    #[inline]
    pub fn process<F: Fn(f32) -> f32>(&mut self, input: f32, f: &F) -> f32 {
        match self.rate {
            1 => f(input),
            2 => {
                let (s0, s1) = self.stage1.upsample(input);
                let p0 = f(s0);
                let p1 = f(s1);
                self.stage1.downsample(p0, p1)
            }
            _ => {
                // 4x: cascade two 2x stages
                let (a0, a1) = self.stage1.upsample(input);
                // Each 2x sample gets upsampled again
                let (b0, b1) = self.stage2.upsample(a0);
                let r0 = f(b0);
                let r1 = f(b1);
                let d0 = self.stage2.downsample(r0, r1);

                let (b2, b3) = self.stage2.upsample(a1);
                let r2 = f(b2);
                let r3 = f(b3);
                let d1 = self.stage2.downsample(r2, r3);

                self.stage1.downsample(d0, d1)
            }
        }
    }

    pub fn reset(&mut self) {
        self.stage1.reset();
        self.stage2.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gluten::diode::DiodeCompressor;
    use crate::gluten::fet::FetCompressor;

    const SAMPLE_RATE: f32 = 48_000.0;
    /// Long enough for every delay line in the 4x cascade to fill.
    const WARMUP: usize = 512;
    /// 200 cycles of the 1 kHz probe — RMS over this window is insensitive to
    /// the round trip's group delay.
    const MEASURE: usize = 9_600;

    fn sine_1khz(n: usize) -> f32 {
        (2.0 * std::f32::consts::PI * 1000.0 * n as f32 / SAMPLE_RATE).sin()
    }

    fn db(ratio: f32) -> f32 {
        20.0 * ratio.log10()
    }

    fn identity(x: f32) -> f32 {
        x
    }

    /// Out/in RMS ratio for a 1 kHz sine pushed through `render`.
    fn rms_ratio(mut render: impl FnMut(f32) -> f32) -> f32 {
        let mut in_energy = 0.0_f32;
        let mut out_energy = 0.0_f32;
        for n in 0..(WARMUP + MEASURE) {
            let x = sine_1khz(n);
            let y = render(x);
            if n >= WARMUP {
                in_energy += x * x;
                out_energy += y * y;
            }
        }
        (out_energy / in_energy).sqrt()
    }

    /// Round-trip DC gain. An interpolator normalized to L=2 followed by a
    /// decimator normalized to 1 is unity by construction, at every factor.
    ///
    /// Measured 1.00000000 at 1x, 2x and 4x. Before the normalization fix this
    /// read 2.0625 at 2x (+6.29 dB) and compounded through the 4x cascade.
    #[test]
    fn round_trip_dc_gain_is_unity_at_every_factor() {
        for rate in [1_u8, 2, 4] {
            let mut os = ConfigurableOversample::new(rate);
            let mut out = 0.0_f32;
            for _ in 0..256 {
                out = os.process(1.0, &identity);
            }
            assert!(
                (out - 1.0).abs() < 1.0e-4,
                "{rate}x DC round trip must settle at 1.0, got {out:.4} ({:+.3} dB)",
                db(out)
            );
        }
    }

    /// Round-trip level on a real signal, not just DC. Measured 1.000000x at
    /// 1x, 0.999997x at 2x and 0.999992x (−0.0001 dB) at 4x; the band is 500x
    /// wider than the residual because it is a level-neutrality claim, not a
    /// pin on the arithmetic. Before the fix this read 2.0683x (+6.312 dB).
    #[test]
    fn round_trip_sine_level_is_unity_at_every_factor() {
        for rate in [1_u8, 2, 4] {
            let mut os = ConfigurableOversample::new(rate);
            let ratio = rms_ratio(|x| os.process(x, &identity));
            assert!(
                db(ratio).abs() < 0.01,
                "{rate}x round trip must be level-neutral at 1 kHz, got {ratio:.4}x ({:+.3} dB)",
                db(ratio)
            );
        }
    }

    /// Linear phase. Both directions are symmetric FIRs, so their cascade is
    /// symmetric too: a 7-tap half-band contributes 3 taps of one-sided support
    /// at the 2x rate, i.e. 1.5 base samples per direction, so the round-trip
    /// impulse response must be symmetric about base sample 3.
    ///
    /// This is the phase half of the defect and is independent of the gain
    /// half: an asymmetric tap pairing mistimes the interpolated phase against
    /// the aligned one whatever the overall scaling is.
    ///
    /// Measured response `[0.001953125, -0.03515625, 0.123046875, 0.8203125,
    /// 0.123046875, -0.03515625, 0.001953125, 0, …]`, summing to exactly 1 —
    /// which is `h ⊛ h/2` decimated at even lags, tap for tap. Before the fix
    /// it was `[-0.1328125, 0.5, 1.828125, 0, -0.1328125, 0, …]`.
    #[test]
    fn round_trip_impulse_response_is_symmetric_about_its_group_delay() {
        const CENTER: usize = 3;
        let mut os = Oversample2x::new();
        let response: Vec<f32> = (0..16)
            .map(|n| {
                let x = if n == 0 { 1.0 } else { 0.0 };
                let (s0, s1) = os.upsample(x);
                os.downsample(s0, s1)
            })
            .collect();
        for k in 1..=CENTER {
            let before = response[CENTER - k];
            let after = response[CENTER + k];
            assert!(
                (before - after).abs() < 1.0e-6,
                "round trip is not linear phase: h[{}]={before:.6} != h[{}]={after:.6} \
                 (full response {response:?})",
                CENTER - k,
                CENTER + k
            );
        }
        for (n, &tap) in response.iter().enumerate().skip(CENTER * 2 + 1) {
            assert!(
                tap.abs() < 1.0e-6,
                "round-trip support must end at base sample {}, but h[{n}]={tap:.6}",
                CENTER * 2
            );
        }
    }

    /// FET topology with every nonlinearity disabled and no gain reduction:
    /// the strip is then exactly the oversampler, so its output level is the
    /// oversampler's round-trip gain measured where the mix bus hears it.
    ///
    /// Measured 0.999997x. Before the fix, 2.0683x (+6.312 dB) — the number a
    /// user hears on the shipped "Punch" style, which forces `Topology::Fet`.
    #[test]
    fn fet_topology_is_level_neutral_when_its_nonlinearities_are_off() {
        let mut fet = FetCompressor::new(SAMPLE_RATE);
        fet.set_param("ratio", 1.0);
        fet.set_param("jfet_k3", 0.0);
        fet.set_param("xfmr_drive", 0.0);
        fet.set_param("xfmr_k2", 0.0);
        let ratio = rms_ratio(|x| fet.process_sample(x, x).0);
        assert!(
            db(ratio).abs() < 0.01,
            "FET topology must not change level with its distortion off, \
             got {ratio:.4}x ({:+.3} dB)",
            db(ratio)
        );

        // A level check alone would also pass if someone defaulted the strip to
        // 1x and removed the rate conversion altogether, which would trade the
        // gain error for an aliasing one. Pin that the oversampler is genuinely
        // in the path: at these settings the strip IS the round trip, so its
        // impulse response must be the round-trip kernel and not a lone spike.
        fet.reset();
        let response: Vec<f32> = (0..8)
            .map(|n| {
                let x = if n == 0 { 1.0 } else { 0.0 };
                fet.process_sample(x, x).0
            })
            .collect();
        assert!(
            (response[3] - 0.820_312_5).abs() < 1.0e-6
                && (response[0] - 0.001_953_125).abs() < 1.0e-6,
            "FET strip must run the corrected round-trip kernel, got {response:?}"
        );
    }

    /// Diode topology driven 26 dB below its threshold: no compression, no
    /// limiting, and the bridge's k2/k3 terms are under 0.01 dB at this level,
    /// so the whole strip reduces to the oversampler round trip.
    ///
    /// Measured 1.000005x. Before the fix, 2.0683x (+6.312 dB).
    #[test]
    fn diode_topology_is_level_neutral_below_its_threshold() {
        let mut diode = DiodeCompressor::new(SAMPLE_RATE);
        let ratio = rms_ratio(|x| diode.process_sample(x * 0.05, x * 0.05).0 / 0.05);
        assert!(
            db(ratio).abs() < 0.01,
            "Diode topology must not change level below threshold, \
             got {ratio:.4}x ({:+.3} dB)",
            db(ratio)
        );
    }
}
