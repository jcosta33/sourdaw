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
/// Blocks retained for the gated loudness measures — one hour at one block per
/// 100 ms.
///
/// This is a *capacity*, not a measurement window: past it the store keeps a
/// uniform random sample rather than forgetting, so the whole programme stays
/// represented (see [`BlockStore::push`]).
const MAX_LOUDNESS_BLOCKS: usize = 36_000;

/// Exact, fixed-capacity store of 100 ms block loudnesses (WB-7).
///
/// **Why not a histogram.** The first shape of this fix binned block loudness
/// at 0.01 LU and answered both measures from counts. That cannot preserve gate
/// accuracy, and the reason is structural rather than a matter of bin width:
/// the relative gate's threshold is derived from the data, so a bucket the
/// threshold lands inside must be decided as a unit, while the reference
/// decides its members individually. Bin width bounds the *value* error; it
/// does not bound the *classification* error, whose size scales with how many
/// blocks share the straddling bucket. Uniformly-spread material hides this —
/// every bucket holds a handful of blocks. Ordinary programme material does
/// not: a quiet section and a loud section are two tight clusters, and when one
/// sits near the gate the histogram flips it wholesale. Measured on 800 blocks
/// near −30 LUFS against 200 near +20 LUFS, integrated loudness diverged by up
/// to **45.21 LU** and LRA by **10.04 LU** — a mastering meter reading a wrong
/// loudness by tens of LU.
///
/// Keeping the values exact removes the question entirely: the read path is the
/// reference algorithm over a preallocated array, so equivalence is by
/// construction rather than by tolerance.
///
/// # What this store guarantees
///
/// 1. **Up to [`MAX_LOUDNESS_BLOCKS`], every block is retained, in order.** Both
///    measures are then exactly what they would be computed over the whole
///    sequence — not approximately. *To check:* push any number of blocks up to
///    capacity and compare the stored slice against the input; they are equal.
///
/// 2. **Past capacity, the retained set is a uniform random sample of every
///    block offered, and selection does not depend on a block's position in the
///    stream.** *To check:* feed a periodic sequence — one loud block every `p`,
///    offset by any phase — for several times capacity, and count how many of
///    each population survive. Each should be retained in proportion to how
///    often it occurs, for every `p` and every phase.
///
/// # What it does not guarantee
///
/// 3. **Exactness past capacity.** Both measures become estimates from the
///    sample. The error shrinks as 1/√n and has no preferred direction, but it
///    is not zero: across 34 period/phase combinations over six hours the worst
///    observed divergence was 0.146 LU.
///
/// 4. **Stability where a whole population sits on the relative gate.** If a
///    large group of blocks lands within a hair of the gate threshold, an
///    arbitrarily small change decides all of them at once and the answer jumps.
///    That discontinuity belongs to the gated measure itself, not to this store:
///    perturbing the *input* by 0.01 LU moves the exact answer by more than
///    10 LU at such a point. No sampling scheme can be stable there. *To check:*
///    compare each block value against the relative threshold; if the nearest is
///    closer than the sampling error can resolve, the configuration is degenerate.
///
/// # Why selection must ignore position
///
/// Guarantee 2 is load-bearing and easy to lose. Any "keep every Nth block"
/// reduction — whether gating the incoming stream or halving the stored array —
/// selects by position, and against periodic material that phase-locks: it
/// retains one phase and can retain **none** of another. Concretely, six hours of
/// blocks alternating −40 and 0 LUFS under a keep-every-other reduction retained
/// 27,000 samples that were *all* −40, reporting −40.0000 LUFS where the true
/// value is 0.0000 — the louder phase, which is the population that actually
/// clears the relative gate, deleted outright. That is not lost resolution, it is
/// total bias, and periodic loudness at a small multiple of the 100 ms block rate
/// is ordinary material: sidechain pumping, rhythmic gating, tremolo, a looped
/// test tone.
///
/// Reservoir sampling (Vitter's Algorithm R) is used because its selection
/// probability depends only on how many blocks have been seen, never on where a
/// block sat, so no periodicity in the input can favour one phase over another.
///
/// **Allocation-free.** The backing store is sized once in [`Self::new`]; past
/// capacity `push` overwrites in place and never grows it.
#[derive(Clone)]
struct BlockStore {
    blocks: Vec<f32>,
    /// Total blocks offered, which is the reservoir's sampling denominator.
    seen: u64,
    /// xorshift64 state. Seeded to a constant so a given block sequence always
    /// produces the same reading.
    rng: u64,
}

