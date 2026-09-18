//! Crossover filters for Bacteria's multi-band processing.
//!
//! Each crossover point is a Linkwitz-Riley split whose order follows the
//! panel's slope chip: 12/24/36/48 dB per octave select LR2/LR4/LR6/LR8 — a
//! cascade of two Butterworth sections of half the order. LR4 (24 dB) is the
//! shipped default and what the device ran before slopes were selectable.
//!
//! Two phase modes:
//!
//! - **Minimum phase** (default): the LR IIR split above. Bands recombine
//!   into an allpass — flat magnitude, frequency-dependent phase — and lower
//!   bands are phase-compensated by allpass sections so they add coherently.
//!   Zero latency.
//!
//! - **Linear phase**: each point renders a symmetric FIR pair derived from
//!   its own LR prototype. The low output is the zero-phase magnitude-squared
//!   response `|H_lp|²` (windowed truncation of the prototype's
//!   autocorrelation), and the high output is the exact complement
//!   `x[n−D] − low[n]`, so the two bands re-sum to the input delayed by D
//!   samples *identically at every frequency* — recombination is exact by
//!   construction; only band isolation is an approximation, degrading for
//!   corners well below a few hundred hertz where a 127-tap window can no
//!   longer resolve the transition. Every band is padded to the same
//!   `points × D` delay, which [`CrossoverEngine::latency_samples`] reports
//!   for host compensation.
//!
//! Supports 1–6 bands with up to 5 crossover points. The full topology is
//! pre-allocated at construction: `set_bands`, `set_slope` and `set_mode` run
//! on the audio rendering thread (via `set_param`), so none of them may grow
//! or allocate — only recompute coefficients and clear state.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

/// Crossover slope options — the panel's 12/24/36/48 dB per octave chips.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CrossoverSlope {
    Db12,
    Db24,
    Db36,
    Db48,
}

impl CrossoverSlope {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::Db12,
            1 => Self::Db24,
            2 => Self::Db36,
            _ => Self::Db48,
        }
    }
}

/// One Butterworth section: second-order with pole pair `q`, or a single real
/// pole when `first_order` is set (`q` unused).
struct SectionSpec {
    q: f32,
    first_order: bool,
}

const fn biquad_section(q: f32) -> SectionSpec {
    SectionSpec {
        q,
        first_order: false,
    }
}

const fn pole_section() -> SectionSpec {
    SectionSpec {
        q: 0.0,
        first_order: true,
    }
}

/// The branch recipes each slope chip selects, in cascaded sections.
///
/// 12 dB per octave is a single 2nd-order Butterworth (B2) per branch: its
/// low-pass and high-pass numerators sum to their common denominator, so the
/// pair recombines *identically* — flat and in phase — without the polarity
/// inversion a true LR2 (two cascaded real poles per branch) demands. The
/// other chips are genuine Linkwitz-Riley cascades — B2·B2, B3·B3, B4·B4 —
/// whose recombination is an allpass, exactly like the shipped LR4 default.
const BRANCH_SECTIONS: [[SectionSpec; 4]; 4] = [
    // 12 dB/oct — LR2: two cascaded real poles per branch. With one branch
    // polarity-reversed the pair recombines into a first-order allpass —
    // exactly flat — where a plain B2 pair would peak +3 dB.
    [
        pole_section(),
        pole_section(),
        pole_section(),
        pole_section(),
    ],
    // 24 dB/oct — LR4, the shipped default.
    [
        biquad_section(std::f32::consts::FRAC_1_SQRT_2),
        biquad_section(std::f32::consts::FRAC_1_SQRT_2),
        pole_section(),
        pole_section(),
    ],
    // 36 dB/oct — LR6: two cascaded B3 (real pole + Q = 1 pair).
    [
        pole_section(),
        biquad_section(1.0),
        pole_section(),
        biquad_section(1.0),
    ],
    // 48 dB/oct — LR8: two cascaded B4 (the two pole pairs).
    [
        biquad_section(0.541_196_1),
        biquad_section(1.306_563_0),
        biquad_section(0.541_196_1),
        biquad_section(1.306_563_0),
    ],
];

/// Live section counts per slope, matching [`BRANCH_SECTIONS`].
const BRANCH_SECTION_COUNT: [usize; 4] = [2, 2, 4, 4];

