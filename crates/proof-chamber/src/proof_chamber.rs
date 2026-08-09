/// Dutch Oven — flagship reverb plugin.
///
/// Implements Dattorro's 1997 plate reverb (JAES "Effect Design Part 1")
/// with exact delay lengths, tap positions, and coefficients from the paper.
/// Reference sample rate: 29761 Hz. All delays scale to target rate.
///
/// Features: modulated tank with allpass interpolation, 14-tap stereo output,
/// freeze, shimmer (granular pitch shifter in feedback), and pre-delay.
use std::f32::consts::TAU;

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

    #[inline]
    fn read(&self, delay: usize) -> f32 {
        let pos = (self.write_pos + self.len - delay.min(self.len - 1)) % self.len;
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

struct GranularShifter {
    buffer: Vec<f32>,
    write_pos: usize,
    phase1: f64,
    phase2: f64,
    pitch_ratio: f64,
    grain_size: usize,
    enabled: bool,
    amount: f32,
    // Random jitter for Eno/Lanois wash character
    jitter_state: u32,
    jitter_amount: f64, // ±samples of position scatter
}

impl GranularShifter {
    fn new(sample_rate: f32) -> Self {
        let grain_size = (0.030 * sample_rate as f64) as usize; // 30ms grain
        let buf_size = grain_size * 4;
        Self {
            buffer: vec![0.0; buf_size],
            write_pos: 0,
            phase1: 0.0,
            phase2: 0.5,      // 180° offset for overlap
            pitch_ratio: 2.0, // octave up
            grain_size,
            enabled: false,
            amount: 0.2,
            jitter_state: 54321,
            jitter_amount: 8.0, // ±8 samples (5-10ms at 44.1kHz)
        }
    }

    /// Cheap noise for jitter
    fn jitter(&mut self) -> f64 {
        self.jitter_state ^= self.jitter_state << 13;
        self.jitter_state ^= self.jitter_state >> 17;
        self.jitter_state ^= self.jitter_state << 5;
        (self.jitter_state as f64 / u32::MAX as f64) * 2.0 - 1.0
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        if !self.enabled {
            return 0.0;
        }

        let buf_len = self.buffer.len();
        self.buffer[self.write_pos] = input;
        self.write_pos = (self.write_pos + 1) % buf_len;

        let gs = self.grain_size as f64;

        // Add random jitter for Eno/Lanois wash character
        let j1 = self.jitter() * self.jitter_amount;
        let j2 = self.jitter() * self.jitter_amount;
        let read1 = self.write_pos as f64 - gs * self.phase1 + j1;
        let read2 = self.write_pos as f64 - gs * self.phase2 + j2;

        self.phase1 += (self.pitch_ratio - 1.0) / gs;
        self.phase2 += (self.pitch_ratio - 1.0) / gs;
        if self.phase1 >= 1.0 {
            self.phase1 -= 1.0;
        }
        if self.phase2 >= 1.0 {
            self.phase2 -= 1.0;
        }

        // Hann envelope
        let env1 = (0.5 * (1.0 - (TAU as f64 * self.phase1).cos())) as f32;
        let env2 = (0.5 * (1.0 - (TAU as f64 * self.phase2).cos())) as f32;

        let idx1 = ((read1 as isize).rem_euclid(buf_len as isize)) as usize;
        let idx2 = ((read2 as isize).rem_euclid(buf_len as isize)) as usize;

        (self.buffer[idx1] * env1 + self.buffer[idx2] * env2) * self.amount
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

    // Shimmer
    shimmer: GranularShifter,

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
            // * It contradicted the product. The Damp knob reads 30%, resets
            //   to 0.3, and `DEFAULT_PARAMS.damping` is 0.3. `addDevice` pushes
            //   the descriptor value, so a new device ran 0.0005 while every
            //   surface claimed 0.3.
            // * It is off the control's grid. The knob is `step={0.001}`, so
            //   0.0005 is unreachable once the user touches Damp.
            // * It does not sound like a plate. In this file's `OnePole` that
            //   coefficient removes 0.0087 dB at Nyquist; measured on an
            //   impulse at mix 1, the 6-12 kHz band came out +0.21 dB *above*
            //   400-1200 Hz 1.5-3.0 s into the tail. A plate that gets brighter
            //   as it decays is a ringing tank. 0.3 puts the corner at 10.6 kHz
            //   and the same measurement at -8.45 dB.
            //
            // #1546 has the peer survey and the EMT 140 TS target; the rendered
            // figures are pinned in `tests/plate_default_damping.rs`.
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
            // * **No contradicted claim.** `damping` had a descriptor entry, a
            //   `set_param` arm, a `DEFAULT_PARAMS` entry and a knob reading
            //   30%, and disagreed with all of them; that contradiction is what
            //   made it a defect rather than a preference. `bandwidth` has none
            //   of those — no descriptor parameter, no arm, no module default,
            //   no control. Nothing in the product says it is anything other
            //   than what it is, and the user-facing treble control on this
            //   path is the output stage's 12 kHz `high_cut`.
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

            left_tank_output: 0.0,
            right_tank_output: 0.0,

            lfo_phase_l: 0.0,
            lfo_phase_r: 0.25, // quadrature

            excursion,

            output: OutputStage::new(sample_rate),

            shimmer: GranularShifter::new(sample_rate),

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
                    self.shimmer.enabled = false; // disable shimmer during freeze
                }
            }
            "shimmer" => self.shimmer.enabled = value > 0.5,
            "shimmer_amount" => self.shimmer.amount = value.clamp(0.0, 1.0),
            "shimmer_pitch" => {
                self.shimmer.pitch_ratio = if value < 0.5 { 1.5 } else { 2.0 }; // fifth or octave
            }
            "gravity" => self.gravity = value.clamp(-1.0, 1.0),
            // Same name, same range and the same blend as `FdnReverb`. The
            // panel has always sent this and the plate has always dropped it,
            // which mattered more here than anywhere else: plate is the
            // default algorithm.
            "early_late" => self.early_late_balance = value.clamp(0.0, 1.0),
            "saturation" => self.saturation_enabled = value > 0.5,
            "saturation_type" => self.saturation_type = (value as u8).min(2),
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

            // Soft saturation (before allpass, per Erbe-Verb design)
            if self.saturation_enabled {
                decayed_l = soft_saturate(decayed_l, self.saturation_type);
            }

            // Tank allpass. Its coefficient is set once per block above, from
            // the decay-linked `dd2` tilted by `gravity`.
            let ap_out_l = self.left_ap.process(decayed_l);

            // Shimmer: process the tank signal and feed back
            let shimmer_l = self.shimmer.process(ap_out_l);

            // Fixed delay 2
            self.left_delay_2.write(ap_out_l + shimmer_l);
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

            if self.saturation_enabled {
                decayed_r = soft_saturate(decayed_r, self.saturation_type);
            }

            let ap_out_r = self.right_ap.process(decayed_r);

            let shimmer_r = self.shimmer.process(ap_out_r);

            self.right_delay_2.write(ap_out_r + shimmer_r);
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
        assert!(dc > 0.0, "the one-pole passes nothing at DC");
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
