//! Mastering metering — LUFS (ITU-R BS.1770), LRA, true peak, crest factor.

use crate::primitives::{flush_denormal, flush_denormal_f64};

/// K-weighting pre-filter for LUFS measurement.
/// Two cascaded biquads: high-frequency shelf + highpass (RLB weighting).
pub struct KWeightingFilter {
    // Stage 1: shelf
    s1_x1: f64,
    s1_x2: f64,
    s1_y1: f64,
    s1_y2: f64,
    s1_b0: f64,
    s1_b1: f64,
    s1_b2: f64,
    s1_a1: f64,
    s1_a2: f64,
    // Stage 2: highpass
    s2_x1: f64,
    s2_x2: f64,
    s2_y1: f64,
    s2_y2: f64,
    s2_b0: f64,
    s2_b1: f64,
    s2_b2: f64,
    s2_a1: f64,
    s2_a2: f64,
}

impl KWeightingFilter {
    /// Create K-weighting filter for the given sample rate.
    /// Uses exact ITU-R BS.1770 coefficients for 48kHz, bilinear pre-warp for other rates.
    pub fn new(sr: f64) -> Self {
        if (sr - 48000.0).abs() < 1.0 {
            // Exact coefficients from ITU-R BS.1770-4 for 48kHz
            Self {
                s1_x1: 0.0,
                s1_x2: 0.0,
                s1_y1: 0.0,
                s1_y2: 0.0,
                s1_b0: 1.53512485958697,
                s1_b1: -2.69169618940638,
                s1_b2: 1.19839281085285,
                s1_a1: -1.69065929318241,
                s1_a2: 0.73248077421585,

                s2_x1: 0.0,
                s2_x2: 0.0,
                s2_y1: 0.0,
                s2_y2: 0.0,
                s2_b0: 1.0,
                s2_b1: -2.0,
                s2_b2: 1.0,
                s2_a1: -1.99004745483398,
                s2_a2: 0.99007225036688,
            }
        } else {
            // Approximate via bilinear pre-warp from 48kHz reference
            let ratio = 48000.0 / sr;
            Self {
                s1_x1: 0.0,
                s1_x2: 0.0,
                s1_y1: 0.0,
                s1_y2: 0.0,
                s1_b0: 1.53512485958697,
                s1_b1: -2.69169618940638 * ratio,
                s1_b2: 1.19839281085285 * ratio * ratio,
                s1_a1: -1.69065929318241 * ratio,
                s1_a2: 0.73248077421585 * ratio * ratio,

                s2_x1: 0.0,
                s2_x2: 0.0,
                s2_y1: 0.0,
                s2_y2: 0.0,
                s2_b0: 1.0,
                s2_b1: -2.0,
                s2_b2: 1.0,
                s2_a1: -1.99004745483398 * ratio,
                s2_a2: 0.99007225036688 * ratio * ratio,
            }
        }
    }

    #[inline]
    pub fn process(&mut self, x: f64) -> f64 {
        // Stage 1. DSP-2: both stages are recursive and this filter runs on the
        // audio thread for every Proof instance (four per chain), so a silent
        // passage drives all four y-state words into the subnormal range.
        let y1 = flush_denormal_f64(
            self.s1_b0 * x + self.s1_b1 * self.s1_x1 + self.s1_b2 * self.s1_x2
                - self.s1_a1 * self.s1_y1
                - self.s1_a2 * self.s1_y2,
        );
        self.s1_x2 = self.s1_x1;
        self.s1_x1 = x;
        self.s1_y2 = self.s1_y1;
        self.s1_y1 = y1;

        // Stage 2 — the RLB highpass, whose pole sits at ~0.995, so it decays
        // slowest of anything in the metering path.
        let y2 = flush_denormal_f64(
            self.s2_b0 * y1 + self.s2_b1 * self.s2_x1 + self.s2_b2 * self.s2_x2
                - self.s2_a1 * self.s2_y1
                - self.s2_a2 * self.s2_y2,
        );
        self.s2_x2 = self.s2_x1;
        self.s2_x1 = y1;
        self.s2_y2 = self.s2_y1;
        self.s2_y1 = y2;

        y2
    }

