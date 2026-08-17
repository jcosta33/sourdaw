/// FDN (Feedback Delay Network) reverb engine.
///
/// Configurable 8 or 16 channel FDN with:
/// - Hadamard (N≥8) or Householder (N=4) mixing matrix
/// - Mutually coprime delay lengths, sized by a `size`-driven window
/// - Per-delay-line absorptive filters for frequency-dependent decay (Jot formula)
/// - Tapped delay line early reflections
/// - Multiple incommensurate-frequency LFOs for modulation
use std::f32::consts::TAU;

// The `decay` contract is crate-wide: `decay` is a normalised coefficient, and
// this engine is the one that needs it expressed in seconds.
use crate::decay_curve::{decay_to_rt60_seconds, MAX_RT60_SECONDS, MIN_RT60_SECONDS};
// The Decay Rate EQ is the multi-band generalisation of the `AbsorptiveFilter`
// below: that stage gives the tail two decay rates either side of 2 kHz, this
// one gives it six. They compose rather than compete — `damping` still sets the
// broad HF tilt and the EQ shapes around it.
use crate::decay_eq::{DecayRateEq, NUM_PROBES};
// `early_late` is a crate-wide contract too, and used to be honoured only
// here. The tapped delay line moved out so the plate could blend the same
// early signal against its own tank.
use crate::early_reflections::EarlyReflections;
// `high_cut`, `low_cut` and `width` are a wet-path stage, not a topology
// property; the plate owned them privately until #1495's gap table showed the
// descriptor advertising all three on an engine that dropped all three.
use crate::output_stage::OutputStage;

// ---------------------------------------------------------------------------
// Mixing matrices
// ---------------------------------------------------------------------------

/// In-place Hadamard transform via Fast Walsh-Hadamard (O(N log N)).
/// Input/output are in `data[0..n]`. Normalizes by 1/sqrt(n).
fn hadamard_transform(data: &mut [f32], n: usize) {
    let mut h = 1;
    while h < n {
        for i in (0..n).step_by(h * 2) {
            for j in i..(i + h) {
                let x = data[j];
                let y = data[j + h];
                data[j] = x + y;
                data[j + h] = x - y;
            }
        }
        h *= 2;
    }
    let norm = 1.0 / (n as f32).sqrt();
    for v in data[..n].iter_mut() {
        *v *= norm;
    }
}

/// Householder reflection: H = I - (2/N) * 1*1^T
/// Equivalent to: output[i] = input[i] - (2/N) * sum(input)
fn householder_transform(data: &mut [f32], n: usize) {
    let sum: f32 = data[..n].iter().sum();
    let factor = 2.0 * sum / n as f32;
    for v in data[..n].iter_mut() {
        *v -= factor;
    }
}

// ---------------------------------------------------------------------------
// Coprime delay length generator
// ---------------------------------------------------------------------------

/// Trial division. Bounded by `sqrt(n)`, so a few dozen `%` for the lengths in
/// play here, and allocation-free — this runs on the audio thread whenever
/// `size` is written.
fn is_prime(n: usize) -> bool {
    if n < 2 {
        return false;
    }
    if n % 2 == 0 {
        return n == 2;
    }
    let mut divisor = 3;
    while divisor * divisor <= n {
        if n % divisor == 0 {
            return false;
        }
        divisor += 2;
    }
    true
}

/// The prime nearest `target` that no earlier line has taken, searching
/// outwards and preferring the longer side on a tie.
fn nearest_unused_prime(target: usize, taken: &[usize], ceiling: usize) -> usize {
    let target = target.clamp(2, ceiling);
    for offset in 0..=target {
        let up = target + offset;
        if up <= ceiling && is_prime(up) && !taken.contains(&up) {
            return up;
        }
        if offset > 0 {
            let down = target - offset;
            if down >= 2 && is_prime(down) && !taken.contains(&down) {
                return down;
            }
        }
    }

    // Unreachable at any sample rate a host can run: the shortest window this
    // is ever asked for is 10 ms, which is 441 samples at 44.1 kHz and holds 85
    // primes against at most 16 lines. The arm exists because this is
    // audio-thread code, and audio-thread code returns rather than looping or
    // panicking. Distinctness is preserved even here; coprimality is not.
    let mut fallback = 2;
    while taken.contains(&fallback) {
        fallback += 1;
    }
    fallback
}

/// Fill `out` with mutually coprime delay lengths spanning
/// `[min_samples, max_samples]`, never exceeding `ceiling`.
///
/// Targets are spread geometrically across the window, so the set keeps its
/// ratios as `size` slides the window rather than bunching at one end; each
/// target is then snapped to the nearest prime no other line holds. Distinct
/// primes are pairwise coprime, which is the property the tuning exists for: no
/// two lines share a modal series, so the tank has no coincident modes to ring
/// on.
///
/// Smith's prime-power form (`M_i = p_i^k_i`) stood here before. It delivers
/// coprimality in principle and not in practice at these lengths, because the
/// powers of a small prime are a factor of `p` apart — `2^k` offers 1024, 2048,
/// 4096 and nothing between. Most lines therefore landed outside the requested
/// window and were clamped onto its boundary, which is both how they collapsed
/// onto one another (five of eight lines shared two values at 44.1 kHz) and why
/// the length of a line barely moved when the window did.
///
/// Allocation-free by contract: it writes into the caller's slice and finds
/// primes by trial division, because `size` is automatable and this is reached
/// from the audio thread.
fn fill_coprime_delays(out: &mut [usize], min_samples: usize, max_samples: usize, ceiling: usize) {
    let lines = out.len();
    if lines == 0 {
        return;
    }

    let low = min_samples.clamp(2, ceiling) as f64;
    let high = max_samples.clamp(min_samples + 1, ceiling) as f64;
    let span = high / low;

    for index in 0..lines {
        let position = if lines > 1 {
            index as f64 / (lines - 1) as f64
        } else {
            0.5
        };
        let target = (low * span.powf(position)).round() as usize;
        let (taken, rest) = out.split_at_mut(index);
        rest[0] = nearest_unused_prime(target, taken, ceiling);
    }
}

