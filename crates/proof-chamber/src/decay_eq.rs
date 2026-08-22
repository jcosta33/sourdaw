//! Decay Rate EQ — six bands of control over *how fast each part of the
//! spectrum decays*, rather than over how loud it is.
//!
//! # What the panel sends
//!
//! `ProofChamberPanel`'s Decay EQ overlay drags six nodes and writes
//! `decay_eq_0` … `decay_eq_5`, each a **decay-time multiplier** in
//! 0.25x…4.0x. 1.0x is "this band decays at the base rate", which is the
//! default and is bit-exactly transparent — see `recompute_filter`.
//!
//! # How a multiplier becomes a filter
//!
//! Jot's frequency-dependent decay: a recirculating loop whose per-pass gain is
//! `g` has `RT60 ∝ -1 / log10(g)`, so a band that should decay `m` times slower
//! needs a per-pass gain of `g^(1/m)` in that band. The filter therefore has to
//! supply `g^(1/m) / g = g^(1/m - 1)`, which in dB is
//!
//! ```text
//! gain_db = 20 * log10(g) * (1/m - 1) = head_room_db * (1 - 1/m)
//! ```
//!
//! where `head_room_db = -20 * log10(g) >= 0` is how much the loop already
//! loses on each pass.
//!
//! **The whole design lives in that identity, and the reason it is written in
//! terms of the loop gain rather than in terms of an RT60 is that only one of
//! the four engines that run this stage has an RT60.** The FDN does
//! (`loop_gain_from_rt60` converts); the plate's tank has a per-pass
//! coefficient, and the spring has a feedback gain. Expressing the stage in
//! seconds would have forced two of the three to invent one.
//!
//! It is also what makes the stage sample-rate independent without a single
//! rate term of its own: `g` is per pass, the loop length in *seconds* does not
//! change with the rate on any of the three engines, and the band centres are
//! absolute hertz converted through `TAU * freq / sample_rate` in the designer.
//!
//! # Realtime
//!
//! Filters are redesigned only when a multiplier or the base loop gain changes,
//! and each redesign is six `Biquad::design_*` calls — transcendental, but
//! allocation-free, lock-free and bounded. `process` is six multiply-add pairs.

use std::f32::consts::TAU;

// ---------------------------------------------------------------------------
// Biquad filter (second-order IIR)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Default for Biquad {
    fn default() -> Self {
        Self::new()
    }
}