    pub fn reset(&mut self) {
        self.s1_x1 = 0.0;
        self.s1_x2 = 0.0;
        self.s1_y1 = 0.0;
        self.s1_y2 = 0.0;
        self.s2_x1 = 0.0;
        self.s2_x2 = 0.0;
        self.s2_y1 = 0.0;
        self.s2_y2 = 0.0;
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
        if mean_sq < 1e-20 {
            return -100.0;
        }
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
        if mean_sq < 1e-20 {
            return -100.0;
        }
        (-0.691 + 10.0 * mean_sq.log10()) as f32
    }
}

/// Integrated LUFS with gating (ITU-R BS.1770-4).
/// Lower edge of the histogram — the EBU R128 absolute gate. Blocks at or below
/// it are discarded by both measures anyway, so they are never stored.
const LOUDNESS_HISTOGRAM_MIN_LUFS: f32 = -70.0;
/// Bin width.
///
/// This is finer than the half-bin error on a single block would suggest it
/// needs to be, because the error does not stay bounded by the bin width: the
/// relative gate's threshold is derived from the mean of the *quantized*
/// blocks, so shifting the mean by half a bin moves the threshold and flips
/// blocks in and out of the gated set. At 0.1 LU that measured 0.134 LU of
/// error on integrated loudness and 0.42 LU on LRA -- at or above the 0.1 LU
/// resolution both are displayed at. At 0.01 LU it is an order of magnitude
/// under it.
const LOUDNESS_HISTOGRAM_BIN_LU: f32 = 0.01;
/// Covers -70.0 LUFS up to +10.0 LUFS; anything louder saturates the top bin.
/// 32 KB per histogram, fixed — against the ~1.1 MiB per hour the unbounded
/// block list grew by.
const LOUDNESS_HISTOGRAM_BINS: usize = 8_000;

/// Fixed-size distribution of 100 ms block loudnesses (WB-7).
///
/// Both R128 measures are defined over the whole programme, so the obvious
/// implementation keeps every block in a growing `Vec`. That allocates on the
/// audio thread and grows without bound — measured at roughly 1.1 MiB per hour
/// of wasm linear memory, with a realloc memcpy of the whole vector at each
/// doubling, plus session-length `collect()`s and a sort on every poll.
///
/// A histogram answers everything both measures need — a mean over a gated
/// subset, and rank-order percentiles — from counts alone. It is O(1) in
/// memory, allocation-free, sort-free, and unlike a ring buffer it puts no
/// ceiling on how long a programme can be measured.
#[derive(Clone)]
struct LoudnessHistogram {
    counts: [u32; LOUDNESS_HISTOGRAM_BINS],
    total: u64,
    /// Inclusive range of bins that have ever been written, so the scans below
    /// cost what the programme's actual loudness spread costs rather than the
    /// full 8000 bins on every poll.
    lowest: usize,
    highest: usize,
}

impl LoudnessHistogram {
    fn new() -> Self {
        Self {
            counts: [0; LOUDNESS_HISTOGRAM_BINS],
            total: 0,
            lowest: LOUDNESS_HISTOGRAM_BINS - 1,
            highest: 0,
        }
    }

    /// Bins that have been written to, in ascending loudness order. Empty
    /// while nothing has been recorded.
    fn occupied(&self) -> core::ops::Range<usize> {
        if self.total == 0 {
            return 0..0;
        }
        self.lowest..self.highest + 1
    }

    /// Record one block. Written as `>` rather than `>=` to match the
    /// absolute gate's own comparison, and to drop NaN.
    fn push(&mut self, lufs: f32) {
        if !(lufs > LOUDNESS_HISTOGRAM_MIN_LUFS) {
            return;
        }
        let offset = (lufs - LOUDNESS_HISTOGRAM_MIN_LUFS) / LOUDNESS_HISTOGRAM_BIN_LU;
        let index = (offset as usize).min(LOUDNESS_HISTOGRAM_BINS - 1);
        self.counts[index] += 1;
        self.total += 1;
        self.lowest = self.lowest.min(index);
        self.highest = self.highest.max(index);
    }

    fn bin_loudness(index: usize) -> f32 {
        LOUDNESS_HISTOGRAM_MIN_LUFS + (index as f32 + 0.5) * LOUDNESS_HISTOGRAM_BIN_LU
    }

    fn is_empty(&self) -> bool {
        self.total == 0
    }