/// Tune `out` for `size` at `sample_rate`, through the size-to-window mapping
/// documented beside `MIN_DELAY_MS_AT_SIZE_0`.
///
/// The single place the mapping is applied, so the constructor and every later
/// `size` write cannot disagree about what a given size means.
fn fill_delay_lengths(out: &mut [usize], size: f32, sample_rate: f32) {
    let size = size.clamp(0.0, 1.0);
    let min_ms = MIN_DELAY_MS_AT_SIZE_0 + size * (MIN_DELAY_MS_AT_SIZE_1 - MIN_DELAY_MS_AT_SIZE_0);
    let max_ms = MAX_DELAY_MS_AT_SIZE_0 + size * (MAX_DELAY_MS - MAX_DELAY_MS_AT_SIZE_0);
    fill_coprime_delays(
        out,
        ms_to_samples(min_ms, sample_rate),
        ms_to_samples(max_ms, sample_rate),
        delay_ceiling(sample_rate),
    );
}

// ---------------------------------------------------------------------------
// One-pole absorptive filter (per delay line)
// ---------------------------------------------------------------------------

/// Per-delay-line absorptive filter implementing Jot's frequency-dependent decay.
/// g(f) = 10^(-3 * M / (fs * RT60(f)))
#[derive(Clone)]
struct AbsorptiveFilter {
    /// Low-frequency gain per sample (derived from RT60 at low freq)
    g_low: f32,
    /// High-frequency gain per sample (derived from RT60 at high freq)
    g_high: f32,
    /// One-pole state for frequency-dependent absorption
    state: f32,
    /// Filter coefficient (controls crossover between g_low and g_high)
    coeff: f32,
}

impl AbsorptiveFilter {
    fn new(delay_samples: usize, sample_rate: f32, rt60_low: f32, rt60_high: f32) -> Self {
        let m = delay_samples as f32;
        let g_low = if rt60_low > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_low))
        } else {
            0.0
        };
        let g_high = if rt60_high > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_high))
        } else {
            0.0
        };

        // Crossover around 2kHz
        let crossover_hz = 2000.0;
        let coeff = (-TAU * crossover_hz / sample_rate).exp();

        Self {
            g_low,
            g_high,
            state: 0.0,
            coeff,
        }
    }

    fn update_rt60(
        &mut self,
        delay_samples: usize,
        sample_rate: f32,
        rt60_low: f32,
        rt60_high: f32,
    ) {
        let m = delay_samples as f32;
        self.g_low = if rt60_low > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_low))
        } else {
            0.0
        };
        self.g_high = if rt60_high > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_high))
        } else {
            0.0
        };
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        // One-pole lowpass to separate low and high frequency components
        self.state = input * (1.0 - self.coeff) + self.state * self.coeff;
        let low = self.state;
        let high = input - low;
        low * self.g_low + high * self.g_high
    }

    /// `|H(f)|` of this filter, which **is** the line's per-pass loop gain:
    /// the mixing matrix is orthonormal and nothing else in the loop has gain.
    ///
    /// `out = L*g_low + (1 - L)*g_high` where `L` is the one-pole lowpass, so
    /// `H = g_high + L*(g_low - g_high)` — complex, because `L` is, and taking
    /// the magnitude of the two bands separately would report a filter with no
    /// crossover phase. This is what the Decay Rate EQ is told, and getting it
    /// as a single low-frequency scalar is what made a requested 4.0x deliver
    /// 0.98x above 2 kHz at the shipped damping.
    fn magnitude_at(&self, freq: f32, sample_rate: f32) -> f32 {
        let w = TAU * freq / sample_rate;
        let real = 1.0 - self.coeff * w.cos();
        let imag = self.coeff * w.sin();
        let denominator = real * real + imag * imag;
        if denominator <= 1e-30 {
            return self.g_low.abs();
        }
        // L = (1 - c) / (1 - c e^-jw), rationalised.
        let scale = (1.0 - self.coeff) / denominator;
        let low_real = scale * real;
        let low_imag = -scale * imag;

        let delta = self.g_low - self.g_high;
        let total_real = self.g_high + delta * low_real;
        let total_imag = delta * low_imag;
        (total_real * total_real + total_imag * total_imag).sqrt()
    }
}

// ---------------------------------------------------------------------------
// FDN Reverb Engine
// ---------------------------------------------------------------------------

const MAX_FDN_CHANNELS: usize = 16;
const SHIPPED_DAMPING: f32 = 0.3;

/// Default `size`, matching the `dutch-oven` descriptor.
const DEFAULT_SIZE: f32 = 0.5;

