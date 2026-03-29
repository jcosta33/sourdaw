//! Mastering metering — LUFS (ITU-R BS.1770), LRA, true peak, crest factor.

/// K-weighting pre-filter for LUFS measurement.
/// Two cascaded biquads: high-frequency shelf + highpass (RLB weighting).
pub struct KWeightingFilter {
    // Stage 1: shelf
    s1_x1: f64, s1_x2: f64, s1_y1: f64, s1_y2: f64,
    s1_b0: f64, s1_b1: f64, s1_b2: f64, s1_a1: f64, s1_a2: f64,
    // Stage 2: highpass
    s2_x1: f64, s2_x2: f64, s2_y1: f64, s2_y2: f64,
    s2_b0: f64, s2_b1: f64, s2_b2: f64, s2_a1: f64, s2_a2: f64,
}

impl KWeightingFilter {
    /// Create K-weighting filter for the given sample rate.
    /// Uses exact ITU-R BS.1770 coefficients for 48kHz, bilinear pre-warp for other rates.
    pub fn new(sr: f64) -> Self {
        if (sr - 48000.0).abs() < 1.0 {
            // Exact coefficients from ITU-R BS.1770-4 for 48kHz
            Self {
                s1_x1: 0.0, s1_x2: 0.0, s1_y1: 0.0, s1_y2: 0.0,
                s1_b0: 1.53512485958697, s1_b1: -2.69169618940638, s1_b2: 1.19839281085285,
                s1_a1: -1.69065929318241, s1_a2: 0.73248077421585,

                s2_x1: 0.0, s2_x2: 0.0, s2_y1: 0.0, s2_y2: 0.0,
                s2_b0: 1.0, s2_b1: -2.0, s2_b2: 1.0,
                s2_a1: -1.99004745483398, s2_a2: 0.99007225036688,
            }
        } else {
            // Approximate via bilinear pre-warp from 48kHz reference
            let ratio = 48000.0 / sr;
            Self {
                s1_x1: 0.0, s1_x2: 0.0, s1_y1: 0.0, s1_y2: 0.0,
                s1_b0: 1.53512485958697, s1_b1: -2.69169618940638 * ratio, s1_b2: 1.19839281085285 * ratio * ratio,
                s1_a1: -1.69065929318241 * ratio, s1_a2: 0.73248077421585 * ratio * ratio,

                s2_x1: 0.0, s2_x2: 0.0, s2_y1: 0.0, s2_y2: 0.0,
                s2_b0: 1.0, s2_b1: -2.0, s2_b2: 1.0,
                s2_a1: -1.99004745483398 * ratio, s2_a2: 0.99007225036688 * ratio * ratio,
            }
        }
    }

    #[inline]
    pub fn process(&mut self, x: f64) -> f64 {
        // Stage 1
        let y1 = self.s1_b0 * x + self.s1_b1 * self.s1_x1 + self.s1_b2 * self.s1_x2
               - self.s1_a1 * self.s1_y1 - self.s1_a2 * self.s1_y2;
        self.s1_x2 = self.s1_x1; self.s1_x1 = x;
        self.s1_y2 = self.s1_y1; self.s1_y1 = y1;

        // Stage 2
        let y2 = self.s2_b0 * y1 + self.s2_b1 * self.s2_x1 + self.s2_b2 * self.s2_x2
               - self.s2_a1 * self.s2_y1 - self.s2_a2 * self.s2_y2;
        self.s2_x2 = self.s2_x1; self.s2_x1 = y1;
        self.s2_y2 = self.s2_y1; self.s2_y1 = y2;

        y2
    }

    pub fn reset(&mut self) {
        self.s1_x1 = 0.0; self.s1_x2 = 0.0; self.s1_y1 = 0.0; self.s1_y2 = 0.0;
        self.s2_x1 = 0.0; self.s2_x2 = 0.0; self.s2_y1 = 0.0; self.s2_y2 = 0.0;
    }
}

/// Momentary LUFS (400ms sliding window).
pub struct MomentaryLufs {
    k_l: KWeightingFilter,
    k_r: KWeightingFilter,
    buffer_l: Vec<f64>,
    buffer_r: Vec<f64>,
    write_pos: usize,
    window_size: usize,
    sum_sq_l: f64,
    sum_sq_r: f64,
}

impl MomentaryLufs {
    pub fn new(sr: f64) -> Self {
        let window_size = (0.4 * sr) as usize; // 400ms
        Self {
            k_l: KWeightingFilter::new(sr),
            k_r: KWeightingFilter::new(sr),
            buffer_l: vec![0.0; window_size],
            buffer_r: vec![0.0; window_size],
            write_pos: 0,
            window_size,
            sum_sq_l: 0.0,
            sum_sq_r: 0.0,
        }
    }