    /// Mean loudness across every block louder than `threshold`.
    fn mean_above(&self, threshold: f32) -> Option<f32> {
        let mut weighted = 0.0_f64;
        let mut counted = 0_u64;
        for index in self.occupied() {
            let count = self.counts[index];
            if count == 0 {
                continue;
            }
            let loudness = Self::bin_loudness(index);
            if loudness > threshold {
                weighted += f64::from(loudness) * f64::from(count);
                counted += u64::from(count);
            }
        }
        if counted == 0 {
            return None;
        }
        Some((weighted / counted as f64) as f32)
    }

    fn count_above(&self, threshold: f32) -> u64 {
        let mut counted = 0_u64;
        for index in self.occupied() {
            let count = self.counts[index];
            if count > 0 && Self::bin_loudness(index) > threshold {
                counted += u64::from(count);
            }
        }
        counted
    }

    /// Loudness of the block at zero-based `rank` when the blocks louder than
    /// `threshold` are ordered quietest-first. Bins are already in ascending
    /// loudness order, so this is the sorted index the previous `Vec`-and-sort
    /// implementation looked up, without the sort.
    fn loudness_at_rank_above(&self, threshold: f32, rank: u64) -> Option<f32> {
        let mut seen = 0_u64;
        for index in self.occupied() {
            let count = self.counts[index];
            if count == 0 {
                continue;
            }
            let loudness = Self::bin_loudness(index);
            if loudness <= threshold {
                continue;
            }
            seen += u64::from(count);
            if seen > rank {
                return Some(loudness);
            }
        }
        None
    }

    fn clear(&mut self) {
        self.counts = [0; LOUDNESS_HISTOGRAM_BINS];
        self.total = 0;
        self.lowest = LOUDNESS_HISTOGRAM_BINS - 1;
        self.highest = 0;
    }
}

pub struct IntegratedLufs {
    momentary: MomentaryLufs,
    /// Distribution of 400 ms block loudnesses (WB-7: was an unbounded `Vec`
    /// pushed to from the audio thread).
    blocks: LoudnessHistogram,
    hop_counter: usize,
    hop_size: usize, // 100ms hop
}

impl IntegratedLufs {
    pub fn new(sr: f64) -> Self {
        let hop_size = (0.1 * sr) as usize;
        Self {
            momentary: MomentaryLufs::new(sr),
            blocks: LoudnessHistogram::new(),
            hop_counter: 0,
            hop_size,
        }
    }

    pub fn process_sample(&mut self, l: f32, r: f32) {
        self.momentary.process_sample(l, r);
        self.hop_counter += 1;
        if self.hop_counter >= self.hop_size {
            self.hop_counter = 0;
            self.blocks.push(self.momentary.get_lufs());
        }
    }

    /// Gated integrated loudness, allocation-free (WB-7): the worklet polls
    /// this from inside `process()`, so it must not collect or sort.
    pub fn get_lufs(&self) -> f32 {
        if self.blocks.is_empty() {
            return -100.0;
        }

        // Absolute gate: -70 LUFS. Applied on the way in, so everything the
        // histogram holds is already above it.
        let Some(mean_absolute) = self.blocks.mean_above(f32::NEG_INFINITY) else {
            return -100.0;
        };

        // Relative gate: 10 LU below the mean of the above-absolute set.
        let relative_threshold = mean_absolute - 10.0;
        self.blocks.mean_above(relative_threshold).unwrap_or(-100.0)
    }

    pub fn reset(&mut self) {
        self.blocks.clear();
        self.hop_counter = 0;
    }
}

/// True peak detector — 4x oversampled peak measurement per ITU-R BS.1770.
///
/// Runs the recommendation's own 4x polyphase interpolation filter
/// (`super::true_peak`), the same reconstruction the limiter's gain computer
/// detects with, so the dBTP the meter shows and the dBTP the limiter enforces
/// come from one filter.
pub struct TruePeakDetector {
    peak: f32,
    os_l: super::true_peak::TruePeakUpsampler,
    os_r: super::true_peak::TruePeakUpsampler,
}

impl TruePeakDetector {
    pub fn new() -> Self {
        Self {
            peak: 0.0,
            os_l: super::true_peak::TruePeakUpsampler::new(),
            os_r: super::true_peak::TruePeakUpsampler::new(),
        }
    }