// `size` maps onto a *window* of delay lengths, not a single scalar. The
// shortest line is the tank's first late arrival — the room's mean free path,
// which is what a listener hears as size — and the longest sets the modal
// spacing. Both edges travel with the control, so the window moves as well as
// widens and no two settings produce the same set:
//
//   size 0.0 → 10 ms … 30 ms   small, dense, fast-repeating
//   size 1.0 → 30 ms … 80 ms   large hall, sparse early modes
//
// The four constants below are the whole mapping. `MAX_DELAY_MS` is also the
// allocation size: buffers are built once for the longest line `size` can ever
// ask for, so a size write only retunes read spans inside a fixed capacity.
const MIN_DELAY_MS_AT_SIZE_0: f32 = 10.0;
const MIN_DELAY_MS_AT_SIZE_1: f32 = 30.0;
const MAX_DELAY_MS_AT_SIZE_0: f32 = 30.0;
const MAX_DELAY_MS: f32 = 80.0;

/// Furthest the LFO can push a read past a line's base delay. `mod_offset` is
/// `lfo * mod_depth * 8` with both factors bounded by 1.
const MODULATION_HEADROOM: usize = 8;

/// Slack above the longest requested delay, so the prime snapping in
/// `fill_coprime_delays` has room to land above its target. Comfortably wider
/// than the largest prime gap below the lengths in play.
const PRIME_HEADROOM: usize = 64;

fn ms_to_samples(ms: f32, sample_rate: f32) -> usize {
    (ms / 1000.0 * sample_rate) as usize
}

/// Longest base delay any line may hold, at any `size`. The generator is capped
/// here rather than at the size-dependent window, so the topmost line can snap
/// upwards to a prime without being clamped back onto its neighbour.
fn delay_ceiling(sample_rate: f32) -> usize {
    ms_to_samples(MAX_DELAY_MS, sample_rate) + PRIME_HEADROOM
}

/// One delay line's allocation, sized so `delay_ceiling` plus full modulation
/// still indexes inside it.
fn delay_buffer_len(sample_rate: f32) -> usize {
    delay_ceiling(sample_rate) + MODULATION_HEADROOM + 1
}

fn normalized_hf_rt60_ratio(damping: f32) -> f32 {
    2.0_f32.powf(-damping.clamp(0.0, 0.999) / SHIPPED_DAMPING)
}

fn legacy_hf_rt60_ratio(damping: f32) -> f32 {
    (1.0 - damping.clamp(0.0, 0.999)) * 0.5
}

pub struct FdnReverb {
    sample_rate: f32,
    num_channels: usize,

    // Delay lines
    buffers: Vec<Vec<f32>>,
    write_positions: Vec<usize>,
    delay_lengths: Vec<usize>,

    // Per-line absorptive filters
    absorptive_filters: Vec<AbsorptiveFilter>,

    /// Per-line Decay Rate EQ, sitting in the same place in the feedback path.
    ///
    /// One per line rather than one shared instance because each line has its
    /// own length, so each runs at its own per-pass gain — and the whole point
    /// of the stage is to be expressed *relative* to that gain. A single shared
    /// filter would apply the short lines' shaping to the long ones.
    decay_eqs: Vec<DecayRateEq>,

    // Mixing matrix scratch buffer
    mix_buf: [f32; MAX_FDN_CHANNELS],

    // Modulation LFOs (incommensurate frequencies)
    lfo_phases: [f32; MAX_FDN_CHANNELS],
    lfo_freqs: [f32; MAX_FDN_CHANNELS],
    mod_depth: f32,

    // Early reflections
    early_reflections_l: EarlyReflections,
    early_reflections_r: EarlyReflections,

    // Parameters
    pub rt60: f32,
    pub rt60_hf: f32,
    /// Normalised 0..0.999 damping. `rt60_hf` is derived from it and the
    /// current `rt60` on every filter update, so the two cannot drift apart.
    damping: f32,
    normalized_damping: bool,
    pub size: f32,
    pub mix: f32,
    pub early_late_balance: f32, // 0=all early, 1=all late
    pub use_hadamard: bool,

    // Pre-delay
    predelay_buf: Vec<f32>,
    predelay_pos: usize,
    predelay_len: usize,

    // Soft saturation for infinite sustain
    pub saturation_enabled: bool,

    /// Wet-path tone and width, shared with the plate.
    output: OutputStage,

    // Parameter smoothing (30ms ramp)
    smooth_mix: f32,
    smooth_coeff: f32,
}

