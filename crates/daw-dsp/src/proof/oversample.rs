//! Simple 2x oversampling with half-band FIR filter.
//!
//! Uses a 15-tap half-band filter for anti-aliasing.
//! Half-band filters are efficient because every other coefficient is zero.

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

/// 4x oversampler — two cascaded 2x stages.
pub struct Oversampler4x {
    stage1: Oversampler2x,
    stage2_a: Oversampler2x,
    stage2_b: Oversampler2x,
}

impl Oversampler4x {
    pub fn new() -> Self {
        Self {
            stage1: Oversampler2x::new(),
            stage2_a: Oversampler2x::new(),
            stage2_b: Oversampler2x::new(),
        }
    }

    /// Upsample 1 sample to 4 samples.
    pub fn upsample(&mut self, x: f32) -> [f32; 4] {
        let (s0, s1) = self.stage1.upsample(x);
        let (s00, s01) = self.stage2_a.upsample(s0);
        let (s10, s11) = self.stage2_b.upsample(s1);
        [s00, s01, s10, s11]
    }

    /// Downsample 4 samples to 1 sample.
    pub fn downsample(&mut self, s: [f32; 4]) -> f32 {
        let d0 = self.stage2_a.downsample(s[0], s[1]);
        let d1 = self.stage2_b.downsample(s[2], s[3]);
        self.stage1.downsample(d0, d1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_1khz(n: usize) -> f32 {
        (2.0 * std::f32::consts::PI * 1000.0 * n as f32 / 48000.0).sin()
    }

    /// True-peak path (metering.rs): a 0 dBFS sine whose peak lands on a
    /// sample must measure ~0 dBTP, not +24 dBTP from resampling gain.
    #[test]
    fn upsampled_true_peak_of_full_scale_sine_stays_near_unity() {
        let mut os = Oversampler4x::new();
        let mut peak = 0.0_f32;
        for n in 0..4800 {
            for s in os.upsample(sine_1khz(n)) {
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