    pub fn process_sample(&mut self, l: f32, r: f32) {
        // Reconstructed inter-sample peak, floored at the sample magnitude so
        // the reading is never optimistic where the 4x filter reads low.
        let reconstructed = self.os_l.push_max_abs(l).max(self.os_r.push_max_abs(r));
        let peak = reconstructed.max(l.abs()).max(r.abs());
        if peak > self.peak {
            self.peak = peak;
        }
    }

    pub fn get_true_peak_db(&self) -> f32 {
        if self.peak > 1e-10 {
            20.0 * self.peak.log10()
        } else {
            -100.0
        }
    }

    pub fn reset(&mut self) {
        self.peak = 0.0;
        self.os_l.reset();
        self.os_r.reset();
    }
}

/// Loudness Range (LRA) — EBU R128.
/// Computed from short-term LUFS blocks using percentile method.
pub struct LoudnessRange {
    st_lufs: ShortTermLufs,
    /// Distribution of short-term block loudnesses (WB-7: was an unbounded
    /// `Vec` that `get_lra` also sorted, both on the audio thread).
    blocks: LoudnessHistogram,
    hop_counter: usize,
    hop_size: usize,
}

impl LoudnessRange {
    pub fn new(sr: f64) -> Self {
        let hop_size = (0.1 * sr) as usize; // 100ms hop
        Self {
            st_lufs: ShortTermLufs::new(sr),
            blocks: LoudnessHistogram::new(),
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

    /// LRA in LU (loudness units), allocation-free and sort-free (WB-7).
    pub fn get_lra(&self) -> f32 {
        if self.blocks.total < 2 {
            return 0.0;
        }

        // Absolute gate: -70 LUFS, applied on the way in.
        let Some(mean) = self.blocks.mean_above(f32::NEG_INFINITY) else {
            return 0.0;
        };

        // Relative gate: 20 LU below the mean of the above-absolute set.
        let relative_threshold = mean - 20.0;
        let n = self.blocks.count_above(relative_threshold);
        if n < 2 {
            return 0.0;
        }

        // Same nearest-rank percentiles the sorted vector was indexed at.
        let p10_rank = (n as f32 * 0.10) as u64;
        let p95_rank = ((n as f32 * 0.95) as u64).min(n - 1);
        let low = self.blocks.loudness_at_rank_above(relative_threshold, p10_rank);
        let high = self.blocks.loudness_at_rank_above(relative_threshold, p95_rank);
        match (low, high) {
            (Some(low), Some(high)) => high - low,
            _ => 0.0,
        }
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
            peak_l: 0.0,
            peak_r: 0.0,
            rms_sq_l: 0.0,
            rms_sq_r: 0.0,
            coeff: (-1.0 / (0.3 * sr)).exp(), // 300ms window
        }
    }

    #[inline]
    pub fn process(&mut self, l: f32, r: f32) {
        let al = l.abs();
        let ar = r.abs();
        if al > self.peak_l {
            self.peak_l = al;
        } else {
            self.peak_l = flush_denormal(self.peak_l * 0.9995);
        }
        if ar > self.peak_r {
            self.peak_r = ar;
        } else {
            self.peak_r = flush_denormal(self.peak_r * 0.9995);
        }
        // DSP-2: squared signal, so this underflows about twice as fast as a
        // linear follower. Runs per sample for every tap in the chain.
        self.rms_sq_l = flush_denormal(self.coeff * self.rms_sq_l + (1.0 - self.coeff) * l * l);
        self.rms_sq_r = flush_denormal(self.coeff * self.rms_sq_r + (1.0 - self.coeff) * r * r);
    }

    pub fn peak_db_l(&self) -> f32 {
        if self.peak_l > 1e-10 {
            20.0 * self.peak_l.log10()
        } else {
            -100.0
        }
    }
    pub fn peak_db_r(&self) -> f32 {
        if self.peak_r > 1e-10 {
            20.0 * self.peak_r.log10()
        } else {
            -100.0
        }
    }
    pub fn rms_db_l(&self) -> f32 {
        if self.rms_sq_l > 1e-20 {
            10.0 * self.rms_sq_l.log10()
        } else {
            -100.0
        }
    }
    pub fn rms_db_r(&self) -> f32 {
        if self.rms_sq_r > 1e-20 {
            10.0 * self.rms_sq_r.log10()
        } else {
            -100.0
        }
    }
}

#[cfg(test)]
mod denormal_tests {
    use super::KWeightingFilter;