impl FdnReverb {
    pub fn new(sample_rate: f32, num_channels: usize) -> Self {
        let n = num_channels.min(MAX_FDN_CHANNELS);

        // Delay lengths for the default room size, through the same mapping a
        // later `size` write uses. Derived rather than written out again: the
        // constructor used to carry its own 20–60 ms window, so a bare instance
        // and one told `size = 0.5` were tuned differently.
        let mut delay_lengths = vec![0_usize; n];
        fill_delay_lengths(&mut delay_lengths, DEFAULT_SIZE, sample_rate);

        // Every line is allocated for the longest delay `size` can ever reach,
        // once, here. This is the RT contract: `set_param("size", …)` is
        // automatable and therefore audio-thread work, and it must retune
        // inside this capacity rather than reallocate.
        let buffer_len = delay_buffer_len(sample_rate);
        let buffers: Vec<Vec<f32>> = (0..n).map(|_| vec![0.0; buffer_len]).collect();

        let write_positions = vec![0; n];

        let absorptive_filters: Vec<AbsorptiveFilter> = delay_lengths
            .iter()
            .map(|&len| AbsorptiveFilter::new(len, sample_rate, 2.0, 0.8))
            .collect();

        // Seeded flat and corrected at the end of this constructor, where
        // `update_absorptive_filters` hands each stage the real
        // frequency-dependent magnitude of the line it sits in.
        //
        // The correcting call is load-bearing and used to be missing. Nothing
        // reached the broken state — `addDevice` writes the descriptor's
        // `decay` before the first render and that write calls
        // `update_absorptive_filters` itself — but a bare `FdnReverb::new`
        // kept `loop_gains = [1.0; NUM_PROBES]`, designed every band at 0 dB,
        // and rendered a Decay EQ that did nothing while this comment said
        // otherwise.
        let decay_eqs: Vec<DecayRateEq> = delay_lengths
            .iter()
            .map(|_| DecayRateEq::new(sample_rate, 1.0))
            .collect();

        // Incommensurate LFO frequencies (Costello-inspired)
        let base_freqs = [
            0.7, 1.1, 1.7, 2.3, 0.5, 1.3, 1.9, 2.9, 0.6, 1.4, 2.1, 0.8, 1.6, 2.7, 0.9, 1.2,
        ];
        let mut lfo_freqs = [0.0_f32; MAX_FDN_CHANNELS];
        let mut lfo_phases = [0.0_f32; MAX_FDN_CHANNELS];
        for i in 0..n {
            lfo_freqs[i] = base_freqs[i % base_freqs.len()];
            lfo_phases[i] = (i as f32) / (n as f32); // spread initial phases
        }

        let predelay_max = (sample_rate * 0.5) as usize;

        let mut reverb = Self {
            sample_rate,
            num_channels: n,
            buffers,
            write_positions,
            delay_lengths,
            absorptive_filters,
            decay_eqs,
            mix_buf: [0.0; MAX_FDN_CHANNELS],
            lfo_phases,
            lfo_freqs,
            mod_depth: 0.3,
            early_reflections_l: EarlyReflections::new(sample_rate, DEFAULT_SIZE),
            early_reflections_r: EarlyReflections::new(sample_rate, DEFAULT_SIZE),
            rt60: 2.0,
            rt60_hf: 0.8,
            // Bare and unversioned saved instances retain the historical curve.
            // Newly added project devices opt into the normalized curve through
            // the private `fdn_damping_version` wire parameter.
            damping: 0.2,
            normalized_damping: false,
            size: DEFAULT_SIZE,
            mix: 0.3,
            early_late_balance: 0.4,
            use_hadamard: true,
            predelay_buf: vec![0.0; predelay_max],
            predelay_pos: 0,
            predelay_len: ((15.0 / 1000.0) * sample_rate) as usize,
            saturation_enabled: false,
            output: OutputStage::new(sample_rate),
            smooth_mix: 0.3,
            smooth_coeff: 1.0 - (-1.0 / (0.030 * sample_rate)).exp(),
        };

        // Make the seeding above true before anyone can render through it.
        reverb.update_absorptive_filters();
        reverb
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if self.output.set_param(name, value) {
            return;
        }

        match name {
            // `width` stays an engine-level arm: the matrix only means
            // something on an engine whose wet path has two different channels.
            "width" => self.output.set_width(value),
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "rt60" => {
                // Seconds-native alias: the value already IS an RT60.
                self.rt60 = value.clamp(MIN_RT60_SECONDS, MAX_RT60_SECONDS);
                self.update_absorptive_filters();
            }
            "decay" => {
                // Host contract: `decay` is the unitless 0..0.999 coefficient
                // declared by the `dutch-oven` descriptor, never seconds.
                self.rt60 = decay_to_rt60_seconds(value);
                self.update_absorptive_filters();
            }
            "rt60_hf" | "damping" => {
                // Stored normalised; `rt60_hf` is derived from the current RT60
                // in `update_absorptive_filters`.
                self.damping = value.clamp(0.0, 0.999);
                self.update_absorptive_filters();
            }
            "size" => {
                self.size = value.clamp(0.0, 1.0);
                self.update_delay_lengths();
                self.early_reflections_l
                    .update_room_size(self.sample_rate, value);
                self.early_reflections_r
                    .update_room_size(self.sample_rate, value);
            }
            "mod_depth" => self.mod_depth = value.clamp(0.0, 1.0),
            "early_late" => self.early_late_balance = value.clamp(0.0, 1.0),
            "predelay" => {
                self.predelay_len = ((value / 1000.0) * self.sample_rate) as usize;
                self.predelay_len = self.predelay_len.min(self.predelay_buf.len() - 1);
            }
            "matrix" => self.use_hadamard = value > 0.5,
            "saturation" => self.saturation_enabled = value > 0.5,
            // Decay Rate EQ. The six literals are spelled out rather than
            // matched by prefix because `descriptorEngineParamWeld.spec.ts`
            // reads the arm names out of this file to decide which engines
            // answer to which id.
            "decay_eq_0" | "decay_eq_1" | "decay_eq_2" | "decay_eq_3" | "decay_eq_4"
            | "decay_eq_5" => {
                let clamped = value.clamp(0.25, 4.0);
                if let Some(band) = crate::decay_eq::band_index_for_name(name) {
                    for eq in self.decay_eqs.iter_mut() {
                        eq.set_band_multiplier(band, clamped);
                    }
                }
            }
            _ => {}
        }
    }

    pub(crate) fn set_damping_version(&mut self, version: u8) {
        self.normalized_damping = version >= 2;
        self.update_absorptive_filters();
    }