/// Any nonzero constant; fixed so metering is reproducible run to run.
const BLOCK_SAMPLER_SEED: u64 = 0x2545_F491_4F6C_DD1D;

impl BlockStore {
    fn new() -> Self {
        Self {
            blocks: Vec::with_capacity(MAX_LOUDNESS_BLOCKS),
            seen: 0,
            rng: BLOCK_SAMPLER_SEED,
        }
    }

    /// xorshift64. Cheap, allocation-free, and good enough for choosing a
    /// reservoir slot — this is not a security or audio-noise source.
    fn next_random(&mut self) -> u64 {
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng = x;
        x
    }

    /// Record one block.
    ///
    /// Under capacity the block is appended. Past capacity it replaces a
    /// uniformly chosen slot with probability `capacity / seen`, which is what
    /// keeps the retained set a uniform sample of everything offered regardless
    /// of arrival order — see the guarantees on [`BlockStore`].
    fn push(&mut self, lufs: f32) {
        self.seen += 1;
        if self.blocks.len() < MAX_LOUDNESS_BLOCKS {
            self.blocks.push(lufs);
            return;
        }
        let slot = self.next_random() % self.seen;
        if let Some(existing) = self.blocks.get_mut(slot as usize) {
            *existing = lufs;
        }
    }

    fn as_slice(&self) -> &[f32] {
        &self.blocks
    }

    fn clear(&mut self) {
        self.blocks.clear();
        self.seen = 0;
        self.rng = BLOCK_SAMPLER_SEED;
    }
}

/// Gated integrated loudness over `blocks`, per EBU R128's two-pass gate.
///
/// Allocation-free, and arithmetically identical to the previous
/// collect-and-average implementation: same f64 accumulation, same iteration
/// order, same strict `>` comparisons at both gates.
fn gated_integrated_lufs(blocks: &[f32]) -> f32 {
    if blocks.is_empty() {
        return -100.0;
    }

    // Absolute gate: -70 LUFS.
    let mut sum = 0.0_f64;
    let mut count = 0_usize;
    for &block in blocks {
        let block = f64::from(block);
        if block > -70.0 {
            sum += block;
            count += 1;
        }
    }
    if count == 0 {
        return -100.0;
    }

    // Relative gate: 10 LU below the mean of the above-absolute set.
    let relative_threshold = sum / count as f64 - 10.0;
    let mut gated_sum = 0.0_f64;
    let mut gated_count = 0_usize;
    for &block in blocks {
        let block = f64::from(block);
        if block > -70.0 && block > relative_threshold {
            gated_sum += block;
            gated_count += 1;
        }
    }
    if gated_count == 0 {
        return -100.0;
    }
    (gated_sum / gated_count as f64) as f32
}

