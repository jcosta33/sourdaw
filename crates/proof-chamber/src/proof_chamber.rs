/// Dutch Oven — flagship reverb plugin.
///
/// Implements Dattorro's 1997 plate reverb (JAES "Effect Design Part 1")
/// with exact delay lengths, tap positions, and coefficients from the paper.
/// Reference sample rate: 29761 Hz. All delays scale to target rate.
///
/// Features: modulated tank with allpass interpolation, 14-tap stereo output,
/// freeze, shimmer (granular pitch shifter in feedback), and pre-delay.
use std::f32::consts::TAU;

use crate::decay_eq::{one_pole_magnitude, Biquad, DecayRateEq, NUM_PROBES};
use crate::early_reflections::EarlyReflections;
use crate::output_stage::OutputStage;

// ---------------------------------------------------------------------------
// Reference delays at 29761 Hz (Dattorro Table 1)
// ---------------------------------------------------------------------------

const REF_RATE: f32 = 29761.0;

// Input diffusers
const INPUT_DIFF_DELAYS: [usize; 4] = [142, 107, 379, 277];

// Left tank (nodes 23→39)
const LEFT_MOD_AP_DELAY: usize = 672;
const LEFT_DELAY_1: usize = 4453;
const LEFT_AP_DELAY: usize = 1800;
const LEFT_DELAY_2: usize = 3720;

// Right tank (nodes 46→63)
const RIGHT_MOD_AP_DELAY: usize = 908;
const RIGHT_DELAY_1: usize = 4217;
const RIGHT_AP_DELAY: usize = 2656;
const RIGHT_DELAY_2: usize = 3163;

// Modulation
const EXCURSION: f32 = 16.0; // peak excursion in samples at ref rate

/// How far `gravity` may tilt the tank allpass coefficient away from the
/// Dattorro-linked value, per unit of gravity.
///
/// Sized by its two hard constraints rather than by taste. The coefficient it
/// scales tops out at 0.50, so 0.30 puts the widest possible tank allpass gain
/// at `0.50 * 1.45 = 0.725` — comfortably inside the range a Schroeder allpass
/// is stable in, and in the same neighbourhood as the 0.70 the input diffusers
/// already run at. Shrinking it would make the control inaudible at the
/// extremes; growing it would push the tank towards unity gain, where it rings
/// rather than decays.
const GRAVITY_TILT_SPAN: f32 = 0.30;

// Output taps (from the paper's Table 2)
// Left output taps: (delay_line_id, tap_position, sign)
// delay IDs: 0=left_delay1 (24→30), 1=left_ap (31→33), 2=left_delay2 (33→39)
//            3=right_delay1 (48→54), 4=right_ap (55→59), 5=right_delay2 (59→63)
const LEFT_TAPS: [(usize, usize, f32); 7] = [
    (3, 266, 0.6),   // +delay_48_54[266]
    (3, 2974, 0.6),  // +delay_48_54[2974]
    (4, 1913, -0.6), // -allpass_55_59[1913]
    (5, 1996, 0.6),  // +delay_59_63[1996]
    (0, 1990, -0.6), // -delay_24_30[1990]
    (1, 187, -0.6),  // -allpass_31_33[187]
    (2, 1066, -0.6), // -delay_33_39[1066]
];

const RIGHT_TAPS: [(usize, usize, f32); 7] = [
    (0, 353, 0.6),   // +delay_24_30[353]
    (0, 3627, 0.6),  // +delay_24_30[3627]
    (1, 1228, -0.6), // -allpass_31_33[1228]
    (2, 2673, 0.6),  // +delay_33_39[2673]
    (3, 2111, -0.6), // -delay_48_54[2111]
    (4, 335, -0.6),  // -allpass_55_59[335]
    (5, 121, -0.6),  // -delay_59_63[121]
];

// ---------------------------------------------------------------------------
// Delay line
// ---------------------------------------------------------------------------

struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
    len: usize,
}

impl DelayLine {
    fn new(max_len: usize) -> Self {
        Self {
            buffer: vec![0.0; max_len.max(1)],
            write_pos: 0,
            len: max_len,
        }
    }

    #[inline]
    fn write(&mut self, sample: f32) {
        // Magnitude truncation to eliminate limit-cycle oscillation
        let truncated = if sample.abs() < 1e-18 { 0.0 } else { sample };
        self.buffer[self.write_pos] = truncated;
        self.write_pos = (self.write_pos + 1) % self.len;
    }

    /// Read `delay` samples back from the **most recently written** sample.
    /// `read(0)` is that sample itself, `read(n)` is the one `n` writes before
    /// it.
    ///
    /// Deliberately phrased against the write history rather than as "a delay
    /// of `delay` samples", because the two are not the same thing at every
    /// call site and this file has both kinds. Three of the six callers write
    /// first and then read — the pre-delay, the two fixed tank delays per half,
    /// and the fourteen output taps — and for those `read(n)` is a delay of
    /// exactly `n` relative to the sample entering the line this cycle. The
    /// other three read *before* writing — `Allpass::process` and, through
    /// `read_allpass_interp`, the two modulated tank allpasses — and for those
    /// the most recent sample is last cycle's, so `read(n)` is a delay of
    /// `n + 1`. A doc line promising "a delay of `delay`" would be wrong for
    /// half the file, so this one promises what the expression does.
    #[inline]
    fn read(&self, delay: usize) -> f32 {
        // The `- 1` is the whole of #1547. `write` post-increments, so by the
        // time a caller reads, `write_pos` addresses the slot the *next* sample
        // will occupy and `write_pos - 1` holds the most recently written one.
        // The count therefore starts at `write_pos - 1`.
        //
        // Counting from `write_pos` instead — which is what this line did —
        // shifted every read one sample earlier in the line, and cost two
        // separate things:
        //
        // * Taps arrived one sample early. Dattorro's Table 2 positions are
        //   literal sample delays into the tank lines, so `delay_48_54[266]` is
        //   266 samples and this line delivered 265. All fourteen output taps
        //   now land where the paper puts them, as do the six Schroeder
        //   allpasses, whose `read(len - 1)` ahead of the write is a delay of
        //   exactly their buffer length.
        //
        //   Six reads are still not the paper's number, and the fix is not what
        //   makes them wrong. The four fixed tank delays pass `scaled_delays[i]`,
        //   which *is* their buffer length, so `.min(len - 1)` clamps and they
        //   deliver `len - 1` — one short, as they were one shorter still
        //   before. The two `read_allpass_interp` calls run before their write
        //   and so deliver `mod_delay + 1`, where before they delivered
        //   `mod_delay` and were the only correct reads in the file. Both are a
        //   single sample on lines of 4453 and 672 at the reference rate, which
        //   is why they are recorded here rather than chased: correcting them
        //   means widening two buffers and subtracting one from two call sites,
        //   and every render digest in the crate moves for 0.01% of a delay
        //   length.
        //
        // * `read(0)` had no representation at all. `(write_pos + len - 0) % len`
        //   is `write_pos`, the *oldest* slot — so a caller asking for the
        //   minimum delay silently got the maximum, `len - 1` samples. That is
        //   not a rounding error on a tank tap, where the argument is a
        //   compile-time constant that is never zero. It is a half-second on
        //   the pre-delay, whose line is `sample_rate * 0.5` long and whose
        //   argument is a user control declared from 0 ms. Pre-Delay at its own
        //   minimum rendered an engine that emitted nothing at all for 500 ms
        //   and then started.
        //
        // The defect is a class, not an instance: the same expression on the
        // same pointer order is live in `bacteria/granular.rs` (#1570), where
        // Position at its declared minimum of 0 plays audio from two seconds
        // ago, and latent in `convolution.rs`'s true-stereo head. The copy in
        // this crate's `early_reflections.rs` was fixed alongside this one.
        //
        // The FDN's inline pre-delay (`fdn.rs`, `pd_read`) reads *before* it
        // advances its write position and has always been correct; this is the
        // same expression evaluated at the same point in the cycle.
        //
        // `delay.min(self.len - 1)` saturates rather than wrapping, so an
        // over-long request reads the oldest sample the line holds instead of
        // aliasing back to a short delay. The subtraction cannot underflow:
        // the clamp bounds it by `len - 1`.
        let pos = (self.write_pos + self.len - 1 - delay.min(self.len - 1)) % self.len;
        self.buffer[pos]
    }