impl Biquad {
    pub fn new() -> Self {
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

    /// Design a peaking EQ filter.
    ///
    /// At `gain_db == 0.0` this is **bit-exactly** a pass-through, and that is
    /// load-bearing rather than incidental: it is what lets the default 1.0x
    /// curve leave `plate_parameter_surface.rs`'s and
    /// `algorithm_switch_parameter_retention.rs`'s pinned digests where they
    /// are. `a` is `10^0 == 1.0`, so `b0/a0` divides `1 + alpha` by the
    /// identical expression `1 + alpha`, and `b1`/`a1` and `b2`/`a2` are
    /// likewise the same float. `process` then computes `1.0 * x + 0.0` and
    /// leaves its state at exactly zero. The same holds for both shelves below.
    pub fn design_peak(&mut self, freq: f32, gain_db: f32, q: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * w0.cos();
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * w0.cos();
        let a2 = 1.0 - alpha / a;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    /// Design a low shelf filter.
    pub fn design_low_shelf(&mut self, freq: f32, gain_db: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let cos_w0 = w0.cos();
        let sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a_alpha;
        self.b0 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a_alpha)) / a0;
        self.b1 = (2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
        self.b2 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a_alpha)) / a0;
        self.a1 = (-2.0 * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
        self.a2 = ((a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a_alpha) / a0;
    }

    /// Design a high shelf filter.
    pub fn design_high_shelf(&mut self, freq: f32, gain_db: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let cos_w0 = w0.cos();
        let sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a_alpha;
        self.b0 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a_alpha)) / a0;
        self.b1 = (-2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
        self.b2 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a_alpha)) / a0;
        self.a1 = (2.0 * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
        self.a2 = ((a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a_alpha) / a0;
    }

    /// Design a lowpass filter.
    ///
    /// `q` selects the section's alignment: cascade two of these at `0.5412` and
    /// `1.3066` for a fourth-order Butterworth, or use one at `0.707` for a
    /// second-order one. Unlike the three designers above this one has no unity
    /// setting — a lowpass is never a pass-through — so it must not be reached
    /// from any path a pinned digest renders.
    pub fn design_lowpass(&mut self, freq: f32, q: f32, sample_rate: f32) {
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();

        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 - cos_w0) * 0.5) / a0;
        self.b1 = (1.0 - cos_w0) / a0;
        self.b2 = ((1.0 - cos_w0) * 0.5) / a0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    /// Make this section a pass-through, leaving its state alone.
    pub fn to_identity(&mut self) {
        self.b0 = 1.0;
        self.b1 = 0.0;
        self.b2 = 0.0;
        self.a1 = 0.0;
        self.a2 = 0.0;
    }

    /// Whether both poles are strictly inside the unit circle.
    ///
    /// Jury's stability triangle for a second-order section: `|a2| < 1` and
    /// `|a1| < 1 + a2`. Two comparisons, no roots taken.
    ///
    /// Checked rather than trusted because the designer's conditioning depends
    /// on the *normalised* centre frequency, and a band centre that is fine at
    /// 48 kHz is a very small angle at 192 kHz — where `a1 -> -2` and `a2 -> 1`
    /// and an `f32` rounding of `a2` to 1.0 or above puts a pole on or outside
    /// the circle. A section that has drifted out is reset to a pass-through:
    /// losing one band of shaping is a defect, and a delay line whose feedback
    /// filter has a pole outside the unit circle is a scream.
    pub fn is_stable(&self) -> bool {
        self.a2.abs() < 1.0 && self.a1.abs() < 1.0 + self.a2
    }

    /// `|H(e^jw)|^2`, from precomputed trig for `w`.
    ///
    /// Squared, because every caller compares against a squared budget and the
    /// square root would be the most expensive operation in the loop.
    ///
    /// **In `f64`, and that is load-bearing rather than caution.** At a low
    /// normalised frequency a second-order section has `a1 -> -2` and
    /// `a2 -> 1`, so `1 + a1*cos w + a2*cos 2w` is three terms of size ~2
    /// cancelling to something of size ~1e-5. In `f32` that leaves a percent of
    /// relative error in a denominator the bound then divides by, and the first
    /// version of this reported a *cut*-only curve raising a loop's gain by
    /// 0.0027 dB at 196 Hz on a 176.4 kHz grid — an artefact of the probe, not
    /// of the filter. This runs on a parameter write rather than per sample, so
    /// the wider type costs nothing that matters.
    #[inline]
    pub fn magnitude_squared(&self, cos_w: f64, sin_w: f64, cos_2w: f64, sin_2w: f64) -> f64 {
        let b0 = f64::from(self.b0);
        let b1 = f64::from(self.b1);
        let b2 = f64::from(self.b2);
        let a1 = f64::from(self.a1);
        let a2 = f64::from(self.a2);

        let numerator_real = b0 + b1 * cos_w + b2 * cos_2w;
        let numerator_imag = -(b1 * sin_w + b2 * sin_2w);
        let denominator_real = 1.0 + a1 * cos_w + a2 * cos_2w;
        let denominator_imag = -(a1 * sin_w + a2 * sin_2w);
        let denominator = denominator_real * denominator_real + denominator_imag * denominator_imag;
        if denominator <= 1e-300 {
            return f64::INFINITY;
        }
        (numerator_real * numerator_real + numerator_imag * numerator_imag) / denominator
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * output + self.z2;
        self.z2 = self.b2 * input - self.a2 * output;
        output
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// Magnitude of the one-pole lowpass `y[n] = x[n]*(1-c) + y[n-1]*c` at `freq`.
///
/// Exported because all three engines that run this stage put one of these in
/// the same loop — the plate's `OnePole`, the spring's damper and the FDN's
/// absorption crossover are the same difference equation — and each has to
/// report its own magnitude at this stage's probe frequencies. Deriving it here
/// once is what stops three copies of the algebra drifting apart.
pub fn one_pole_magnitude(coeff: f32, freq: f32, sample_rate: f32) -> f32 {
    let c = coeff.clamp(0.0, 0.999_999);
    if c <= 0.0 {
        return 1.0;
    }
    let w = TAU * freq / sample_rate;
    let real = 1.0 - c * w.cos();
    let imag = c * w.sin();
    (1.0 - c) / (real * real + imag * imag).sqrt()
}

// ---------------------------------------------------------------------------
// Decay Rate EQ (6-band)
// ---------------------------------------------------------------------------

pub const NUM_BANDS: usize = 6;

/// The travel of one band, matching `DecayEqOverlay.tsx`'s `MIN_MULT`/`MAX_MULT`
/// and the `decay_eq_*` rows in `NativeDspDescriptors.ts`. All three are welded
/// by `declaredRangeVsKnobTravel.spec.ts`.
pub const MIN_MULTIPLIER: f32 = 0.25;
pub const MAX_MULTIPLIER: f32 = 4.0;
pub const DEFAULT_MULTIPLIER: f32 = 1.0;

/// The six wire names, in band order.
///
/// Declared here so `param_names()` on three engines cannot drift from each
/// other. The `set_param` **arms** are still spelled out literally in each
/// engine, and deliberately so: `descriptorEngineParamWeld.spec.ts` reads match
/// arms out of the Rust, treats everything outside an engine's own file as
/// shared by *every* engine, and would therefore read an arm placed here as
/// proof that the reverse engine answers to these ids — which it does not.
pub const PARAM_NAMES: [&str; NUM_BANDS] = [
    "decay_eq_0",
    "decay_eq_1",
    "decay_eq_2",
    "decay_eq_3",
    "decay_eq_4",
    "decay_eq_5",
];

/// The band a `decay_eq_N` write addresses, or `None` for anything else.
///
/// Deliberately not named `*param*`: the weld spec scans the body of every
/// function whose name contains "param" for match arms, and a helper holding
/// all six literals in one shared file would vouch for engines that drop them.
pub fn band_index_for_name(name: &str) -> Option<usize> {
    PARAM_NAMES.iter().position(|candidate| *candidate == name)
}

/// The per-pass loop gain a delay line of `delay_samples` runs at to reach
/// `rt60_seconds` — Jot's `g = 10^(-3M / (fs * RT60))`.
///
/// The FDN's own `AbsorptiveFilter` computes the identical expression for its
/// low band. It is **not** what the decay EQ is told — `AbsorptiveFilter::
/// magnitude_at` is, because the low-frequency figure alone is exactly the
/// error that made the control weakest where the damper bites hardest — and it
/// is kept because it is the readable statement of the Jot relation the whole
/// stage is derived from, and `rt60_conversion_matches_the_jot_gain_the_fdn_
/// lines_run_at` pins the two against each other.
pub fn loop_gain_from_rt60(delay_samples: usize, sample_rate: f32, rt60_seconds: f32) -> f32 {
    if rt60_seconds <= 0.01 || sample_rate <= 0.0 {
        return MIN_LOOP_GAIN;
    }
    let m = delay_samples as f32;
    10.0_f32.powf(-3.0 * m / (sample_rate * rt60_seconds))
}

/// Floor on a loop gain, i.e. a ceiling of 60 dB on `head_room_db`.
///
/// Without it a plate at `decay = 0` divides by `log10(0)` and every filter is
/// designed at infinite gain. 60 dB is past any setting an engine reaches in
/// practice — the FDN's shortest line at its shortest RT60 is about 36 dB.
const MIN_LOOP_GAIN: f32 = 0.001;

/// How close to unity the loop is allowed to get once this stage is in it, as
/// an **absolute** number of dB.
///
/// Absolute rather than a fraction of the headroom, and that is the whole of
/// the correction. A proportional-only margin — which is what
/// `MAX_TOTAL_BOOST = 0.95` was — guarantees `loop <= 10^(-0.05 * head_room/20)`,
/// so the guaranteed margin goes to zero exactly as the headroom does, while
/// the `f32` coefficient error of six RBJ designs does not shrink with it. Past
/// roughly 0.02 dB of headroom the error dominates and the bound stops
/// bounding: measured `loop = 1.000994` at `decay = 0.9999` and `1.000076` at
/// the descriptor's own maximum of 0.999.
///
/// 0.02 dB, not the 0.1 this first carried. The bound now measures the
/// *realised* cascade — `|H|` computed in `f64` from the coefficients the
/// designer actually produced — so the margin no longer has to absorb
/// per-section rounding that the measurement can see directly. It covers only
/// the gap between the loop the engine reports and the loop it runs. The
/// difference is not cosmetic: an absolute margin is a growing *fraction* of
/// the headroom as a loop gets longer, and at 0.1 dB it took 37% of the budget
/// on an FDN at `decay = 0.85`, which showed up as a requested 4.0x delivering
/// 1.42x.
const LIMIT_MARGIN_DB: f32 = 0.02;

/// Additional margin as a fraction of the band's own headroom, so a deep loop
/// keeps proportional safety as well as the absolute floor above.
const MARGIN_FRACTION: f32 = 0.02;

/// Below this much shaping, a section is made an exact pass-through instead of
/// being designed.
///
/// Not a performance shortcut — a correctness one, and it is the second half of
/// why the margin has to be absolute. At a low normalised frequency a
/// second-order section has `a1 -> -2` and `a2 -> 1`, and `f32` stores those
/// with an absolute error around 6e-8. Near the pole the magnitude goes as
/// `1/(1 - r)^2`, which at 100 Hz on a 176.4 kHz grid is about 1e-5, so that
/// rounding is worth roughly **0.01 dB of magnitude error per section** —
/// bigger than the shaping being asked for whenever the loop is nearly
/// lossless. Measured: six *cut*-only bands on a loop of per-pass gain 0.999
/// took it to 1.000268 at 196 Hz. A cut raising a loop's gain is nonsense; it
/// was six roundings of a filter that was supposed to be almost exactly 1.
///
/// 0.05 dB of decay-rate shaping is inaudible, so nothing is lost by refusing
/// to design it, and an identity section is exactly 1.0 with no rounding at all.
const MIN_DESIGNABLE_GAIN_DB: f32 = 0.05;

/// Ceiling on a single section's design gain, in either direction.
///
/// The cut side is what needs it. `head_room_db * (1 - 1/0.25)` is three times
/// the loop's own per-pass loss, and where the loop is already lossy — an FDN
/// band above its absorption crossover at the shipped damping — that reaches
/// 60 dB and beyond. A 60 dB notch does not mean "this band decays four times
/// faster", it means "this band is gone", and it asks the `f32` designer for a
/// filter whose coefficients span nine orders of magnitude for no audible gain
/// over a 36 dB one. The boost side never reaches this in practice — a boost is
/// bounded by three quarters of the headroom — but it is applied symmetrically
/// so no direction can quietly exceed it.
const MAX_DESIGN_GAIN_DB: f32 = 36.0;

/// Bisection steps used to find the largest boost scale the loop can afford.
///
/// **Bisection rather than a fixed-point correction, and the difference is
/// observable.** The cascade's dB response is close to but not exactly linear
/// in the design gains, so a `scale *= affordable / asked` iteration lands
/// somewhere near the budget rather than on it — and *where* it lands depends
/// on how many passes it happened to take. That made the clamp's outcome depend
/// on iteration dynamics rather than only on the curve: asking for a sixth
/// boosted band could leave an untouched band delivering slightly *more* than
/// it had with five, which is not a thing a user can be told.
///
/// The excess is monotone in the scale, so the feasible set is an interval
/// `[0, s*]` and bisection converges on `s*` from a fixed number of steps.
/// Ten gives a resolution of about one part in a thousand, which is far below
/// audibility, and the count is fixed because this runs on the audio thread.
const SCALE_BISECTION_STEPS: usize = 10;

/// The last design gain handed to each section, in dB. Measurement surface for
/// the guards, and the quantity the panel draws as the delivered curve.
type DesignGains = [f32; NUM_BANDS];

/// One band of the Decay Rate EQ.
#[derive(Clone, Copy)]
pub struct DecayEqBand {
    pub freq: f32,
    pub multiplier: f32,
    pub q: f32,
    pub band_type: BandType,
}

#[derive(Clone, Copy, PartialEq)]
pub enum BandType {
    LowShelf,
    Bell,
    HighShelf,
}

/// The six band centres, matching `BAND_FREQS` in `DecayEqOverlay.tsx`.
pub fn default_bands() -> [DecayEqBand; NUM_BANDS] {
    [
        DecayEqBand {
            freq: 100.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 0.707,
            band_type: BandType::LowShelf,
        },
        DecayEqBand {
            freq: 400.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 1200.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 3500.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 8000.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 12000.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 0.707,
            band_type: BandType::HighShelf,
        },
    ]
}

/// Frequencies the stability bound is evaluated at, and the frequencies an
/// engine has to report its loop magnitude at.
///
/// Two DC/Nyquist ends, the six band centres, the five geometric midpoints
/// between adjacent centres, and a twelve-point geometric sweep across the
/// whole band. The ends are not decoration: a high-shelf boost reaches its
/// maximum at Nyquist and a low-shelf boost at DC, so a sweep that stopped at
/// 20 kHz would miss both peaks entirely. The midpoints are where a cascade
/// peaks when two adjacent bells are boosted together, which is the shape the
/// bound exists for.
pub const NUM_PROBES: usize = 25;

const PROBE_SWEEP_POINTS: usize = 12;

/// Precomputed trig for the probe grid.
///
/// Depends only on the sample rate, so it is built once at construction and
/// every redesign reads it. `magnitude_squared` needs `cos w`, `sin w`,
/// `cos 2w` and `sin 2w`, and computing four transcendentals per probe per
/// section per pass would put roughly 2400 of them on a parameter write.
struct ProbeGrid {
    freqs: [f32; NUM_PROBES],
    cos_w: [f64; NUM_PROBES],
    sin_w: [f64; NUM_PROBES],
    cos_2w: [f64; NUM_PROBES],
    sin_2w: [f64; NUM_PROBES],
    /// Probe index carrying each band's own centre frequency.
    band_probe: [usize; NUM_BANDS],
}

impl ProbeGrid {
    fn new(sample_rate: f32) -> Self {
        let nyquist = sample_rate * 0.5;
        let mut freqs = [0.0_f32; NUM_PROBES];
        let mut band_probe = [0_usize; NUM_BANDS];

        freqs[0] = 0.0;
        freqs[1] = nyquist;

        let bands = default_bands();
        for (index, band) in bands.iter().enumerate() {
            let probe = 2 + index;
            freqs[probe] = clamp_band_frequency(band.freq, sample_rate);
            band_probe[index] = probe;
        }
        for index in 0..(NUM_BANDS - 1) {
            let low = freqs[2 + index];
            let high = freqs[3 + index];
            freqs[8 + index] = (low * high).sqrt();
        }

        let start = 20.0_f32.min(nyquist * 0.5);
        let end = nyquist * 0.98;
        let ratio = (end / start).powf(1.0 / (PROBE_SWEEP_POINTS - 1) as f32);
        let mut sweep = start;
        for index in 0..PROBE_SWEEP_POINTS {
            freqs[13 + index] = sweep;
            sweep *= ratio;
        }

        let mut grid = Self {
            freqs,
            cos_w: [0.0; NUM_PROBES],
            sin_w: [0.0; NUM_PROBES],
            cos_2w: [0.0; NUM_PROBES],
            sin_2w: [0.0; NUM_PROBES],
            band_probe,
        };
        for index in 0..NUM_PROBES {
            let w = std::f64::consts::TAU * f64::from(grid.freqs[index]) / f64::from(sample_rate);
            grid.cos_w[index] = w.cos();
            grid.sin_w[index] = w.sin();
            grid.cos_2w[index] = (2.0 * w).cos();
            grid.sin_2w[index] = (2.0 * w).sin();
        }
        grid
    }
}

/// A band centre above Nyquist designs a filter at a wrapped angle, which is
/// how a stage that measures correctly at 48 kHz renders something else at
/// another rate. 0.45 keeps the top band below the fold at every rate.
fn clamp_band_frequency(freq: f32, sample_rate: f32) -> f32 {
    freq.min(sample_rate * 0.45)
}

/// Decay Rate EQ for **one** recirculating path.
///
/// One instance per independent loop: two on the plate (one per tank half), one
/// on the spring, and one per delay line on the FDN — where each line has its
/// own length and therefore its own loop gain.
pub struct DecayRateEq {
    biquads: [Biquad; NUM_BANDS],
    bands: [DecayEqBand; NUM_BANDS],
    sample_rate: f32,
    probes: ProbeGrid,
    /// Per-pass magnitude of the loop this stage sits in, **excluding** this
    /// stage, at each probe frequency.
    ///
    /// A vector rather than the single number this used to be, because the
    /// number was wrong in a way that made the control weakest exactly where a
    /// user would reach for it. Every engine that runs this stage also has a
    /// damping filter in the same loop — the plate's `OnePole`, the spring's
    /// damper, the FDN's absorption crossover — so the loop's per-pass loss is
    /// a *function of frequency*, and the correction that turns a multiplier
    /// into a filter gain is proportional to that loss. Told a single
    /// low-frequency figure, the stage supplied roughly half the dB it needed
    /// above the FDN's 2 kHz crossover: at the shipped `damping = 0.3` a
    /// requested 4.0x delivered 0.98x on fdn8 — *less than neutral*.
    loop_gains: [f32; NUM_PROBES],
    design_gains: DesignGains,
}

impl DecayRateEq {
    pub fn new(sample_rate: f32, base_loop_gain: f32) -> Self {
        let clamped = base_loop_gain.clamp(MIN_LOOP_GAIN, 1.0);
        let mut eq = Self {
            biquads: core::array::from_fn(|_| Biquad::new()),
            bands: default_bands(),
            sample_rate,
            probes: ProbeGrid::new(sample_rate),
            loop_gains: [clamped; NUM_PROBES],
            design_gains: [0.0; NUM_BANDS],
        };
        eq.recompute_filters();
        eq
    }

    /// The frequencies an engine must report its loop magnitude at.
    ///
    /// The grid belongs to this stage rather than to the engines because the
    /// stability bound is evaluated on it: an engine that sampled its damper
    /// somewhere else would be describing a different loop than the one being
    /// bounded.
    pub fn probe_frequencies(&self) -> &[f32; NUM_PROBES] {
        &self.probes.freqs
    }

    /// Set a band's decay multiplier.
    ///
    /// Recomputes **all six** filters rather than only this one, because
    /// `MAX_TOTAL_BOOST` couples them: raising one band can require the others'
    /// boosts to be scaled back.
    pub fn set_band_multiplier(&mut self, band_index: usize, multiplier: f32) {
        if band_index >= NUM_BANDS {
            return;
        }
        let clamped = multiplier.clamp(MIN_MULTIPLIER, MAX_MULTIPLIER);
        if self.bands[band_index].multiplier == clamped {
            return;
        }
        self.bands[band_index].multiplier = clamped;
        self.recompute_filters();
    }

    pub fn band_multiplier(&self, band_index: usize) -> f32 {
        if band_index >= NUM_BANDS {
            return DEFAULT_MULTIPLIER;
        }
        self.bands[band_index].multiplier
    }

    /// Tell the stage what the loop around it is doing, at every probe.
    ///
    /// Called whenever the host engine's decay, damping or delay length moves —
    /// the shaping is *relative* to the loop's own per-pass loss, so a curve set
    /// at one Decay setting has to keep meaning the same thing at the next one,
    /// and a band sitting where the damper is eating 6 dB a pass needs a
    /// different correction from one sitting where it is eating none.
    pub fn set_loop_gains(&mut self, gains: &[f32; NUM_PROBES]) {
        let mut changed = false;
        for index in 0..NUM_PROBES {
            let clamped = gains[index].clamp(MIN_LOOP_GAIN, 1.0);
            if self.loop_gains[index] != clamped {
                self.loop_gains[index] = clamped;
                changed = true;
            }
        }
        if changed {
            self.recompute_filters();
        }
    }

    /// The flat case: a loop whose per-pass loss is the same at every
    /// frequency. No engine in this crate is actually flat — all three have a
    /// damper in the loop — so this exists for tests and for a caller that has
    /// nothing better to report.
    pub fn set_base_loop_gain(&mut self, gain: f32) {
        let clamped = gain.clamp(MIN_LOOP_GAIN, 1.0);
        self.set_loop_gains(&[clamped; NUM_PROBES]);
    }

    /// True while every band sits at 1.0x, i.e. while the cascade is the
    /// identity. Engines use it for nothing; guards use it to state what they
    /// are measuring.
    pub fn is_neutral(&self) -> bool {
        self.bands
            .iter()
            .all(|band| band.multiplier == DEFAULT_MULTIPLIER)
    }

    /// How much dB each band may spend, from the loop's own loss *at that
    /// band's centre*, less the margin.
    ///
    /// Subtracting an absolute margin here is what makes the stage go quietly
    /// transparent as the loop approaches unity rather than fighting `f32`
    /// rounding for the last hundredth of a dB. It is also the honest answer:
    /// a loop that loses 0.017 dB a pass — the plate at the descriptor's
    /// maximum `decay` of 0.999 — has nothing to redistribute, and a decay
    /// multiplier relative to an effectively infinite decay is not a control,
    /// it is a resonator.
    fn band_budget_db(&self, band: usize) -> f32 {
        let head_room_db = self.head_room_db(band);
        let margin = LIMIT_MARGIN_DB.max(head_room_db * MARGIN_FRACTION);
        (head_room_db - margin).max(0.0)
    }

    fn head_room_db(&self, band: usize) -> f32 {
        -20.0 * self.loop_gains[self.probes.band_probe[band]].log10()
    }

    fn recompute_filters(&mut self) {
        self.design_all(1.0);

        // The budget is checked against the *realised* cascade every time, not
        // against an analytic bound on the intended one. An earlier version
        // skipped the check whenever the requested shares summed below 1.0, on
        // the sound argument that a cascade's dB magnitude is at most the sum of
        // its sections' peaks — but that bound is only ever conservative, and
        // being conservative is what cost the control most of its range. It also
        // forced the margin to absorb per-section rounding that the measurement
        // can simply see. The check is one pass over the probe grid; the
        // bisection below runs only when it says the curve does not fit.
        if self.worst_excess_db().0 > 0.0 {
            let mut low = 0.0_f32;
            let mut high = 1.0_f32;
            for _ in 0..SCALE_BISECTION_STEPS {
                let mid = 0.5 * (low + high);
                self.design_all(mid);
                if self.worst_excess_db().0 > 0.0 {
                    high = mid;
                } else {
                    low = mid;
                }
            }
            // End on the largest scale known to be inside the budget rather
            // than on whichever side the last probe happened to fall.
            self.design_all(low);
        }

        // The invariant is a guarantee, not a hope. If four passes have not
        // brought the cascade inside the budget the boosts go to zero, and if
        // even that is not enough — which needs the loop to be so close to
        // lossless that the sections' own `f32` rounding is the whole of the
        // excess — every section becomes an exact pass-through.
        if self.worst_excess_db().0 > 0.0 {
            self.design_all(0.0);
        }
        if self.worst_excess_db().0 > 0.0 {
            for (index, biquad) in self.biquads.iter_mut().enumerate() {
                biquad.to_identity();
                self.design_gains[index] = 0.0;
            }
        }

        self.enforce_section_stability();
    }

    /// How far past its budget the loop is, in dB, and how much of the figure
    /// at that frequency is this stage's own doing.
    ///
    /// Monotone in the boost scale, which is what makes the bisection above a
    /// search for a well-defined bound rather than a guess.
    fn worst_excess_db(&self) -> (f32, f32) {
        let mut worst_excess = f32::NEG_INFINITY;
        let mut cascade_at_worst = 0.0_f32;

        for probe in 0..NUM_PROBES {
            let magnitude_squared = self.cascade_magnitude_squared(probe);
            if !magnitude_squared.is_finite() {
                return (f32::INFINITY, f32::INFINITY);
            }

            let cascade_db = (10.0 * magnitude_squared.max(1e-300).log10()) as f32;
            let loop_db = 20.0 * self.loop_gains[probe].log10();
            let margin = LIMIT_MARGIN_DB.max(-loop_db * MARGIN_FRACTION);
            // The loop is allowed to stay where it already is — a frozen tank
            // sits at unity on its own and this stage is not what put it there
            // — but it may not be pushed past `-margin`.
            let budget_db = (-margin).max(loop_db);
            let excess = loop_db + cascade_db - budget_db;
            if excess > worst_excess {
                worst_excess = excess;
                cascade_at_worst = cascade_db;
            }
        }

        (worst_excess, cascade_at_worst)
    }

    fn cascade_magnitude_squared(&self, probe: usize) -> f64 {
        let mut magnitude_squared = 1.0_f64;
        for biquad in self.biquads.iter() {
            magnitude_squared *= biquad.magnitude_squared(
                self.probes.cos_w[probe],
                self.probes.sin_w[probe],
                self.probes.cos_2w[probe],
                self.probes.sin_2w[probe],
            );
        }
        magnitude_squared
    }

    /// Reset any section whose poles have left the unit circle.
    ///
    /// The last line of defence, and the only one that survives a designer
    /// conditioning problem the magnitude probes cannot see: a pole outside the
    /// circle still has a perfectly finite `|H(e^jw)|` at every probe, so the
    /// bound above would report a stage that is inside its budget while the
    /// time-domain response runs away.
    fn enforce_section_stability(&mut self) {
        for (index, biquad) in self.biquads.iter_mut().enumerate() {
            if !biquad.is_stable() {
                biquad.to_identity();
                self.design_gains[index] = 0.0;
            }
        }
    }

    fn design_all(&mut self, boost_scale: f32) {
        for index in 0..NUM_BANDS {
            self.design_band(index, boost_scale);
        }
    }

    fn design_band(&mut self, index: usize, boost_scale: f32) {
        let band = self.bands[index];

        // `share > 0` lengthens this band's decay and spends headroom;
        // `share < 0` shortens it and cannot destabilise anything, so only the
        // positive side is scaled or budgeted. At the 1.0x default `share` is
        // exactly 0.0 and `gain_db` is exactly 0.0, which is the transparency
        // the pinned digests depend on.
        let share = 1.0 - 1.0 / band.multiplier;
        let requested_db = if share > 0.0 {
            self.band_budget_db(index) * share * boost_scale
        } else {
            self.head_room_db(index) * share
        };
        let gain_db = requested_db.clamp(-MAX_DESIGN_GAIN_DB, MAX_DESIGN_GAIN_DB);
        self.design_gains[index] = gain_db;

        if gain_db.abs() < MIN_DESIGNABLE_GAIN_DB {
            self.design_gains[index] = 0.0;
            self.biquads[index].to_identity();
            return;
        }

        let freq = clamp_band_frequency(band.freq, self.sample_rate);

        match band.band_type {
            BandType::LowShelf => {
                self.biquads[index].design_low_shelf(freq, gain_db, self.sample_rate)
            }
            BandType::Bell => {
                self.biquads[index].design_peak(freq, gain_db, band.q, self.sample_rate)
            }
            BandType::HighShelf => {
                self.biquads[index].design_high_shelf(freq, gain_db, self.sample_rate)
            }
        }
    }

    /// The worst per-pass loop gain the loop reaches with this stage in it, and
    /// the frequency it happens at. Measurement surface for the guards.
    pub fn worst_loop_gain(&self) -> (f32, f32) {
        let mut worst = 0.0_f32;
        let mut worst_hz = 0.0_f32;
        for probe in 0..NUM_PROBES {
            let magnitude = self.cascade_magnitude_squared(probe).max(0.0).sqrt();
            let gain = (f64::from(self.loop_gains[probe]) * magnitude) as f32;
            if gain > worst {
                worst = gain;
                worst_hz = self.probes.freqs[probe];
            }
        }
        (worst, worst_hz)
    }

    /// The worst per-pass loop gain **without** this stage — what the loop does
    /// on its own. A guard needs both to say whether the stage made it worse.
    pub fn worst_loop_gain_without_stage(&self) -> f32 {
        self.loop_gains.iter().fold(0.0_f32, |acc, g| acc.max(*g))
    }

    /// The dB each section was actually designed at, after budgeting and after
    /// the clamp.
    ///
    /// The difference between what the user asked for and what the loop could
    /// lend lives here, so this is both the guards' measurement surface and the
    /// quantity a panel needs in order to draw the delivered curve rather than
    /// only the requested one.
    pub fn design_gains_db(&self) -> DesignGains {
        self.design_gains
    }

    /// Whether every section's poles are inside the unit circle.
    pub fn all_sections_stable(&self) -> bool {
        self.biquads.iter().all(Biquad::is_stable)
    }

    /// Process one sample through all six bands.
    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let mut signal = input;
        for bq in self.biquads.iter_mut() {
            signal = bq.process(signal);
        }
        signal
    }

    pub fn reset(&mut self) {
        for bq in self.biquads.iter_mut() {
            bq.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        band_index_for_name, loop_gain_from_rt60, DecayRateEq, DEFAULT_MULTIPLIER, MAX_MULTIPLIER,
        MIN_MULTIPLIER, NUM_BANDS, PARAM_NAMES, TAU,
    };

    #[test]
    fn every_wire_name_resolves_to_its_own_band_and_nothing_else_resolves() {
        for (index, name) in PARAM_NAMES.iter().enumerate() {
            assert_eq!(band_index_for_name(name), Some(index));
        }
        assert_eq!(band_index_for_name("decay_eq_6"), None);
        assert_eq!(band_index_for_name("decay"), None);
        assert_eq!(band_index_for_name("decay_eq_"), None);
    }

    #[test]
    fn the_neutral_curve_is_bit_exactly_transparent() {
        // The claim `plate_parameter_surface.rs`'s and
        // `algorithm_switch_parameter_retention.rs`'s pinned digests rest on.
        for gain in [0.999_f32, 0.9, 0.5, 0.1, 0.01] {
            let mut eq = DecayRateEq::new(48_000.0, gain);
            assert!(eq.is_neutral());
            for step in 0..2_000 {
                let input = ((step as f32) * 0.017).sin() * 0.7;
                let output = eq.process(input);
                assert_eq!(
                    output.to_bits(),
                    input.to_bits(),
                    "a 1.0x curve at base gain {gain} altered sample {step}: {input} -> {output}"
                );
            }
        }
    }

    #[test]
    fn writes_outside_the_declared_travel_are_clamped_to_it() {
        let mut eq = DecayRateEq::new(48_000.0, 0.5);
        eq.set_band_multiplier(0, 99.0);
        assert_eq!(eq.band_multiplier(0), MAX_MULTIPLIER);
        eq.set_band_multiplier(0, -3.0);
        assert_eq!(eq.band_multiplier(0), MIN_MULTIPLIER);
        // Out-of-range band indices are dropped, not panicked on: `set_param`
        // is reached from the audio thread.
        eq.set_band_multiplier(NUM_BANDS, 2.0);
        for index in 0..NUM_BANDS {
            let expected = if index == 0 {
                MIN_MULTIPLIER
            } else {
                DEFAULT_MULTIPLIER
            };
            assert_eq!(eq.band_multiplier(index), expected);
        }
    }

    /// Every curve shape the bound has to survive, named.
    ///
    /// The adjacent pairs are here because a pair beats all-six consistently —
    /// the clamp scales all boosts together, so asking for six spreads the
    /// budget six ways while asking for two concentrates it where the sections
    /// overlap most. A grid that only tried all-six would miss the worst case it
    /// is supposed to bound. The mixed rows are here for the same reason: a cut
    /// band is exempt from the boost budget, so a shape with cuts in it reaches
    /// a higher boost scale than one without.
    ///
    /// **The pair rows are spelled `boosted, rest neutral` and `boosted, rest
    /// cut` because those are two different shapes and #1580's review found
    /// them travelling under one name.** A reviewer's `lo pair` meant
    /// `[4, 4, 0.25, 0.25, 0.25, 0.25]` while this file's meant
    /// `[4, 4, 1, 1, 1, 1]`, and since cuts do not spend budget the two reach
    /// different boost scales. Neither was wrong; comparing measurements across
    /// them was.
    const SHAPES: [(&str, [f32; NUM_BANDS]); 15] = [
        ("band 0 alone", [4.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
        ("band 1 alone", [1.0, 4.0, 1.0, 1.0, 1.0, 1.0]),
        ("band 2 alone", [1.0, 1.0, 4.0, 1.0, 1.0, 1.0]),
        ("band 3 alone", [1.0, 1.0, 1.0, 4.0, 1.0, 1.0]),
        ("band 4 alone", [1.0, 1.0, 1.0, 1.0, 4.0, 1.0]),
        ("band 5 alone", [1.0, 1.0, 1.0, 1.0, 1.0, 4.0]),
        ("lo pair, rest neutral", [4.0, 4.0, 1.0, 1.0, 1.0, 1.0]),
        ("lo pair, rest cut", [4.0, 4.0, 0.25, 0.25, 0.25, 0.25]),
        ("mid pair, rest neutral", [1.0, 1.0, 4.0, 4.0, 1.0, 1.0]),
        ("mid pair, rest cut", [0.25, 0.25, 4.0, 4.0, 0.25, 0.25]),
        ("hi pair, rest neutral", [1.0, 1.0, 1.0, 1.0, 4.0, 4.0]),
        ("hi pair, rest cut", [0.25, 0.25, 0.25, 0.25, 4.0, 4.0]),
        ("all max", [4.0, 4.0, 4.0, 4.0, 4.0, 4.0]),
        ("all min", [0.25, 0.25, 0.25, 0.25, 0.25, 0.25]),
        (
            "alternating boost and cut",
            [4.0, 0.25, 4.0, 0.25, 4.0, 0.25],
        ),
    ];

    /// Every base loop gain an engine can hand the stage.
    ///
    /// 0.999 and 0.99 are the top of the grid deliberately. The old
    /// proportional-only bound guaranteed `loop <= 10^(-0.05 * head_room/20)`,
    /// so its guaranteed margin vanished exactly where the loop had least room
    /// — and it was measured *over* unity there, at 1.000076 for the plate at
    /// the descriptor's own maximum `decay` of 0.999. A grid that stopped at 0.9
    /// could not see it.
    const BASE_GAINS: [f32; 7] = [0.999, 0.99, 0.9, 0.5, 0.1, 0.01, 0.001];

    /// The rates to design at. 176.4 and 192 kHz are not rates this application
    /// runs at, and are here because the stage claims to have no rate term of
    /// its own — a claim that is only worth anything if it is tested where a
    /// band centre becomes a very small normalised angle.
    const RATES: [f32; 5] = [44_100.0, 48_000.0, 96_000.0, 176_400.0, 192_000.0];

    fn configured(sample_rate: f32, base_gain: f32, shape: [f32; NUM_BANDS]) -> DecayRateEq {
        let mut eq = DecayRateEq::new(sample_rate, base_gain);
        for (index, multiplier) in shape.iter().enumerate() {
            eq.set_band_multiplier(index, *multiplier);
        }
        eq
    }

    #[test]
    fn no_curve_on_any_loop_at_any_rate_is_allowed_past_its_budget() {
        // The whole invariant, on the whole grid: 5 rates x 7 base gains x 12
        // shapes. The measurement is the *realised* cascade — `|H|` evaluated
        // from the coefficients the designer actually produced, against the
        // loop's own magnitude at the same frequency — which is the reason the
        // bound moved from an analytic sum of intended gains to a measured
        // peak. The analytic sum was simultaneously too tight in the middle of
        // the range and too loose at the top of it.
        //
        // The limit is a **literal**, not `LIMIT_MARGIN_DB` read back out of
        // the source. Deriving the expectation from the constant under test is
        // the tautology this repo has been bitten by before: the assertion
        // moves with the thing it is supposed to police, and setting the margin
        // to zero — which is exactly the proportional-only shape #1580's review
        // found measuring over unity — leaves it green.
        //
        // 0.998 is the guarantee the shipped 0.02 dB margin makes
        // (`10^(-0.02/20) = 0.99770`), rounded away from it so the two are not
        // the same number. The one thing the stage is allowed to do is leave a
        // loop where it already was: a frozen tank sits at unity on its own and
        // this stage is not what put it there.
        let limit = 0.998_f32;

        for sample_rate in RATES {
            for base_gain in BASE_GAINS {
                for (label, shape) in SHAPES {
                    let eq = configured(sample_rate, base_gain, shape);

                    assert!(
                        eq.all_sections_stable(),
                        "{label} at {base_gain} on {sample_rate} Hz designed a section with a \
                         pole outside the unit circle"
                    );

                    let (worst, worst_hz) = eq.worst_loop_gain();
                    let allowed = limit.max(eq.worst_loop_gain_without_stage());
                    assert!(
                        worst <= allowed + 1e-4,
                        "{label} at {base_gain} on {sample_rate} Hz takes the loop to \
                         {worst:.6} at {worst_hz:.0} Hz, past its budget of {allowed:.6}"
                    );
                }
            }
        }
    }

    #[test]
    fn raising_one_band_never_raises_another_bands_delivered_gain() {
        // The clamp is **global**: when the requested curve asks for more than
        // the loop can lend, every boost is scaled by the same factor, so
        // raising one band takes headroom back from the others. That is a real
        // property of the control and the panel draws it — `design_gains_db` is
        // what it draws — but it has a direction, and this is the direction.
        //
        // Measured on the design gains rather than through a render, because
        // that is the layer the clamp lives at: a render puts a T30 fit and a
        // measuring filter's skirt between the assertion and the thing it is
        // about, and the earlier version of this guard did exactly that and
        // reported a band gaining when its design gain had fallen.
        //
        // It is also the guard the *first* version of the locality test could
        // not be: displacing one band from neutral keeps the requested share at
        // 0.75, which fits every loop, so the clamp never engaged in anything it
        // measured.
        for sample_rate in RATES {
            for base_gain in [0.9_f32, 0.5, 0.1] {
                for raised in 0..NUM_BANDS {
                    let mut before_shape = [MAX_MULTIPLIER; NUM_BANDS];
                    before_shape[raised] = DEFAULT_MULTIPLIER;
                    let before = configured(sample_rate, base_gain, before_shape);
                    let after = configured(sample_rate, base_gain, [MAX_MULTIPLIER; NUM_BANDS]);

                    let before_gains = before.design_gains_db();
                    let after_gains = after.design_gains_db();

                    assert!(
                        after_gains[raised] > before_gains[raised],
                        "raising band {raised} from {DEFAULT_MULTIPLIER}x to {MAX_MULTIPLIER}x at \
                         base {base_gain} on {sample_rate} Hz left its own design gain at \
                         {:.3} dB against {:.3} dB",
                        after_gains[raised],
                        before_gains[raised]
                    );

                    for other in 0..NUM_BANDS {
                        if other == raised {
                            continue;
                        }
                        assert!(
                            after_gains[other] <= before_gains[other] + 1e-3,
                            "raising band {raised} at base {base_gain} on {sample_rate} Hz also \
                             raised untouched band {other}, from {:.3} dB to {:.3} dB — the \
                             clamp is handing out headroom rather than only taking it back",
                            before_gains[other],
                            after_gains[other]
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn a_loop_with_no_headroom_zeroes_every_band_and_not_only_the_starved_one() {
        // **The behaviour #1580's review found, pinned as a fact rather than
        // left to be rediscovered.** The scale is global, so it is set by the
        // single worst probe — and when one probe sits at the loop's own
        // ceiling, the bisection drives that scale to zero and takes every band
        // with it, including bands two decades away that had ample headroom of
        // their own.
        //
        // On the plate at `decay = 0.999` the loop is `0.999^2 = 0.998001`,
        // which is 0.0174 dB of loss — below `LIMIT_MARGIN_DB`. Band 4 at 8 kHz
        // still has its own headroom there, and gets nothing anyway.
        //
        // It is a cliff and not a fade, and that is the part worth pinning: one
        // step down the Decay knob and the shaping is back.
        let starved = configured(48_000.0, 0.998_001, [MAX_MULTIPLIER; NUM_BANDS]);
        for (band, gain) in starved.design_gains_db().iter().enumerate() {
            assert_eq!(
                *gain, 0.0,
                "band {band} was designed at {gain} dB on a loop with 0.017 dB to lend"
            );
        }

        // **And the same loop shapes one band while refusing six**, which is
        // the sharpest statement of the coupling. At a loop gain of 0.99 there
        // is 0.087 dB to lend: one band asks for 0.05 dB of it and fits, six
        // ask for compound gain the loop cannot cover, so the bisection drives
        // the shared scale under `MIN_DESIGNABLE_GAIN_DB` and all six become
        // pass-throughs — including the five that would each have fitted alone.
        let one_band = configured(48_000.0, 0.99, [4.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
        assert!(
            one_band.design_gains_db()[0] > 0.05,
            "a loop with 0.087 dB to lend must still shape a single band, got {:?}",
            one_band.design_gains_db()
        );
        let six_bands = configured(48_000.0, 0.99, [MAX_MULTIPLIER; NUM_BANDS]);
        assert_eq!(
            six_bands.design_gains_db()[0],
            0.0,
            "the same loop asked for six bands leaves band 0 designed at {:?}",
            six_bands.design_gains_db()
        );

        // This is a *flat* loop, which is the worst case: no damper anywhere to
        // open headroom up. On the real plate the tank's damper takes far more
        // than 0.087 dB above a few kHz, so the upper bands keep working well
        // past the point the low ones stop. That is why the panel gate is
        // stated in terms of the states a user can see — `freeze`, and Decay at
        // the top of its travel — rather than as one Decay number.

        // The refusal is right — boosting a loop already at the ceiling is what
        // #1580 asked not to loosen — so what this pins is that it is *total*.
        // A user cannot tell a stage that has decided it has nothing to give
        // from one that is broken, which is why `ProofChamberPanel` gates the
        // overlay on the states that produce it.
    }

    #[test]
    fn a_loop_running_a_bounded_curve_still_falls_silent() {
        // The same invariant as a time-domain fact, so a magnitude sweep that
        // measured the wrong thing cannot carry the claim on its own. Two
        // shapes, because `lo pair` reaches a higher boost scale than `all max`
        // and is the harder of the two.
        for (label, shape) in [SHAPES[6], SHAPES[9]] {
            for base_gain in [0.9_f32, 0.5, 0.1] {
                let mut eq = configured(48_000.0, base_gain, shape);
                let mut state = 1.0_f32;
                let mut peak_late = 0.0_f32;
                for step in 0..400_000 {
                    state = eq.process(state) * base_gain;
                    assert!(
                        state.is_finite(),
                        "{label} at {base_gain} diverged to {state} at step {step}"
                    );
                    if step > 200_000 {
                        peak_late = peak_late.max(state.abs());
                    }
                }
                assert!(
                    peak_late < 1e-3,
                    "{label} at {base_gain} must still decay; late peak was {peak_late}"
                );
            }
        }
    }

    #[test]
    fn a_loop_with_no_headroom_left_is_shaped_not_at_all() {
        // The absolute margin's visible consequence, asserted rather than left
        // as a side effect. A plate at the descriptor's maximum `decay` of
        // 0.999 loses 0.017 dB per half-traversal; there is nothing there to
        // redistribute, and the old bound's answer — spend 95% of 0.017 dB and
        // hope — measured *over* unity. The honest answer is that the stage
        // goes transparent, and it does so continuously rather than at a cliff.
        let mut eq = DecayRateEq::new(48_000.0, 0.998_001);
        for index in 0..NUM_BANDS {
            eq.set_band_multiplier(index, MAX_MULTIPLIER);
        }
        let (worst, _) = eq.worst_loop_gain();
        assert!(
            worst <= 0.998_001 + 1e-6,
            "a loop with 0.017 dB of headroom must not be pushed at all, got {worst:.6}"
        );

        // ...and the shaping comes back as soon as there is headroom to spend,
        // so this is a floor rather than a dead control.
        let mut roomy = DecayRateEq::new(48_000.0, 0.6);
        roomy.set_band_multiplier(2, MAX_MULTIPLIER);
        let (roomy_worst, _) = roomy.worst_loop_gain();
        assert!(
            roomy_worst > 0.6 * 1.2,
            "a loop with 4.4 dB of headroom must still be shaped, got {roomy_worst:.4}"
        );
    }

    /// Steady-state gain of the cascade at `freq`, measured by driving it.
    ///
    /// The finiteness assertion is not decoration. `f32::max` *ignores* NaN, so
    /// a running `peak.max(output.abs())` over a diverged filter comes back as
    /// the initial `0.0` and reports a perfectly quiet stage — which is exactly
    /// how the first version of the Nyquist guard below passed with the clamp
    /// deleted, against a cascade whose poles had a radius of 2.95.
    fn gain_at(eq: &mut DecayRateEq, freq: f32, sample_rate: f32) -> f32 {
        let step = TAU * freq / sample_rate;
        let mut peak = 0.0_f32;
        for index in 0..40_000 {
            let output = eq.process((index as f32 * step).sin());
            assert!(
                output.is_finite(),
                "the cascade produced {output} at sample {index} driving {freq} Hz at {sample_rate} Hz"
            );
            if index > 20_000 {
                peak = peak.max(output.abs());
            }
        }
        peak
    }

    #[test]
    fn a_band_centre_above_nyquist_does_not_fold_back_into_the_audible_range() {
        // `design_*` converts hertz through `TAU * freq / sample_rate`, and
        // beyond Nyquist that angle wraps: the 12 kHz shelf at a 16 kHz rate
        // would be designed at 4 kHz and put its whole boost in the middle of
        // the spectrum. The clamp in `recompute_filter` is what stops it, and
        // this is the rate that shows the difference — the two the application
        // runs at (44.1 and 48 kHz) are both far above the fold, so a guard at
        // either would pass with the clamp deleted.
        let sample_rate = 16_000.0_f32;
        let mut eq = DecayRateEq::new(sample_rate, 0.05);
        eq.set_band_multiplier(5, MAX_MULTIPLIER);

        let mid = gain_at(&mut eq, 4_000.0, sample_rate);
        assert!(
            mid < 1.5,
            "the top band folded down to 4 kHz and boosted it by {mid}x"
        );
    }

    #[test]
    fn rt60_conversion_matches_the_jot_gain_the_fdn_lines_run_at() {
        // 24_000 samples at 48 kHz is 0.5 s of delay; an RT60 of 1.5 s is three
        // passes, so the gain is 10^(-3 * 0.5 / 1.5) = 10^-1.
        let gain = loop_gain_from_rt60(24_000, 48_000.0, 1.5);
        assert!((gain - 0.1).abs() < 1e-6, "expected 0.1, got {gain}");
        // A degenerate RT60 floors rather than dividing by zero.
        assert_eq!(loop_gain_from_rt60(24_000, 48_000.0, 0.0), 0.001);
    }
}