/// Loudness range over `blocks`, in LU.
///
/// `scratch` is the caller's preallocated buffer for the gated subset; it is
/// cleared on entry and never grown, so this allocates nothing. Percentiles use
/// `select_nth_unstable_by` — two O(n) selections rather than the O(n log n)
/// full sort the previous implementation ran on every poll — which returns the
/// same order statistic the sorted vector was indexed at.
fn gated_loudness_range(blocks: &[f32], scratch: &mut Vec<f32>) -> f32 {
    if blocks.len() < 2 {
        return 0.0;
    }

    // Absolute gate, and its mean, in f32 to match the previous implementation.
    let mut sum = 0.0_f32;
    let mut count = 0_usize;
    for &block in blocks {
        if block > -70.0 {
            sum += block;
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    let relative_threshold = sum / count as f32 - 20.0;

    scratch.clear();
    for &block in blocks {
        if block > -70.0 && block > relative_threshold {
            scratch.push(block);
        }
    }
    if scratch.len() < 2 {
        return 0.0;
    }

    let n = scratch.len();
    let p10 = (n as f32 * 0.10) as usize;
    let p95 = ((n as f32 * 0.95) as usize).min(n - 1);
    let order = |a: &f32, b: &f32| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal);

    // Read the low percentile before selecting the high one: the second
    // selection re-partitions and may move the first.
    let (_, low, _) = scratch.select_nth_unstable_by(p10, order);
    let low = *low;
    let (_, high, _) = scratch.select_nth_unstable_by(p95, order);
    *high - low
}

pub struct IntegratedLufs {
    momentary: MomentaryLufs,
    /// 400 ms block loudnesses (WB-7: was an unbounded `Vec` pushed to from the
    /// audio thread).
    blocks: BlockStore,
    /// Recomputed when a block lands, not when the value is read. The worklet
    /// polls this from inside `process()` roughly every 2.7 ms while blocks
    /// arrive at 10 Hz, so recomputing on read did ~37x redundant work.
    cached_lufs: f32,
    hop_counter: usize,
    hop_size: usize, // 100ms hop
}

impl IntegratedLufs {
    pub fn new(sr: f64) -> Self {
        let hop_size = (0.1 * sr) as usize;
        Self {
            momentary: MomentaryLufs::new(sr),
            blocks: BlockStore::new(),
            cached_lufs: -100.0,
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
            self.cached_lufs = gated_integrated_lufs(self.blocks.as_slice());
        }
    }

    pub fn get_lufs(&self) -> f32 {
        self.cached_lufs
    }

    pub fn reset(&mut self) {
        self.blocks.clear();
        self.cached_lufs = -100.0;
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
    /// Short-term block loudnesses (WB-7: was an unbounded `Vec` that `get_lra`
    /// also sorted, both on the audio thread).
    blocks: BlockStore,
    /// Preallocated working buffer for the gated subset, so the percentile
    /// selection never allocates.
    scratch: Vec<f32>,
    cached_lra: f32,
    hop_counter: usize,
    hop_size: usize,
}

impl LoudnessRange {
    pub fn new(sr: f64) -> Self {
        let hop_size = (0.1 * sr) as usize; // 100ms hop
        Self {
            st_lufs: ShortTermLufs::new(sr),
            blocks: BlockStore::new(),
            scratch: Vec::with_capacity(MAX_LOUDNESS_BLOCKS),
            cached_lra: 0.0,
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
            self.cached_lra = gated_loudness_range(self.blocks.as_slice(), &mut self.scratch);
        }
    }

    /// LRA in LU (loudness units).
    pub fn get_lra(&self) -> f32 {
        self.cached_lra
    }

    pub fn reset(&mut self) {
        self.blocks.clear();
        self.scratch.clear();
        self.cached_lra = 0.0;
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
mod loudness_block_store_tests {
    //! WB-7. The store keeps block loudnesses exactly, so the read path is the
    //! previous collect-and-average algorithm over a preallocated array. That
    //! makes equivalence checkable as **bit-identity**, not as a tolerance —
    //! which is the point: the histogram this replaced could only ever be
    //! argued for within some error bound, and review round 1 found ordinary
    //! programme material where that bound was 45.21 LU.

    use super::{
        gated_integrated_lufs, gated_loudness_range, BlockStore, IntegratedLufs, LoudnessRange,
        MAX_LOUDNESS_BLOCKS,
    };

    /// The previous `IntegratedLufs::get_lufs`, verbatim, as the oracle.
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

    /// The previous `LoudnessRange::get_lra`, verbatim, as the oracle.
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

    fn actual_lra(blocks: &[f32]) -> f32 {
        let mut scratch = Vec::with_capacity(blocks.len());
        gated_loudness_range(blocks, &mut scratch)
    }

    /// Smoothly-spread material. This is the distribution the histogram handled
    /// fine, kept so a regression toward bucketing is still caught here too.
    fn synthetic_blocks(count: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        (0..count)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let unit = f32::from((state >> 16) as u16) / 65_535.0;
                -80.0 + unit * 76.0
            })
            .collect()
    }

    /// A quiet section and a loud section — dialogue plus music, or programme
    /// plus a calibration tone. Two tight clusters rather than a spread, which
    /// is what ordinary material actually looks like and what broke the
    /// histogram: when a cluster sits near the relative gate, a bucketed store
    /// decides all of it as a unit while the reference splits it.
    fn bimodal_blocks(quiet_lufs: f32) -> Vec<f32> {
        let mut blocks = Vec::with_capacity(1_000);
        for i in 0..800 {
            blocks.push(quiet_lufs + (i % 7) as f32 * 0.003);
        }
        for i in 0..200 {
            blocks.push(20.0 + (i % 5) as f32 * 0.01);
        }
        blocks
    }

    #[test]
    fn integrated_loudness_is_bit_identical_on_smooth_material() {
        for seed in [1_u32, 7, 99, 4_242] {
            for count in [12_usize, 300, 36_000] {
                let blocks = synthetic_blocks(count, seed);
                assert_eq!(
                    gated_integrated_lufs(&blocks).to_bits(),
                    reference_integrated(&blocks).to_bits(),
                    "seed {seed}, {count} blocks"
                );
            }
        }
    }

    #[test]
    fn loudness_range_is_bit_identical_on_smooth_material() {
        for seed in [1_u32, 7, 99, 4_242] {
            for count in [12_usize, 300, 36_000] {
                let blocks = synthetic_blocks(count, seed);
                assert_eq!(
                    actual_lra(&blocks).to_bits(),
                    reference_lra(&blocks).to_bits(),
                    "seed {seed}, {count} blocks"
                );
            }
        }
    }

    /// Review round 1's adversarial case. The sweep walks the quiet cluster
    /// across the relative-gate threshold, so at some offset the gate lands
    /// inside it. The histogram diverged by up to 45.21 LU here (LRA 10.04 LU)
    /// against a committed tolerance of 0.02 LU.
    #[test]
    fn integrated_loudness_is_bit_identical_across_a_gate_straddling_cluster() {
        for step in 0..11 {
            let quiet = -34.0 + step as f32;
            let blocks = bimodal_blocks(quiet);
            assert_eq!(
                gated_integrated_lufs(&blocks).to_bits(),
                reference_integrated(&blocks).to_bits(),
                "quiet section at {quiet:.1} LUFS"
            );
        }
    }

    #[test]
    fn loudness_range_is_bit_identical_across_a_gate_straddling_cluster() {
        for step in 0..11 {
            let quiet = -34.0 + step as f32;
            let blocks = bimodal_blocks(quiet);
            assert_eq!(
                actual_lra(&blocks).to_bits(),
                reference_lra(&blocks).to_bits(),
                "quiet section at {quiet:.1} LUFS"
            );
        }
    }

    /// Loudness far above the old histogram's +10 LUFS ceiling used to saturate
    /// into the top bin, which is what pulled the mean and moved the gate in the
    /// case above. An exact store has no ceiling to saturate against.
    #[test]
    fn very_loud_blocks_are_not_clamped() {
        let blocks = vec![60.0_f32, 60.0, 60.0, 60.0];
        assert_eq!(
            gated_integrated_lufs(&blocks).to_bits(),
            reference_integrated(&blocks).to_bits()
        );
        assert!((gated_integrated_lufs(&blocks) - 60.0).abs() < 1e-4);
    }

    #[test]
    fn blocks_under_the_absolute_gate_are_excluded_but_still_counted() {
        // The reference stored every block and gated at read time; `blocks.len()`
        // therefore included sub-gate blocks, and LRA's `< 2` guard saw them.
        let blocks = vec![-90.0_f32, -70.0, f32::NAN, -20.0, -21.0];
        assert_eq!(
            gated_integrated_lufs(&blocks).to_bits(),
            reference_integrated(&blocks).to_bits()
        );
        assert_eq!(actual_lra(&blocks).to_bits(), reference_lra(&blocks).to_bits());
    }

    #[test]
    fn every_block_is_retained_up_to_capacity() {
        let mut store = BlockStore::new();
        let offered: Vec<f32> = (0..MAX_LOUDNESS_BLOCKS)
            .map(|i| i as f32 * 0.001 - 30.0)
            .collect();
        for &b in &offered {
            store.push(b);
        }
        assert_eq!(
            store.as_slice(),
            offered.as_slice(),
            "under capacity the store is the sequence itself, in order — which is what \
             makes the bit-identity assertions above meaningful"
        );
    }

    #[test]
    fn capacity_is_never_exceeded_however_long_the_programme_runs() {
        let mut store = BlockStore::new();
        for i in 0..MAX_LOUDNESS_BLOCKS * 6 {
            store.push(i as f32 * 0.001 - 30.0);
            assert!(
                store.as_slice().len() <= MAX_LOUDNESS_BLOCKS,
                "capacity exceeded at block {i}, so `push` would have reallocated"
            );
        }
        assert_eq!(store.as_slice().len(), MAX_LOUDNESS_BLOCKS);
    }

    #[test]
    fn the_retained_sample_tracks_the_true_proportions() {
        // Past capacity the store is a uniform sample, so the *proportion* of
        // each population it retains should match the programme's. Six hours at
        // a 1-in-5 duty cycle.
        let full: Vec<f32> = (0..MAX_LOUDNESS_BLOCKS * 6)
            .map(|i| if i % 5 == 0 { -12.0 } else { -26.0 })
            .collect();
        let mut store = BlockStore::new();
        for &b in &full {
            store.push(b);
        }
        let loud = store.as_slice().iter().filter(|&&b| b > -20.0).count();
        let fraction = loud as f64 / store.as_slice().len() as f64;
        assert!(
            (fraction - 0.2).abs() < 0.02,
            "retained {fraction:.4} loud against a true 0.2000 — the sample is not uniform"
        );
        assert!(
            (gated_integrated_lufs(store.as_slice()) - reference_integrated(&full)).abs() < 0.5,
            "sampled {:.3} LUFS vs exact {:.3} LUFS over six hours of audio",
            gated_integrated_lufs(store.as_slice()),
            reference_integrated(&full)
        );
    }

    #[test]
    fn sampling_past_capacity_does_not_allocate() {
        // Review round 2: the chain-level RT test renders 30 s, which is 300
        // blocks — it never reaches the 36,000-block capacity, so it asserted
        // allocation-freedom for a path it never executed. Force the store well
        // past capacity under the guard instead of waiting an hour of
        // wall-clock for it.
        use assert_no_alloc::assert_no_alloc;

        let mut store = BlockStore::new();
        let mut scratch: Vec<f32> = Vec::with_capacity(MAX_LOUDNESS_BLOCKS);
        // Fill to capacity outside the guard; that part is the ordinary path.
        for i in 0..MAX_LOUDNESS_BLOCKS {
            store.push(i as f32 * 0.001 - 30.0);
        }

        assert_no_alloc(|| {
            // Three more hours: every one of these takes the replacement branch.
            for i in 0..MAX_LOUDNESS_BLOCKS * 3 {
                store.push(i as f32 * 0.001 - 30.0);
            }
            let _ = gated_integrated_lufs(store.as_slice());
            let _ = gated_loudness_range(store.as_slice(), &mut scratch);
        });
        assert_eq!(store.as_slice().len(), MAX_LOUDNESS_BLOCKS);
    }

    #[test]
    fn a_steady_level_integrates_to_that_level() {
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
        meter.reset();
        assert_eq!(meter.get_lufs(), -100.0);
    }

    #[test]
    fn alternating_levels_produce_a_loudness_range_near_their_separation() {
        let sr = 48_000.0;
        let mut meter = LoudnessRange::new(sr);
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

#[cfg(test)]
mod reduction_aliasing_tests {
    //! Review round 2. Bounded memory means something is discarded past
    //! capacity, and *which* blocks are discarded decides which population
    //! survives the relative gate. A fixed-phase "keep every Nth" locks onto one
    //! parity of periodic material and deletes the rest — measured at 40 LU of
    //! bias on a period-2 sequence, in the wrong direction. Reservoir sampling
    //! selects independently of position, so no phase relationship can bias it.

    use super::{gated_integrated_lufs, BlockStore, MAX_LOUDNESS_BLOCKS};

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

    /// How far the nearest block population sits from the relative gate. When
    /// this approaches zero the measure is on a knife edge: an arbitrarily
    /// small change to the input moves a whole population across the gate and
    /// the answer jumps. That is a property of R128's gate, not of any
    /// implementation of it.
    fn gate_margin(blocks: &[f32]) -> f64 {
        let above: Vec<f64> = blocks
            .iter()
            .map(|&b| f64::from(b))
            .filter(|&b| b > -70.0)
            .collect();
        if above.is_empty() {
            return f64::INFINITY;
        }
        let threshold = above.iter().sum::<f64>() / above.len() as f64 - 10.0;
        above
            .iter()
            .map(|v| (v - threshold).abs())
            .fold(f64::INFINITY, f64::min)
    }

    /// Stationary periodic loudness: one loud block every `period`, offset by
    /// `phase`. Sidechain pumping, rhythmic gating, tremolo and a looped test
    /// tone all produce this at a small multiple of the 100 ms block rate.
    ///
    /// Phase is swept as well as period because *which* phase survives is the
    /// whole question. A period-2 sequence with the loud block at index 0
    /// happens to phase-lock a keep-every-other reduction onto the loud parity
    /// and looks fine; the same sequence offset by one loses the loud phase
    /// entirely. Testing one phase would reproduce the blind spot under test.
    fn periodic(period: usize, phase: usize, blocks: usize) -> Vec<f32> {
        (0..blocks)
            .map(|i| if i % period == phase { 0.0 } else { -40.0 })
            .collect()
    }

    /// Six hours, so the store replaces its contents many times over.
    const LONG_PROGRAMME: usize = 216_000;

    #[test]
    fn periodic_material_survives_the_capacity_reduction() {
        let mut worst = 0.0f32;
        let mut worst_case = (0, 0);
        let mut compared = 0;
        let mut degenerate = 0;

        for period in [2_usize, 3, 4, 5, 8, 16] {
            for phase in 0..period {
                let full = periodic(period, phase, LONG_PROGRAMME);
                // Skip configurations sitting on the gate's own discontinuity;
                // `the_gate_is_discontinuous_where_a_population_sits_on_it`
                // proves those are unstable for the reference too, so agreement
                // there would be luck rather than correctness.
                if gate_margin(&full) < 0.5 {
                    degenerate += 1;
                    continue;
                }
                compared += 1;

                let mut store = BlockStore::new();
                for &b in &full {
                    store.push(b);
                }
                let delta = (gated_integrated_lufs(store.as_slice())
                    - reference_integrated(&full))
                .abs();
                if delta > worst {
                    worst = delta;
                    worst_case = (period, phase);
                }
            }
        }

        assert!(
            compared >= 20,
            "only {compared} configurations were comparable ({degenerate} degenerate) — \
             the sweep is not exercising enough of the space"
        );
        assert!(
            worst < 1.0,
            "periodic loudness at period {} phase {} diverges by {worst:.4} LU after the \
             store reduces — a position-based reduction locks onto one phase and deletes \
             the others, which is bias, not lost resolution ({compared} configurations \
             compared, {degenerate} skipped as degenerate)",
            worst_case.0,
            worst_case.1
        );
    }

    #[test]
    fn a_two_block_cycle_keeps_both_phases() {
        // The sharpest case: alternating quiet and loud, quiet first, so a
        // keep-every-other reduction locks onto the quiet parity. The
        // gate-relative population is the loud half, so losing it inverts the
        // reading — measured at -40.0000 against an exact 0.0000.
        let full = periodic(2, 1, LONG_PROGRAMME);
        let mut store = BlockStore::new();
        for &b in &full {
            store.push(b);
        }
        let reduced = gated_integrated_lufs(store.as_slice());
        let exact = reference_integrated(&full);

        let loud_retained = store.as_slice().iter().filter(|&&b| b > -20.0).count();
        assert!(
            loud_retained > 0,
            "every loud block was discarded: stored {} blocks, all quiet; \
             reduced reads {reduced:.4} LUFS against an exact {exact:.4} LUFS",
            store.as_slice().len()
        );
        // Half the blocks are loud, so a uniform sample should retain about half.
        let fraction = loud_retained as f64 / store.as_slice().len() as f64;
        assert!(
            (fraction - 0.5).abs() < 0.02,
            "retained {fraction:.4} loud blocks against a true 0.5000"
        );
        assert!(
            (reduced - exact).abs() < 1.0,
            "alternating programme reads {reduced:.4} LUFS against an exact {exact:.4} LUFS"
        );
    }

    #[test]
    fn the_gate_is_discontinuous_where_a_population_sits_on_it() {
        // Justifies the skip above, rather than asserting it. At period 4 with
        // these levels the quiet population lands exactly 10 LU below the mean,
        // which is exactly the relative gate. Perturbing the *input* by 0.01 LU
        // — nothing to do with how blocks are stored — moves the reference
        // itself by tens of LU, because a whole population crosses the gate.
        let at_the_edge = periodic(4, 1, 4_000);
        assert!(
            gate_margin(&at_the_edge) < 0.01,
            "expected this configuration to sit on the gate, margin was {:.4} LU",
            gate_margin(&at_the_edge)
        );

        let nudged: Vec<f32> = at_the_edge
            .iter()
            .map(|&b| if b < -20.0 { b + 0.01 } else { b })
            .collect();

        let before = reference_integrated(&at_the_edge);
        let after = reference_integrated(&nudged);
        assert!(
            (after - before).abs() > 10.0,
            "the reference moved only {:.4} LU for a 0.01 LU input change ({before:.4} -> \
             {after:.4}); if the gate is not discontinuous here, the skip above is not \
             justified and should be removed",
            (after - before).abs()
        );
    }

    #[test]
    fn a_long_programme_is_sampled_not_truncated() {
        // The store must keep representing the *whole* programme, not its first
        // hour. A quiet first half followed by a loud second half would read as
        // quiet-only if the store stopped accepting blocks at capacity.
        let mut full = vec![-40.0f32; MAX_LOUDNESS_BLOCKS * 3];
        for block in full.iter_mut().skip(MAX_LOUDNESS_BLOCKS * 3 / 2) {
            *block = 0.0;
        }
        let mut store = BlockStore::new();
        for &b in &full {
            store.push(b);
        }
        let loud = store.as_slice().iter().filter(|&&b| b > -20.0).count();
        let fraction = loud as f64 / store.as_slice().len() as f64;
        assert!(
            (fraction - 0.5).abs() < 0.02,
            "retained {fraction:.4} of the second half against a true 0.5000 — the store \
             is favouring one part of the programme"
        );
    }
}