    /// Unguarded twin of `KWeightingFilter::process` — what it was before
    /// DSP-2. Kept here so the failure mode is demonstrated, not asserted from
    /// memory. Coefficients are the exact ITU-R BS.1770-4 48 kHz set.
    #[derive(Default)]
    struct UnguardedKWeighting {
        s1_x1: f64,
        s1_x2: f64,
        s1_y1: f64,
        s1_y2: f64,
        s2_x1: f64,
        s2_x2: f64,
        s2_y1: f64,
        s2_y2: f64,
    }

    const S1: [f64; 5] = [
        1.535_124_859_586_97,
        -2.691_696_189_406_38,
        1.198_392_810_852_85,
        -1.690_659_293_182_41,
        0.732_480_774_215_85,
    ];
    const S2: [f64; 5] = [
        1.0,
        -2.0,
        1.0,
        -1.990_047_454_833_98,
        0.990_072_250_366_88,
    ];

    impl UnguardedKWeighting {
        fn process(&mut self, x: f64) -> f64 {
            let y1 = S1[0] * x + S1[1] * self.s1_x1 + S1[2] * self.s1_x2
                - S1[3] * self.s1_y1
                - S1[4] * self.s1_y2;
            self.s1_x2 = self.s1_x1;
            self.s1_x1 = x;
            self.s1_y2 = self.s1_y1;
            self.s1_y1 = y1;

            let y2 = S2[0] * y1 + S2[1] * self.s2_x1 + S2[2] * self.s2_x2
                - S2[3] * self.s2_y1
                - S2[4] * self.s2_y2;
            self.s2_x2 = self.s2_x1;
            self.s2_x1 = y1;
            self.s2_y2 = self.s2_y1;
            self.s2_y1 = y2;

            y2
        }
    }

    /// The RLB highpass pole sits at ~0.995, so the tail is long. f64 has to
    /// fall ~308 decades to reach subnormal, which needs a big silent run.
    const SILENT_TAIL: usize = 400_000;

    #[test]
    fn unguarded_k_weighting_decays_into_the_subnormal_range() {
        let mut unguarded = UnguardedKWeighting::default();
        unguarded.process(1.0);

        let mut first_subnormal = None;
        for _ in 0..SILENT_TAIL {
            let out = unguarded.process(0.0);
            if out != 0.0 && !out.is_normal() && first_subnormal.is_none() {
                first_subnormal = Some(out);
            }
        }

        let value = first_subnormal.expect(
            "the unguarded K-weighting filter fed to silence must land in the \
             subnormal range — if it stops doing so the guard test below is vacuous",
        );
        assert!(
            value.abs() < f64::MIN_POSITIVE,
            "raw unguarded state {value:e} must be below the f64 normal boundary {:e}",
            f64::MIN_POSITIVE
        );
        assert!(value != 0.0, "raw unguarded state must be a nonzero subnormal");
        assert!(
            !unguarded.s2_y1.is_normal() && unguarded.s2_y1 != 0.0,
            "the stored stage-2 state ends subnormal, not just one output sample"
        );
    }

    #[test]
    fn guarded_k_weighting_flushes_to_exact_zero() {
        let mut guarded = KWeightingFilter::new(48_000.0);
        guarded.process(1.0);

        for _ in 0..SILENT_TAIL {
            let out = guarded.process(0.0);
            assert!(
                out == 0.0 || out.is_normal(),
                "guarded K-weighting output {out:e} must never be subnormal"
            );
        }

        assert_eq!(guarded.s1_y1, 0.0, "stage-1 state must reach exact zero");
        assert_eq!(guarded.s1_y2, 0.0);
        assert_eq!(guarded.s2_y1, 0.0, "stage-2 state must reach exact zero");
        assert_eq!(guarded.s2_y2, 0.0);
    }

