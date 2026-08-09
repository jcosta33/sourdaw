/// Spring reverb engine — Parker (2011) dispersive allpass cascade method.
///
/// A cascade of identical first-order allpass filters creates frequency-dependent
/// group delay (dispersion), placed in a feedback loop with a long delay line
/// representing the spring length. The result is the characteristic chirp/drip
/// sound of a real helical spring reverberator.
use std::f32::consts::TAU;

// A spring's tone controls are not part of its physical model — a real tank is
// followed by an amplifier's tone stack, and every spring emulation puts its
// filters after the tank for the same reason. Shared with the plate and the
// FDN so Hi Cut, Lo Cut and Width mean one thing across the Dutch Oven.
use crate::decay_eq::DecayRateEq;
use crate::output_stage::OutputStage;

// ---------------------------------------------------------------------------
// First-order allpass filter
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Allpass1 {
    state: f32,
    coeff: f32,
}

impl Allpass1 {
    fn new(coeff: f32) -> Self {
        Self { state: 0.0, coeff }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let output = self.state + self.coeff * input;
        self.state = input - self.coeff * output;
        output
    }
}

// ---------------------------------------------------------------------------
// Spring reverb engine
// ---------------------------------------------------------------------------

/// Number of cascaded allpass filters for dispersion.
/// More stages = more frequency spread in the chirp.
const NUM_DISPERSION_STAGES: usize = 80;

pub struct SpringReverb {
    sample_rate: f32,

    // Dispersive allpass cascade
    allpass_cascade: Vec<Allpass1>,
    dispersion_coeff: f32,

    // Feedback delay line (spring length)
    delay_buf: Vec<f32>,
    delay_write: usize,
    delay_len: usize,

    // Feedback and damping
    feedback: f32,
    damp_state: f32,
    damping: f32,

    /// Decay Rate EQ across the single feedback loop.
    ///
    /// One instance, because a spring tank *is* one loop — the stereo pair the
    /// engine emits is two taps off it, not two independent paths. The base
    /// loop gain is `feedback` directly: unlike the plate, the gain is applied
    /// exactly once per circulation.
    decay_eq: DecayRateEq,

    // Modulation (self-modulation for metallic character)
    mod_phase: f32,
    mod_rate: f32,
    mod_depth: f32,

    // Output
    pub mix: f32,

    /// Wet-path tone and width, shared with the plate and the FDN.
    output: OutputStage,

    // Drip transient emphasis
    drip_envelope: f32,
    drip_decay: f32,
}

impl SpringReverb {
    pub fn new(sample_rate: f32) -> Self {
        // Default: medium spring (~150ms round-trip)
        let delay_len = (sample_rate * 0.15) as usize;
        let max_delay = (sample_rate * 0.5) as usize; // 500ms max

        // Dispersion coefficient: higher = more frequency spread
        // Typical spring: 0.5-0.8
        let dispersion_coeff = 0.6;

        let allpass_cascade: Vec<Allpass1> = (0..NUM_DISPERSION_STAGES)
            .map(|_| Allpass1::new(dispersion_coeff))
            .collect();

        Self {
            sample_rate,
            allpass_cascade,
            dispersion_coeff,
            delay_buf: vec![0.0; max_delay],
            delay_write: 0,
            delay_len,
            feedback: 0.7,
            damp_state: 0.0,
            damping: 0.3,
            decay_eq: DecayRateEq::new(sample_rate, 0.7),
            mod_phase: 0.0,
            mod_rate: 4.5, // faster modulation for metallic character
            mod_depth: 0.3,
            mix: 0.3,
            output: OutputStage::new(sample_rate),
            drip_envelope: 0.0,
            drip_decay: (-1.0 / (0.05 * sample_rate)).exp(), // 50ms drip decay
        }
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
            "decay" | "feedback" => {
                self.feedback = value.clamp(0.0, 0.95);
                // The shaping is relative to the loop gain, so it moves with it.
                self.decay_eq.set_base_loop_gain(self.feedback);
            }
            "damping" => self.damping = value.clamp(0.0, 0.99),
            "size" => {
                // Map size to spring length (50ms - 300ms)
                let ms = 50.0 + value * 250.0;
                self.delay_len = ((ms / 1000.0) * self.sample_rate) as usize;
                self.delay_len = self.delay_len.min(self.delay_buf.len() - 1).max(1);
            }
            "dispersion" => {
                self.dispersion_coeff = value.clamp(0.1, 0.9);
                for ap in self.allpass_cascade.iter_mut() {
                    ap.coeff = self.dispersion_coeff;
                }
            }
            "mod_depth" => self.mod_depth = value.clamp(0.0, 1.0),
            // Decay Rate EQ. The six literals are spelled out rather than
            // matched by prefix because `descriptorEngineParamWeld.spec.ts`
            // reads the arm names out of this file to decide which engines
            // answer to which id.
            "decay_eq_0" | "decay_eq_1" | "decay_eq_2" | "decay_eq_3" | "decay_eq_4"
            | "decay_eq_5" => {
                let clamped = value.clamp(0.25, 4.0);
                if let Some(band) = crate::decay_eq::band_index_for_name(name) {
                    self.decay_eq.set_band_multiplier(band, clamped);
                }
            }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let buf_len = self.delay_buf.len();

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];
            let mono = (dry_l + dry_r) * 0.5;