    /// Recompute the per-line absorptive gains.
    ///
    /// `rt60_hf` is derived here rather than stored at `damping`-set time: the
    /// HF band is a fraction of the current RT60, so a later `decay` change
    /// must re-derive it or the high band stays pinned to whatever RT60 was
    /// current when damping was last touched.
    fn update_absorptive_filters(&mut self) {
        let ratio = if self.normalized_damping {
            normalized_hf_rt60_ratio(self.damping)
        } else {
            legacy_hf_rt60_ratio(self.damping)
        };
        self.rt60_hf = self.rt60 * ratio;
        for (i, filter) in self.absorptive_filters.iter_mut().enumerate() {
            if i < self.delay_lengths.len() {
                filter.update_rt60(
                    self.delay_lengths[i],
                    self.sample_rate,
                    self.rt60,
                    self.rt60_hf,
                );
            }
        }

        // The decay EQ shapes *relative* to the loop's own per-pass loss, so it
        // has to be re-told that loss whenever it moves. Reached from
        // `decay`/`rt60`, from `damping`, and — the case a stage that stored
        // its delay length at construction would have got wrong — from `size`,
        // which rewrites every `delay_lengths[i]` before calling this.
        //
        // The magnitude comes from the absorptive filter that is actually in
        // the line rather than from `loop_gain_from_rt60`, which reports only
        // the low-frequency figure. Above the 2 kHz crossover the two differ by
        // the whole of `damping`, and the difference is not a detail: told the
        // low-frequency figure, this stage supplied about half the dB it needed
        // up there and a requested 4.0x came out below neutral.
        let sample_rate = self.sample_rate;
        for (i, eq) in self.decay_eqs.iter_mut().enumerate() {
            if i >= self.absorptive_filters.len() {
                continue;
            }
            let filter = &self.absorptive_filters[i];
            let probes = *eq.probe_frequencies();
            let mut gains = [0.0_f32; NUM_PROBES];
            for (index, freq) in probes.iter().enumerate() {
                gains[index] = filter.magnitude_at(*freq, sample_rate);
            }
            eq.set_loop_gains(&gains);
        }
    }

    /// Retune the tank for the current `size`.
    ///
    /// Allocation-free, and it has to be: `size` is an automatable parameter,
    /// so this is reached from the audio thread on every envelope point. It
    /// used to build a fresh `Vec` per write, and then clamp each new length
    /// down to the buffer that line was given at construction — a ceiling
    /// derived from the *default* size, which is why everything above roughly
    /// 0.75 rendered identically. `fdn_size_automation_rt.rs` guards the first
    /// half of that and `fdn_size_tuning.rs` the second.
    fn update_delay_lengths(&mut self) {
        fill_delay_lengths(&mut self.delay_lengths, self.size, self.sample_rate);
        self.update_absorptive_filters();
    }