    #[inline]
    pub fn process_sample(&mut self, l: f32, r: f32) {
        let wl = self.k_l.process(l as f64);
        let wr = self.k_r.process(r as f64);

        // Remove oldest sample's contribution
        let old_l = self.buffer_l[self.write_pos];
        let old_r = self.buffer_r[self.write_pos];
        self.sum_sq_l -= old_l * old_l;
        self.sum_sq_r -= old_r * old_r;

        // Add new sample
        self.buffer_l[self.write_pos] = wl;
        self.buffer_r[self.write_pos] = wr;
        self.sum_sq_l += wl * wl;
        self.sum_sq_r += wr * wr;

        self.write_pos = (self.write_pos + 1) % self.window_size;
    }

    pub fn get_lufs(&self) -> f32 {
        let mean_sq = (self.sum_sq_l + self.sum_sq_r) / (2.0 * self.window_size as f64);
        if mean_sq < 1e-20 { return -100.0; }
        (-0.691 + 10.0 * mean_sq.log10()) as f32
    }
}

/// Short-term LUFS (3000ms sliding window).
pub struct ShortTermLufs {
    k_l: KWeightingFilter,
    k_r: KWeightingFilter,
    buffer_l: Vec<f64>,
    buffer_r: Vec<f64>,
    write_pos: usize,
    window_size: usize,
    sum_sq_l: f64,
    sum_sq_r: f64,
}

impl ShortTermLufs {
    pub fn new(sr: f64) -> Self {
        let window_size = (3.0 * sr) as usize;
        Self {
            k_l: KWeightingFilter::new(sr),
            k_r: KWeightingFilter::new(sr),
            buffer_l: vec![0.0; window_size],
            buffer_r: vec![0.0; window_size],
            write_pos: 0,
            window_size,
            sum_sq_l: 0.0,
            sum_sq_r: 0.0,
        }
    }

    #[inline]
    pub fn process_sample(&mut self, l: f32, r: f32) {
        let wl = self.k_l.process(l as f64);
        let wr = self.k_r.process(r as f64);
        let old_l = self.buffer_l[self.write_pos];
        let old_r = self.buffer_r[self.write_pos];
        self.sum_sq_l -= old_l * old_l;
        self.sum_sq_r -= old_r * old_r;
        self.buffer_l[self.write_pos] = wl;
        self.buffer_r[self.write_pos] = wr;
        self.sum_sq_l += wl * wl;
        self.sum_sq_r += wr * wr;
        self.write_pos = (self.write_pos + 1) % self.window_size;
    }

    pub fn get_lufs(&self) -> f32 {
        let mean_sq = (self.sum_sq_l + self.sum_sq_r) / (2.0 * self.window_size as f64);
        if mean_sq < 1e-20 { return -100.0; }
        (-0.691 + 10.0 * mean_sq.log10()) as f32
    }
}

/// Integrated LUFS with gating (ITU-R BS.1770-4).
pub struct IntegratedLufs {
    momentary: MomentaryLufs,
    blocks: Vec<f64>,           // loudness of each 400ms block
    hop_counter: usize,
    hop_size: usize,            // 100ms hop
}

impl IntegratedLufs {
    pub fn new(sr: f64) -> Self {
        let hop_size = (0.1 * sr) as usize;
        Self {
            momentary: MomentaryLufs::new(sr),
            blocks: Vec::new(),
            hop_counter: 0,
            hop_size,
        }
    }

    pub fn process_sample(&mut self, l: f32, r: f32) {
        self.momentary.process_sample(l, r);
        self.hop_counter += 1;
        if self.hop_counter >= self.hop_size {
            self.hop_counter = 0;
            let block_lufs = self.momentary.get_lufs() as f64;
            self.blocks.push(block_lufs);
        }
    }

    pub fn get_lufs(&self) -> f32 {
        if self.blocks.is_empty() { return -100.0; }

        // Absolute gate: -70 LUFS
        let above_absolute: Vec<f64> = self.blocks.iter()
            .copied().filter(|&b| b > -70.0).collect();
        if above_absolute.is_empty() { return -100.0; }

        // Relative gate: 10 LU below mean of above-absolute
        let mean_abs = above_absolute.iter().sum::<f64>() / above_absolute.len() as f64;
        let rel_threshold = mean_abs - 10.0;

        let above_relative: Vec<f64> = above_absolute.iter()
            .copied().filter(|&b| b > rel_threshold).collect();
        if above_relative.is_empty() { return -100.0; }

        (above_relative.iter().sum::<f64>() / above_relative.len() as f64) as f32
    }

    pub fn reset(&mut self) {
        self.blocks.clear();
        self.hop_counter = 0;
    }
}