    /// Read with allpass interpolation for fractional delay (unity gain at all frequencies).
    #[inline]
    fn read_allpass_interp(&self, delay_frac: f32) -> f32 {
        let delay_int = delay_frac as usize;
        let frac = delay_frac - delay_int as f32;

        let d0 = self.read(delay_int);
        let d1 = self.read(delay_int + 1);

        // First-order allpass interpolation: H(z) = (a + z^-1) / (1 + a*z^-1)
        // Simplified: out = d1 + frac * (d0 - d1) ... but that's linear.
        // True allpass: out = d0 + (1 - frac) * (d1 - prev_out)
        // For simplicity in reverb context, use the Thiran first-order approximation:
        let a = (1.0 - frac) / (1.0 + frac);
        d1 + a * (d0 - d1)
    }

    /// Tap at a specific position (for output mixing).
    #[inline]
    fn tap(&self, position: usize) -> f32 {
        self.read(position.min(self.len.saturating_sub(1)))
    }
}

// ---------------------------------------------------------------------------
// Allpass filter (two-multiplier lattice)
// ---------------------------------------------------------------------------

struct Allpass {
    delay: DelayLine,
    gain: f32,
}

impl Allpass {
    fn new(delay_len: usize, gain: f32) -> Self {
        Self {
            delay: DelayLine::new(delay_len),
            gain,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.delay.read(self.delay.len - 1);
        let v = input - self.gain * delayed;
        self.delay.write(v);
        delayed + self.gain * v
    }

    /// Tap the internal delay at a specific position.
    #[inline]
    fn tap(&self, position: usize) -> f32 {
        self.delay.tap(position)
    }
}

// ---------------------------------------------------------------------------
// One-pole lowpass filter
// ---------------------------------------------------------------------------

struct OnePole {
    state: f32,
    coeff: f32, // 0 = pass-all, approaching 1 = heavy lowpass
}

impl OnePole {
    fn new(coeff: f32) -> Self {
        Self { state: 0.0, coeff }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        self.state = input * (1.0 - self.coeff) + self.state * self.coeff;
        self.state
    }
}

// ---------------------------------------------------------------------------
// Simple one-pole filters for input/output EQ
// ---------------------------------------------------------------------------

// `HighCut` and `LowCut` moved to `output_stage.rs` along with the width
// matrix, so the FDN, spring and reverse engines can run the same wet-path
// tone stage this engine used to own privately.

// ---------------------------------------------------------------------------
// Granular pitch shifter (for shimmer)
// ---------------------------------------------------------------------------

/// Where the shimmer feed is band-limited before the grains resample it.
///
/// Reading a grain faster than it was written is resampling, and resampling
/// images: anything the tank carries above `sample_rate / (2 * ratio)`
/// transposes past Nyquist and folds back down the spectrum as a pitch nobody
/// selected — which then recirculates through the tank feedback and folds again.
///
/// 6 kHz is the conventional corner for a shimmer feed rather than the highest
/// one that would be safe. Shimmer designs feed the pitch shifter a deliberately
/// dark signal so the transposed voice reads as a halo over the source instead
/// of a second and brighter copy of it, and an octave up of a 6 kHz feed still
/// reaches 12 kHz, so the wash keeps its air. Sitting that far down also leaves
/// most of an octave of transition band before the worst-case fold corner —
/// 11.025 kHz, at 44.1 kHz with the octave selected — which is what lets a
/// filter this cheap do the job.
const SHIMMER_FEED_HZ: f32 = 6_000.0;

/// The largest ratio `shimmer_pitch` selects, and so the one that folds first.
const MAX_SHIMMER_RATIO: f32 = 2.0;

struct GranularShifter {
    buffer: Vec<f32>,
    /// Anti-imaging lowpass on the buffer feed, as a fourth-order Butterworth
    /// pair. Only what the grains read is filtered: the dry term in the output
    /// blend below stays full-band, so engaging Shimmer does not darken the tank
    /// it sits in.
    ///
    /// The order is set by the rejection needed at the fold frequencies, not by
    /// the passband. Measured on the fold cells in
    /// `plate_shimmer_render_contract.rs`: one second-order section at this
    /// corner rejects 24 to 40 dB, which misses the bar that file sets in every
    /// cell; two reach 55 to 63 dB. A third section was measured too and buys
    /// another 5 to 6 dB — real, but a diminishing return on a biquad running
    /// per sample in each of two tank halves, and far inside the margin two
    /// sections already hold.
    feed: [Biquad; 2],
    write_pos: usize,
    phase1: f64,
    phase2: f64,
    /// Extra delay the grain currently in flight reads back from, drawn once
    /// when that grain starts. See `draw_scatter`.
    scatter1: f64,
    scatter2: f64,
    pitch_ratio: f64,
    grain_size: usize,
    enabled: bool,
    amount: f32,
    // Random grain placement for Eno/Lanois wash character
    jitter_state: u32,
    scatter_range: f64, // samples of grain-position scatter
}

impl GranularShifter {
    /// One shifter owns one channel. `jitter_seed` decorrelates the wash
    /// between the two tank halves, which would otherwise scatter their grains
    /// in lockstep and collapse the shimmer to the centre of the image.
    fn new(sample_rate: f32, jitter_seed: u32) -> Self {
        // 30ms grain. A grain reaches back one grain of history, plus however
        // far its own scatter draw pushes it, so four grains of buffer covers
        // both with room to spare.
        let grain_size = (0.030 * sample_rate as f64) as usize;
        let buf_size = grain_size * 4;

        // Butterworth Q pair for a fourth-order cascade. The corner only moves
        // off its conventional 6 kHz on a rate low enough that the octave would
        // otherwise fold below it.
        let corner = SHIMMER_FEED_HZ.min(0.55 * sample_rate / (2.0 * MAX_SHIMMER_RATIO));
        let mut feed = [Biquad::new(), Biquad::new()];
        feed[0].design_lowpass(corner, 0.541_196, sample_rate);
        feed[1].design_lowpass(corner, 1.306_563, sample_rate);

        Self {
            buffer: vec![0.0; buf_size],
            feed,
            write_pos: 0,
            phase1: 0.0,
            phase2: 0.5, // 180° offset for overlap
            scatter1: 0.0,
            scatter2: 0.0,
            pitch_ratio: 2.0, // octave up
            grain_size,
            enabled: false,
            amount: 0.2,
            jitter_state: jitter_seed,
            scatter_range: grain_size as f64,
        }
    }

    /// Cheap noise for jitter
    fn jitter(&mut self) -> f64 {
        self.jitter_state ^= self.jitter_state << 13;
        self.jitter_state ^= self.jitter_state >> 17;
        self.jitter_state ^= self.jitter_state << 5;
        (self.jitter_state as f64 / u32::MAX as f64) * 2.0 - 1.0
    }

