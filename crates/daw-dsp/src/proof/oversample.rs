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

/// 2x oversampler for a single channel.
pub struct Oversampler2x {
    delay_line: [f32; HALFBAND_TAPS],
    pos: usize,
}

impl Oversampler2x {
    pub fn new() -> Self {
        Self {
            delay_line: [0.0; HALFBAND_TAPS],
            pos: 0,
        }
    }

    /// Upsample: insert zero between each sample, then filter.
    /// Input: 1 sample. Output: 2 samples at double rate.
    #[inline]
    pub fn upsample(&mut self, x: f32) -> (f32, f32) {
        // Insert sample and zero into delay line
        self.delay_line[self.pos] = x * 2.0; // compensate for zero-stuffing gain loss
        self.pos = (self.pos + 1) % HALFBAND_TAPS;

        // Filter at position 0 (original sample location)
        let mut sum_even = 0.0_f32;
        for (i, &c) in HALFBAND_COEFFS.iter().enumerate() {
            let idx = (self.pos + i) % HALFBAND_TAPS;
            sum_even += self.delay_line[idx] * c;
        }

        // Filter at position 0.5 (interpolated sample location)
        // For half-band, the odd-position output only uses non-zero taps
        let mut sum_odd = 0.0_f32;
        for (i, &c) in HALFBAND_COEFFS.iter().enumerate() {
            if c != 0.0 {
                let idx = (self.pos + HALFBAND_TAPS - 1 - i) % HALFBAND_TAPS;
                sum_odd += self.delay_line[idx] * c;
            }
        }

        (sum_even, sum_odd)
    }

    /// Downsample: filter then decimate by 2.
    /// Input: 2 samples at double rate. Output: 1 sample.
    #[inline]
    pub fn downsample(&mut self, s0: f32, s1: f32) -> f32 {
        // Process both samples through the anti-alias filter
        self.delay_line[self.pos] = s0;
        self.pos = (self.pos + 1) % HALFBAND_TAPS;
        self.delay_line[self.pos] = s1;
        self.pos = (self.pos + 1) % HALFBAND_TAPS;

        // Read filtered output (decimate — take every other sample)
        let mut sum = 0.0_f32;
        for (i, &c) in HALFBAND_COEFFS.iter().enumerate() {
            let idx = (self.pos + i) % HALFBAND_TAPS;
            sum += self.delay_line[idx] * c;
        }
        sum
    }

    pub fn reset(&mut self) {
        self.delay_line = [0.0; HALFBAND_TAPS];
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