    #[test]
    fn k_weighting_guard_is_bit_exact_in_normal_range() {
        let mut guarded = KWeightingFilter::new(48_000.0);
        let mut unguarded = UnguardedKWeighting::default();

        let mut compared = 0;
        for index in 0..SILENT_TAIL {
            let input = if index == 0 { 1.0 } else { 0.0 };
            let reference = unguarded.process(input);
            let actual = guarded.process(input);
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
            compared > 1_000,
            "expected a long normal-range run to compare, got {compared} samples"
        );
    }
}

#[cfg(test)]
mod loudness_histogram_tests {
    //! WB-7. The histogram replaces an unbounded block list, so the risk is not
    //! memory but arithmetic: it must produce the same gated loudness and the
    //! same percentiles the `Vec`-and-sort implementation did. These compare it
    //! against that exact algorithm, kept here verbatim as the reference.

    use super::{IntegratedLufs, LoudnessHistogram, LoudnessRange};

    /// The previous `IntegratedLufs::get_lufs`, unchanged.
    fn reference_integrated(blocks: &[f32]) -> f32 {
        if blocks.is_empty() {
            return -100.0;
        }
        let above_absolute: Vec<f64> = blocks
            .iter()
            .map(|&b| f64::from(b))
            .filter(|&b| b > -70.0)
            .collect();
        if above_absolute.is_empty() {
            return -100.0;
        }
        let mean_abs = above_absolute.iter().sum::<f64>() / above_absolute.len() as f64;
        let rel_threshold = mean_abs - 10.0;
        let above_relative: Vec<f64> = above_absolute
            .iter()
            .copied()
            .filter(|&b| b > rel_threshold)
            .collect();
        if above_relative.is_empty() {
            return -100.0;
        }
        (above_relative.iter().sum::<f64>() / above_relative.len() as f64) as f32
    }

    /// The previous `LoudnessRange::get_lra`, unchanged.
    fn reference_lra(blocks: &[f32]) -> f32 {
        if blocks.len() < 2 {
            return 0.0;
        }
        let mut above_abs: Vec<f32> = blocks.iter().copied().filter(|&b| b > -70.0).collect();
        if above_abs.is_empty() {
            return 0.0;
        }
        let mean: f32 = above_abs.iter().sum::<f32>() / above_abs.len() as f32;
        let rel_threshold = mean - 20.0;
        let mut above_rel: Vec<f32> = above_abs.drain(..).filter(|&b| b > rel_threshold).collect();
        if above_rel.len() < 2 {
            return 0.0;
        }
        above_rel.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let n = above_rel.len();
        let p10_idx = (n as f32 * 0.10) as usize;
        let p95_idx = ((n as f32 * 0.95) as usize).min(n - 1);
        above_rel[p95_idx] - above_rel[p10_idx]
    }

    fn histogram_of(blocks: &[f32]) -> LoudnessHistogram {
        let mut h = LoudnessHistogram::new();
        for &b in blocks {
            h.push(b);
        }
        h
    }

    fn histogram_integrated(blocks: &[f32]) -> f32 {
        let h = histogram_of(blocks);
        if h.is_empty() {
            return -100.0;
        }
        let Some(mean_absolute) = h.mean_above(f32::NEG_INFINITY) else {
            return -100.0;
        };
        h.mean_above(mean_absolute - 10.0).unwrap_or(-100.0)
    }

    fn histogram_lra(blocks: &[f32]) -> f32 {
        let h = histogram_of(blocks);
        if h.total < 2 {
            return 0.0;
        }
        let Some(mean) = h.mean_above(f32::NEG_INFINITY) else {
            return 0.0;
        };
        let threshold = mean - 20.0;
        let n = h.count_above(threshold);
        if n < 2 {
            return 0.0;
        }
        let p10 = (n as f32 * 0.10) as u64;
        let p95 = ((n as f32 * 0.95) as u64).min(n - 1);
        match (
            h.loudness_at_rank_above(threshold, p10),
            h.loudness_at_rank_above(threshold, p95),
        ) {
            (Some(low), Some(high)) => high - low,
            _ => 0.0,
        }
    }