/// 2nd-order biquad filter, also used for cascaded 1st-order sections
/// (those run with `b2 = a2 = 0`).
#[derive(Clone)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn new() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn set_butterworth_lp(&mut self, freq: f32, sample_rate: f32, q: f32) {
        let w0 = 2.0 * PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        // RBJ: alpha = sin(w0) / (2Q). One LR4 stage is Butterworth, Q = 1/√2 —
        // Q = √2 here put +6 dB/stage into every crossover (audit #508 row 25).
        let alpha = sin_w0 / (2.0 * q);

        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 - cos_w0) / 2.0) / a0;
        self.b1 = (1.0 - cos_w0) / a0;
        self.b2 = self.b0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    fn set_butterworth_hp(&mut self, freq: f32, sample_rate: f32, q: f32) {
        let w0 = 2.0 * PI * freq / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q);

        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 + cos_w0) / 2.0) / a0;
        self.b1 = (-(1.0 + cos_w0)) / a0;
        self.b2 = self.b0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    /// First-order low-pass (bilinear transform of the analog prototype),
    /// stored in the biquad with the second-order terms zeroed. LR2's half is
    /// two cascaded real poles.
    fn set_first_order_lp(&mut self, freq: f32, sample_rate: f32) {
        let k = (PI * freq / sample_rate).tan();
        let denom = 1.0 + k;
        self.b0 = k / denom;
        self.b1 = k / denom;
        self.b2 = 0.0;
        self.a1 = (k - 1.0) / denom;
        self.a2 = 0.0;
    }

    fn set_first_order_hp(&mut self, freq: f32, sample_rate: f32) {
        let k = (PI * freq / sample_rate).tan();
        let denom = 1.0 + k;
        self.b0 = 1.0 / denom;
        self.b1 = -1.0 / denom;
        self.b2 = 0.0;
        self.a1 = (k - 1.0) / denom;
        self.a2 = 0.0;
    }

    fn process_sample(&mut self, input: f32) -> f32 {
        // Direct Form II Transposed
        let out = flush_denormal(self.b0 * input + self.z1);
        self.z1 = flush_denormal(self.b1 * input - self.a1 * out + self.z2);
        self.z2 = flush_denormal(self.b2 * input - self.a2 * out);
        out
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// Half-length of the linear-phase FIR pair: 127 taps, `FIR_DELAY` samples of
/// linear delay per point. Short enough that five stereo points stay a small
/// fraction of an AudioWorklet's budget; long enough that isolation holds
/// for corners in the instrument's usual range.
pub(crate) const FIR_DELAY: usize = 63;
/// Total taps: symmetric, odd.
const FIR_TAPS: usize = 2 * FIR_DELAY + 1;
/// Impulse-run length feeding the design autocorrelation. Long enough to let
/// an LR4 prototype at mid corners substantially decay; corners far below
/// that trade isolation, never recombination (which stays exact).
const DESIGN_FRAMES: usize = 512;

/// Ring of the last `FIR_TAPS` input samples for one channel of one point,
/// from which both linear-phase outputs are read.
#[derive(Clone)]
struct FirState {
    history: [f32; FIR_TAPS],
    write: usize,
}

impl FirState {
    fn new() -> Self {
        Self {
            history: [0.0; FIR_TAPS],
            write: 0,
        }
    }

    /// Push `input`, return `(low, high)`: the symmetric FIR output and its
    /// exact complement. `low + high` is the input delayed `FIR_DELAY`
    /// samples, sample for sample.
    fn process(&mut self, input: f32, taps: &[f32; FIR_TAPS]) -> (f32, f32) {
        self.history[self.write] = input;

        // y[n] = Σ h[j]·x[n−j] folded over the symmetry h[j] == h[2D−j]:
        // the two samples of each pair are D+1 apart in the ring, so one
        // ascending pass reads the whole history without modulo indexing.
        let mut acc = 0.0;
        let mut older = self.write + 1; // oldest sample, x[n−2D]
        if older == FIR_TAPS {
            older = 0;
        }
        let mut younger = self.write; // newest, x[n]
        for j in 0..FIR_DELAY {
            acc += taps[j] * (self.history[older] + self.history[younger]);
            older += 1;
            if older == FIR_TAPS {
                older = 0;
            }
            if younger == 0 {
                younger = FIR_TAPS - 1;
            } else {
                younger -= 1;
            }
        }
        // The centre tap pairs the sample with itself.
        let centre_index = (self.write + FIR_TAPS - FIR_DELAY) % FIR_TAPS;
        let centre = self.history[centre_index];
        acc += taps[FIR_DELAY] * centre;
        acc = flush_denormal(acc);

        let low = acc;
        let high = flush_denormal(centre - acc);
        self.write += 1;
        if self.write == FIR_TAPS {
            self.write = 0;
        }
        (low, high)
    }

    fn reset(&mut self) {
        self.history = [0.0; FIR_TAPS];
        self.write = 0;
    }
}

/// Whole-sample delay line padding one band out to the shared linear-phase
/// delay.
#[derive(Clone)]
struct BandTail {
    ring: [f32; (MAX_CROSSOVER_POINTS - 1) * FIR_DELAY],
    write: usize,
    delay: usize,
}

impl BandTail {
    fn new() -> Self {
        Self {
            ring: [0.0; (MAX_CROSSOVER_POINTS - 1) * FIR_DELAY],
            write: 0,
            delay: 0,
        }
    }

    fn set_delay(&mut self, delay: usize) {
        assert!(
            delay <= self.ring.len(),
            "band tail cannot exceed its pre-allocated ring"
        );
        self.delay = delay;
    }

    fn process(&mut self, input: f32) -> f32 {
        if self.delay == 0 {
            return input;
        }
        let out = self.ring[self.write];
        self.ring[self.write] = input;
        self.write = (self.write + 1) % self.delay;
        out
    }

    fn reset(&mut self) {
        self.ring = [0.0; (MAX_CROSSOVER_POINTS - 1) * FIR_DELAY];
        self.write = 0;
    }
}

/// One crossover split — low-pass and high-pass outputs for a corner.
///
/// In minimum-phase mode this is the slope's Butterworth cascade (B2 for the
/// 12 dB chip, LR4/6/8 beyond). In linear-phase mode the biquads are kept as
/// the design prototype and the runtime path is the FIR pair, so a mode
/// switch only changes which process call reads the state.
#[derive(Clone)]
pub struct CrossoverPoint {
    lp: [Biquad; MAX_SECTIONS_PER_BRANCH],
    hp: [Biquad; MAX_SECTIONS_PER_BRANCH],
    section_count: usize,
    freq: f32,
    /// +1, or −1 for the LR2 and LR6 slopes, whose branches meet in
    /// anti-phase at the corner and sum flat only polarity-reversed — the
    /// textbook wiring for those crossover classes.
    hp_polarity: f32,
    /// Symmetric linear-phase taps; designed from this point's own low-pass
    /// prototype whenever the corner or the slope moves.
    fir_taps: [f32; FIR_TAPS],
    fir_l: FirState,
    fir_r: FirState,
}

/// Biquad slots per branch: the widest recipe (orders 3 and 4) is two
/// sections per half, cascaded twice.
const MAX_SECTIONS_PER_BRANCH: usize = 4;

impl CrossoverPoint {
    pub fn new(freq: f32, sample_rate: f32) -> Self {
        let mut point = Self {
            lp: std::array::from_fn(|_| Biquad::new()),
            hp: std::array::from_fn(|_| Biquad::new()),
            section_count: 0,
            freq,
            hp_polarity: 1.0,
            fir_taps: [0.0; FIR_TAPS],
            fir_l: FirState::new(),
            fir_r: FirState::new(),
        };
        point.configure(freq, sample_rate, CrossoverSlope::Db24);
        point
    }

    /// Recompute every coefficient for this corner, slope and phase mode.
    ///
    /// Control-rate arithmetic only — called from `set_bands`, `set_slope`
    /// and `set_mode`, all of which reach here through `set_param` on the
    /// audio thread. Nothing allocates.
    fn configure(&mut self, freq: f32, sample_rate: f32, slope: CrossoverSlope) {
        self.freq = freq;
        let recipe = &BRANCH_SECTIONS[slope as usize];
        let count = BRANCH_SECTION_COUNT[slope as usize];
        self.section_count = count;
        // LRn sums flat on its own only when n is a multiple of 4 (LR4, LR8);
        // for n ≡ 2 (mod 4) — LR2 and LR6 — the two branches meet in
        // anti-phase at the corner and the high band must be polarity
        // reversed, the textbook wiring for those slopes. Applied inside the
        // point, so the split and the allpass compensation that reuses
        // `process` stay consistent.
        self.hp_polarity = match slope {
            CrossoverSlope::Db12 | CrossoverSlope::Db36 => -1.0,
            CrossoverSlope::Db24 | CrossoverSlope::Db48 => 1.0,
        };

        for (index, spec) in recipe.iter().take(count).enumerate() {
            if spec.first_order {
                self.lp[index].set_first_order_lp(freq, sample_rate);
                self.hp[index].set_first_order_hp(freq, sample_rate);
            } else {
                self.lp[index].set_butterworth_lp(freq, sample_rate, spec.q);
                self.hp[index].set_butterworth_hp(freq, sample_rate, spec.q);
            }
        }

        self.design_fir();
    }

    /// Derive the linear-phase taps from this point's own low-pass prototype:
    /// run the cascade with an impulse, window its autocorrelation (the
    /// zero-phase magnitude-squared response), normalize to exact DC gain.
    fn design_fir(&mut self) {
        let mut prototype = self.lp.clone();
        for stage in &mut prototype {
            stage.reset();
        }
        let mut impulse = [0.0_f32; DESIGN_FRAMES];
        for frame in 0..DESIGN_FRAMES {
            let mut sample = if frame == 0 { 1.0 } else { 0.0 };
            for stage in prototype.iter_mut().take(self.section_count) {
                sample = stage.process_sample(sample);
            }
            impulse[frame] = sample;
        }

        let mut taps = [0.0_f32; FIR_TAPS];
        for n in 0..=FIR_DELAY {
            let mut r = 0.0_f32;
            for m in 0..DESIGN_FRAMES - n {
                r += impulse[m] * impulse[m + n];
            }
            // Blackman window over the full 2D+1 span; symmetric in n.
            let phase = n as f32 / FIR_DELAY as f32;
            let w = 0.42 - 0.5 * (2.0 * PI * phase).cos() + 0.08 * (4.0 * PI * phase).cos();
            taps[FIR_DELAY - n] = w * r;
            taps[FIR_DELAY + n] = w * r;
        }

        // Pin the DC gain of both bands: Σtaps is |H_lp|² at DC, so after
        // normalization the low band is exactly unity and the complement
        // exactly cuts DC.
        let sum: f32 = taps.iter().sum();
        if sum > f32::EPSILON {
            for tap in &mut taps {
                *tap /= sum;
            }
        }
        self.fir_taps = taps;
    }

    /// Process one sample in minimum-phase mode, returns (low, high).
    pub fn process(&mut self, input: f32) -> (f32, f32) {
        let mut low = input;
        let mut high = input;
        for index in 0..self.section_count {
            low = self.lp[index].process_sample(low);
            high = self.hp[index].process_sample(high);
        }
        (low, self.hp_polarity * high)
    }

    /// Process one stereo sample in linear-phase mode.
    pub fn process_linear(&mut self, left: f32, right: f32) -> ((f32, f32), (f32, f32)) {
        let (low_l, high_l) = self.fir_l.process(left, &self.fir_taps);
        let (low_r, high_r) = self.fir_r.process(right, &self.fir_taps);
        ((low_l, low_r), (high_l, high_r))
    }

    pub fn reset(&mut self) {
        for stage in &mut self.lp {
            stage.reset();
        }
        for stage in &mut self.hp {
            stage.reset();
        }
        self.fir_l.reset();
        self.fir_r.reset();
    }
}

/// Multi-band crossover engine. Splits stereo input into up to 6 bands.
pub struct CrossoverEngine {
    /// Crossover points for left channel (up to 5)
    points_l: Vec<CrossoverPoint>,
    /// Crossover points for right channel (up to 5)
    points_r: Vec<CrossoverPoint>,
    /// Allpass points for left channel to compensate lower bands (up to 10)
    allpass_points_l: Vec<CrossoverPoint>,
    /// Allpass points for right channel to compensate lower bands (up to 10)
    allpass_points_r: Vec<CrossoverPoint>,
    /// Whole-sample pads that bring every band to the shared linear-phase
    /// delay. Unused in minimum-phase mode.
    band_tails_l: [BandTail; MAX_BANDS],
    band_tails_r: [BandTail; MAX_BANDS],
    band_count: usize,
    slope: CrossoverSlope,
    linear_phase: bool,
    sample_rate: f32,
}

/// Maximum crossover split points (6 bands → 5 points).
const MAX_CROSSOVER_POINTS: usize = 5;
/// Maximum allpass compensation points (Σ i for i in 1..5).
const MAX_ALLPASS_POINTS: usize = 10;
/// Maximum bands, mirrored from the engine's own constant.
const MAX_BANDS: usize = 6;

impl CrossoverEngine {
    pub fn new(sample_rate: f32) -> Self {
        // Pre-allocate the full topology at construction: set_bands runs on the
        // audio rendering thread (via set_param), so it must never grow these
        // Vecs — activity is gated by band_count, not Vec length.
        let make_points = |count: usize| {
            let mut points = Vec::with_capacity(count);
            points.resize_with(count, || CrossoverPoint::new(1000.0, sample_rate));
            points
        };
        Self {
            points_l: make_points(MAX_CROSSOVER_POINTS),
            points_r: make_points(MAX_CROSSOVER_POINTS),
            allpass_points_l: make_points(MAX_ALLPASS_POINTS),
            allpass_points_r: make_points(MAX_ALLPASS_POINTS),
            band_tails_l: std::array::from_fn(|_| BandTail::new()),
            band_tails_r: std::array::from_fn(|_| BandTail::new()),
            band_count: 1,
            slope: CrossoverSlope::Db24,
            linear_phase: false,
            sample_rate,
        }
    }

    /// Set the number of bands and crossover frequencies.
    pub fn set_bands(&mut self, band_count: usize, freqs: &[f32]) {
        let n = band_count.clamp(1, 6);

        // Topology switch: reset biquad state (z1/z2) so newly activated points
        // don't replay stale state from a previous configuration (click) and
        // active points don't carry history across the band-layout change.
        if n != self.band_count {
            self.reset();
        }
        self.band_count = n;

        self.apply_configuration(freqs);
    }

    /// Select the slope chip: LR2/LR4/LR6/LR8 for 12/24/36/48 dB per octave.
    pub fn set_slope(&mut self, slope: CrossoverSlope, freqs: &[f32]) {
        if slope != self.slope {
            self.slope = slope;
            // Coefficients change across every point; drop in-flight state so
            // the new filters do not replay the old ones' history.
            self.reset();
            self.apply_configuration(freqs);
        }
    }

    /// Select the phase mode: minimum-phase LR IIR, or the linear-phase FIR
    /// pair with its `latency_samples` delay.
    pub fn set_mode(&mut self, linear_phase: bool, freqs: &[f32]) {
        if linear_phase != self.linear_phase {
            self.linear_phase = linear_phase;
            self.reset();
            self.apply_configuration(freqs);
        }
    }

    /// Push the stored band count, corners, slope and mode into every point.
    fn apply_configuration(&mut self, freqs: &[f32]) {
        let num_xovers = self.band_count.saturating_sub(1).min(MAX_CROSSOVER_POINTS);

        let mut ap_idx = 0;
        for i in 0..num_xovers {
            let freq = freqs.get(i).copied().unwrap_or(1000.0).clamp(20.0, 20000.0);
            self.points_l[i].configure(freq, self.sample_rate, self.slope);
            self.points_r[i].configure(freq, self.sample_rate, self.slope);

            if i > 0 {
                for _j in 0..i {
                    self.allpass_points_l[ap_idx].configure(freq, self.sample_rate, self.slope);
                    self.allpass_points_r[ap_idx].configure(freq, self.sample_rate, self.slope);
                    ap_idx += 1;
                }
            }
        }

        // Linear-phase pads: band j already carries (j+1)·D from the cascade
        // and the top band k·D, so padding band j by (k−1−j)·D lands every
        // band on the same k·D the latency report names.
        let shared = self.latency_samples();
        for (j, tail) in self.band_tails_l.iter_mut().enumerate() {
            tail.set_delay(shared.saturating_sub((j + 1) * FIR_DELAY));
        }
        for (j, tail) in self.band_tails_r.iter_mut().enumerate() {
            tail.set_delay(shared.saturating_sub((j + 1) * FIR_DELAY));
        }
    }

    /// The whole-sample delay the linear-phase mode inserts, in samples.
    ///
    /// Zero in minimum-phase mode (the LR IIR is zero-latency); otherwise
    /// every band is padded to `points × FIR_DELAY`, which is the figure the
    /// engine reports to the host.
    pub fn latency_samples(&self) -> usize {
        if self.linear_phase {
            self.band_count.saturating_sub(1).min(MAX_CROSSOVER_POINTS) * FIR_DELAY
        } else {
            0
        }
    }

    /// Split a stereo sample into per-band outputs.
    /// Returns arrays of (left, right) for each band.
    pub fn process_sample(
        &mut self,
        left: f32,
        right: f32,
        bands_l: &mut [f32],
        bands_r: &mut [f32],
    ) {
        if self.band_count <= 1 {
            bands_l[0] = left;
            bands_r[0] = right;
            return;
        }

        let num_xovers = (self.band_count - 1).min(MAX_CROSSOVER_POINTS);

        if self.linear_phase {
            // Cascading split through the FIR pairs. No allpass compensation:
            // every band is a linear-phase output padded to the same delay,
            // so they add coherently already.
            let mut remaining_l = left;
            let mut remaining_r = right;

            for i in 0..num_xovers {
                let ((lo_l, lo_r), (hi_l, hi_r)) =
                    self.points_l[i].process_linear(remaining_l, remaining_r);
                bands_l[i] = self.band_tails_l[i].process(lo_l);
                bands_r[i] = self.band_tails_r[i].process(lo_r);
                remaining_l = hi_l;
                remaining_r = hi_r;
            }
            // Last band got the whole cascade — no pad needed.
            bands_l[num_xovers] = remaining_l;
            bands_r[num_xovers] = remaining_r;
            return;
        }

        // Cascading split: input → xover[0] → (low0, rest) → xover[1] → (low1, rest) → ...
        let mut remaining_l = left;
        let mut remaining_r = right;

        for i in 0..num_xovers {
            let (lo_l, hi_l) = self.points_l[i].process(remaining_l);
            let (lo_r, hi_r) = self.points_r[i].process(remaining_r);
            bands_l[i] = lo_l;
            bands_r[i] = lo_r;
            remaining_l = hi_l;
            remaining_r = hi_r;
        }
        // Last band gets the remaining high-pass
        bands_l[num_xovers] = remaining_l;
        bands_r[num_xovers] = remaining_r;

        // Apply allpasses to lower bands to compensate for phase delays introduced by subsequent crossovers
        let mut ap_idx = 0;
        for i in 1..num_xovers {
            for j in 0..i {
                let (lp_l, hp_l) = self.allpass_points_l[ap_idx].process(bands_l[j]);
                bands_l[j] = lp_l + hp_l;

                let (lp_r, hp_r) = self.allpass_points_r[ap_idx].process(bands_r[j]);
                bands_r[j] = lp_r + hp_r;

                ap_idx += 1;
            }
        }
    }

    pub fn band_count(&self) -> usize {
        self.band_count
    }

    pub fn reset(&mut self) {
        for p in &mut self.points_l {
            p.reset();
        }
        for p in &mut self.points_r {
            p.reset();
        }
        for p in &mut self.allpass_points_l {
            p.reset();
        }
        for p in &mut self.allpass_points_r {
            p.reset();
        }
        for tail in &mut self.band_tails_l {
            tail.reset();
        }
        for tail in &mut self.band_tails_r {
            tail.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RT contract: the full topology is allocated at construction and
    /// set_bands (which runs on the audio thread via set_param) never grows
    /// or shrinks storage — activity is gated by band_count alone.
    #[test]
    fn new_preallocates_full_topology_and_set_bands_never_grows_storage() {
        let mut xover = CrossoverEngine::new(48_000.0);
        assert_eq!(
            (
                xover.points_l.len(),
                xover.points_r.len(),
                xover.allpass_points_l.len(),
                xover.allpass_points_r.len(),
            ),
            (
                MAX_CROSSOVER_POINTS,
                MAX_CROSSOVER_POINTS,
                MAX_ALLPASS_POINTS,
                MAX_ALLPASS_POINTS
            )
        );
        let capacities = (
            xover.points_l.capacity(),
            xover.points_r.capacity(),
            xover.allpass_points_l.capacity(),
            xover.allpass_points_r.capacity(),
        );

        let freqs = [200.0, 800.0, 2500.0, 6000.0, 12000.0];
        for n in [2usize, 6, 3, 1, 5, 6] {
            xover.set_bands(n, &freqs);
            assert_eq!(xover.points_l.len(), MAX_CROSSOVER_POINTS);
            assert_eq!(xover.allpass_points_r.len(), MAX_ALLPASS_POINTS);
            assert_eq!(
                (
                    xover.points_l.capacity(),
                    xover.points_r.capacity(),
                    xover.allpass_points_l.capacity(),
                    xover.allpass_points_r.capacity(),
                ),
                capacities,
                "set_bands({n}) changed storage — allocation on the RT path"
            );
        }
    }

    /// A band-count change must clear biquad z1/z2 state so the new topology
    /// does not replay stale filter history (transient click).
    #[test]
    fn band_count_change_resets_filter_state() {
        let mut xover = CrossoverEngine::new(48_000.0);
        let freqs = [1000.0, 3000.0, 8000.0, 12000.0, 16000.0];
        xover.set_bands(3, &freqs);

        let mut bands_l = [0.0_f32; 6];
        let mut bands_r = [0.0_f32; 6];
        for i in 0..512 {
            let s = (i as f32 * 0.1).sin();
            xover.process_sample(s, s, &mut bands_l, &mut bands_r);
        }
        let dirty = xover
            .points_l
            .iter()
            .any(|p| p.lp[0].z1 != 0.0 || p.lp[0].z2 != 0.0);
        assert!(
            dirty,
            "expected filter state to accumulate while processing"
        );

        xover.set_bands(2, &freqs);
        let clean = xover
            .points_l
            .iter()
            .chain(xover.points_r.iter())
            .chain(xover.allpass_points_l.iter())
            .chain(xover.allpass_points_r.iter())
            .all(|p| {
                p.lp[0].z1 == 0.0 && p.lp[0].z2 == 0.0 && p.hp[1].z1 == 0.0 && p.hp[1].z2 == 0.0
            });
        assert!(clean, "topology switch left stale filter state");
    }

    /// Steady-state magnitude (dB) of the summed band outputs for a sine at
    /// `test_freq`, relative to the input. A correct LR crossover sums flat
    /// (allpass); the wrong Q peaks at every crossover frequency.
    fn band_sum_db(
        num_bands: usize,
        slope: CrossoverSlope,
        freqs: &[f32],
        test_freq: f32,
        sr: f32,
    ) -> f32 {
        let mut xover = CrossoverEngine::new(sr);
        xover.set_bands(num_bands, freqs);
        xover.set_slope(slope, freqs);
        let mut bands_l = [0.0_f32; 6];
        let mut bands_r = [0.0_f32; 6];
        let total = (sr * 1.5) as usize;
        let measure_from = total / 3; // 0.5 s warmup, 1 s measurement
        let mut in_energy = 0.0_f64;
        let mut out_energy = 0.0_f64;
        for n in 0..total {
            let s = (2.0 * PI * test_freq * n as f32 / sr).sin();
            xover.process_sample(s, s, &mut bands_l, &mut bands_r);
            if n >= measure_from {
                let sum: f32 = bands_l[..num_bands].iter().sum();
                in_energy += (s as f64) * (s as f64);
                out_energy += (sum as f64) * (sum as f64);
            }
        }
        (10.0 * (out_energy / in_energy).log10()) as f32
    }

    /// Low-band steady-state magnitude (linear) for a sine at `test_freq`
    /// above a 1 kHz corner — where the slope chip's dB/oct promise is
    /// directly readable as attenuation.
    fn low_band_level(slope: CrossoverSlope, test_freq: f32) -> f32 {
        let freqs = [1000.0_f32];
        let mut xover = CrossoverEngine::new(48_000.0);
        xover.set_bands(2, &freqs);
        xover.set_slope(slope, &freqs);
        let mut bands_l = [0.0_f32; 6];
        let mut bands_r = [0.0_f32; 6];
        let sr = 48_000.0_f32;
        let total = (sr * 0.8) as usize;
        let measure_from = total / 2;
        let mut out_energy = 0.0_f64;
        let mut in_energy = 0.0_f64;
        for n in 0..total {
            let s = (2.0 * PI * test_freq * n as f32 / sr).sin();
            xover.process_sample(s, s, &mut bands_l, &mut bands_r);
            if n >= measure_from {
                in_energy += (s as f64) * (s as f64);
                out_energy += (bands_l[0] as f64) * (bands_l[0] as f64);
            }
        }
        ((out_energy / in_energy).sqrt()) as f32
    }

    fn low_band_level_one_octave_above_corner(slope: CrossoverSlope) -> f32 {
        low_band_level(slope, 2000.0)
    }

    /// Every slope chip must select its declared rolloff: one octave above
    /// the corner the low band has fallen by the chip's dB per octave. One
    /// octave keeps every chip clear of the ~-80 dB stopband floor a
    /// single-precision RBJ cascade reaches two octaves down, while still
    /// separating the chips by 12 dB each. The shipped defect ran every chip
    /// at the same LR4 response, so this failed flat.
    #[test]
    fn slope_chips_select_the_declared_rolloff() {
        let mut previous_level = f32::INFINITY;
        for (index, slope) in [
            CrossoverSlope::Db12,
            CrossoverSlope::Db24,
            CrossoverSlope::Db36,
            CrossoverSlope::Db48,
        ]
        .into_iter()
        .enumerate()
        {
            let level = low_band_level_one_octave_above_corner(slope);
            let db = 20.0 * level.log10();
            let ideal_db = -(index as f32 + 1.0) * 12.0;
            let loose_db = ideal_db - 6.0;
            let tight_db = ideal_db + 2.0;
            assert!(
                db <= tight_db && db >= loose_db,
                "slope chip {index} measured {db:.1} dB down one octave up; its declared \
                 {ideal_db:.1} dB/oct puts the true value between {loose_db:.1} and {tight_db:.1} dB"
            );
            assert!(
                level < previous_level,
                "slope chip {index} must roll off harder than the chip below it"
            );
            previous_level = level;
        }
    }

    /// Log-spaced sweep 20 Hz–16 kHz plus every crossover frequency (the exact
    /// points where a wrong Butterworth Q peaks hardest).
    fn sweep_plus(xover_freqs: &[f32]) -> Vec<f32> {
        let mut points: Vec<f32> = (0..40)
            .map(|i| 20.0 * (800.0_f32).powf(i as f32 / 39.0))
            .collect();
        points.extend_from_slice(xover_freqs);
        points
    }

    #[test]
    fn two_band_sum_is_flat_across_frequency_including_crossover() {
        let freqs = [1000.0_f32, 3000.0, 8000.0, 12000.0, 16000.0];
        let mut worst_db = 0.0_f32;
        let mut worst_freq = 0.0_f32;
        for f in sweep_plus(&freqs[..1]) {
            let db = band_sum_db(2, CrossoverSlope::Db24, &freqs, f, 48_000.0);
            if db.abs() > worst_db.abs() {
                worst_db = db;
                worst_freq = f;
            }
        }
        eprintln!("2-band worst deviation: {worst_db:+.2} dB at {worst_freq} Hz");
        assert!(
            worst_db.abs() <= 0.5,
            "2-band sum not flat: {worst_db:+.2} dB at {worst_freq} Hz"
        );
    }

    #[test]
    fn four_band_sum_is_flat_across_frequency_including_all_crossovers() {
        let freqs = [200.0_f32, 800.0, 2500.0, 6000.0, 12000.0];
        let mut worst_db = 0.0_f32;
        let mut worst_freq = 0.0_f32;
        for f in sweep_plus(&freqs[..3]) {
            let db = band_sum_db(4, CrossoverSlope::Db24, &freqs, f, 48_000.0);
            if db.abs() > worst_db.abs() {
                worst_db = db;
                worst_freq = f;
            }
        }
        eprintln!("4-band worst deviation: {worst_db:+.2} dB at {worst_freq} Hz");
        assert!(
            worst_db.abs() <= 0.5,
            "4-band sum not flat: {worst_db:+.2} dB at {worst_freq} Hz"
        );
    }

    /// The slope chips beyond the LR4 default are also genuine LR splits:
    /// each must recombine flat across the sweep, at the corner itself
    /// included.
    #[test]
    fn every_other_slope_recombines_flat_across_frequency() {
        let freqs = [1000.0_f32];
        for slope in [
            CrossoverSlope::Db12,
            CrossoverSlope::Db36,
            CrossoverSlope::Db48,
        ] {
            let mut worst_db = 0.0_f32;
            let mut worst_freq = 0.0_f32;
            for f in sweep_plus(&freqs) {
                let db = band_sum_db(2, slope, &freqs, f, 48_000.0);
                if db.abs() > worst_db.abs() {
                    worst_db = db;
                    worst_freq = f;
                }
            }
            assert!(
                worst_db.abs() <= 0.5,
                "{slope:?} sum not flat: {worst_db:+.2} dB at {worst_freq} Hz"
            );
        }
    }

    /// In linear-phase mode the band sum is the input delayed by exactly the
    /// reported latency — sample for sample, before it and including the
    /// impulse itself.
    #[test]
    fn linear_mode_recombines_to_the_input_delayed_by_the_reported_latency() {
        let freqs = [1000.0_f32];
        let mut xover = CrossoverEngine::new(48_000.0);
        xover.set_bands(2, &freqs);
        xover.set_mode(true, &freqs);
        assert_eq!(
            xover.latency_samples(),
            FIR_DELAY,
            "one point must report FIR_DELAY samples"
        );

        let mut bands_l = [0.0_f32; 6];
        let mut bands_r = [0.0_f32; 6];
        let total = FIR_DELAY + 256;
        let mut input = [0.0_f32; FIR_DELAY + 256];
        input[0] = 1.0;
        // A following sine exercises steady-state recombination too.
        for (n, sample) in input.iter_mut().enumerate().skip(1) {
            *sample = (2.0 * PI * 220.0 * n as f32 / 48_000.0).sin();
        }

        for n in 0..total {
            xover.process_sample(input[n], input[n], &mut bands_l, &mut bands_r);
            let sum = bands_l[0] + bands_l[1];
            let expected = if n >= FIR_DELAY {
                input[n - FIR_DELAY]
            } else {
                0.0
            };
            assert!(
                (sum - expected).abs() <= 1e-5,
                "linear-mode recombination diverged at sample {n}: {sum} against {expected}"
            );
            assert_eq!(
                bands_r[0] + bands_r[1],
                sum,
                "right channel must recombine identically"
            );
        }
    }

    /// With two points active the band sum is the input delayed by exactly
    /// the reported 2·FIR_DELAY. Individual bands pre-ring — a symmetric FIR
    /// starts responding before its centre — but their sum is the delayed
    /// input at every sample, which is what the pads and the report claim.
    #[test]
    fn every_band_shares_the_reported_linear_delay() {
        let freqs = [1000.0_f32, 6000.0_f32];
        let mut xover = CrossoverEngine::new(48_000.0);
        xover.set_bands(3, &freqs);
        xover.set_mode(true, &freqs);
        assert_eq!(xover.latency_samples(), 2 * FIR_DELAY);

        let mut bands_l = [0.0_f32; 6];
        let mut bands_r = [0.0_f32; 6];
        let total = 2 * FIR_DELAY + 128;
        let mut input = [0.0_f32; 2 * FIR_DELAY + 128];
        input[0] = 1.0;
        for (n, sample) in input.iter_mut().enumerate().skip(1) {
            *sample = (2.0 * PI * 220.0 * n as f32 / 48_000.0).sin();
        }
        for n in 0..total {
            xover.process_sample(input[n], input[n], &mut bands_l, &mut bands_r);
            let sum = bands_l[0] + bands_l[1] + bands_l[2];
            let expected = if n >= 2 * FIR_DELAY {
                input[n - 2 * FIR_DELAY]
            } else {
                0.0
            };
            assert!(
                (sum - expected).abs() <= 1e-4,
                "linear-mode recombination diverged at sample {n}: {sum} against {expected}"
            );
        }
    }

    /// Minimum phase — the shipped default — reports no crossover latency.
    #[test]
    fn minimum_phase_mode_reports_no_latency() {
        let freqs = [1000.0_f32];
        let mut xover = CrossoverEngine::new(48_000.0);
        xover.set_bands(2, &freqs);
        xover.set_mode(true, &freqs);
        xover.set_mode(false, &freqs);
        assert_eq!(xover.latency_samples(), 0);
    }
}