    /// Where in recent history the next grain starts reading from.
    ///
    /// Scattering *grains* is what granular processing randomises, and it has
    /// to be redrawn per grain rather than per sample. A read offset redrawn
    /// every sample is not placement at all: it modulates the read pointer at
    /// audio rate, which is a noise generator, and it is the reason the tail
    /// used to come back as a flat hiss.
    ///
    /// The draw has to span a good fraction of a grain to do its job. Grains
    /// restart on a fixed period, and a periodically restarting resampler is a
    /// linear periodically time-varying system: its output for an input partial
    /// at `f` can only land on the grid `f + k / grain_period`, which does not
    /// in general contain `f * ratio` — it does so only when a grain holds a
    /// whole number of input cycles, and the transposed partial is otherwise the
    /// one frequency such a shifter cannot produce. Restarting each grain at an
    /// unrelated point in history randomises the phase every grain inherits,
    /// which breaks the periodicity that builds the grid: the transposed energy
    /// then arrives centred on `f * ratio`, spread over a band about one grain
    /// rate wide rather than standing as a single line.
    #[inline]
    fn draw_scatter(&mut self) -> f64 {
        (self.jitter() * 0.5 + 0.5) * self.scatter_range
    }

    /// The buffer at a fractional position, linearly interpolated.
    ///
    /// The read pointer carries a fraction — the scatter draw and the ramp both
    /// put it between samples — and rounding it to an index throws that fraction
    /// away, which is a quantisation error that changes every sample. It is not
    /// what the fold cell in `plate_shimmer_render_contract.rs` measures (that
    /// figure is unchanged by interpolating), but a fractional pointer that gets
    /// truncated is a pointer whose fraction was computed for nothing.
    ///
    /// `floor` rather than a cast: read positions go negative whenever a grain
    /// reaches back past the start of the buffer, and a cast truncates toward
    /// zero there, which would fold one sample of the grain onto its neighbour.
    #[inline]
    fn read_interpolated(&self, position: f64) -> f32 {
        let buf_len = self.buffer.len();
        let base = position.floor();
        let fraction = (position - base) as f32;
        let lower = (base as isize).rem_euclid(buf_len as isize) as usize;
        let upper = if lower + 1 == buf_len { 0 } else { lower + 1 };
        let (a, b) = (self.buffer[lower], self.buffer[upper]);
        a + (b - a) * fraction
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        if !self.enabled {
            return input;
        }

        let buf_len = self.buffer.len();
        // Band-limit what the grains will resample, not what the blend returns.
        let mut feed = self.feed[0].process(input);
        feed = self.feed[1].process(feed);
        self.buffer[self.write_pos] = feed;
        self.write_pos = (self.write_pos + 1) % buf_len;

        let gs = self.grain_size as f64;

        // A grain raises pitch by replaying recent history *faster* than it was
        // written, so its read pointer has to trail the write pointer by a
        // delay that shrinks as the grain plays: one grain of history at
        // `phase = 0`, closing on the write pointer as `phase` approaches 1,
        // offset by wherever this grain's scatter draw started it. The delay is
        // consumed at `pitch_ratio - 1` samples per sample, so the pointer
        // advances at `pitch_ratio` and the grain comes back up-shifted by
        // exactly that factor. Trailing by a *growing* delay is the same
        // construction upside down and shifts down instead, which is what a
        // `gs * phase` delay does.
        //
        // The end of the ramp is not a read of the sample just written. Closing
        // on `write_pos` closes on the slot the write above already stepped
        // past, which is the *oldest* sample the buffer holds — a whole buffer
        // of delay, `4 * gs`, rather than none. That discontinuity is never
        // heard because the Hann window below is at its zero exactly there, and
        // the scatter draw normally keeps the pointer short of it anyway; it is
        // the envelope, not the arithmetic, that makes the wrap silent.
        let read1 = self.write_pos as f64 - gs * (1.0 - self.phase1) - self.scatter1;
        let read2 = self.write_pos as f64 - gs * (1.0 - self.phase2) - self.scatter2;

        // Hann envelope, taken at the phase the pointers above were taken at so
        // a grain's window stays aligned with its own pointer. The window sits
        // at its zero on both ends of the ramp, which is where the pointer jumps
        // back to a fresh start, so the jump itself is silent.
        //
        // The two grains stay exactly a half period apart, so the envelopes sum
        // to one. That holds the *envelope* flat, not the output: the grains
        // read from independently drawn points in history, so they are mutually
        // incoherent and their sum at the crossfade midpoint runs with the phase
        // between them rather than with the envelope. Short-window RMS wobbles
        // by some 9 dB at the octave and 4 dB at the fifth. An equal-power
        // crossfade measures worse on both counts, so the wobble is what this
        // design costs, not something left unfinished.
        let env1 = (0.5 * (1.0 - (TAU as f64 * self.phase1).cos())) as f32;
        let env2 = (0.5 * (1.0 - (TAU as f64 * self.phase2).cos())) as f32;

        let shifted = self.read_interpolated(read1) * env1 + self.read_interpolated(read2) * env2;

        // Advance last, and redraw each grain's placement at its own wrap —
        // where its envelope is at zero, so the jump costs nothing.
        let increment = (self.pitch_ratio - 1.0) / gs;
        self.phase1 += increment;
        if self.phase1 >= 1.0 {
            self.phase1 -= 1.0;
            self.scatter1 = self.draw_scatter();
        }
        self.phase2 += increment;
        if self.phase2 >= 1.0 {
            self.phase2 -= 1.0;
            self.scatter2 = self.draw_scatter();
        }

        // Shimmer lives inside the tank feedback path. Adding the shifted
        // signal at full scale makes the path's gain exceed unity when Decay
        // is near its reachable ceiling. Normalising by the sum of the dry and
        // shifted weights preserves their existing ratio while keeping this
        // stage at unity gain across the whole Amount range.
        (input + shifted * self.amount) / (1.0 + self.amount)
    }
}

// ---------------------------------------------------------------------------
// Dutch Oven — the main reverb engine
// ---------------------------------------------------------------------------

fn scale_delay(ref_delay: usize, sample_rate: f32) -> usize {
    ((ref_delay as f32 * sample_rate / REF_RATE) + 0.5) as usize
}

pub struct ProofChamber {
    sample_rate: f32,

    // Parameters
    mix: f32,
    decay: f32,
    damping: f32,
    predelay_ms: f32,
    size: f32,
    mod_rate: f32,
    mod_depth: f32,
    diffusion: f32,
    freeze: bool,
    gravity: f32,        // -1 to +1: negative = reverse swell, positive = normal
    saturation_type: u8, // 0=tanh, 1=chebyshev, 2=hard clip
    saturation_enabled: bool,
    /// 0 = all early reflections, 1 = all tank. Same meaning and same blend as
    /// `FdnReverb::early_late_balance`, so the shipped default of 0.4 sounds
    /// like the same control on both engines.
    early_late_balance: f32,

    // Input section
    bandwidth_filter: OnePole,
    input_diffusers: [Allpass; 4],

    /// Early reflections, tapped off the pre-delayed input ahead of the tank.
    ///
    /// One instance, not the FDN's pair. The plate sums its input to mono
    /// before the pre-delay, so a second instance fed the same signal with the
    /// same tap table would produce a bit-identical second copy — twice the
    /// buffer and twice the tap sum for nothing. The stereo image of this
    /// engine comes from the tank's 14 output taps, which the blend leaves
    /// untouched.
    early_reflections: EarlyReflections,

    // Pre-delay
    predelay: DelayLine,
    predelay_len: usize,

    // Tank — left half
    left_mod_ap: DelayLine, // modulated allpass delay
    left_mod_ap_gain: f32,
    left_delay_1: DelayLine,
    left_damp: OnePole,
    left_ap: Allpass,
    left_delay_2: DelayLine,

    // Tank — right half
    right_mod_ap: DelayLine,
    right_mod_ap_gain: f32,
    right_delay_1: DelayLine,
    right_damp: OnePole,
    right_ap: Allpass,
    right_delay_2: DelayLine,