            // Detect transients for drip emphasis
            let abs_in = mono.abs();
            if abs_in > self.drip_envelope * 2.0 {
                self.drip_envelope = abs_in;
            }
            self.drip_envelope *= self.drip_decay;

            // Modulation for self-modulation character
            let lfo = (self.mod_phase * TAU).sin();
            self.mod_phase += self.mod_rate / self.sample_rate;
            if self.mod_phase >= 1.0 {
                self.mod_phase -= 1.0;
            }
            let mod_offset = (lfo * self.mod_depth * 4.0) as isize;
            let effective_delay =
                (self.delay_len as isize + mod_offset).clamp(1, (buf_len - 1) as isize) as usize;

            // Read from feedback delay
            let read_pos = (self.delay_write + buf_len - effective_delay) % buf_len;
            let delayed = self.delay_buf[read_pos];

            // Damping (one-pole lowpass in feedback)
            self.damp_state = delayed * (1.0 - self.damping) + self.damp_state * self.damping;
            // Per-band decay shaping, immediately after the per-pass gain it is
            // expressed relative to and still inside the loop — outside it the
            // same filter would be a tone control that never compounds.
            let feedback_signal = self.decay_eq.process(self.damp_state * self.feedback);

            // Input + feedback through dispersive allpass cascade
            let mut signal = mono + feedback_signal;
            for ap in self.allpass_cascade.iter_mut() {
                signal = ap.process(signal);
            }

            // Write to delay line
            let truncated = if signal.abs() < 1e-18 { 0.0 } else { signal };
            self.delay_buf[self.delay_write] = truncated;
            self.delay_write = (self.delay_write + 1) % buf_len;

            // Stereo output: slight spread between dispersion stages
            let wet_l = signal;
            // Tap from a different point in the cascade for the right channel
            let wet_r = self.damp_state; // simpler stereo spread

            // Add drip emphasis on transients
            let drip = self.drip_envelope * 0.3;

            // Output EQ and stereo width, over the whole wet signal including
            // the drip: the drip is part of what the spring emits, and leaving
            // it outside the filters would make Hi Cut fail to tame exactly
            // the transient brightness it exists to tame.
            let (wet_l, wet_r) = self.output.process(wet_l + drip, wet_r + drip);

            // Mix
            left[i] = dry_l * (1.0 - self.mix) + wet_l * self.mix;
            right[i] = dry_r * (1.0 - self.mix) + wet_r * self.mix;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        let mut names = vec!["mix", "decay", "damping", "size", "dispersion", "mod_depth"];
        names.extend(crate::decay_eq::PARAM_NAMES);
        names.extend(OutputStage::PARAM_NAMES);
        names.push(OutputStage::WIDTH);
        names
    }
}