    /// Deterministic spread of block loudnesses across the useful range,
    /// including values under the absolute gate that both must discard.
    fn synthetic_blocks(count: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        (0..count)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let unit = f32::from((state >> 16) as u16) / 65_535.0;
                // -80 .. -4 LUFS, so roughly a tenth land under the -70 gate.
                -80.0 + unit * 76.0
            })
            .collect()
    }

    /// Comfortably inside the 0.1 LU resolution either measure is displayed
    /// at, and roughly an order of magnitude better than the 0.1 LU bin width
    /// this replaced measured (0.134 LU integrated, 0.42 LU LRA).
    const BIN_TOLERANCE_LU: f32 = 0.02;

    #[test]
    fn integrated_loudness_matches_the_unbounded_reference() {
        for seed in [1_u32, 7, 99, 4_242] {
            for count in [12_usize, 300, 36_000] {
                let blocks = synthetic_blocks(count, seed);
                let expected = reference_integrated(&blocks);
                let actual = histogram_integrated(&blocks);
                assert!(
                    (actual - expected).abs() <= BIN_TOLERANCE_LU,
                    "seed {seed}, {count} blocks: histogram {actual:.4} LUFS vs unbounded \
                     reference {expected:.4} LUFS"
                );
            }
        }
    }

    #[test]
    fn loudness_range_matches_the_unbounded_reference() {
        for seed in [1_u32, 7, 99, 4_242] {
            for count in [12_usize, 300, 36_000] {
                let blocks = synthetic_blocks(count, seed);
                let expected = reference_lra(&blocks);
                let actual = histogram_lra(&blocks);
                        // Two rank lookups, so up to two bins of quantization.
                assert!(
                    (actual - expected).abs() <= 4.0 * BIN_TOLERANCE_LU,
                    "seed {seed}, {count} blocks: histogram LRA {actual:.4} LU vs unbounded \
                     reference {expected:.4} LU"
                );
            }
        }
    }

    #[test]
    fn blocks_under_the_absolute_gate_are_discarded_not_stored() {
        let mut h = LoudnessHistogram::new();
        h.push(-70.0); // exactly at the gate — the gate is `>`, so excluded
        h.push(-90.0);
        h.push(f32::NAN);
        assert!(h.is_empty(), "gated blocks must not be counted");
        h.push(-69.9);
        assert_eq!(h.total, 1);
    }

    #[test]
    fn loudness_above_the_top_bin_saturates_instead_of_indexing_out_of_range() {
        let mut h = LoudnessHistogram::new();
        h.push(1_000.0);
        assert_eq!(h.total, 1);
        let mean = h.mean_above(f32::NEG_INFINITY).expect("one block recorded");
        assert!(mean > 9.0, "a saturating block lands in the top bin, got {mean}");
    }

    #[test]
    fn a_steady_level_integrates_to_that_level() {
        // End-to-end through the real meter rather than the helpers: a constant
        // programme must integrate to its own loudness.
        let sr = 48_000.0;
        let mut meter = IntegratedLufs::new(sr);
        for n in 0..(sr as usize * 4) {
            let s = 0.5 * (2.0 * core::f64::consts::PI * 1_000.0 * n as f64 / sr).sin();
            meter.process_sample(s as f32, s as f32);
        }
        let integrated = meter.get_lufs();
        assert!(
            (-20.0..-6.0).contains(&integrated),
            "a steady -6 dBFS 1 kHz tone should integrate to a plausible LUFS, got {integrated}"
        );

        // Reset must actually clear the distribution, not just the counter.
        meter.reset();
        assert_eq!(meter.get_lufs(), -100.0);
    }

    #[test]
    fn alternating_levels_produce_a_loudness_range_near_their_separation() {
        let sr = 48_000.0;
        let mut meter = LoudnessRange::new(sr);
        // Alternate every 8 s so the short-term meter's own 3 s window settles
        // fully at each level; shorter blocks measure the meter's smoothing
        // rather than the programme's range.
        for n in 0..(sr as usize * 32) {
            let loud = (n / (sr as usize * 8)) % 2 == 0;
            let amp = if loud { 0.5 } else { 0.05 };
            let s = amp * (2.0 * core::f64::consts::PI * 1_000.0 * n as f64 / sr).sin();
            meter.process_sample(s as f32, s as f32);
        }
        let lra = meter.get_lra();
        assert!(
            (10.0..30.0).contains(&lra),
            "alternating 20 dB apart should give an LRA near 20 LU, got {lra}"
        );

        meter.reset();
        assert_eq!(meter.get_lra(), 0.0);
    }
}