    /// Process stereo audio in-place.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = self.num_channels;

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];
            let mono = (dry_l + dry_r) * 0.5;

            // Pre-delay
            let pd_len = self.predelay_buf.len();
            self.predelay_buf[self.predelay_pos % pd_len] = mono;
            let pd_read = (self.predelay_pos + pd_len - self.predelay_len) % pd_len;
            let predelayed = self.predelay_buf[pd_read];
            self.predelay_pos = (self.predelay_pos + 1) % pd_len;

            // Early reflections
            let early_l = self.early_reflections_l.process(predelayed);
            let early_r = self.early_reflections_r.process(predelayed);

            // Read from all delay lines (with modulation)
            for ch in 0..n {
                let base_delay = self.delay_lengths[ch];
                let buf_len = self.buffers[ch].len();

                // LFO modulation
                let lfo = (self.lfo_phases[ch] * TAU).sin();
                self.lfo_phases[ch] += self.lfo_freqs[ch] / self.sample_rate;
                if self.lfo_phases[ch] >= 1.0 {
                    self.lfo_phases[ch] -= 1.0;
                }

                let mod_offset = (lfo * self.mod_depth * 8.0) as isize;
                let effective_delay =
                    (base_delay as isize + mod_offset).clamp(1, (buf_len - 1) as isize) as usize;

                let read_pos = (self.write_positions[ch] + buf_len - effective_delay) % buf_len;
                self.mix_buf[ch] = self.buffers[ch][read_pos];
            }

            // Apply absorptive filters, then the per-band decay shaping over
            // the top of them. Both are in the feedback path and before the
            // matrix, which is where a per-pass gain has to be for its effect
            // to compound into a decay rate rather than a one-shot tone change.
            for ch in 0..n {
                self.mix_buf[ch] = self.absorptive_filters[ch].process(self.mix_buf[ch]);
                self.mix_buf[ch] = self.decay_eqs[ch].process(self.mix_buf[ch]);
            }

            // Soft saturation (before matrix) for infinite sustain
            if self.saturation_enabled {
                for ch in 0..n {
                    let x = self.mix_buf[ch];
                    // Fast tanh approximation
                    let x2 = x * x;
                    self.mix_buf[ch] = x * (27.0 + x2) / (27.0 + 9.0 * x2);
                }
            }

            // Apply mixing matrix
            if self.use_hadamard && n >= 8 {
                hadamard_transform(&mut self.mix_buf, n);
            } else {
                householder_transform(&mut self.mix_buf, n);
            }

            // Write back to delay lines (input + mixed feedback)
            for ch in 0..n {
                let input_gain = if ch < n / 2 { 1.0 } else { 0.8 }; // slight asymmetry for stereo
                let sample = predelayed * input_gain + self.mix_buf[ch];

                // Magnitude truncation
                let truncated = if sample.abs() < 1e-18 { 0.0 } else { sample };
                let buf_len = self.buffers[ch].len();
                self.buffers[ch][self.write_positions[ch]] = truncated;
                self.write_positions[ch] = (self.write_positions[ch] + 1) % buf_len;
            }

            // Sum outputs: first half → left, second half → right, with cross-tapping
            let mut late_l = 0.0_f32;
            let mut late_r = 0.0_f32;
            for ch in 0..n {
                let val = self.mix_buf[ch];
                if ch % 2 == 0 {
                    late_l += val;
                    late_r += val * 0.3; // cross-tap
                } else {
                    late_r += val;
                    late_l += val * 0.3;
                }
            }
            let scale = 1.0 / (n as f32).sqrt();
            late_l *= scale;
            late_r *= scale;

            // Blend early and late
            let el = self.early_late_balance;
            let blended_l = early_l * (1.0 - el) + late_l * el;
            let blended_r = early_r * (1.0 - el) + late_r * el;

            // Output EQ and stereo width. After the blend, exactly as on the
            // plate: filtering before it would leave the early half unfiltered
            // and make Hi Cut, Lo Cut and Width fade out as Early/Late turned
            // down.
            let (wet_l, wet_r) = self.output.process(blended_l, blended_r);

            // Mix
            // Smoothed mix to prevent clicks
            self.smooth_mix += self.smooth_coeff * (self.mix - self.smooth_mix);
            let m = self.smooth_mix;
            left[i] = dry_l * (1.0 - m) + wet_l * m;
            right[i] = dry_r * (1.0 - m) + wet_r * m;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decay_to_rt60_seconds, delay_buffer_len, normalized_hf_rt60_ratio, FdnReverb, MAX_DELAY_MS,
        MAX_DELAY_MS_AT_SIZE_0, MAX_FDN_CHANNELS, MAX_RT60_SECONDS, MIN_DELAY_MS_AT_SIZE_0,
        MIN_DELAY_MS_AT_SIZE_1, MIN_RT60_SECONDS, MODULATION_HEADROOM,
    };

    #[test]
    fn a_bare_instance_has_already_told_its_decay_eq_what_the_loop_does() {
        // `FdnReverb::new` seeds every Decay Rate EQ with a flat loop gain of
        // 1.0 and then corrects it. The correcting call went missing and the
        // comment beside the seeding said it was there, so a bare instance
        // designed every band at 0 dB while claiming otherwise.
        //
        // **Unreachable through the engine's public path, and guarded here for
        // that reason.** `addDevice` writes the descriptor's `decay` before the
        // first render and that write calls `update_absorptive_filters` itself,
        // so no render-level guard can see the difference — removing the call
        // again leaves every test in `decay_eq_parameter_surface.rs` green. A
        // constructor whose stated post-condition is only true because of what
        // happens next is a trap for the next caller, so the post-condition is
        // asserted where it can be.
        let reverb = FdnReverb::new(48_000.0, 8);
        for (index, eq) in reverb.decay_eqs.iter().enumerate() {
            let worst = eq.worst_loop_gain_without_stage();
            assert!(
                worst < 1.0,
                "line {index} was left with a flat unity loop gain of {worst}, so its Decay EQ \
                 has been told the tail never decays"
            );
        }
    }

    /// Coincident modes are the whole reason the delay lengths are tuned at
    /// all: two lines of equal length ring the same series of frequencies, and
    /// an FDN with a repeated length sounds metallic in a way no amount of
    /// modulation hides.
    ///
    /// Asserted over sample rate *and* size because the collapse was a
    /// quantisation artefact of both — the tuning generator produced values
    /// that fell outside the requested window and every one of them saturated
    /// on the same boundary. A single-rate, single-size check would have been
    /// green at the shipped default while the top of the control ran three
    /// lines at one length.
    #[test]
    fn delay_lengths_stay_mutually_distinct_across_size_and_sample_rate() {
        for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
            for channels in [8_usize, 16] {
                for step in 0..=20 {
                    let size = step as f32 / 20.0;
                    let mut reverb = FdnReverb::new(sample_rate, channels);
                    reverb.set_param("size", size);

                    let lengths = &reverb.delay_lengths;
                    for (i, a) in lengths.iter().enumerate() {
                        for (j, b) in lengths.iter().enumerate().skip(i + 1) {
                            assert_ne!(
                                a, b,
                                "lines {i} and {j} collapsed onto {a} samples at \
                                 {sample_rate} Hz, {channels} lines, size {size}: \
                                 {lengths:?}"
                            );
                        }
                    }
                }
            }
        }
    }

    /// Both edges of the delay window travel with `size`, over the whole
    /// declared range and not just its lower three quarters.
    ///
    /// The render-level consequence is in `tests/fdn_size_tuning.rs`; this is
    /// the mapping itself, where the failure was visible as a table that stopped
    /// changing. Every line used to be clamped to the buffer it was allocated at
    /// construction, and that buffer was sized for the *default* size, so above
    /// roughly 0.75 the longest lines were already pinned and the set was
    /// frozen.
    #[test]
    fn both_edges_of_the_delay_window_travel_with_size() {
        for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
            let mut shortest_before = 0_usize;
            let mut longest_before = 0_usize;
            for step in 0..=20 {
                let size = step as f32 / 20.0;
                let mut reverb = FdnReverb::new(sample_rate, 8);
                reverb.set_param("size", size);

                let shortest = *reverb.delay_lengths.iter().min().expect("lines exist");
                let longest = *reverb.delay_lengths.iter().max().expect("lines exist");
                assert!(
                    shortest > shortest_before,
                    "the shortest line must grow with size: {size} gave {shortest} \
                     samples after {shortest_before} at {sample_rate} Hz"
                );
                assert!(
                    longest > longest_before,
                    "the longest line must grow with size: {size} gave {longest} \
                     samples after {longest_before} at {sample_rate} Hz"
                );
                shortest_before = shortest;
                longest_before = longest;
            }
        }
    }

    /// The declared window endpoints, so the mapping comment above
    /// `MIN_DELAY_MS_AT_SIZE_0` stays a contract rather than a wish. The
    /// tolerance is the prime snapping, which moves a target by at most a prime
    /// gap.
    #[test]
    fn the_size_window_reaches_the_documented_millisecond_bounds() {
        let sample_rate = 48_000.0_f32;
        for (size, expected_min_ms, expected_max_ms) in [
            (0.0_f32, MIN_DELAY_MS_AT_SIZE_0, MAX_DELAY_MS_AT_SIZE_0),
            (1.0, MIN_DELAY_MS_AT_SIZE_1, MAX_DELAY_MS),
        ] {
            let mut reverb = FdnReverb::new(sample_rate, 8);
            reverb.set_param("size", size);

            let shortest_ms = *reverb.delay_lengths.iter().min().expect("lines exist") as f32
                / sample_rate
                * 1000.0;
            let longest_ms = *reverb.delay_lengths.iter().max().expect("lines exist") as f32
                / sample_rate
                * 1000.0;
            assert!(
                (shortest_ms - expected_min_ms).abs() < 1.0,
                "size {size} must put its shortest line near {expected_min_ms} ms, got {shortest_ms}"
            );
            assert!(
                (longest_ms - expected_max_ms).abs() < 1.0,
                "size {size} must put its longest line near {expected_max_ms} ms, got {longest_ms}"
            );
        }
    }

    /// Every line stays inside the buffer it was allocated, at every size and
    /// with the modulation pushed to its limit. The read in `process` clamps, so
    /// a length past the end degrades to a wrong delay rather than a panic —
    /// which is precisely the kind of failure that would go unnoticed.
    #[test]
    fn no_tuning_can_ask_for_a_delay_the_buffer_cannot_hold() {
        for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
            let capacity = delay_buffer_len(sample_rate);
            for step in 0..=20 {
                let size = step as f32 / 20.0;
                let mut reverb = FdnReverb::new(sample_rate, MAX_FDN_CHANNELS);
                reverb.set_param("size", size);
                reverb.set_param("mod_depth", 1.0);

                for (index, &length) in reverb.delay_lengths.iter().enumerate() {
                    assert!(
                        length + MODULATION_HEADROOM < capacity,
                        "line {index} asks for {length} samples plus modulation \
                         against a {capacity}-sample buffer at {sample_rate} Hz, \
                         size {size}"
                    );
                }
            }
        }
    }

    /// Distinct is necessary and not sufficient: two lines differing by one
    /// sample still share nearly every mode. The prime-power/coprime tuning
    /// exists to make the shared modes rare, so the lengths must also be
    /// pairwise coprime.
    #[test]
    fn delay_lengths_stay_pairwise_coprime_across_size_and_sample_rate() {
        fn gcd(mut a: usize, mut b: usize) -> usize {
            while b != 0 {
                let t = a % b;
                a = b;
                b = t;
            }
            a
        }

        for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
            for channels in [8_usize, 16] {
                for step in 0..=20 {
                    let size = step as f32 / 20.0;
                    let mut reverb = FdnReverb::new(sample_rate, channels);
                    reverb.set_param("size", size);

                    let lengths = &reverb.delay_lengths;
                    for (i, &a) in lengths.iter().enumerate() {
                        for (j, &b) in lengths.iter().enumerate().skip(i + 1) {
                            let common = gcd(a, b);
                            assert_eq!(
                                common, 1,
                                "lines {i} ({a}) and {j} ({b}) share a factor of \
                                 {common} at {sample_rate} Hz, {channels} lines, \
                                 size {size}: {lengths:?}"
                            );
                        }
                    }
                }
            }
        }
    }

    // The `decay` parameter as declared by the `dutch-oven` descriptor in
    // src/modules/Arrangement/models/PluginDescriptors/NativeDspDescriptors.ts.
    const DESCRIPTOR_MIN: f32 = 0.0;
    const DESCRIPTOR_DEFAULT: f32 = 0.5;
    const DESCRIPTOR_MAX: f32 = 0.999;

    fn rt60_for_decay(decay: f32) -> f32 {
        let mut reverb = FdnReverb::new(48_000.0, 8);
        reverb.set_param("decay", decay);
        reverb.rt60
    }

    fn hf_ratio_for_damping(damping: f32) -> f32 {
        let mut reverb = FdnReverb::new(48_000.0, 8);
        reverb.set_damping_version(2);
        reverb.set_param("damping", damping);
        reverb.rt60_hf / reverb.rt60
    }

    #[test]
    fn descriptor_decay_range_maps_onto_the_full_realisable_rt60() {
        // Endpoints of the declared range reach the endpoints of the FDN's
        // usable RT60 window; the descriptor default lands mid-hall.
        assert!(
            (rt60_for_decay(DESCRIPTOR_MIN) - MIN_RT60_SECONDS).abs() < 1e-4,
            "decay 0.0 must land on the shortest realisable RT60, got {}",
            rt60_for_decay(DESCRIPTOR_MIN)
        );
        assert!(
            (rt60_for_decay(DESCRIPTOR_DEFAULT) - 1.7320508).abs() < 1e-3,
            "decay 0.5 must land on ~1.73 s, got {}",
            rt60_for_decay(DESCRIPTOR_DEFAULT)
        );
        assert!(
            (rt60_for_decay(DESCRIPTOR_MAX) - 29.829_4).abs() < 1e-2,
            "decay 0.999 must reach ~29.8 s, got {}",
            rt60_for_decay(DESCRIPTOR_MAX)
        );
    }

    #[test]
    fn top_of_the_declared_range_is_reachable_not_clamped_near_one_second() {
        // Regression: the FDN used to read `decay` as raw seconds, so the whole
        // declared 0..0.999 range collapsed into an RT60 of 0.1..1.0 s.
        let top = rt60_for_decay(DESCRIPTOR_MAX);
        assert!(
            top > 25.0,
            "the top of the declared range must produce a long tail, got {top} s"
        );
        assert!(
            top <= MAX_RT60_SECONDS,
            "the mapping must stay inside the realisable window, got {top} s"
        );
    }

    #[test]
    fn decay_is_strictly_increasing_across_the_declared_range() {
        let mut previous = 0.0_f32;
        for step in 0..=999 {
            let decay = step as f32 / 1000.0;
            let rt60 = rt60_for_decay(decay);
            assert!(
                rt60 > previous,
                "RT60 must increase with decay: {decay} produced {rt60} s after {previous} s"
            );
            previous = rt60;
        }
    }

    #[test]
    fn out_of_range_decay_is_clamped_to_the_realisable_window() {
        assert!((rt60_for_decay(-1.0) - MIN_RT60_SECONDS).abs() < 1e-4);
        assert!((rt60_for_decay(4.2) - MAX_RT60_SECONDS).abs() < 1e-3);
    }

    #[test]
    fn rt60_alias_still_takes_raw_seconds() {
        // `rt60` is the seconds-native name and must not go through the
        // normalised mapping, or the two aliases would disagree.
        let mut reverb = FdnReverb::new(48_000.0, 8);
        reverb.set_param("rt60", 4.0);
        assert!((reverb.rt60 - 4.0).abs() < 1e-6);

        reverb.set_param("rt60", 500.0);
        assert!((reverb.rt60 - MAX_RT60_SECONDS).abs() < 1e-6);

        // ...and the normalised name is not an alias of it.
        reverb.set_param("decay", 4.0);
        assert!((reverb.rt60 - MAX_RT60_SECONDS).abs() < 1e-3);
        reverb.set_param("decay", 0.0);
        assert!((reverb.rt60 - MIN_RT60_SECONDS).abs() < 1e-4);
    }

    #[test]
    fn damping_ratio_survives_a_later_decay_change() {
        let mut reverb = FdnReverb::new(48_000.0, 8);
        reverb.set_param("damping", 0.5);
        let short_ratio = reverb.rt60_hf / reverb.rt60;

        reverb.set_param("decay", 0.9);
        let long_ratio = reverb.rt60_hf / reverb.rt60;

        assert!(
            (short_ratio - long_ratio).abs() < 1e-6,
            "damping is a ratio of the current RT60: {short_ratio} vs {long_ratio}"
        );
        assert!(
            reverb.rt60_hf > 1.0,
            "the HF band must stretch with the tail, got {} s",
            reverb.rt60_hf
        );
    }

    #[test]
    fn zero_damping_leaves_the_high_frequency_rt60_undiminished() {
        let ratio = hf_ratio_for_damping(0.0);
        assert!(
            (ratio - 1.0).abs() < 1e-6,
            "damping=0 must leave HF RT60 equal to the base RT60, got ratio {ratio}"
        );
    }

    #[test]
    fn descriptor_default_halves_the_high_frequency_rt60() {
        let ratio = hf_ratio_for_damping(0.3);
        assert!(
            (ratio - 0.5).abs() < 1e-6,
            "the shipped damping=0.3 must land on the conventional 0.5x HF RT60, got {ratio}"
        );
    }

    #[test]
    fn legacy_project_damping_keeps_its_original_ratio() {
        let mut reverb = FdnReverb::new(48_000.0, 8);
        reverb.set_param("damping", 0.3);
        let ratio = reverb.rt60_hf / reverb.rt60;
        assert!(
            (ratio - 0.35).abs() < 1e-6,
            "an unversioned saved device must keep the legacy 0.35x ratio, got {ratio}"
        );
    }

    #[test]
    fn damping_mapping_is_strictly_darker_across_the_declared_range() {
        let mut previous = f32::INFINITY;
        for step in 0..=999 {
            let damping = step as f32 / 1000.0;
            let ratio = normalized_hf_rt60_ratio(damping);
            assert!(
                ratio < previous,
                "HF RT60 ratio must fall as damping rises: {damping} produced {ratio} after {previous}"
            );
            previous = ratio;
        }
    }

    #[test]
    fn mapping_helper_agrees_with_the_engine_it_feeds() {
        for step in 0..=100 {
            let decay = step as f32 / 100.0;
            assert!((decay_to_rt60_seconds(decay) - rt60_for_decay(decay)).abs() < 1e-6);
        }
    }
}
