//! Mastering metering — LUFS (ITU-R BS.1770), LRA, true peak, crest factor.

use crate::primitives::{flush_denormal, flush_denormal_f64};

/// One direct-form-I biquad section, normalised so `a0 == 1`.
///
/// `a1` and `a2` carry the sign the recommendation's published tables use, i.e.
/// `y[n] = b0·x[n] + b1·x[n−1] + b2·x[n−2] − a1·y[n−1] − a2·y[n−2]`.
#[derive(Clone, Copy)]
struct BiquadCoefficients {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

/// ITU-R BS.1770-4 stage 1 — the high-frequency shelving filter — as the analog
/// prototype it is specified as.
///
/// The recommendation publishes stage 1 as a **coefficient table at 48 kHz
/// only**, and is explicit that the filter is an analog prototype of which that
/// table is one discretisation; any other sample rate has to be discretised from
/// the prototype at that rate. These are the prototype's parameters — corner
/// frequency, shelf gain, and Q — recovered to full double precision by Brecht
/// De Man, *Evaluation of implementations of the EBU R128 loudness measurement*
/// (AES 145th Convention, 2018), and carried by the public EBU/ITU reference
/// implementations that followed it (`libebur128`, `pyloudnorm`).
///
/// Discretising them with a pre-warped bilinear transform at 48 kHz reproduces
/// the published table; `derived_coefficients_reproduce_the_published_48k_table`
/// pins that to 1e-12, so neither these constants nor the design below can drift
/// off the recommendation unnoticed.
const SHELF_FREQUENCY_HZ: f64 = 1681.974450955533;
const SHELF_GAIN_DB: f64 = 3.999843853973347;
const SHELF_Q: f64 = 0.7071752369554196;
/// Exponent taking the shelf's high-frequency gain to its band gain.
const SHELF_BAND_GAIN_EXPONENT: f64 = 0.4996667741545416;

/// ITU-R BS.1770-4 stage 2 — the RLB high-pass — as an analog prototype. Same
/// provenance as the stage-1 constants above.
const HIGHPASS_FREQUENCY_HZ: f64 = 38.13547087602444;
const HIGHPASS_Q: f64 = 0.5003270373238773;

/// Largest `f0 / sample_rate` the pre-warp is evaluated at.
///
/// `tan(π·f0/sr)` diverges as `f0` approaches Nyquist. No rate an engine runs at
/// puts either stage near Nyquist — the shelf sits at 1682 Hz, so even 8 kHz
/// leaves it at a fifth of the band — but the meter is constructed from a sample
/// rate the host hands us, and a nonsensical one has to yield a finite, stable
/// filter rather than an infinity that then poisons every reading taken through
/// it.
const MAX_PREWARP_RATIO: f64 = 0.49;

/// Bilinear-transform frequency parameter with frequency pre-warping,
/// `tan(π·f0/sr)`, so the discrete corner lands on the analog one.
fn prewarped_tangent(frequency_hz: f64, sample_rate: f64) -> f64 {
    let ratio = if sample_rate.is_finite() && sample_rate > 0.0 {
        (frequency_hz / sample_rate).min(MAX_PREWARP_RATIO)
    } else {
        MAX_PREWARP_RATIO
    };
    (core::f64::consts::PI * ratio).tan()
}

/// K-weighting stage 1 (high-frequency shelf), designed at `sample_rate`.
fn k_weighting_shelf(sample_rate: f64) -> BiquadCoefficients {
    let k = prewarped_tangent(SHELF_FREQUENCY_HZ, sample_rate);
    let k2 = k * k;
    let high_gain = 10.0_f64.powf(SHELF_GAIN_DB / 20.0);
    let band_gain = high_gain.powf(SHELF_BAND_GAIN_EXPONENT);
    let scaled_q = k / SHELF_Q;
    let a0 = 1.0 + scaled_q + k2;
    BiquadCoefficients {
        b0: (high_gain + band_gain * scaled_q + k2) / a0,
        b1: 2.0 * (k2 - high_gain) / a0,
        b2: (high_gain - band_gain * scaled_q + k2) / a0,
        a1: 2.0 * (k2 - 1.0) / a0,
        a2: (1.0 - scaled_q + k2) / a0,
    }
}

/// K-weighting stage 2 (RLB high-pass), designed at `sample_rate`.
fn k_weighting_highpass(sample_rate: f64) -> BiquadCoefficients {
    let k = prewarped_tangent(HIGHPASS_FREQUENCY_HZ, sample_rate);
    let k2 = k * k;
    let scaled_q = k / HIGHPASS_Q;
    let a0 = 1.0 + scaled_q + k2;
    BiquadCoefficients {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: 2.0 * (k2 - 1.0) / a0,
        a2: (1.0 - scaled_q + k2) / a0,
    }
}

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
    /// Create the K-weighting filter for `sr`, designing both stages at that
    /// rate from the BS.1770-4 analog prototypes.
    ///
    /// There is deliberately no special case for 48 kHz. The recommendation's
    /// published 48 kHz table falls out of this same derivation — that is what
    /// makes the derivation checkable, and a hardcoded branch beside it would be
    /// a second source of truth that nothing forces to agree.
    ///
    /// **What this replaced, and why it was not a design at all.** The previous
    /// constructor kept the 48 kHz table and, at every other rate, multiplied it
    /// by powers of `48000/sr`. Scaling a discrete-time biquad's coefficients by
    /// a frequency ratio is not a re-discretisation of anything: it preserves
    /// neither the magnitude response nor the pole locations, so the filter it
    /// produces is not K-weighting and need not even be stable.
    ///
    /// It was not stable at the rate that matters most. At 44.1 kHz — the
    /// commonest browser `AudioContext` rate — `ratio = 1.0884` put the stage-2
    /// RLB pole at radius 1.099, growing by ten percent per sample; the meter
    /// ran to infinity within a fraction of a second and then reported the
    /// silence floor forever. Measured against this implementation, a −6 dBFS
    /// 1 kHz tone at 44.1 kHz integrated to −100.0 LUFS where 48 kHz read
    /// −9.19. Lower rates fail harder: at 16 kHz the stage-1 pole reached
    /// radius 2.57.
    pub fn new(sr: f64) -> Self {
        let shelf = k_weighting_shelf(sr);
        let highpass = k_weighting_highpass(sr);
        Self {
            s1_x1: 0.0,
            s1_x2: 0.0,
            s1_y1: 0.0,
            s1_y2: 0.0,
            s1_b0: shelf.b0,
            s1_b1: shelf.b1,
            s1_b2: shelf.b2,
            s1_a1: shelf.a1,
            s1_a2: shelf.a2,

            s2_x1: 0.0,
            s2_x2: 0.0,
            s2_y1: 0.0,
            s2_y2: 0.0,
            s2_b0: highpass.b0,
            s2_b1: highpass.b1,
            s2_b2: highpass.b2,
            s2_a1: highpass.a1,
            s2_a2: highpass.a2,
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

/// The offset in BS.1770-4's block-loudness formula,
/// `L = −0.691 + 10·log10(z)`, where `z` is the K-weighted block energy.
///
/// It calibrates out the K-weighting filter's gain at 1 kHz, which is why every
/// conversion between loudness and energy in this file carries it.
const LOUDNESS_OFFSET_DB: f64 = -0.691;

/// Block loudness in LUFS from block energy (K-weighted mean square).
///
/// Energies at or below zero have no loudness; they report the same `-100.0`
/// floor the meters have always shown for silence.
#[inline]
fn loudness_from_energy(energy: f64) -> f32 {
    if !(energy > 1e-20) {
        return -100.0;
    }
    (LOUDNESS_OFFSET_DB + 10.0 * energy.log10()) as f32
}

/// Block energy from block loudness — the inverse of [`loudness_from_energy`].
///
/// Not on the audio path: it exists so the absolute gate can be stated once, in
/// the decibel units the recommendation states it in, and compared in the energy
/// domain where the gating actually happens.
#[inline]
fn energy_from_loudness(lufs: f64) -> f64 {
    10.0_f64.powf((lufs - LOUDNESS_OFFSET_DB) / 10.0)
}

/// BS.1770-4's absolute gate, Γ_a, in LUFS.
const ABSOLUTE_GATE_LUFS: f64 = -70.0;

/// Relative gate offset below the absolute-gated level, in LU — Γ_r = Γ_a-gated
/// loudness − 10 LU (BS.1770-4 §5.1).
const INTEGRATED_RELATIVE_GATE_LU: f64 = 10.0;

/// EBU Tech 3342's relative gate offset for loudness range, in LU.
const LOUDNESS_RANGE_RELATIVE_GATE_LU: f64 = 20.0;

/// The absolute gate expressed as an energy, so a block can be gated without a
/// logarithm per block per pass.
///
/// Gating in the energy domain is not an optimisation, it is the definition:
/// `L_i > Γ` and `z_i > energy(Γ)` are the same predicate because
/// [`loudness_from_energy`] is strictly increasing, and doing it this way keeps
/// the whole gated computation in the domain BS.1770-4 averages in.
#[inline]
fn absolute_gate_energy() -> f64 {
    energy_from_loudness(ABSOLUTE_GATE_LUFS)
}

/// The energy ratio corresponding to a relative gate `lu` below a mean.
///
/// `L_i > L_mean − lu` ⟺ `z_i > z_mean · 10^(−lu/10)`; the −0.691 offset appears
/// on both sides and cancels, so the relative gate is a pure ratio on energies.
#[inline]
fn relative_gate_factor(lu: f64) -> f64 {
    10.0_f64.powf(-lu / 10.0)
}

/// Upper bound on a derived window/hop sample count, safely above anything a
/// real audio rate produces (3 s at 768 kHz — an extreme professional rate —
/// is 2,304,000 samples) but far below what a corrupt or absurd host-reported
/// rate could otherwise request.
const MAX_DERIVED_SAMPLES: usize = 10_000_000;

/// `seconds * sample_rate` as a sample count, clamped to `[1,
/// MAX_DERIVED_SAMPLES]`.
///
/// The rate arrives from the host. Rust's float-to-int `as` cast saturates
/// rather than panicking, so a sample rate of zero, negative, or NaN all cast
/// to `0`, which then sizes a ring buffer to nothing — the first
/// `process_sample` indexes an empty `Vec` and computes `% 0`, a panic. A
/// sample rate of `+inf` casts the other way, to `usize::MAX`, which turns a
/// buffer allocation into an OOM abort. Both ends are host input, not an
/// invariant this crate controls, so both are clamped here rather than
/// asserted away.
#[inline]
fn sanitized_sample_count(seconds: f64, sample_rate: f64) -> usize {
    let raw = seconds * sample_rate;
    if !raw.is_finite() || raw <= 0.0 {
        return 1;
    }
    (raw as usize).clamp(1, MAX_DERIVED_SAMPLES)
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
        let window_size = sanitized_sample_count(0.4, sr); // 400ms
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

    /// K-weighted energy over the window — the `z` of BS.1770-4's block
    /// loudness formula, and the quantity the gated measures average.
    pub fn energy(&self) -> f64 {
        (self.sum_sq_l + self.sum_sq_r) / (2.0 * self.window_size as f64)
    }

    pub fn get_lufs(&self) -> f32 {
        loudness_from_energy(self.energy())
    }

    /// Clear the K-weighting filter state, the ring buffers, and the running
    /// sums, so one non-finite input sample cannot poison every reading taken
    /// after a reset. Without this, `k_l`/`k_r`'s filter state and
    /// `sum_sq_l`/`sum_sq_r` survive a caller's `reset` untouched — see
    /// `IntegratedLufs::reset`, which calls this.
    pub fn reset(&mut self) {
        self.k_l.reset();
        self.k_r.reset();
        self.buffer_l.iter_mut().for_each(|s| *s = 0.0);
        self.buffer_r.iter_mut().for_each(|s| *s = 0.0);
        self.sum_sq_l = 0.0;
        self.sum_sq_r = 0.0;
        self.write_pos = 0;
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
        let window_size = sanitized_sample_count(3.0, sr);
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

    /// K-weighted energy over the window — see [`MomentaryLufs::energy`].
    pub fn energy(&self) -> f64 {
        (self.sum_sq_l + self.sum_sq_r) / (2.0 * self.window_size as f64)
    }

    pub fn get_lufs(&self) -> f32 {
        loudness_from_energy(self.energy())
    }

    /// Clear the K-weighting filter state, the ring buffers, and the running
    /// sums — the short-term twin of [`MomentaryLufs::reset`]. Called from
    /// `LoudnessRange::reset`.
    pub fn reset(&mut self) {
        self.k_l.reset();
        self.k_r.reset();
        self.buffer_l.iter_mut().for_each(|s| *s = 0.0);
        self.buffer_r.iter_mut().for_each(|s| *s = 0.0);
        self.sum_sq_l = 0.0;
        self.sum_sq_r = 0.0;
        self.write_pos = 0;
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

/// Exact, fixed-capacity store of 100 ms block **energies**.
///
/// **Why energies and not decibels.** BS.1770-4 gates and integrates the mean of
/// block *energies*; the decibel figure is produced once, at the end. Storing
/// decibels and averaging those is not the same measurement — the arithmetic
/// mean of a set of dB values is at or below the dB of their mean by Jensen's
/// inequality, with equality only when every block is identical, so the error is
/// zero on a steady tone and grows with the programme's dynamic range. It is
/// always in the same direction: a dynamic master reads quieter than it is,
/// which is the number a mastering engineer trusts to hit a delivery target.
/// `energy_domain_gating_tests` measures the gap, and separates the bias in the
/// average itself from the way that bias then drags the relative gate down.
///
/// Energy also removes the store's only remaining logarithm from the read path:
/// both gates become comparisons on energies, and `log10` is evaluated once per
/// answer rather than once per block per pass.
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
///    This sample backs **integrated loudness only**. Loudness range does not
///    read it past capacity — see guarantee 3.
///
/// # What it does not guarantee
///
/// 3. **Exactness past capacity — and the two measures behave differently
///    here, so they are stated separately.**
///
///    *Integrated loudness* is estimated from the sample above. A mean
///    tolerates sampling: the error shrinks as 1/√n with no preferred
///    direction. **That bound is empirical, not proved.** It describes one
///    sweep — 34 periodic duty-cycle configurations at six hours, worst
///    observed 0.146 LU. A deliberately extreme population (a few blocks a
///    thousand LU above the rest) reaches 0.39 LU; held to physically
///    reachable block loudness the worst seen is 0.0245 LU. A distribution
///    outside that sweep could do worse.
///
///    *Loudness range* is **not** estimated from the sample, because it is a
///    pair of order statistics rather than a mean. A percentile is a discrete
///    rank, so a sampled population count heavy by a fraction of a percent
///    moves that rank; where a population boundary sits near it, the answer
///    jumps by the whole gap between populations rather than degrading — 20.0
///    LU, measured, on a programme whose quiet intro was a tenth of its length.
///    It therefore reads from [`LoudnessQuantiles`], which counts every block
///    so ranks stay exact at any programme length. Its error is bounded by two
///    bins: one for the two percentiles being reported as their bins' centres,
///    and one more because the relative gate is also compared against a bin
///    centre, so it admits or excludes a whole bin at once and can displace a
///    rank into its neighbour. *To check:* compare against the unbounded
///    implementation over material with a population boundary near the 10th
///    percentile; measured 0.0000 LU there, and worst 0.0116 LU on continuously
///    distributed material.
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
    blocks: Vec<f64>,
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
    fn push(&mut self, energy: f64) {
        self.seen += 1;
        if self.blocks.len() < MAX_LOUDNESS_BLOCKS {
            self.blocks.push(energy);
            return;
        }
        let slot = self.next_random() % self.seen;
        if let Some(existing) = self.blocks.get_mut(slot as usize) {
            *existing = energy;
        }
    }

    fn as_slice(&self) -> &[f64] {
        &self.blocks
    }

    /// True while every block offered is still retained, i.e. before any
    /// replacement has happened. Measures read from the slice are exact only
    /// while this holds.
    fn is_exact(&self) -> bool {
        self.seen <= MAX_LOUDNESS_BLOCKS as u64
    }

    fn clear(&mut self) {
        self.blocks.clear();
        self.seen = 0;
        self.rng = BLOCK_SAMPLER_SEED;
    }
}

/// Gated integrated loudness over `blocks`, per BS.1770-4's two-pass gate.
///
/// `blocks` are **energies**, not decibels. Both gates are applied to energies
/// and both passes average energies; the single conversion to LUFS happens on
/// the way out. That is the recommendation's own order of operations, and the
/// reason it matters is that averaging is not preserved by the logarithm — see
/// [`BlockStore`].
///
/// Allocation-free: two passes over a borrowed slice, no scratch.
fn gated_integrated_lufs(blocks: &[f64]) -> f32 {
    if blocks.is_empty() {
        return -100.0;
    }

    // Absolute gate, Γ_a = −70 LUFS, expressed as the energy at that loudness.
    let absolute_gate = absolute_gate_energy();
    let mut sum = 0.0_f64;
    let mut count = 0_usize;
    for &energy in blocks {
        if energy > absolute_gate {
            sum += energy;
            count += 1;
        }
    }
    if count == 0 {
        return -100.0;
    }

    // Relative gate, Γ_r = 10 LU below the loudness of the absolute-gated mean
    // energy. In the energy domain that is a plain ratio: the −0.691 offset sits
    // on both sides of the comparison and cancels.
    let relative_gate = (sum / count as f64) * relative_gate_factor(INTEGRATED_RELATIVE_GATE_LU);
    let mut gated_sum = 0.0_f64;
    let mut gated_count = 0_usize;
    for &energy in blocks {
        if energy > absolute_gate && energy > relative_gate {
            gated_sum += energy;
            gated_count += 1;
        }
    }
    if gated_count == 0 {
        return -100.0;
    }
    loudness_from_energy(gated_sum / gated_count as f64)
}

/// Loudness range over `blocks`, in LU. `blocks` are energies.
///
/// **The percentiles are order statistics, so they were never the defective
/// part** — energy is a strictly increasing function of loudness, so ranking
/// blocks by either gives the same two blocks. The gate that selects *which*
/// blocks are ranked is a mean, and that one was defective in exactly the way
/// [`gated_integrated_lufs`] was: EBU Tech 3342 puts its threshold 20 LU below
/// the loudness of the mean *energy* of the absolute-gated blocks, and this
/// averaged their decibel values instead. Averaging decibels sits at or below
/// the true level, so the threshold sat too low and admitted quiet blocks the
/// reference excludes — which widens the reported range, because the blocks it
/// wrongly admits are the ones at the bottom that p10 reads.
///
/// `scratch` is the caller's preallocated buffer for the gated subset; it is
/// cleared on entry and never grown, so this allocates nothing. Percentiles use
/// `select_nth_unstable_by` — two O(n) selections rather than the O(n log n)
/// full sort the previous implementation ran on every poll — which returns the
/// same order statistic the sorted vector was indexed at.
fn gated_loudness_range(blocks: &[f64], scratch: &mut Vec<f64>) -> f32 {
    if blocks.len() < 2 {
        return 0.0;
    }

    let absolute_gate = absolute_gate_energy();
    let mut sum = 0.0_f64;
    let mut count = 0_usize;
    for &energy in blocks {
        if energy > absolute_gate {
            sum += energy;
            count += 1;
        }
    }
    if count == 0 {
        return 0.0;
    }
    let relative_gate =
        (sum / count as f64) * relative_gate_factor(LOUDNESS_RANGE_RELATIVE_GATE_LU);

    scratch.clear();
    for &energy in blocks {
        if energy > absolute_gate && energy > relative_gate {
            scratch.push(energy);
        }
    }
    if scratch.len() < 2 {
        return 0.0;
    }

    let n = scratch.len();
    let p10 = (n as f32 * 0.10) as usize;
    let p95 = ((n as f32 * 0.95) as usize).min(n - 1);
    let order = |a: &f64, b: &f64| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal);

    // Read the low percentile before selecting the high one: the second
    // selection re-partitions and may move the first.
    let (_, low, _) = scratch.select_nth_unstable_by(p10, order);
    let low = *low;
    let (_, high, _) = scratch.select_nth_unstable_by(p95, order);
    let high = *high;

    // A range is a *difference* of loudnesses, so the −0.691 offset cancels and
    // this is the ratio of the two energies in decibels.
    if !(low > 0.0) || !(high > 0.0) {
        return 0.0;
    }
    (10.0 * (high / low).log10()) as f32
}

pub struct IntegratedLufs {
    momentary: MomentaryLufs,
    /// 400 ms block energies. These were held in an unbounded `Vec` pushed
    /// to from the audio thread.
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
        let hop_size = sanitized_sample_count(0.1, sr);
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
            self.blocks.push(self.momentary.energy());
            self.cached_lufs = gated_integrated_lufs(self.blocks.as_slice());
        }
    }

    pub fn get_lufs(&self) -> f32 {
        self.cached_lufs
    }

    pub fn reset(&mut self) {
        self.momentary.reset();
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
/// Lowest loudness the quantile histogram resolves. Blocks at or under the
/// absolute gate never reach a percentile, so nothing below this matters.
const QUANTILE_MIN_LUFS: f32 = -70.0;
/// Bin width, and therefore the whole of the error in a returned percentile.
const QUANTILE_BIN_LU: f32 = 0.01;
/// Bins span −70 to +810 LUFS.
///
/// The top is chosen so that **no finite block loudness can reach it**: block
/// loudness is a decibel figure, and the largest a finite f32 signal can produce
/// is around +770. Covering the whole reachable range uniformly is deliberate —
/// an earlier version stopped at +60 and handled everything above it specially,
/// which produced a silent ceiling twice (first by clamping into the last bin,
/// then by collapsing a distribution into an interpolation between two
/// extremes). One mapping with no seam cannot do that. 352 KB, allocated once.
const QUANTILE_BINS: usize = 88_000;

/// Exact-rank quantile estimator for loudness range.
///
/// Loudness range is `p95 − p10` of the gated blocks — two order statistics.
/// Order statistics cannot be estimated from a uniform sample the way a mean
/// can: a percentile is a discrete rank, so a sampled population count that is
/// a fraction of a percent heavy moves that rank, and where a population
/// boundary sits near it the result jumps by the entire gap between
/// populations. Measured at **20.0 LU** on a programme whose quiet intro is a
/// tenth of its length — not a wobble, the whole gap.
///
/// So this counts every block instead of sampling. Ranks are therefore exact
/// however long the programme runs, and the bin width is the whole of the
/// remaining error, in two places: a returned percentile is the centre of its
/// bin, so its value is within [`QUANTILE_BIN_LU`]; and the relative gate is
/// compared against that same centre, so it admits or excludes a whole bin at
/// once and can displace a rank into the neighbouring bin. Two bins in total —
/// see guarantee 3 on [`BlockStore`] for the measurement.
///
/// The relative gate's threshold is **not** derived from these bins. It comes
/// from `gate_energy_sum`/`gate_count`, an exact f64 running total of block
/// *energies* accumulated in arrival order — the same summation the unbounded
/// implementation performs, in the domain EBU Tech 3342 defines the threshold
/// in. Taking the threshold from binned values is what broke an earlier
/// histogram: a quantised mean shifted the threshold onto a cluster and flipped
/// all of it at once. Here the bins only ever answer "what loudness sits at
/// rank k".
///
/// **Nothing finite saturates**, and that has to hold past capacity, not just
/// under it. A runaway filter or a feedback blowup drives block loudness far
/// above anything music reaches, and surfacing that is the metering path's job;
/// a meter that quietly reports a plausible number instead has failed at
/// precisely the moment it mattered. The bins therefore span the entire range a
/// finite f32 signal can produce, so no reachable loudness lands on the edge.
///
/// Non-finite block loudness is discarded rather than binned, so one infinity
/// cannot poison the gate mean for every later reading.
#[derive(Clone)]
struct LoudnessQuantiles {
    counts: Vec<u32>,
    /// Exact sum of the **energies** of blocks above the absolute gate, and
    /// their count, for the relative-gate threshold.
    gate_energy_sum: f64,
    gate_count: usize,
    /// Every block offered, including those under the absolute gate — the
    /// unbounded implementation's `< 2` guard counted those too.
    total: u64,
    lowest: usize,
    highest: usize,
}

impl LoudnessQuantiles {
    fn new() -> Self {
        Self {
            counts: vec![0; QUANTILE_BINS],
            gate_energy_sum: 0.0,
            gate_count: 0,
            total: 0,
            lowest: QUANTILE_BINS - 1,
            highest: 0,
        }
    }

    /// Record one block, given as an energy.
    ///
    /// The energy is what the relative gate accumulates; the loudness derived
    /// from it is only used to pick a bin, i.e. to establish rank.
    fn push(&mut self, energy: f64) {
        self.total += 1;
        // Rejects NaN as well as anything at or under the absolute gate.
        if !(energy > absolute_gate_energy()) || !energy.is_finite() {
            return;
        }
        let lufs = loudness_from_energy(energy);
        if !(lufs > QUANTILE_MIN_LUFS) || !lufs.is_finite() {
            return;
        }
        self.gate_energy_sum += energy;
        self.gate_count += 1;

        let offset = (lufs - QUANTILE_MIN_LUFS) / QUANTILE_BIN_LU;
        let index = (offset as usize).min(QUANTILE_BINS - 1);
        self.counts[index] += 1;
        self.lowest = self.lowest.min(index);
        self.highest = self.highest.max(index);
    }

    fn bin_loudness(index: usize) -> f32 {
        QUANTILE_MIN_LUFS + (index as f32 + 0.5) * QUANTILE_BIN_LU
    }

    fn occupied(&self) -> core::ops::Range<usize> {
        if self.gate_count == 0 || self.lowest > self.highest {
            return 0..0;
        }
        self.lowest..self.highest + 1
    }

    /// Loudness range in LU. Allocation-free.
    fn loudness_range(&self) -> f32 {
        if self.total < 2 || self.gate_count == 0 {
            return 0.0;
        }
        // 20 LU below the loudness of the mean *energy* of the absolute-gated
        // blocks, which is where EBU Tech 3342 puts it.
        let mean_energy = self.gate_energy_sum / self.gate_count as f64;
        let threshold = loudness_from_energy(mean_energy) - LOUDNESS_RANGE_RELATIVE_GATE_LU as f32;

        let mut gated = 0_u64;
        for index in self.occupied() {
            if Self::bin_loudness(index) > threshold {
                gated += u64::from(self.counts[index]);
            }
        }
        if gated < 2 {
            return 0.0;
        }

        // The same nearest-rank percentiles the sorted implementation indexes.
        let p10 = (gated as f32 * 0.10) as u64;
        let p95 = ((gated as f32 * 0.95) as u64).min(gated - 1);
        match (self.at_rank(threshold, p10), self.at_rank(threshold, p95)) {
            (Some(low), Some(high)) => high - low,
            _ => 0.0,
        }
    }

    /// Loudness at zero-based `rank` among gated blocks ordered quietest-first.
    /// Bins ascend in loudness, so this is the sorted index without the sort.
    fn at_rank(&self, threshold: f32, rank: u64) -> Option<f32> {
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
        self.counts.iter_mut().for_each(|c| *c = 0);
        self.gate_energy_sum = 0.0;
        self.gate_count = 0;
        self.total = 0;
        self.lowest = QUANTILE_BINS - 1;
        self.highest = 0;
    }
}

pub struct LoudnessRange {
    st_lufs: ShortTermLufs,
    /// Short-term block energies. These were held in an unbounded `Vec` that
    /// `get_lra` also sorted, both on the audio thread.
    blocks: BlockStore,
    /// Preallocated working buffer for the gated subset, so the percentile
    /// selection never allocates.
    scratch: Vec<f64>,
    /// Exact-rank estimator, used once the block store stops being exact.
    quantiles: LoudnessQuantiles,
    cached_lra: f32,
    hop_counter: usize,
    hop_size: usize,
}

impl LoudnessRange {
    pub fn new(sr: f64) -> Self {
        let hop_size = sanitized_sample_count(0.1, sr); // 100ms hop
        Self {
            st_lufs: ShortTermLufs::new(sr),
            blocks: BlockStore::new(),
            scratch: Vec::with_capacity(MAX_LOUDNESS_BLOCKS),
            quantiles: LoudnessQuantiles::new(),
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
            let block = self.st_lufs.energy();
            self.record_block(block);
        }
    }

    /// Record one 100 ms block and refresh the cached measure.
    ///
    /// While every block is retained, read them directly: that path is
    /// bit-identical to computing the measure over the whole sequence. Once
    /// blocks start being replaced the stored set is a sample, and a sample
    /// cannot carry order statistics — see [`LoudnessQuantiles`].
    fn record_block(&mut self, energy: f64) {
        self.store_block(energy);
        self.refresh_cached();
    }

    /// Everything a block does to the stored state, without refreshing the
    /// cached measure. Shared so the batched test entry point cannot drift from
    /// what production records.
    fn store_block(&mut self, energy: f64) {
        self.blocks.push(energy);
        self.quantiles.push(energy);
    }

    /// Recompute the cached measure from the stored state. Pure in that state,
    /// which is why a test may record many blocks and refresh once.
    fn refresh_cached(&mut self) {
        self.cached_lra = if self.blocks.is_exact() {
            gated_loudness_range(self.blocks.as_slice(), &mut self.scratch)
        } else {
            self.quantiles.loudness_range()
        };
    }

    /// Feed a block straight in, skipping the 100 ms of audio that would
    /// normally produce it. Test-only: reaching the capacity behaviour through
    /// `process_sample` would need hours of rendered samples, and this drives
    /// the same `record_block` production uses rather than a copy of it.
    #[cfg(test)]
    pub(crate) fn record_block_for_test(&mut self, energy: f64) {
        self.record_block(energy);
    }

    /// Record a whole programme and refresh once. Equivalent to recording each
    /// block in turn — [`Self::refresh_cached`] depends only on the stored
    /// state, and `batched_recording_matches_block_by_block` pins that — but
    /// without repeating an O(n) refresh n times in a debug build.
    #[cfg(test)]
    pub(crate) fn record_blocks_for_test(&mut self, blocks: &[f64]) {
        for &energy in blocks {
            self.store_block(energy);
        }
        self.refresh_cached();
    }

    /// LRA in LU (loudness units).
    pub fn get_lra(&self) -> f32 {
        self.cached_lra
    }

    pub fn reset(&mut self) {
        self.st_lufs.reset();
        self.blocks.clear();
        self.scratch.clear();
        self.quantiles.clear();
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
    use super::{k_weighting_highpass, k_weighting_shelf, BiquadCoefficients, KWeightingFilter};

    /// Unguarded twin of `KWeightingFilter::process` — what it was before
    /// DSP-2. Kept here so the failure mode is demonstrated, not asserted from
    /// memory.
    ///
    /// Its coefficients come from the same design functions the real filter
    /// uses, rather than from a copy of the 48 kHz table. This module is about
    /// the *denormal guard*, so the twin has to differ from production in the
    /// guard and in nothing else; a second copy of the coefficients would make
    /// `k_weighting_guard_is_bit_exact_in_normal_range` fail for a reason that
    /// has nothing to do with denormals the moment the design changes.
    struct UnguardedKWeighting {
        shelf: BiquadCoefficients,
        highpass: BiquadCoefficients,
        s1_x1: f64,
        s1_x2: f64,
        s1_y1: f64,
        s1_y2: f64,
        s2_x1: f64,
        s2_x2: f64,
        s2_y1: f64,
        s2_y2: f64,
    }

    impl UnguardedKWeighting {
        fn new(sr: f64) -> Self {
            Self {
                shelf: k_weighting_shelf(sr),
                highpass: k_weighting_highpass(sr),
                s1_x1: 0.0,
                s1_x2: 0.0,
                s1_y1: 0.0,
                s1_y2: 0.0,
                s2_x1: 0.0,
                s2_x2: 0.0,
                s2_y1: 0.0,
                s2_y2: 0.0,
            }
        }

        fn process(&mut self, x: f64) -> f64 {
            let s1 = self.shelf;
            let y1 = s1.b0 * x + s1.b1 * self.s1_x1 + s1.b2 * self.s1_x2
                - s1.a1 * self.s1_y1
                - s1.a2 * self.s1_y2;
            self.s1_x2 = self.s1_x1;
            self.s1_x1 = x;
            self.s1_y2 = self.s1_y1;
            self.s1_y1 = y1;

            let s2 = self.highpass;
            let y2 = s2.b0 * y1 + s2.b1 * self.s2_x1 + s2.b2 * self.s2_x2
                - s2.a1 * self.s2_y1
                - s2.a2 * self.s2_y2;
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
        let mut unguarded = UnguardedKWeighting::new(48_000.0);
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
        assert!(
            value != 0.0,
            "raw unguarded state must be a nonzero subnormal"
        );
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
        let mut unguarded = UnguardedKWeighting::new(48_000.0);

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
mod k_weighting_design_tests {
    //! The K-weighting stages are designed at the running sample rate from
    //! ITU-R BS.1770-4's analog prototypes.
    //!
    //! What this replaced multiplied the recommendation's 48 kHz coefficient
    //! table by powers of `48000/sr`. That is not a filter design: scaling a
    //! discrete-time biquad's coefficients by a frequency ratio preserves
    //! neither the magnitude response nor the pole radii, so it put every
    //! reading at 44.1 kHz off the K curve and, below about 24 kHz, moved a
    //! stage-1 pole outside the unit circle — an unstable filter, whose output
    //! is not a wrong loudness but an infinite one.

    use super::{
        k_weighting_highpass, k_weighting_shelf, BiquadCoefficients, IntegratedLufs,
        KWeightingFilter, LoudnessRange, MomentaryLufs,
    };

    /// ITU-R BS.1770-4 Table 1 — stage 1 at 48 kHz.
    const PUBLISHED_SHELF_48K: BiquadCoefficients = BiquadCoefficients {
        b0: 1.535_124_859_586_97,
        b1: -2.691_696_189_406_38,
        b2: 1.198_392_810_852_85,
        a1: -1.690_659_293_182_41,
        a2: 0.732_480_774_215_85,
    };

    /// ITU-R BS.1770-4 Table 2 — stage 2 at 48 kHz.
    const PUBLISHED_HIGHPASS_48K: BiquadCoefficients = BiquadCoefficients {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: -1.990_047_454_833_98,
        a2: 0.990_072_250_366_21,
    };

    /// Rates an `AudioContext` or an interface can actually present, plus two
    /// below the point where the old coefficient scaling went unstable.
    const RATES: [f64; 9] = [
        16_000.0, 22_050.0, 32_000.0, 44_100.0, 48_000.0, 88_200.0, 96_000.0, 176_400.0, 192_000.0,
    ];

    /// Radius of the larger pole of `z² + a1·z + a2`. Strictly below 1 is
    /// stability; at or above it the filter's impulse response grows without
    /// bound.
    fn pole_radius(c: BiquadCoefficients) -> f64 {
        let discriminant = c.a1 * c.a1 - 4.0 * c.a2;
        if discriminant < 0.0 {
            // Complex-conjugate pair: both roots have radius √a2.
            c.a2.abs().sqrt()
        } else {
            let root = discriminant.sqrt();
            let r1 = (-c.a1 + root) / 2.0;
            let r2 = (-c.a1 - root) / 2.0;
            r1.abs().max(r2.abs())
        }
    }

    #[test]
    fn derived_coefficients_reproduce_the_published_48k_table() {
        // The recommendation prints the 48 kHz table to 15 significant figures,
        // so agreement well inside its own last printed digit is the claim. The
        // derivation agrees with the published table to ~1e-16 (f64 epsilon);
        // 1e-14 is two orders of magnitude looser than that measured agreement,
        // not four, so the guard is no longer sized to a transcription typo.
        const TOLERANCE: f64 = 1e-14;

        let shelf = k_weighting_shelf(48_000.0);
        for (name, derived, published) in [
            ("b0", shelf.b0, PUBLISHED_SHELF_48K.b0),
            ("b1", shelf.b1, PUBLISHED_SHELF_48K.b1),
            ("b2", shelf.b2, PUBLISHED_SHELF_48K.b2),
            ("a1", shelf.a1, PUBLISHED_SHELF_48K.a1),
            ("a2", shelf.a2, PUBLISHED_SHELF_48K.a2),
        ] {
            assert!(
                (derived - published).abs() < TOLERANCE,
                "stage 1 {name}: derived {derived:.15} against the published \
                 {published:.15} (difference {:.3e}) — the analog prototype constants \
                 no longer discretise to BS.1770-4's own table, so the filter is not \
                 K-weighting any more",
                (derived - published).abs()
            );
        }

        let highpass = k_weighting_highpass(48_000.0);
        for (name, derived, published) in [
            ("b0", highpass.b0, PUBLISHED_HIGHPASS_48K.b0),
            ("b1", highpass.b1, PUBLISHED_HIGHPASS_48K.b1),
            ("b2", highpass.b2, PUBLISHED_HIGHPASS_48K.b2),
            ("a1", highpass.a1, PUBLISHED_HIGHPASS_48K.a1),
            ("a2", highpass.a2, PUBLISHED_HIGHPASS_48K.a2),
        ] {
            assert!(
                (derived - published).abs() < TOLERANCE,
                "stage 2 {name}: derived {derived:.15} against the published \
                 {published:.15} (difference {:.3e})",
                (derived - published).abs()
            );
        }
    }

    #[test]
    fn both_stages_are_stable_at_every_rate_the_engine_can_run_at() {
        for sr in RATES {
            for (stage, coefficients) in [
                ("shelf", k_weighting_shelf(sr)),
                ("highpass", k_weighting_highpass(sr)),
            ] {
                let radius = pole_radius(coefficients);
                assert!(
                    radius.is_finite() && radius < 1.0,
                    "{stage} at {sr} Hz has a pole of radius {radius} — a pole at or \
                     outside the unit circle makes the meter diverge instead of \
                     reading loudness (a1 {}, a2 {})",
                    coefficients.a1,
                    coefficients.a2
                );
            }
        }
    }

    #[test]
    fn a_nonsensical_sample_rate_still_yields_a_stable_filter() {
        // The rate arrives from the host. Zero, negative and NaN must not be
        // able to produce a non-finite coefficient that then poisons every
        // reading taken through the filter.
        for sr in [0.0_f64, -48_000.0, f64::NAN, f64::INFINITY, 1.0] {
            for coefficients in [k_weighting_shelf(sr), k_weighting_highpass(sr)] {
                assert!(
                    coefficients.b0.is_finite()
                        && coefficients.b1.is_finite()
                        && coefficients.b2.is_finite()
                        && coefficients.a1.is_finite()
                        && coefficients.a2.is_finite(),
                    "a sample rate of {sr} produced a non-finite coefficient"
                );
                assert!(
                    pole_radius(coefficients) < 1.0,
                    "a sample rate of {sr} produced an unstable filter"
                );
            }
        }
    }

    #[test]
    fn a_nonsensical_sample_rate_does_not_panic_the_gated_meters() {
        // The coefficient-level test above only exercises the two free design
        // functions. `IntegratedLufs::new` and `LoudnessRange::new` additionally
        // derive a ring-buffer window size (`MomentaryLufs`/`ShortTermLufs`) and
        // a block hop size from the same host-supplied rate. Before those sizes
        // were clamped to at least one sample, a rate of 0.0, a negative rate,
        // or NaN all cast `0.4 * sr` (or `0.1 * sr`) to `0usize` via Rust's
        // saturating float-to-int `as`, sizing the ring buffer to nothing: the
        // first `process_sample` indexed an empty `Vec` and computed `% 0`, a
        // panic. `+inf` cast the other way, to `usize::MAX`, turning the buffer
        // allocation into an OOM abort.
        for sr in [0.0_f64, -48_000.0, f64::NAN, f64::INFINITY, 1.0] {
            let mut integrated = IntegratedLufs::new(sr);
            integrated.process_sample(0.5, 0.5);
            assert!(
                integrated.get_lufs().is_finite(),
                "IntegratedLufs at sample rate {sr} produced a non-finite reading \
                 instead of degrading cleanly"
            );

            let mut lra = LoudnessRange::new(sr);
            lra.process_sample(0.5, 0.5);
            assert!(
                lra.get_lra().is_finite(),
                "LoudnessRange at sample rate {sr} produced a non-finite reading \
                 instead of degrading cleanly"
            );
        }
    }

    #[test]
    fn reset_recovers_from_a_poisoning_non_finite_sample() {
        // `MomentaryLufs`/`ShortTermLufs` hold K-weighting filter state, a ring
        // buffer, and a running sum-of-squares; a single non-finite sample
        // parks the running sum at NaN forever, because every later
        // `sum_sq -= old*old` / `sum_sq += new*new` propagates it. Neither
        // struct had a `reset()` at all, and `IntegratedLufs::reset` /
        // `LoudnessRange::reset` cleared only their own block store, leaving
        // the inner meter poisoned. This test goes red if either forwarding
        // call — `momentary.reset()` in `IntegratedLufs::reset`, or
        // `st_lufs.reset()` in `LoudnessRange::reset` — is removed: a poisoned
        // instance that was reset must read exactly what an instance that was
        // never poisoned reads, once both are fed the same tone.
        let sr = 48_000.0_f64;
        let amplitude = 0.5_f64;
        let one_second = sr as usize;

        fn feed_tone(mut process: impl FnMut(f32, f32), sr: f64, amplitude: f64, samples: usize) {
            for n in 0..samples {
                let s = amplitude * (2.0 * core::f64::consts::PI * 1_000.0 * n as f64 / sr).sin();
                process(s as f32, s as f32);
            }
        }

        // IntegratedLufs::reset must reset the inner MomentaryLufs.
        let mut poisoned_integrated = IntegratedLufs::new(sr);
        poisoned_integrated.process_sample(f32::NAN, f32::NAN);
        poisoned_integrated.reset();
        feed_tone(
            |l, r| poisoned_integrated.process_sample(l, r),
            sr,
            amplitude,
            one_second,
        );

        let mut clean_integrated = IntegratedLufs::new(sr);
        feed_tone(
            |l, r| clean_integrated.process_sample(l, r),
            sr,
            amplitude,
            one_second,
        );

        assert!(
            poisoned_integrated.get_lufs().is_finite(),
            "integrated LUFS must be finite after reset, got {}",
            poisoned_integrated.get_lufs()
        );
        assert_eq!(
            poisoned_integrated.get_lufs(),
            clean_integrated.get_lufs(),
            "a reset IntegratedLufs must read exactly like an instance that was never \
             poisoned — if IntegratedLufs::reset stops calling MomentaryLufs::reset the \
             poisoned instance's running sum stays NaN, every block is excluded by the \
             absolute gate, and it reads -100.0 forever instead"
        );

        // LoudnessRange::reset must reset the inner ShortTermLufs.
        let mut poisoned_lra = LoudnessRange::new(sr);
        poisoned_lra.process_sample(f32::NAN, f32::NAN);
        poisoned_lra.reset();
        feed_tone(
            |l, r| poisoned_lra.process_sample(l, r),
            sr,
            amplitude,
            one_second,
        );

        let mut clean_lra = LoudnessRange::new(sr);
        feed_tone(
            |l, r| clean_lra.process_sample(l, r),
            sr,
            amplitude,
            one_second,
        );

        assert!(
            poisoned_lra.st_lufs.get_lufs().is_finite(),
            "the loudness range meter's short-term LUFS must be finite after reset, got {}",
            poisoned_lra.st_lufs.get_lufs()
        );
        assert_eq!(
            poisoned_lra.st_lufs.get_lufs(),
            clean_lra.st_lufs.get_lufs(),
            "a reset LoudnessRange must read exactly like an instance that was never \
             poisoned — if LoudnessRange::reset stops calling ShortTermLufs::reset the \
             poisoned instance's K-weighting filter state and running sum stay NaN forever"
        );
    }

    /// The impulse-response half of stability, at the two rates the coefficient
    /// scaling this replaced actually blew up at.
    ///
    /// `ratio = 48000/22050 = 2.177`, so the old stage-1 `a2` was
    /// `0.73248 × 2.177² = 3.47` — a pole radius of 1.86, and an impulse
    /// response that multiplies itself by 1.86 forever.
    #[test]
    fn the_impulse_response_decays_and_stays_finite_below_48k() {
        for sr in [22_050.0_f64, 16_000.0] {
            let mut filter = KWeightingFilter::new(sr);
            let mut peak_early = 0.0_f64;
            let mut peak_late = 0.0_f64;

            for n in 0..200_000 {
                let x = if n == 0 { 1.0 } else { 0.0 };
                let y = filter.process(x);
                assert!(
                    y.is_finite(),
                    "the impulse response went non-finite at sample {n} at {sr} Hz"
                );
                if n < 1_000 {
                    peak_early = peak_early.max(y.abs());
                } else if n >= 100_000 {
                    peak_late = peak_late.max(y.abs());
                }
            }

            assert!(
                peak_early > 0.1,
                "the filter is not passing the impulse at all at {sr} Hz \
                 (early peak {peak_early:e}) — a decay assertion over silence is vacuous"
            );
            assert!(
                peak_late < peak_early * 1e-6,
                "at {sr} Hz the tail peak {peak_late:e} has not decayed away from the \
                 early peak {peak_early:e} — the filter is not stable"
            );
        }
    }

    /// Momentary loudness of a steady 1 kHz sine at `amplitude` on both
    /// channels, measured after the meter's 400 ms window has filled.
    fn tone_loudness(sr: f64, amplitude: f64) -> f32 {
        let mut meter = MomentaryLufs::new(sr);
        // Two seconds: five window-lengths, so start-up transients are long gone.
        for n in 0..(sr as usize * 2) {
            let s = amplitude * (2.0 * core::f64::consts::PI * 1_000.0 * n as f64 / sr).sin();
            meter.process_sample(s as f32, s as f32);
        }
        meter.get_lufs()
    }

    #[test]
    fn a_tone_reads_the_same_loudness_at_every_sample_rate() {
        // Loudness is a property of the signal, not of how densely it was
        // sampled. This is the falsifying measurement for the coefficient
        // scaling: with it, 44.1 kHz and 48 kHz disagreed even though the tone
        // did not change, and rates below 24 kHz produced no number at all.
        let reference = tone_loudness(48_000.0, 0.5);
        for sr in RATES {
            let measured = tone_loudness(sr, 0.5);
            assert!(
                measured.is_finite(),
                "a 1 kHz tone reads {measured} at {sr} Hz"
            );
            assert!(
                (measured - reference).abs() < 0.1,
                "a 1 kHz tone at −6 dBFS reads {measured:.4} LUFS at {sr} Hz against \
                 {reference:.4} LUFS at 48 kHz — the K-weighting curve is not the same \
                 curve at both rates"
            );
        }
    }

    #[test]
    fn integrated_loudness_agrees_across_sample_rates() {
        // The same invariance through the whole gated path, not just the
        // momentary window.
        fn integrated(sr: f64) -> f32 {
            let mut meter = IntegratedLufs::new(sr);
            for n in 0..(sr as usize * 4) {
                let s = 0.5 * (2.0 * core::f64::consts::PI * 1_000.0 * n as f64 / sr).sin();
                meter.process_sample(s as f32, s as f32);
            }
            meter.get_lufs()
        }

        let at_48k = integrated(48_000.0);
        for sr in [44_100.0_f64, 22_050.0, 96_000.0] {
            let measured = integrated(sr);
            assert!(
                (measured - at_48k).abs() < 0.1,
                "integrated loudness reads {measured:.4} LUFS at {sr} Hz against \
                 {at_48k:.4} LUFS at 48 kHz"
            );
        }
    }

    /// The K filter's gain at 1 kHz is what BS.1770-4's −0.691 offset cancels,
    /// so the two have to be measured together or neither is pinned.
    #[test]
    fn the_k_weighting_gain_at_1khz_matches_the_loudness_offset() {
        let sr = 48_000.0;
        let mut filter = KWeightingFilter::new(sr);
        let mut sum_sq = 0.0_f64;
        let total = sr as usize * 2;
        let settle = sr as usize;
        for n in 0..total {
            let s = (2.0 * core::f64::consts::PI * 1_000.0 * n as f64 / sr).sin();
            let y = filter.process(s);
            if n >= settle {
                sum_sq += y * y;
            }
        }
        // Input is a unit sine, mean square 0.5; the gain is the ratio of the
        // output's mean square to that.
        let gain_db = 10.0 * ((sum_sq / (total - settle) as f64) / 0.5).log10();
        assert!(
            (gain_db - 0.691).abs() < 0.01,
            "K-weighting gain at 1 kHz measured {gain_db:.4} dB; BS.1770-4's −0.691 \
             offset exists to cancel exactly this, so if they disagree the meter is \
             mis-calibrated at the reference frequency"
        );
    }
}

#[cfg(test)]
mod loudness_block_store_tests {
    //! The store keeps block energies exactly, so the read path is the
    //! previous collect-and-average algorithm over a preallocated array. That
    //! makes equivalence checkable as **bit-identity**, not as a tolerance —
    //! which is the point: the histogram this replaced could only ever be
    //! argued for within some error bound, and review round 1 found ordinary
    //! programme material where that bound was 45.21 LU.

    use super::{
        gated_integrated_lufs, gated_loudness_range, BlockStore, IntegratedLufs, LoudnessRange,
        MAX_LOUDNESS_BLOCKS,
    };

    /// Block energy at a block loudness, written out rather than taken from the
    /// production helper so these oracles do not inherit the thing they check.
    pub(super) fn energy(lufs: f64) -> f64 {
        10.0_f64.powf((lufs + 0.691) / 10.0)
    }

    pub(super) fn energies(lufs: &[f32]) -> Vec<f64> {
        lufs.iter().map(|&l| energy(f64::from(l))).collect()
    }

    /// BS.1770-4 §5.1's gated integrated loudness, written as the
    /// recommendation states it: gate on energies, average energies, take the
    /// logarithm once at the end.
    fn reference_integrated(blocks: &[f64]) -> f32 {
        if blocks.is_empty() {
            return -100.0;
        }
        let absolute_gate = energy(-70.0);
        let above_absolute: Vec<f64> = blocks
            .iter()
            .copied()
            .filter(|&e| e > absolute_gate)
            .collect();
        if above_absolute.is_empty() {
            return -100.0;
        }
        let mean_abs = above_absolute.iter().sum::<f64>() / above_absolute.len() as f64;
        let rel_threshold = mean_abs * 10.0_f64.powf(-10.0 / 10.0);
        let above_relative: Vec<f64> = above_absolute
            .iter()
            .copied()
            .filter(|&e| e > rel_threshold)
            .collect();
        if above_relative.is_empty() {
            return -100.0;
        }
        let mean = above_relative.iter().sum::<f64>() / above_relative.len() as f64;
        (-0.691 + 10.0 * mean.log10()) as f32
    }

    /// EBU Tech 3342's loudness range, same treatment: the relative gate is
    /// 20 LU below the loudness of the mean *energy*.
    fn reference_lra(blocks: &[f64]) -> f32 {
        if blocks.len() < 2 {
            return 0.0;
        }
        let absolute_gate = energy(-70.0);
        let above_abs: Vec<f64> = blocks
            .iter()
            .copied()
            .filter(|&e| e > absolute_gate)
            .collect();
        if above_abs.is_empty() {
            return 0.0;
        }
        let mean = above_abs.iter().sum::<f64>() / above_abs.len() as f64;
        let rel_threshold = mean * 10.0_f64.powf(-20.0 / 10.0);
        let mut above_rel: Vec<f64> = above_abs
            .into_iter()
            .filter(|&e| e > rel_threshold)
            .collect();
        if above_rel.len() < 2 {
            return 0.0;
        }
        above_rel.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let n = above_rel.len();
        let p10_idx = (n as f32 * 0.10) as usize;
        let p95_idx = ((n as f32 * 0.95) as usize).min(n - 1);
        (10.0 * (above_rel[p95_idx] / above_rel[p10_idx]).log10()) as f32
    }

    fn actual_lra(blocks: &[f64]) -> f32 {
        let mut scratch = Vec::with_capacity(blocks.len());
        gated_loudness_range(blocks, &mut scratch)
    }

    /// Smoothly-spread material. This is the distribution the histogram handled
    /// fine, kept so a regression toward bucketing is still caught here too.
    fn synthetic_blocks(count: usize, seed: u32) -> Vec<f64> {
        let mut state = seed;
        (0..count)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let unit = f64::from((state >> 16) as u16) / 65_535.0;
                energy(-80.0 + unit * 76.0)
            })
            .collect()
    }

    /// A quiet section and a loud section — dialogue plus music, or programme
    /// plus a calibration tone. Two tight clusters rather than a spread, which
    /// is what ordinary material actually looks like and what broke the
    /// histogram: when a cluster sits near the relative gate, a bucketed store
    /// decides all of it as a unit while the reference splits it.
    fn bimodal_blocks(quiet_lufs: f64) -> Vec<f64> {
        let mut blocks = Vec::with_capacity(1_000);
        for i in 0..800 {
            blocks.push(energy(quiet_lufs + f64::from(i % 7) * 0.003));
        }
        for i in 0..200 {
            blocks.push(energy(20.0 + f64::from(i % 5) * 0.01));
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
            let quiet = -34.0 + f64::from(step);
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
            let quiet = -34.0 + f64::from(step);
            let blocks = bimodal_blocks(quiet);
            assert_eq!(
                actual_lra(&blocks).to_bits(),
                reference_lra(&blocks).to_bits(),
                "quiet section at {quiet:.1} LUFS"
            );
        }
    }

    /// An exact store has no ceiling to saturate against.
    ///
    /// This deliberately only covers the under-capacity path; the same property
    /// past capacity, where a fixed-size structure *can* impose a ceiling, is
    /// `extreme_loudness_tests`. Keeping this one narrow is the point — an
    /// earlier version asserted "not clamped" only here, where clamping is
    /// impossible by construction, and stayed green while the quantile path
    /// capped loudness range near 80 LU.
    #[test]
    fn very_loud_blocks_are_not_clamped_under_capacity() {
        for level in [60.0_f64, 200.0, 760.0] {
            let blocks = vec![energy(level); 4];
            assert_eq!(
                gated_integrated_lufs(&blocks).to_bits(),
                reference_integrated(&blocks).to_bits(),
                "level {level}"
            );
            assert!(
                (f64::from(gated_integrated_lufs(&blocks)) - level).abs() < 1e-3,
                "level {level} read back as {}",
                gated_integrated_lufs(&blocks)
            );
        }
    }

    #[test]
    fn blocks_under_the_absolute_gate_are_excluded_but_still_counted() {
        // The reference stored every block and gated at read time; `blocks.len()`
        // therefore included sub-gate blocks, and LRA's `< 2` guard saw them.
        let blocks = energies(&[-90.0_f32, -70.0, f32::NAN, -20.0, -21.0]);
        assert_eq!(
            gated_integrated_lufs(&blocks).to_bits(),
            reference_integrated(&blocks).to_bits()
        );
        assert_eq!(
            actual_lra(&blocks).to_bits(),
            reference_lra(&blocks).to_bits()
        );
    }

    #[test]
    fn every_block_is_retained_up_to_capacity() {
        let mut store = BlockStore::new();
        let offered: Vec<f64> = (0..MAX_LOUDNESS_BLOCKS)
            .map(|i| energy(i as f64 * 0.001 - 30.0))
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
            store.push(energy(i as f64 * 0.001 - 30.0));
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
        let full: Vec<f64> = (0..MAX_LOUDNESS_BLOCKS * 6)
            .map(|i| energy(if i % 5 == 0 { -12.0 } else { -26.0 }))
            .collect();
        let mut store = BlockStore::new();
        for &b in &full {
            store.push(b);
        }
        let loud_gate = energy(-20.0);
        let loud = store.as_slice().iter().filter(|&&b| b > loud_gate).count();
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
        let mut scratch: Vec<f64> = Vec::with_capacity(MAX_LOUDNESS_BLOCKS);
        // Fill to capacity outside the guard; that part is the ordinary path.
        for i in 0..MAX_LOUDNESS_BLOCKS {
            store.push(energy(i as f64 * 0.001 - 30.0));
        }

        assert_no_alloc(|| {
            // Three more hours: every one of these takes the replacement branch.
            for i in 0..MAX_LOUDNESS_BLOCKS / 8 {
                store.push(energy(i as f64 * 0.001 - 30.0));
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
mod energy_domain_gating_tests {
    //! BS.1770-4 gates and integrates the mean of block **energies**. What this
    //! replaced summed the blocks' decibel values and divided by the count.
    //!
    //! The two agree exactly on a steady programme and nowhere else. The
    //! arithmetic mean of decibels is at or below the decibel of the mean by
    //! Jensen's inequality, always in the same direction, with a gap that grows
    //! with the programme's dynamic range — so a dynamic master read quieter
    //! than it is, which is the direction that makes an engineer push it harder
    //! and overshoot the delivery target.
    //!
    //! Two mechanisms, measured separately below, because they compound and a
    //! single number would hide one of them:
    //!
    //! 1. **The average itself is biased**, even when both domains gate the same
    //!    blocks in.
    //! 2. **The relative gate moves**, because it is derived from that same
    //!    average. A threshold that sits too low admits quiet blocks the
    //!    recommendation excludes, and those blocks then drag the answer down
    //!    again.

    use super::loudness_block_store_tests::energy;
    use super::{gated_integrated_lufs, gated_loudness_range};

    /// The gated integrated loudness as it was computed before this repair:
    /// both gates and the final average taken on decibel values.
    fn decibel_average_integrated(lufs: &[f32]) -> f32 {
        let above_absolute: Vec<f64> = lufs
            .iter()
            .map(|&b| f64::from(b))
            .filter(|&b| b > -70.0)
            .collect();
        if above_absolute.is_empty() {
            return -100.0;
        }
        let mean = above_absolute.iter().sum::<f64>() / above_absolute.len() as f64;
        let above_relative: Vec<f64> = above_absolute
            .iter()
            .copied()
            .filter(|&b| b > mean - 10.0)
            .collect();
        (above_relative.iter().sum::<f64>() / above_relative.len() as f64) as f32
    }

    /// Loudness range as it was computed before this repair: relative gate 20 LU
    /// below the arithmetic mean of the blocks' decibel values.
    fn decibel_average_lra(lufs: &[f32]) -> f32 {
        let above_abs: Vec<f32> = lufs.iter().copied().filter(|&b| b > -70.0).collect();
        if above_abs.is_empty() {
            return 0.0;
        }
        let mean = above_abs.iter().sum::<f32>() / above_abs.len() as f32;
        let mut above_rel: Vec<f32> = above_abs
            .iter()
            .copied()
            .filter(|&b| b > mean - 20.0)
            .collect();
        if above_rel.len() < 2 {
            return 0.0;
        }
        above_rel.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let n = above_rel.len();
        let p10 = (n as f32 * 0.10) as usize;
        let p95 = ((n as f32 * 0.95) as usize).min(n - 1);
        above_rel[p95] - above_rel[p10]
    }

    /// A programme alternating between two levels `separation` LU apart — the
    /// simplest thing with a dynamic range.
    fn alternating(loud_lufs: f32, separation: f32) -> Vec<f32> {
        (0..1_000)
            .map(|i| {
                if i % 2 == 0 {
                    loud_lufs
                } else {
                    loud_lufs - separation
                }
            })
            .collect()
    }

    fn as_energies(lufs: &[f32]) -> Vec<f64> {
        lufs.iter().map(|&l| energy(f64::from(l))).collect()
    }

    #[test]
    fn a_steady_programme_reads_the_same_in_either_domain() {
        // Jensen's inequality is an equality when every block is identical, so
        // the two implementations must agree exactly here. Without this, the
        // measurements below could be explained by an unrelated offset rather
        // than by the averaging domain.
        let steady = vec![-14.0_f32; 1_000];
        let energy_domain = gated_integrated_lufs(&as_energies(&steady));
        let decibel_domain = decibel_average_integrated(&steady);
        assert!(
            (energy_domain - decibel_domain).abs() < 1e-3,
            "a steady −14 LUFS programme reads {energy_domain:.4} in the energy domain \
             and {decibel_domain:.4} in the decibel domain; they must agree exactly on \
             material with no dynamic range"
        );
    }

    #[test]
    fn averaging_decibels_biases_a_dynamic_programme_low() {
        // 12 LU apart: both domains admit all 1,000 blocks, so this isolates
        // mechanism 1 — the bias in the average itself, with gate membership
        // held fixed.
        let programme = alternating(-10.0, 12.0);
        let energy_domain = gated_integrated_lufs(&as_energies(&programme));
        let decibel_domain = decibel_average_integrated(&programme);

        // Measured: −12.7446 LUFS against −16.0000 LUFS.
        assert!(
            (energy_domain - (-12.7446)).abs() < 0.01,
            "energy-domain integrated loudness moved to {energy_domain:.4} LUFS"
        );
        assert!(
            (decibel_domain - (-16.0)).abs() < 0.01,
            "decibel-average integrated loudness moved to {decibel_domain:.4} LUFS"
        );
        assert!(
            energy_domain - decibel_domain > 3.0,
            "the decibel average reads {decibel_domain:.4} LUFS against the \
             recommendation's {energy_domain:.4} LUFS — only {:.4} LU apart, so this \
             case is no longer discriminating",
            energy_domain - decibel_domain
        );
    }

    #[test]
    fn the_biased_average_also_drags_the_relative_gate_down() {
        // 14 LU apart: the energy-domain threshold now sits above the quiet
        // population and excludes it, while the decibel threshold — pulled down
        // by its own biased mean — still admits it. Mechanism 2, on top of
        // mechanism 1.
        let programme = alternating(-10.0, 14.0);
        let energy_domain = gated_integrated_lufs(&as_energies(&programme));
        let decibel_domain = decibel_average_integrated(&programme);

        // Measured: −10.0000 LUFS against −17.0000 LUFS.
        assert!(
            (energy_domain - (-10.0)).abs() < 0.01,
            "energy-domain integrated loudness moved to {energy_domain:.4} LUFS"
        );
        assert!(
            (decibel_domain - (-17.0)).abs() < 0.01,
            "decibel-average integrated loudness moved to {decibel_domain:.4} LUFS"
        );
        assert!(
            energy_domain - decibel_domain > 6.0,
            "the two gates now select different blocks, so the gap should be several \
             LU; measured {:.4}",
            energy_domain - decibel_domain
        );
    }

    #[test]
    fn the_bias_grows_with_the_programmes_dynamic_range() {
        // The error is not a constant offset that a calibration could absorb —
        // it is a function of the material, which is why it has to be fixed in
        // the arithmetic rather than trimmed out afterwards.
        let mut previous = 0.0_f32;
        for separation in [2.0_f32, 4.0, 6.0, 8.0, 10.0, 12.0] {
            let programme = alternating(-10.0, separation);
            let gap = gated_integrated_lufs(&as_energies(&programme))
                - decibel_average_integrated(&programme);
            assert!(
                gap > previous,
                "the decibel-average error was {previous:.4} LU at the previous \
                 separation and {gap:.4} LU at {separation} LU — it must grow with \
                 dynamic range"
            );
            previous = gap;
        }
        // Measured at 12 LU separation: 3.2554 LU.
        assert!(
            previous > 3.0,
            "the error only reached {previous:.4} LU across the sweep"
        );
    }

    /// A quiet tail under a body with its own internal spread — a fade-out, or
    /// room tone left on the end of a master.
    fn quiet_tail(tail_lufs: f32) -> Vec<f32> {
        let mut blocks = vec![tail_lufs; 200];
        for i in 0..800 {
            blocks.push(-12.0 + (i as f32 / 799.0) * 4.0);
        }
        blocks
    }

    #[test]
    fn the_loudness_range_relative_gate_is_taken_on_energies() {
        // EBU Tech 3342 puts the loudness-range gate 20 LU below the loudness of
        // the mean *energy*. The percentiles either side of it were never
        // wrong — energy is a strictly increasing function of loudness, so the
        // ranking is the same — but the gate deciding which blocks are ranked
        // was computed by averaging decibels, and sat too low.
        //
        // At a −34 LUFS tail the two thresholds fall either side of it: the
        // recommendation excludes the tail, the decibel average admits it, and
        // admitting it moves the 10th percentile onto the tail so the whole
        // reported range changes character.
        let programme = quiet_tail(-34.0);
        let mut scratch = Vec::with_capacity(programme.len());
        let energy_domain = gated_loudness_range(&as_energies(&programme), &mut scratch);
        let decibel_domain = decibel_average_lra(&programme);

        // Measured: 3.4043 LU against 25.7547 LU.
        assert!(
            (energy_domain - 3.4043).abs() < 0.01,
            "energy-domain loudness range moved to {energy_domain:.4} LU"
        );
        assert!(
            (decibel_domain - 25.7547).abs() < 0.01,
            "decibel-average loudness range moved to {decibel_domain:.4} LU"
        );
        assert!(
            decibel_domain - energy_domain > 20.0,
            "the decibel-average gate reports a range of {decibel_domain:.4} LU against \
             the recommendation's {energy_domain:.4} LU"
        );
    }

    #[test]
    fn the_absolute_gate_is_the_energy_at_minus_seventy_lufs() {
        // Both gated computations compare energies against this instead of
        // comparing decibels against −70, so the two have to name the same
        // point or every gate in the file is off by however far they differ.
        let gate = super::absolute_gate_energy();
        assert!(
            (super::loudness_from_energy(gate) - (-70.0)).abs() < 1e-4,
            "the absolute gate energy {gate:e} corresponds to {} LUFS, not −70",
            super::loudness_from_energy(gate)
        );
        assert!(
            (energy(-70.0) - gate).abs() < gate * 1e-12,
            "the test helper and the production gate disagree about the energy at \
             −70 LUFS"
        );
    }

    #[test]
    fn loudness_and_energy_round_trip() {
        for lufs in [-70.0_f64, -40.0, -23.0, -14.0, -0.691, 0.0, 24.0, 200.0] {
            let round_tripped = super::loudness_from_energy(super::energy_from_loudness(lufs));
            assert!(
                (f64::from(round_tripped) - lufs).abs() < 1e-3,
                "{lufs} LUFS round-tripped to {round_tripped}"
            );
        }
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

    use super::loudness_block_store_tests::energy;
    use super::{gated_integrated_lufs, BlockStore, MAX_LOUDNESS_BLOCKS};

    fn reference_integrated(blocks: &[f64]) -> f32 {
        if blocks.is_empty() {
            return -100.0;
        }
        let absolute_gate = energy(-70.0);
        let above_absolute: Vec<f64> = blocks
            .iter()
            .copied()
            .filter(|&e| e > absolute_gate)
            .collect();
        if above_absolute.is_empty() {
            return -100.0;
        }
        let mean_abs = above_absolute.iter().sum::<f64>() / above_absolute.len() as f64;
        let rel_threshold = mean_abs * 10.0_f64.powf(-10.0 / 10.0);
        let above_relative: Vec<f64> = above_absolute
            .iter()
            .copied()
            .filter(|&e| e > rel_threshold)
            .collect();
        if above_relative.is_empty() {
            return -100.0;
        }
        let mean = above_relative.iter().sum::<f64>() / above_relative.len() as f64;
        (-0.691 + 10.0 * mean.log10()) as f32
    }

    fn loudness(energy: f64) -> f64 {
        -0.691 + 10.0 * energy.log10()
    }

    /// How far, in LU, the nearest block population sits from the relative
    /// gate. When this approaches zero the measure is on a knife edge: an
    /// arbitrarily small change to the input moves a whole population across
    /// the gate and the answer jumps. That is a property of R128's gate, not of
    /// any implementation of it.
    fn gate_margin(blocks: &[f64]) -> f64 {
        let absolute_gate = energy(-70.0);
        let above: Vec<f64> = blocks
            .iter()
            .copied()
            .filter(|&e| e > absolute_gate)
            .collect();
        if above.is_empty() {
            return f64::INFINITY;
        }
        let threshold = loudness(above.iter().sum::<f64>() / above.len() as f64) - 10.0;
        above
            .iter()
            .map(|&e| (loudness(e) - threshold).abs())
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
    fn periodic(period: usize, phase: usize, blocks: usize) -> Vec<f64> {
        periodic_at(period, phase, blocks, 0.0, -40.0)
    }

    fn periodic_at(
        period: usize,
        phase: usize,
        blocks: usize,
        loud_lufs: f64,
        quiet_lufs: f64,
    ) -> Vec<f64> {
        (0..blocks)
            .map(|i| {
                energy(if i % period == phase {
                    loud_lufs
                } else {
                    quiet_lufs
                })
            })
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
                let delta =
                    (gated_integrated_lufs(store.as_slice()) - reference_integrated(&full)).abs();
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

        let loud_gate = energy(-20.0);
        let loud_retained = store.as_slice().iter().filter(|&&b| b > loud_gate).count();
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

    /// The quiet level that places the quiet population exactly on the relative
    /// gate, for a `period`-block cycle carrying one loud block.
    ///
    /// Solved by fixed point rather than written down, because the gate is
    /// derived from the data: moving the quiet population moves the mean energy,
    /// which moves the gate. Substituting the current guess back in converges in
    /// a handful of steps because the quiet blocks contribute only a small
    /// fraction of the mean energy.
    fn quiet_level_on_the_gate(period: usize, loud_lufs: f64) -> f64 {
        let mut quiet = loud_lufs - 20.0;
        for _ in 0..64 {
            let mean = (energy(loud_lufs) + (period - 1) as f64 * energy(quiet)) / period as f64;
            quiet = loudness(mean) - 10.0;
        }
        quiet
    }

    #[test]
    fn the_gate_is_discontinuous_where_a_population_sits_on_it() {
        // Justifies the skip above, rather than asserting it. Perturbing the
        // *input* by 0.01 LU — nothing to do with how blocks are stored — moves
        // the reference itself by tens of LU, because a whole population
        // crosses the gate.
        let quiet = quiet_level_on_the_gate(4, 0.0);
        let at_the_edge = periodic_at(4, 1, 4_000, 0.0, quiet);
        assert!(
            gate_margin(&at_the_edge) < 0.01,
            "expected this configuration to sit on the gate, margin was {:.4} LU",
            gate_margin(&at_the_edge)
        );

        // Downward, which is the direction that crosses: the gate is a stable
        // fixed point, so nudging the quiet population up carries the threshold
        // most of the way with it, while nudging it down drops it clear.
        let nudged = periodic_at(4, 1, 4_000, 0.0, quiet - 0.01);

        let before = reference_integrated(&at_the_edge);
        let after = reference_integrated(&nudged);
        assert!(
            (after - before).abs() > 1.0,
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
        let mut full = vec![energy(-40.0); MAX_LOUDNESS_BLOCKS * 3];
        for block in full.iter_mut().skip(MAX_LOUDNESS_BLOCKS * 3 / 2) {
            *block = energy(0.0);
        }
        let mut store = BlockStore::new();
        for &b in &full {
            store.push(b);
        }
        let loud_gate = energy(-20.0);
        let loud = store.as_slice().iter().filter(|&&b| b > loud_gate).count();
        let fraction = loud as f64 / store.as_slice().len() as f64;
        assert!(
            (fraction - 0.5).abs() < 0.02,
            "retained {fraction:.4} of the second half against a true 0.5000 — the store \
             is favouring one part of the programme"
        );
    }
}

#[cfg(test)]
mod loudness_range_past_capacity_tests {
    //! Loudness range is a pair of order statistics, not a mean. A uniform
    //! sample estimates a population's *proportion* to within a fraction of a
    //! percent, which is harmless for an average and not harmless at all for a
    //! percentile: if a population boundary sits near the 10th percentile, that
    //! same fraction of a percent moves the index across it and the answer
    //! jumps by the whole gap between populations.

    use super::loudness_block_store_tests::energy;
    use super::{LoudnessRange, MAX_LOUDNESS_BLOCKS};

    fn reference_lra(blocks: &[f64]) -> f32 {
        if blocks.len() < 2 {
            return 0.0;
        }
        let absolute_gate = energy(-70.0);
        let above_abs: Vec<f64> = blocks
            .iter()
            .copied()
            .filter(|&e| e > absolute_gate)
            .collect();
        if above_abs.is_empty() {
            return 0.0;
        }
        let mean = above_abs.iter().sum::<f64>() / above_abs.len() as f64;
        let rel_threshold = mean * 10.0_f64.powf(-20.0 / 10.0);
        let mut above_rel: Vec<f64> = above_abs
            .into_iter()
            .filter(|&e| e > rel_threshold)
            .collect();
        if above_rel.len() < 2 {
            return 0.0;
        }
        above_rel.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let n = above_rel.len();
        let p10_idx = (n as f32 * 0.10) as usize;
        let p95_idx = ((n as f32 * 0.95) as usize).min(n - 1);
        (10.0 * (above_rel[p95_idx] / above_rel[p10_idx]).log10()) as f32
    }

    /// A quiet intro against a louder body — the commonest programme shape
    /// there is. `quiet_fraction` of the blocks sit at −38 LUFS, the rest at
    /// −18. Both clear the relative gate, so the whole sequence is in play.
    fn quiet_intro(quiet_fraction: f64, blocks: usize) -> Vec<f64> {
        let quiet = (blocks as f64 * quiet_fraction) as usize;
        (0..blocks)
            .map(|i| energy(if i < quiet { -38.0 } else { -18.0 }))
            .collect()
    }

    /// Drive the real meter one block at a time, which is what
    /// `process_sample` does at every 100 ms hop.
    fn meter_lra(full: &[f64]) -> f32 {
        let mut meter = LoudnessRange::new(48_000.0);
        meter.record_blocks_for_test(full);
        meter.get_lra()
    }

    #[test]
    fn batched_recording_matches_block_by_block() {
        // Justifies `record_blocks_for_test`, so the long cases below are not
        // testing a shortcut that production never takes.
        let programme = quiet_intro(0.10, 2_000);
        let mut incremental = LoudnessRange::new(48_000.0);
        for &b in &programme {
            incremental.record_block_for_test(b);
        }
        let mut batched = LoudnessRange::new(48_000.0);
        batched.record_blocks_for_test(&programme);
        assert_eq!(incremental.get_lra().to_bits(), batched.get_lra().to_bits());
    }

    #[test]
    fn loudness_range_survives_a_population_boundary_at_the_tenth_percentile() {
        // Six hours. The quiet section is exactly a tenth of the programme, so
        // the p10 index lands on the boundary between the two populations —
        // where a sampled count that is a fraction of a percent heavy reads the
        // wrong population entirely.
        let full = quiet_intro(0.10, 216_000);
        assert!(
            full.len() > MAX_LOUDNESS_BLOCKS,
            "this case only means anything past capacity"
        );
        let expected = reference_lra(&full);
        let actual = meter_lra(&full);
        assert!(
            (actual - expected).abs() < 1.0,
            "LRA reads {actual:.4} LU against an exact {expected:.4} LU — the percentile \
             index crossed a population boundary, so the error is the entire gap between \
             populations rather than a sampling wobble"
        );
    }

    #[test]
    fn loudness_range_holds_across_programme_lengths_and_intro_sizes() {
        let mut worst = 0.0f32;
        let mut worst_case = (0.0, 0);
        for hours in [1_usize, 2, 4, 6] {
            for quiet_fraction in [0.05, 0.08, 0.10, 0.12, 0.20] {
                let full = quiet_intro(quiet_fraction, 36_000 * hours);
                let delta = (meter_lra(&full) - reference_lra(&full)).abs();
                if delta > worst {
                    worst = delta;
                    worst_case = (quiet_fraction, hours);
                }
            }
        }
        assert!(
            worst < 0.05,
            "worst LRA divergence {worst:.4} LU at a {:.0}% intro over {} h",
            worst_case.0 * 100.0,
            worst_case.1
        );
    }

    /// Continuously distributed loudness, where a percentile lands mid-bin
    /// rather than on a population. This is where the bin width shows up: the
    /// returned value is its bin's centre, so each percentile is within half a
    /// bin and their difference within a whole one.
    fn continuous(blocks: usize, seed: u32) -> Vec<f64> {
        let mut state = seed;
        (0..blocks)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let unit = f64::from((state >> 16) as u16) / 65_535.0;
                energy(-45.0 + unit * 35.0)
            })
            .collect()
    }

    #[test]
    fn loudness_range_stays_within_one_bin_on_continuous_material() {
        let mut worst = 0.0f32;
        for seed in [3_u32, 11, 29, 101] {
            for hours in [2_usize, 6] {
                let full = continuous(36_000 * hours, seed);
                let delta = (meter_lra(&full) - reference_lra(&full)).abs();
                worst = worst.max(delta);
            }
        }
        // Two bins, from two independent halves:
        //
        // - Each percentile is reported as its bin's centre, so each is within
        //   half a bin and their difference within one bin (0.01 LU).
        // - The relative gate is compared against a bin's centre, so it admits
        //   or excludes a whole bin at once. On continuous material that moves
        //   the gated population by about a bin's worth of blocks, which can
        //   displace a rank into the neighbouring bin — one more bin (0.01 LU).
        //
        // The second half is not new; the gate has always been applied to
        // binned loudness. Its size depends on where the threshold happens to
        // fall between bin edges, so it moved when the threshold moved into the
        // energy domain: measured worst was 0.0031 LU, and is now 0.0116 LU
        // (seed 11 at six hours; every other case in this sweep is under
        // 0.0073 LU).
        assert!(
            worst < 0.02,
            "worst LRA divergence on continuous material {worst:.4} LU exceeds the \
             two-bin ceiling — the percentile lookup is not doing what its bin width says"
        );
    }

    #[test]
    fn recording_past_capacity_does_not_allocate() {
        // The quantile histogram is fed on every block, so it sits on the audio
        // thread alongside the block store. Fill to capacity outside the guard,
        // then drive further blocks through the real `record_block` inside it —
        // every one of those takes the replacement branch.
        use assert_no_alloc::assert_no_alloc;

        let mut meter = LoudnessRange::new(48_000.0);
        let prefill: Vec<f64> = (0..MAX_LOUDNESS_BLOCKS)
            .map(|i| energy(-20.0 + (i % 97) as f64 * 0.1))
            .collect();
        meter.record_blocks_for_test(&prefill);

        assert_no_alloc(|| {
            for i in 0..4_000 {
                meter.record_block_for_test(energy(-20.0 + f64::from(i % 89) * 0.1));
            }
        });
        assert!(
            meter.get_lra() > 0.0,
            "the meter should still be reporting a range"
        );
    }
}

#[cfg(test)]
mod extreme_loudness_tests {
    //! A metering path exists partly to surface anomalies. A runaway filter or a
    //! feedback blowup drives block loudness far above anything music reaches,
    //! and the meter's job is to show that, not to quietly report a plausible
    //! number instead.

    use super::loudness_block_store_tests::energy;
    use super::{
        LoudnessRange, MAX_LOUDNESS_BLOCKS, QUANTILE_BINS, QUANTILE_BIN_LU, QUANTILE_MIN_LUFS,
    };

    fn reference_lra(blocks: &[f64]) -> f32 {
        if blocks.len() < 2 {
            return 0.0;
        }
        let absolute_gate = energy(-70.0);
        let above_abs: Vec<f64> = blocks
            .iter()
            .copied()
            .filter(|&e| e > absolute_gate)
            .collect();
        if above_abs.is_empty() {
            return 0.0;
        }
        let mean = above_abs.iter().sum::<f64>() / above_abs.len() as f64;
        let rel_threshold = mean * 10.0_f64.powf(-20.0 / 10.0);
        let mut above_rel: Vec<f64> = above_abs
            .into_iter()
            .filter(|&e| e > rel_threshold)
            .collect();
        if above_rel.len() < 2 {
            return 0.0;
        }
        above_rel.sort_by(|a, b| a.partial_cmp(b).unwrap_or(core::cmp::Ordering::Equal));
        let n = above_rel.len();
        let p10_idx = (n as f32 * 0.10) as usize;
        let p95_idx = ((n as f32 * 0.95) as usize).min(n - 1);
        (10.0 * (above_rel[p95_idx] / above_rel[p10_idx]).log10()) as f32
    }

    fn meter_lra(full: &[f64]) -> f32 {
        let mut meter = LoudnessRange::new(48_000.0);
        meter.record_blocks_for_test(full);
        meter.get_lra()
    }

    /// A steady programme with a loud anomalous passage on the end. 40,000
    /// blocks, so the store is past capacity and the quantile path is in use.
    fn with_spike(spike_lufs: f64) -> Vec<f64> {
        let mut blocks = vec![energy(-20.0); 38_000];
        blocks.extend(core::iter::repeat(energy(spike_lufs)).take(2_000));
        blocks
    }

    /// The past-capacity half of "no ceiling to saturate against", which is
    /// where a fixed-size structure can actually impose one.
    #[test]
    fn very_loud_blocks_are_not_clamped_past_capacity() {
        for level in [70.0_f64, 200.0, 760.0] {
            // A quiet body so the loud passage stays above the relative gate
            // rather than dragging the mean up past it.
            let mut blocks = vec![energy(level - 25.0); 38_000];
            blocks.extend(core::iter::repeat(energy(level)).take(2_000));
            assert!(blocks.len() > MAX_LOUDNESS_BLOCKS);

            let expected = reference_lra(&blocks);
            let actual = meter_lra(&blocks);
            assert!(
                (actual - expected).abs() < 0.01,
                "a {level} LUFS passage reports a range of {actual:.4} LU against an exact \
                 {expected:.4} LU — something is capping the reported loudness"
            );
        }
    }

    /// The bin range must cover every loudness a block can actually carry.
    ///
    /// `MomentaryLufs::get_lufs` is `-0.691 + 10*log10(mean_sq)`, and `mean_sq`
    /// is accumulated in f64 from f32 samples, so it peaks at `f32::MAX`
    /// squared. Deriving the bound here rather than trusting a comment means a
    /// change to the formula or to the sample type fails this test instead of
    /// quietly re-introducing a ceiling.
    #[test]
    fn the_binned_range_covers_every_reachable_block_loudness() {
        let max_mean_square = f64::from(f32::MAX) * f64::from(f32::MAX);
        let max_block_lufs = -0.691 + 10.0 * max_mean_square.log10();
        // K-weighting can add a few dB of gain on top before the mean square is
        // taken, so leave room rather than sitting exactly on the bound.
        let top_edge =
            f64::from(QUANTILE_MIN_LUFS) + QUANTILE_BINS as f64 * f64::from(QUANTILE_BIN_LU);
        assert!(
            max_block_lufs + 20.0 < top_edge,
            "the loudest reachable block is {max_block_lufs:.1} LUFS but the bins stop at \
             {top_edge:.1} — extreme loudness would saturate into the last bin"
        );
    }

    #[test]
    fn no_finite_block_loudness_is_clamped_past_capacity() {
        let mut worst = 0.0f32;
        let mut worst_spike = 0.0f64;
        for spike in [60.0f64, 70.0, 100.0, 200.0, 500.0] {
            let full = with_spike(spike);
            assert!(
                full.len() > MAX_LOUDNESS_BLOCKS,
                "this case only means anything past capacity"
            );
            let expected = reference_lra(&full);
            let actual = meter_lra(&full);
            let delta = (actual - expected).abs();
            if delta > worst {
                worst = delta;
                worst_spike = spike;
            }
        }
        // Exact: the spike lands in its own bin like any other loudness, so
        // there is nothing left to quantise away. Measured worst: 0.0000 LU.
        assert!(
            worst < 0.01,
            "a {worst_spike:.0} LUFS passage is mis-measured by {worst:.4} LU past capacity — \
             loudness above the histogram's top edge saturates into the last bin, so the \
             meter under-reports an anomaly instead of surfacing it"
        );
    }
}