    /// Decay Rate EQ, one instance per tank half.
    ///
    /// Two rather than one because the halves are separate filter states on
    /// separate signals; sharing an instance would cross-couple them through
    /// the biquad memories and collapse the stereo tank into something closer
    /// to mono.
    ///
    /// The base loop gain these are told is `decay * decay`, not `decay`. A
    /// signal entering the left half is multiplied by `decay` once inside that
    /// half and once more as it crosses into the right, so `decay^2` is the
    /// gain per EQ application — which is the quantity Jot's formula wants,
    /// since the stage is applied once per half-traversal. Getting this wrong
    /// would not break the sign or the shape of the control, only its scale,
    /// which is exactly the kind of error a render-delta guard passes.
    decay_eq_left: DecayRateEq,
    decay_eq_right: DecayRateEq,
    /// The `(per-half-traversal scalar gain, tank damping coefficient)` the two
    /// stages above were last designed for, so a per-block redesign only
    /// happens when one of them actually moved.
    ///
    /// Both, not just the gain: the tank's damper is inside the same loop, so
    /// the loop's per-pass loss is a function of frequency and `damping` moves
    /// it as surely as `decay` does.
    decay_eq_base_gain: f32,
    decay_eq_damping: f32,

    // Tank state (cross-feedback)
    left_tank_output: f32,
    right_tank_output: f32,

    // Modulation LFOs
    lfo_phase_l: f32,
    lfo_phase_r: f32,
    excursion: f32,

    /// Wet-path tone and width. Shared with the FDN, spring and reverse
    /// engines since #1495's gap table — the same two filters and the same
    /// mid/side matrix this engine used to own alone.
    output: OutputStage,

    // Shimmer. One shifter per tank half: a shifter holds a delay line of its
    // own history, so feeding one shifter both halves interleaves them a sample
    // at a time and every grain read lands on whichever half the jitter happens
    // to point at. What comes back from that is a scramble of two unrelated
    // signals, not either one of them transposed.
    shimmer_left: GranularShifter,
    shimmer_right: GranularShifter,

    // Parameter smoothing (30ms ramp to prevent clicks)
    smooth_mix: f32,
    smooth_decay: f32,
    smooth_coeff: f32, // one-pole smoothing coefficient