/// True peak detector — 4x oversampled peak measurement per ITU-R BS.1770.
/// Uses a 4x FIR interpolation filter for inter-sample peak detection.
pub struct TruePeakDetector {
    peak: f32,
    os_l: super::oversample::Oversampler4x,
    os_r: super::oversample::Oversampler4x,
}

impl TruePeakDetector {
    pub fn new() -> Self {
        Self {
            peak: 0.0,
            os_l: super::oversample::Oversampler4x::new(),
            os_r: super::oversample::Oversampler4x::new(),
        }
    }

    pub fn process_sample(&mut self, l: f32, r: f32) {
        // 4x upsample and measure peak of all interpolated samples
        let up_l = self.os_l.upsample(l);
        let up_r = self.os_r.upsample(r);
        for k in 0..4 {
            let p = up_l[k].abs().max(up_r[k].abs());
            if p > self.peak { self.peak = p; }
        }
    }

    pub fn get_true_peak_db(&self) -> f32 {
        if self.peak > 1e-10 { 20.0 * self.peak.log10() } else { -100.0 }
    }

    pub fn reset(&mut self) {
        self.peak = 0.0;
    }
}

/// Loudness Range (LRA) — EBU R128.
/// Computed from short-term LUFS blocks using percentile method.
pub struct LoudnessRange {
    st_lufs: ShortTermLufs,
    blocks: Vec<f32>,
    hop_counter: usize,
    hop_size: usize,
}

impl LoudnessRange {
    pub fn new(sr: f64) -> Self {
        let hop_size = (0.1 * sr) as usize; // 100ms hop
        Self {
            st_lufs: ShortTermLufs::new(sr),
            blocks: Vec::new(),
            hop_counter: 0,
            hop_size,
        }
    }

    pub fn process_sample(&mut self, l: f32, r: f32) {
        self.st_lufs.process_sample(l, r);
        self.hop_counter += 1;
        if self.hop_counter >= self.hop_size {
            self.hop_counter = 0;
            self.blocks.push(self.st_lufs.get_lufs());
        }
    }

    /// Get LRA in LU (loudness units).
    pub fn get_lra(&self) -> f32 {
        if self.blocks.len() < 2 { return 0.0; }

        // Absolute gate: -70 LUFS
        let mut above_abs: Vec<f32> = self.blocks.iter()
            .copied().filter(|&b| b > -70.0).collect();
        if above_abs.is_empty() { return 0.0; }

        // Relative gate: -20 LU below mean of above-absolute
        let mean: f32 = above_abs.iter().sum::<f32>() / above_abs.len() as f32;
        let rel_threshold = mean - 20.0;

        let mut above_rel: Vec<f32> = above_abs.drain(..)
            .filter(|&b| b > rel_threshold).collect();
        if above_rel.len() < 2 { return 0.0; }

        // Sort and compute percentiles
        above_rel.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let n = above_rel.len();
        let p10_idx = (n as f32 * 0.10) as usize;
        let p95_idx = ((n as f32 * 0.95) as usize).min(n - 1);

        above_rel[p95_idx] - above_rel[p10_idx]
    }

    pub fn reset(&mut self) {
        self.blocks.clear();
        self.hop_counter = 0;
    }
}

/// Inline metering tap between processing modules.
pub struct MeterTap {
    peak_l: f32,
    peak_r: f32,
    rms_sq_l: f32,
    rms_sq_r: f32,
    coeff: f32,
}

impl MeterTap {
    pub fn new(sr: f32) -> Self {
        Self {
            peak_l: 0.0, peak_r: 0.0,
            rms_sq_l: 0.0, rms_sq_r: 0.0,
            coeff: (-1.0 / (0.3 * sr)).exp(), // 300ms window
        }
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) {
        let al = l.abs();
        let ar = r.abs();
        if al > self.peak_l { self.peak_l = al; } else { self.peak_l *= 0.9995; }
        if ar > self.peak_r { self.peak_r = ar; } else { self.peak_r *= 0.9995; }
        self.rms_sq_l = self.coeff * self.rms_sq_l + (1.0 - self.coeff) * l * l;
        self.rms_sq_r = self.coeff * self.rms_sq_r + (1.0 - self.coeff) * r * r;
    }

    pub fn peak_db_l(&self) -> f32 { if self.peak_l > 1e-10 { 20.0 * self.peak_l.log10() } else { -100.0 } }
    pub fn peak_db_r(&self) -> f32 { if self.peak_r > 1e-10 { 20.0 * self.peak_r.log10() } else { -100.0 } }
    pub fn rms_db_l(&self) -> f32 { if self.rms_sq_l > 1e-20 { 10.0 * self.rms_sq_l.log10() } else { -100.0 } }
    pub fn rms_db_r(&self) -> f32 { if self.rms_sq_r > 1e-20 { 10.0 * self.rms_sq_r.log10() } else { -100.0 } }
}