    // Scaled delay lengths (for output tapping)
    scaled_delays: [usize; 6], // [left_d1, left_ap, left_d2, right_d1, right_ap, right_d2]
    scaled_taps_l: [(usize, usize, f32); 7],
    scaled_taps_r: [(usize, usize, f32); 7],
}

impl ProofChamber {
    pub fn new(sample_rate: f32) -> Self {
        let s = |d: usize| scale_delay(d, sample_rate);

        let scaled_left_mod =
            s(LEFT_MOD_AP_DELAY) + (EXCURSION * sample_rate / REF_RATE) as usize + 2;
        let scaled_right_mod =
            s(RIGHT_MOD_AP_DELAY) + (EXCURSION * sample_rate / REF_RATE) as usize + 2;

        let left_d1_len = s(LEFT_DELAY_1);
        let left_ap_len = s(LEFT_AP_DELAY);
        let left_d2_len = s(LEFT_DELAY_2);
        let right_d1_len = s(RIGHT_DELAY_1);
        let right_ap_len = s(RIGHT_AP_DELAY);
        let right_d2_len = s(RIGHT_DELAY_2);

        let scaled_delays = [
            left_d1_len,
            left_ap_len,
            left_d2_len,
            right_d1_len,
            right_ap_len,
            right_d2_len,
        ];

        // Scale output taps
        let scale_taps = |taps: &[(usize, usize, f32); 7]| -> [(usize, usize, f32); 7] {
            let mut out = [(0usize, 0usize, 0.0f32); 7];
            for i in 0..7 {
                out[i] = (taps[i].0, s(taps[i].1), taps[i].2);
            }
            out
        };

        let excursion = EXCURSION * sample_rate / REF_RATE;
        let predelay_max = (sample_rate * 0.5) as usize; // 500ms max

        Self {
            sample_rate,
            mix: 0.3,
            decay: 0.5,
            // Dattorro's Table 1 gives 0.0005 here, and 0.0005 is what this
            // engine shipped. The transcription was not the error — the row is
            //
            //     damping = 0.0005    High-frequency damping; no damping = 0.0
            //
            // so 0.0005 is the paper's own recommended value, sitting just off
            // the neutral extreme its annotation names. What is wrong is
            // shipping the paper's value as a *product* default.
            //
            // Three reasons, none of them about the paper:
            //
            // * It contradicted its own reset target and the module default.
            //   Two declarations said 0.3 — `DEFAULT_PARAMS.damping` and the
            //   Damp knob's `defaultValue` — while `addDevice` pushed the
            //   descriptor's 0.0005 to the engine. The knob's *readout* is not
            //   part of that disagreement and an earlier revision of this
            //   comment said it was: it displays the stored value through
            //   `Math.round(v * 100)`, so an old device read "0%" and agreed
            //   with the engine. That agreement is what made this invisible —
            //   0.0005 and a true zero are the same three characters on screen.
            // * It is off the control's grid. The knob is `step={0.001}`, so
            //   the reset target above was the only way back to 0.0005 and it
            //   pointed somewhere else; once the user touched Damp, the value
            //   their device booted at was unreachable.
            // * It does not sound like a plate. In this file's `OnePole` that
            //   coefficient removes 0.0087 dB at Nyquist; measured on an
            //   impulse at mix 1, the 6-12 kHz band came out +0.21 dB *above*
            //   400-1200 Hz 1.5-3.0 s into the tail. A plate that gets brighter
            //   as it decays is a ringing tank. 0.3 puts the corner at 10.6 kHz
            //   and the same measurement at -8.45 dB.
            //
            // #1546 has the EMT 140 TS target; the rendered figures are pinned
            // in `tests/plate_default_damping.rs`, and the peer defaults — with
            // the layer named for each, because library and application
            // disagree in at least two of them — are in `fdn.rs` beside the
            // FDN's own damping literal. For this algorithm the nearest
            // reference point is Faust's `dm.dattorro_rev_demo`, which ships its
            // Damping slider at 0.625: the demo application built on the same
            // paper defaults to more than double 0.3. That cuts against 0.3
            // being too dark, not for it.
            damping: 0.3,
            predelay_ms: 15.0,
            size: 0.75,
            mod_rate: 1.0,
            mod_depth: 0.3,
            diffusion: 0.75,
            freeze: false,
            gravity: 0.5,
            saturation_type: 0,
            saturation_enabled: false,
            early_late_balance: 0.4,

            // Stays at Dattorro's `bandwidth = 0.9995`, and deliberately, even
            // though the coefficient below is numerically the same 0.0005 the
            // damping seed had before #1546 moved it. The two lines look like
            // one mistake and are not:
            //
            // * **Topology.** `left_damp`/`right_damp` sit inside the tank's
            //   recirculating path, so their coefficient compounds once per
            //   circulation — hundreds of times across a three-second tail.
            //   This filter sits on the input, ahead of the diffusers, with no
            //   feedback around it, and is applied exactly once per sample.
            //   Its entire authority is its response at Nyquist,
            //   20*log10(0.9995/1.0005) = -0.0087 dB. The same number in the
            //   two positions is not the same amount of filtering.
            // * **No contradicted claim.** `damping` contradicted its own reset
            //   target and the module default — the Damp knob's `defaultValue`
            //   and `DEFAULT_PARAMS.damping`, both 0.3 — and that contradiction
            //   is what made it a defect rather than a preference. `bandwidth`
            //   has no reset target, no module default, no descriptor entry, no
            //   `set_param` arm and no control, so there is nothing for it to
            //   contradict. The user-facing treble control on this path is the
            //   output stage's 12 kHz `high_cut`.
            //
            // The paper does **not** separate the two, and an earlier revision
            // of this comment claimed it did. Table 1 reads
            //
            //     bandwidth = 0.9995  High-frequency attenuation on input;
            //                         full bandwidth = 0.9999999
            //     damping   = 0.0005  High-frequency damping; no damping = 0.0
            //
            // — both rows list a near-neutral value and name their own neutral
            // extreme, and §1.3.5 gives both filters the same recommended range
            // 0.0 to 0.9999999. Neither literal is "the paper's bypass". The
            // split above rests on topology and on which of the two contradicts
            // something the product says, and it does not need the paper's help.
            //
            // The `tests` module at the foot of this file measures this
            // filter's coefficient on the *running* engine — after a render,
            // and after every advertised parameter has been driven across its
            // range — and reds if it ever acquires enough authority for the
            // reasoning above to stop holding.
            bandwidth_filter: OnePole::new(1.0 - 0.9995), // bandwidth=0.9995
            input_diffusers: [
                Allpass::new(s(INPUT_DIFF_DELAYS[0]), 0.750),
                Allpass::new(s(INPUT_DIFF_DELAYS[1]), 0.750),
                Allpass::new(s(INPUT_DIFF_DELAYS[2]), 0.625),
                Allpass::new(s(INPUT_DIFF_DELAYS[3]), 0.625),
            ],

            predelay: DelayLine::new(predelay_max),
            predelay_len: ((15.0 / 1000.0) * sample_rate) as usize,

            // Seeded at the same room size the FDN uses, so a project that
            // never touches Size hears the same reflection pattern whichever
            // of the two engines it selects.
            early_reflections: EarlyReflections::new(sample_rate, 0.5),

            left_mod_ap: DelayLine::new(scaled_left_mod),
            left_mod_ap_gain: -0.70,
            left_delay_1: DelayLine::new(left_d1_len),
            // Seeded to match `damping` above, though `process()` overwrites
            // both tank damp coefficients from `self.damping` at the top of
            // every block, so these two literals never survive the first
            // render. They are kept in step so that reading the constructor
            // does not suggest a different tank than the one that runs.
            left_damp: OnePole::new(0.3),
            left_ap: Allpass::new(left_ap_len, 0.50),
            left_delay_2: DelayLine::new(left_d2_len),

            right_mod_ap: DelayLine::new(scaled_right_mod),
            right_mod_ap_gain: -0.70,
            right_delay_1: DelayLine::new(right_d1_len),
            right_damp: OnePole::new(0.3),
            right_ap: Allpass::new(right_ap_len, 0.50),
            right_delay_2: DelayLine::new(right_d2_len),

            // Seeded flat; `process` hands both stages the tank's real
            // frequency-dependent per-pass magnitude before the first sample,
            // and the sentinels below force that on the first block.
            decay_eq_left: DecayRateEq::new(sample_rate, 1.0),
            decay_eq_right: DecayRateEq::new(sample_rate, 1.0),
            decay_eq_base_gain: f32::NAN,
            decay_eq_damping: f32::NAN,

            left_tank_output: 0.0,
            right_tank_output: 0.0,

            lfo_phase_l: 0.0,
            lfo_phase_r: 0.25, // quadrature

            excursion,

            output: OutputStage::new(sample_rate),

            shimmer_left: GranularShifter::new(sample_rate, 54321),
            shimmer_right: GranularShifter::new(sample_rate, 1_402_237),

            smooth_mix: 0.3,
            smooth_decay: 0.5,
            smooth_coeff: 1.0 - (-1.0 / (0.030 * sample_rate)).exp(), // 30ms ramp

            scaled_delays,
            scaled_taps_l: scale_taps(&LEFT_TAPS),
            scaled_taps_r: scale_taps(&RIGHT_TAPS),
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        // The shared wet-path stage owns the two tone ids, and reports whether
        // it took the write rather than swallowing everything.
        if self.output.set_param(name, value) {
            return;
        }

        match name {
            // `width` stays an engine-level arm: the matrix only means
            // something on an engine whose wet path has two different channels.
            "width" => self.output.set_width(value),
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "decay" => self.decay = value.clamp(0.0, 0.9999),
            "damping" => self.damping = value.clamp(0.0, 0.9999),
            "predelay" => {
                self.predelay_ms = value.clamp(0.0, 500.0);
                self.predelay_len = ((value / 1000.0) * self.sample_rate) as usize;
                self.predelay_len = self.predelay_len.min(self.predelay.len - 1);
            }
            "size" => {
                let clamped = value.clamp(0.0, 1.0);
                self.size = clamped;
                // Reflection spacing follows room size, exactly as it does on
                // the FDN (`fdn.rs`, the same arm). The plate's *tank* delays
                // still do not scale with Size — they are fixed at Dattorro's
                // Table 1 lengths — so Size remains partly inert on this
                // engine. That is a separate defect from this one and needs
                // the tank rebuilt against a maximum length, not a wire.
                self.early_reflections
                    .update_room_size(self.sample_rate, clamped);
            }
            "mod_rate" => self.mod_rate = value.clamp(0.1, 5.0),
            "mod_depth" => self.mod_depth = value.clamp(0.0, 1.0),
            "diffusion" => {
                self.diffusion = value.clamp(0.0, 1.0);
                let d1 = 0.750 * value;
                let d2 = 0.625 * value;
                self.input_diffusers[0].gain = d1;
                self.input_diffusers[1].gain = d1;
                self.input_diffusers[2].gain = d2;
                self.input_diffusers[3].gain = d2;
            }
            "freeze" => {
                self.freeze = value > 0.5;
                if self.freeze {
                    // disable shimmer during freeze
                    self.shimmer_left.enabled = false;
                    self.shimmer_right.enabled = false;
                }
            }
            "shimmer" => {
                self.shimmer_left.enabled = value > 0.5;
                self.shimmer_right.enabled = value > 0.5;
            }
            "shimmer_amount" => {
                self.shimmer_left.amount = value.clamp(0.0, 1.0);
                self.shimmer_right.amount = value.clamp(0.0, 1.0);
            }
            "shimmer_pitch" => {
                let ratio = if value < 0.5 { 1.5 } else { 2.0 }; // fifth or octave
                self.shimmer_left.pitch_ratio = ratio;
                self.shimmer_right.pitch_ratio = ratio;
            }
            "gravity" => self.gravity = value.clamp(-1.0, 1.0),
            // Same name, same range and the same blend as `FdnReverb`. The
            // panel has always sent this and the plate has always dropped it,
            // which mattered more here than anywhere else: plate is the
            // default algorithm.
            "early_late" => self.early_late_balance = value.clamp(0.0, 1.0),
            "saturation" => self.saturation_enabled = value > 0.5,
            "saturation_type" => self.saturation_type = (value as u8).min(2),
            // Decay Rate EQ. Applied to both tank halves, because a curve that
            // shaped only one half would also be a stereo image control.
            //
            // The six literals are spelled out rather than matched by prefix
            // because `descriptorEngineParamWeld.spec.ts` reads the arm names
            // out of this file to decide which engines answer to which id, and
            // a prefix match is invisible to it.
            "decay_eq_0" | "decay_eq_1" | "decay_eq_2" | "decay_eq_3" | "decay_eq_4"
            | "decay_eq_5" => {
                let clamped = value.clamp(0.25, 4.0);
                if let Some(band) = crate::decay_eq::band_index_for_name(name) {
                    self.decay_eq_left.set_band_multiplier(band, clamped);
                    self.decay_eq_right.set_band_multiplier(band, clamped);
                }
            }
            "density" => {
                // Density controls inter-delay mixing (diffusion in the tank).
                // Higher density = more cross-coupling between tank halves.
                let d = value.clamp(0.0, 1.0);
                self.left_mod_ap_gain = -0.70 * d;
                self.right_mod_ap_gain = -0.70 * d;
            }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let target_decay = if self.freeze { 1.0 } else { self.decay };
        let input_gain = if self.freeze { 0.0 } else { 1.0 };
        let alpha = self.smooth_coeff;
        let damp = if self.freeze { 0.0 } else { self.damping };

        // Update damping coefficients
        self.left_damp.coeff = damp;
        self.right_damp.coeff = damp;

        // Linked decay_diffusion_2, tilted by gravity.
        //
        // `gravity` was accepted by `set_param`, clamped, stored — and never
        // read. The knob moved on the *default* algorithm and the render was
        // bit-identical across the whole declared range, which is the same
        // defect class as `early_late`, `saturation_type` and `density` before
        // them, and worse than all three because nothing had to be selected
        // for a user to meet it.
        //
        // What it should do was already written down twice: the field is
        // documented as "-1 to +1: negative = reverse swell, positive =
        // normal", and the tank allpass below carried the comment "gravity
        // adjusts coefficient distribution". Those agree. A larger allpass
        // coefficient smears more of each pass into later ones — energy
        // arrives late, which is the swell — and a smaller one lets the signal
        // through sooner, which is an ordinary decay. So gravity tilts that
        // coefficient, and nothing else.
        //
        // The tilt is exactly 1.0 at the shipped default of 0.5, so a project
        // that never wrote `gravity` renders bit-identically to what it
        // rendered before the parameter did anything — the same constraint
        // `density` was built to (`-0.70 * d`, neutral at its own default of
        // 1.0). `plate_parameter_surface.rs` asserts that identity rather than
        // trusting this comment.
        let dd2 = (target_decay + 0.15).clamp(0.25, 0.50);
        let gravity_tilt = 1.0 - (self.gravity - 0.5) * GRAVITY_TILT_SPAN;
        let tank_ap_gain = (dd2 * gravity_tilt).clamp(0.15, 0.72);
        self.left_ap.gain = tank_ap_gain;
        self.right_ap.gain = tank_ap_gain;

        // Re-tell the decay EQ what the tank is doing, once per block rather
        // than once per sample: `decay` is smoothed over 30 ms and redesigning
        // six biquads per sample would be an order of magnitude more work than
        // the tank itself. Same cadence, and the same reason, as `tank_ap_gain`
        // above.
        //
        // `target_decay` rather than `smooth_decay`, so a frozen tank
        // (`target_decay = 1.0`) hands the stage a per-pass gain of 1.0 and
        // every band designs at 0 dB. That is the correct answer rather than a
        // dodge: with no per-pass loss there is no decay rate for a multiplier
        // to be relative to, and a boost applied to a unity-gain loop is a
        // resonator, not a longer tail.
        let decay_eq_gain = target_decay * target_decay;
        if decay_eq_gain != self.decay_eq_base_gain || damp != self.decay_eq_damping {
            self.decay_eq_base_gain = decay_eq_gain;
            self.decay_eq_damping = damp;

            // The tank's per-pass loss is `decay^2` times the damper's own
            // magnitude, and the damper is a lowpass — so the loss at 8 kHz is
            // nothing like the loss at 100 Hz, and a stage told only the scalar
            // under-corrects wherever the damper bites. The probe grid is the
            // stage's own, so the two describe the same loop.
            let probes = *self.decay_eq_left.probe_frequencies();
            let mut gains = [0.0_f32; NUM_PROBES];
            for (index, freq) in probes.iter().enumerate() {
                gains[index] = decay_eq_gain * one_pole_magnitude(damp, *freq, self.sample_rate);
            }
            self.decay_eq_left.set_loop_gains(&gains);
            self.decay_eq_right.set_loop_gains(&gains);
        }

        let mod_depth = if self.freeze { 0.0 } else { self.mod_depth };

        for i in 0..left.len() {
            // Smooth parameters (30ms ramp prevents clicks)
            self.smooth_decay += alpha * (target_decay - self.smooth_decay);
            self.smooth_mix += alpha * (self.mix - self.smooth_mix);
            let decay = self.smooth_decay;

            let dry_l = left[i];
            let dry_r = right[i];

            // Sum to mono and apply input gain
            let mono = (dry_l + dry_r) * 0.5 * input_gain;

            // Pre-delay
            self.predelay.write(mono);
            let predelayed = self.predelay.read(self.predelay_len);

            // Early reflections, tapped off the same point the FDN taps.
            let early = self.early_reflections.process(predelayed);

            // Bandwidth filter
            let filtered = self.bandwidth_filter.process(predelayed);

            // Input diffusion (4 series allpasses)
            let mut diffused = filtered;
            for ap in self.input_diffusers.iter_mut() {
                diffused = ap.process(diffused);
            }

            // ── Tank processing ──────────────────────────────────

            // LFO modulation
            let lfo_l = (self.lfo_phase_l * TAU).sin();
            let lfo_r = (self.lfo_phase_r * TAU).sin();
            self.lfo_phase_l += self.mod_rate / self.sample_rate;
            self.lfo_phase_r += (self.mod_rate * 0.707) / self.sample_rate;
            if self.lfo_phase_l >= 1.0 {
                self.lfo_phase_l -= 1.0;
            }
            if self.lfo_phase_r >= 1.0 {
                self.lfo_phase_r -= 1.0;
            }

            let mod_l = self.excursion * 0.5 * mod_depth * lfo_l;
            let mod_r = self.excursion * 0.5 * mod_depth * lfo_r;

            // ── Left half ──
            // Input: diffused signal + cross-feedback from right
            let left_in = diffused + self.right_tank_output * decay;

            // Modulated allpass (using allpass interpolation for fractional delay)
            let base_delay_l = scale_delay(LEFT_MOD_AP_DELAY, self.sample_rate) as f32;
            let mod_delay_l = (base_delay_l + mod_l).max(1.0);
            let ap_read_l = self.left_mod_ap.read_allpass_interp(mod_delay_l);
            let v_l = left_in - self.left_mod_ap_gain * ap_read_l;
            self.left_mod_ap.write(v_l);
            let mod_ap_out_l = ap_read_l + self.left_mod_ap_gain * v_l;

            // Fixed delay 1
            self.left_delay_1.write(mod_ap_out_l);
            let d1_out_l = self.left_delay_1.read(self.scaled_delays[0]);

            // Damping + decay
            let damped_l = self.left_damp.process(d1_out_l);
            let mut decayed_l = damped_l * decay;

            // Per-band decay shaping, immediately after the per-pass gain it is
            // expressed relative to and *before* the saturator, so the
            // saturator stays the last nonlinearity in the loop and can still
            // catch a boosted band.
            decayed_l = self.decay_eq_left.process(decayed_l);

            // Soft saturation (before allpass, per Erbe-Verb design)
            if self.saturation_enabled {
                decayed_l = soft_saturate(decayed_l, self.saturation_type);
            }

            // Tank allpass. Its coefficient is set once per block above, from
            // the decay-linked `dd2` tilted by `gravity`.
            let ap_out_l = self.left_ap.process(decayed_l);

            // Shimmer: blend the pitch-shifted signal into the tank feedback.
            let shimmer_l = self.shimmer_left.process(ap_out_l);

            // Fixed delay 2
            self.left_delay_2.write(shimmer_l);
            self.left_tank_output = self.left_delay_2.read(self.scaled_delays[2]);

            // ── Right half ──
            let right_in = diffused + self.left_tank_output * decay;

            let base_delay_r = scale_delay(RIGHT_MOD_AP_DELAY, self.sample_rate) as f32;
            let mod_delay_r = (base_delay_r + mod_r).max(1.0);
            let ap_read_r = self.right_mod_ap.read_allpass_interp(mod_delay_r);
            let v_r = right_in - self.right_mod_ap_gain * ap_read_r;
            self.right_mod_ap.write(v_r);
            let mod_ap_out_r = ap_read_r + self.right_mod_ap_gain * v_r;

            self.right_delay_1.write(mod_ap_out_r);
            let d1_out_r = self.right_delay_1.read(self.scaled_delays[3]);

            let damped_r = self.right_damp.process(d1_out_r);
            let mut decayed_r = damped_r * decay;

            decayed_r = self.decay_eq_right.process(decayed_r);

            if self.saturation_enabled {
                decayed_r = soft_saturate(decayed_r, self.saturation_type);
            }

            let ap_out_r = self.right_ap.process(decayed_r);

            let shimmer_r = self.shimmer_right.process(ap_out_r);

            self.right_delay_2.write(shimmer_r);
            self.right_tank_output = self.right_delay_2.read(self.scaled_delays[5]);

            // ── Stereo output (14 taps) ──────────────────────────

            let mut wet_l = 0.0_f32;
            let mut wet_r = 0.0_f32;

            for &(line, pos, gain) in &self.scaled_taps_l {
                let sample = match line {
                    0 => self.left_delay_1.tap(pos),
                    1 => self.left_ap.tap(pos),
                    2 => self.left_delay_2.tap(pos),
                    3 => self.right_delay_1.tap(pos),
                    4 => self.right_ap.tap(pos),
                    5 => self.right_delay_2.tap(pos),
                    _ => 0.0,
                };
                wet_l += sample * gain;
            }

            for &(line, pos, gain) in &self.scaled_taps_r {
                let sample = match line {
                    0 => self.left_delay_1.tap(pos),
                    1 => self.left_ap.tap(pos),
                    2 => self.left_delay_2.tap(pos),
                    3 => self.right_delay_1.tap(pos),
                    4 => self.right_ap.tap(pos),
                    5 => self.right_delay_2.tap(pos),
                    _ => 0.0,
                };
                wet_r += sample * gain;
            }

            // ── Early/late balance ───────────────────────────────
            //
            // Same formula as `FdnReverb::process`, so the knob reads the same
            // on both engines. Placed *before* the output EQ and width rather
            // than after, where the FDN puts it: this engine has an output
            // stage and the FDN does not, and blending afterwards would leave
            // the early half unfiltered — Hi Cut, Lo Cut and Width would go
            // progressively inert as the knob turned down, trading one dead
            // control for three.
            let el = self.early_late_balance;
            wet_l = early * (1.0 - el) + wet_l * el;
            wet_r = early * (1.0 - el) + wet_r * el;

            // Output EQ and stereo width — the shared wet-path stage.
            (wet_l, wet_r) = self.output.process(wet_l, wet_r);

            // Mix
            let m = self.smooth_mix;
            left[i] = dry_l * (1.0 - m) + wet_l * m;
            right[i] = dry_r * (1.0 - m) + wet_r * m;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec![
            "mix",
            "decay",
            "damping",
            "predelay",
            "size",
            "mod_rate",
            "mod_depth",
            "diffusion",
            "high_cut",
            "low_cut",
            "width",
            "freeze",
            "shimmer",
            "shimmer_amount",
            "shimmer_pitch",
            "gravity",
            "saturation",
            "saturation_type",
            "density",
            "early_late",
        ]
        .into_iter()
        .chain(crate::decay_eq::PARAM_NAMES)
        .collect()
    }
}

/// Soft saturation — prevents runaway at infinite sustain.
/// Placed before the mixing matrix, per delay line.
#[inline]
fn soft_saturate(x: f32, saturation_type: u8) -> f32 {
    match saturation_type {
        0 => {
            // Fast tanh approximation (Aleksey Vaneev, KVR)
            let x2 = x * x;
            x * (27.0 + x2) / (27.0 + 9.0 * x2)
        }
        1 => {
            // Chebyshev 3rd-degree (Erbe-Verb style): f(x) = x - x³/3
            // Only 3rd-harmonic distortion
            let clamped = x.clamp(-1.5, 1.5);
            clamped - clamped * clamped * clamped / 3.0
        }
        _ => {
            // Hard clip
            x.clamp(-1.0, 1.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;
    const BLOCK: usize = 128;

    /// The Decay EQ is told the tank's gain **per half-traversal**, which is
    /// `decay * decay` and not `decay`.
    ///
    /// Pinned as arithmetic rather than acoustically, and the distinction is
    /// the point. Dropping the square is a *scale* error: every band still
    /// lengthens when dragged up and shortens when dragged down, still moves
    /// only its own part of the spectrum, and still tracks the Decay knob — so
    /// every render-delta assertion in `decay_eq_parameter_surface.rs` stays
    /// green while a declared 4.0x delivers about 1.6x. The only thing that can
    /// catch it is the derivation, so the derivation is what is asserted.
    ///
    /// The count: a sample entering the left half is multiplied by `decay`
    /// inside that half (`damped_l * decay`) and again as it crosses into the
    /// right (`right_in = diffused + left_tank_output * decay`). One EQ
    /// application per half, two per round trip, four `decay` multiplies per
    /// round trip — so `decay^2` per application, which makes the round trip
    /// `decay^(4/m)` and the RT60 exactly `m` times longer.
    #[test]
    fn the_decay_eq_is_told_the_tanks_gain_per_half_traversal() {
        let mut left = [0.0_f32; BLOCK];
        let mut right = [0.0_f32; BLOCK];

        for decay in [0.2_f32, 0.5, 0.75, 0.9999] {
            let mut plate = ProofChamber::new(SR);
            plate.set_param("decay", decay);
            plate.process(&mut left, &mut right);
            assert!(
                (plate.decay_eq_base_gain - decay * decay).abs() < 1e-6,
                "decay {decay} should hand the stage {}, got {}",
                decay * decay,
                plate.decay_eq_base_gain
            );
        }

        // Freeze holds the tank at unity, so the stage is handed 1.0 and every
        // band designs at 0 dB: with no per-pass loss there is no decay rate
        // for a multiplier to be relative to, and a boost on a unity-gain loop
        // is a resonator rather than a longer tail.
        let mut frozen = ProofChamber::new(SR);
        frozen.set_param("decay", 0.5);
        frozen.set_param("freeze", 1.0);
        frozen.process(&mut left, &mut right);
        assert_eq!(frozen.decay_eq_base_gain, 1.0);
    }

    /// What `DelayLine::read` returns, pinned directly on the primitive.
    ///
    /// `wet_onset_follows_predelay.rs` is the right instrument for #1547 — it
    /// listens to the engine and notices the reverb is not there yet — and it
    /// is blind to everything on this line that is not half a second long. A
    /// one-sample shift in the argument's meaning does not move a rendered
    /// onset past a 20 ms budget, and it is exactly what #1547 turned out to
    /// be. So the contract is pinned where it is written.
    ///
    /// Nothing here reads a delay-length constant. The line is fed a counting
    /// ramp and asked what came back, which is the only way to distinguish
    /// "`read(n)` means n" from "`read(n)` means n + 1" — the distinction the
    /// whole issue was.
    #[test]
    fn read_counts_back_from_the_most_recently_written_sample() {
        let mut line = DelayLine::new(8);

        // Write 100, 101 … 107, so a returned value names the write that
        // produced it.
        for step in 0..8 {
            line.write(100.0 + step as f32);
        }

        assert_eq!(
            line.read(0),
            107.0,
            "read(0) must be the sample just written, not the oldest one the \
             line holds. Returning 100.0 here is #1547: on the pre-delay line \
             that is `sample_rate * 0.5` samples of silence instead of none."
        );
        for back in 0..8 {
            assert_eq!(
                line.read(back),
                107.0 - back as f32,
                "read({back}) must be {back} writes before the newest sample"
            );
        }

        // Past the end of the line the read saturates on the oldest sample
        // rather than wrapping round to a short delay.
        assert_eq!(line.read(7), 100.0);
        assert_eq!(line.read(8), 100.0, "read(len) must clamp, not alias to 0");
        assert_eq!(line.read(9_999), 100.0);
    }

    /// The pre-delay's zero case on the real line size, which is where the
    /// half-second came from. A ring buffer's wrap is the thing that turns a
    /// one-sample confusion into an audible defect, so it is exercised.
    #[test]
    fn a_full_length_line_still_returns_the_newest_sample_at_zero() {
        let len = (SR * 0.5) as usize;
        let mut line = DelayLine::new(len);

        // Fill the line more than once so `write_pos` has wrapped and the
        // slot `read(0)` used to land on holds something distinguishable.
        for step in 0..(len + 137) {
            line.write(step as f32 + 1.0);
        }

        let newest = (len + 137) as f32;
        assert_eq!(
            line.read(0),
            newest,
            "read(0) on a {len}-sample line returned a sample from {} writes \
             ago instead of the newest one",
            newest - line.read(0)
        );
        assert_eq!(line.read(1), newest - 1.0);
        assert_eq!(
            line.read(len - 1),
            newest - (len - 1) as f32,
            "the oldest addressable sample is len - 1 writes back"
        );
    }

    /// Magnitude of a `OnePole` at DC and at Nyquist, measured by driving the
    /// real struct rather than derived from its coefficient.
    ///
    /// A first-order lowpass is monotone between the two, so the ratio is the
    /// filter's worst-case attenuation anywhere below Nyquist.
    fn one_pole_extremes(coeff: f32) -> (f32, f32) {
        let settle = 200_000;

        let mut dc = OnePole::new(coeff);
        let mut dc_out = 0.0;
        for _ in 0..settle {
            dc_out = dc.process(1.0);
        }

        // Alternating +/-1 is Nyquist at any sample rate. The steady-state
        // magnitude is the peak of the alternating output.
        let mut nyquist = OnePole::new(coeff);
        let mut nyquist_out = 0.0_f32;
        for index in 0..settle {
            let input = if index % 2 == 0 { 1.0 } else { -1.0 };
            nyquist_out = nyquist.process(input);
        }

        (dc_out.abs(), nyquist_out.abs())
    }

    fn worst_case_attenuation_db(coeff: f32) -> f32 {
        let (dc, nyquist) = one_pole_extremes(coeff);
        if dc <= 0.0 || nyquist <= 0.0 {
            // A coefficient of 1.0 is a filter that never converges away from
            // its initial state: it passes nothing at all. That is the maximum
            // possible authority, not a broken measurement, so it is reported
            // as such rather than panicking here — the caller's assertion is
            // the one that should explain the failure.
            return f32::INFINITY;
        }
        -20.0 * (nyquist / dc).log10()
    }

    fn run_a_block(chamber: &mut ProofChamber) {
        let mut left = [0.0_f32; BLOCK];
        let mut right = [0.0_f32; BLOCK];
        left[0] = 1.0;
        right[0] = 1.0;
        chamber.process(&mut left, &mut right);
    }

    /// The input bandwidth filter's authority, measured on the **running**
    /// engine.
    ///
    /// #1546 decided that `bandwidth_filter: OnePole::new(1.0 - 0.9995)` stays
    /// where the tank's `damping` moved, and the comment beside that line rests
    /// the decision on a magnitude: applied once, outside any feedback path,
    /// this filter takes a hundredth of a decibel off the top of the spectrum,
    /// so it is not a voicing choice at all.
    ///
    /// The first revision of this guard proved that by parsing the constructor
    /// literal out of the source text — which proves nothing about the engine.
    /// This file's own `left_damp: OnePole::new(0.3)` is the counter-example:
    /// `process()` overwrites `.coeff` from `self.damping` at the top of every
    /// block, so that literal is dead and a source parse would still have
    /// vouched for it. Anything that gave the input filter a live coefficient
    /// — a `process()`-time assignment, a new `set_param` arm — would have left
    /// the parse green.
    ///
    /// So the coefficient is read out of the engine after it has rendered, and
    /// after every parameter the engine advertises has been driven across its
    /// range. A `set_param` arm that reaches this filter moves the number and
    /// reds here.
    #[test]
    fn the_input_bandwidth_filter_has_no_audible_authority_on_the_running_engine() {
        let mut chamber = ProofChamber::new(SR);
        run_a_block(&mut chamber);

        let after_render = chamber.bandwidth_filter.coeff;
        let attenuation = worst_case_attenuation_db(after_render);
        assert!(
            attenuation < 0.05,
            "after one render the input bandwidth filter removes up to \
             {attenuation:.4} dB (live coefficient {after_render:e}). It is \
             applied once per sample with no feedback around it, and the \
             comment beside its constructor line justifies leaving it at \
             Dattorro's 0.9995 on the grounds that a single pass at this \
             coefficient is inaudible. At this magnitude that is no longer \
             true, and the bandwidth value has become a voicing decision that \
             needs one."
        );

        // And no advertised parameter can hand it authority. This is the arm
        // the source parse could not see.
        let names: Vec<String> = chamber
            .param_names()
            .into_iter()
            .map(str::to_owned)
            .collect();
        assert!(
            names.len() >= 20,
            "param_names shrank to {} entries; the sweep below is only as \
             broad as this list",
            names.len()
        );
        for name in &names {
            for value in [0.0_f32, 0.5, 1.0, 20_000.0] {
                let mut probe = ProofChamber::new(SR);
                probe.set_param(name, value);
                run_a_block(&mut probe);
                let live = probe.bandwidth_filter.coeff;
                let attenuation = worst_case_attenuation_db(live);
                assert!(
                    attenuation < 0.05,
                    "writing {name}={value} gave the input bandwidth filter \
                     {attenuation:.4} dB of authority (live coefficient \
                     {live:e}). The input filter is not a user control, and the \
                     #1546 decision to leave it at Dattorro's 0.9995 assumes it \
                     stays inaudible."
                );
            }
        }
    }

    /// Anti-vacuity for the guard above: the measurement it uses has to be able
    /// to report a filter that *does* have authority, or the threshold is
    /// unfalsifiable.
    #[test]
    fn the_authority_measurement_reports_a_filter_that_is_actually_closed() {
        let open = worst_case_attenuation_db(1.0 - 0.9995);
        let closed = worst_case_attenuation_db(1.0 - 0.85);
        assert!(
            open < 0.05,
            "the shipped coefficient measures {open:.4} dB, which the guard \
             above would already have caught"
        );
        assert!(
            closed > 1.0,
            "a one-pole at coefficient 0.15 measured only {closed:.4} dB, so \
             the measurement cannot distinguish an open filter from a closed \
             one"
        );
    }

    /// The tank's damping seeds are dead literals, and the guard set depends on
    /// knowing that: it is why `plate_default_damping.rs` measures the rendered
    /// tail rather than reading `left_damp.coeff`, and why the guard above
    /// reads its coefficient *after* a render instead of before one.
    #[test]
    fn process_overwrites_the_tank_damp_coefficients_and_leaves_the_input_filter_alone() {
        let mut chamber = ProofChamber::new(SR);
        let bandwidth_before = chamber.bandwidth_filter.coeff;

        chamber.set_param("damping", 0.62);
        // Not yet: `set_param` writes the field, `process` propagates it.
        assert_eq!(
            chamber.left_damp.coeff, 0.3,
            "the constructor seed changed without a render"
        );

        run_a_block(&mut chamber);
        assert_eq!(
            chamber.left_damp.coeff, 0.62,
            "process() did not push `damping` into the left tank filter"
        );
        assert_eq!(
            chamber.right_damp.coeff, 0.62,
            "process() did not push `damping` into the right tank filter"
        );
        assert_eq!(
            chamber.bandwidth_filter.coeff, bandwidth_before,
            "the input bandwidth filter is not on the per-block update path and \
             must not move when `damping` does"
        );
    }
}
