//! Chorus, Flanger, and Phaser for Bacteria.
//!
//! Chorus/Flanger: modulated delay lines with feedback.
//! Phaser: series of all-pass filters creating moving notches.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

// ── Modulated Delay Line (shared by Chorus & Flanger) ────────────────────────

/// Fractional-delay circular buffer with linear interpolation.
///
/// Linear and not a higher-order interpolator on purpose. Its error is a
/// gentle lowpass that falls off with the fractional part of the delay, and
/// the delays here are short (0.5–40 ms) and modulated slowly, so the moving
/// read point spends its time far from the worst-case half-sample offset and
/// the residual sits well above the audio band at engine rates. Cubic would
/// cost three more taps per sample per channel to correct an error that the
/// wet/dry mix already buries.
struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
    max_samples: usize,
}

impl DelayLine {
    fn new(max_delay_ms: f32, sample_rate: f32) -> Self {
        let max_samples = (max_delay_ms * 0.001 * sample_rate) as usize + 4;
        Self {
            buffer: vec![0.0; max_samples],
            write_pos: 0,
            max_samples,
        }
    }

    fn write(&mut self, sample: f32) {
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.max_samples;
    }

    /// Read with fractional delay using linear interpolation.
    fn read(&self, delay_samples: f32) -> f32 {
        let delay = delay_samples.clamp(0.0, (self.max_samples - 2) as f32);
        let index = self.write_pos as f32 - delay - 1.0;
        let index = if index < 0.0 {
            index + self.max_samples as f32
        } else {
            index
        };
        let i0 = index as usize % self.max_samples;
        let i1 = (i0 + 1) % self.max_samples;
        let frac = index - index.floor();
        self.buffer[i0] * (1.0 - frac) + self.buffer[i1] * frac
    }

    fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
    }
}

// ── Chorus / Flanger ─────────────────────────────────────────────────────────

/// Combined chorus/flanger using modulated delay lines.
/// Short delay + high feedback = flanger. Longer delay + low feedback = chorus.
pub struct ChorusFlanger {
    delay_l: DelayLine,
    delay_r: DelayLine,
    lfo_phase: f32,
    rate: f32,          // Hz
    depth: f32,         // 0-1
    feedback: f32,      // -1 to 1
    mix: f32,           // 0-1
    base_delay_ms: f32, // chorus: 7-20ms, flanger: 1-5ms
    sample_rate: f32,
    fb_sample_l: f32,
    fb_sample_r: f32,
}

impl ChorusFlanger {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            delay_l: DelayLine::new(50.0, sample_rate),
            delay_r: DelayLine::new(50.0, sample_rate),
            lfo_phase: 0.0,
            rate: 1.5,
            depth: 0.4,
            feedback: 0.2,
            mix: 0.5,
            base_delay_ms: 7.0,
            sample_rate,
            fb_sample_l: 0.0,
            fb_sample_r: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "chorusRate" => self.rate = value.max(0.001),
            "chorusDepth" => self.depth = value.clamp(0.0, 1.0),
            "chorusFeedback" => self.feedback = value.clamp(-0.95, 0.95),
            "chorusMix" => self.mix = value.clamp(0.0, 1.0),
            "chorusBaseDelay" => self.base_delay_ms = value.clamp(0.5, 40.0),
            _ => {}
        }
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        // LFO
        let phase_inc = self.rate / self.sample_rate;
        self.lfo_phase += phase_inc;
        if self.lfo_phase >= 1.0 {
            self.lfo_phase -= 1.0;
        }

        let lfo_l = (self.lfo_phase * 2.0 * PI).sin();
        let lfo_r = ((self.lfo_phase + 0.25) * 2.0 * PI).sin(); // 90° offset for stereo

        let mod_depth_ms = self.depth * self.base_delay_ms * 0.5;
        let delay_l_ms = self.base_delay_ms + lfo_l * mod_depth_ms;
        let delay_r_ms = self.base_delay_ms + lfo_r * mod_depth_ms;

        let delay_l_samples = delay_l_ms * 0.001 * self.sample_rate;
        let delay_r_samples = delay_r_ms * 0.001 * self.sample_rate;

        // Write input + feedback
        self.delay_l.write(left + self.fb_sample_l * self.feedback);
        self.delay_r.write(right + self.fb_sample_r * self.feedback);

        // Read delayed
        let wet_l = self.delay_l.read(delay_l_samples);
        let wet_r = self.delay_r.read(delay_r_samples);

        // DSP-2: these latches close the delay feedback loop — flushing here
        // stops a decaying tail recirculating as subnormals forever.
        self.fb_sample_l = flush_denormal(wet_l);
        self.fb_sample_r = flush_denormal(wet_r);

        // Mix
        let out_l = left * (1.0 - self.mix) + wet_l * self.mix;
        let out_r = right * (1.0 - self.mix) + wet_r * self.mix;
        (out_l, out_r)
    }

    pub fn reset(&mut self) {
        self.delay_l.reset();
        self.delay_r.reset();
        self.lfo_phase = 0.0;
        self.fb_sample_l = 0.0;
        self.fb_sample_r = 0.0;
    }
}

// ── Phaser ───────────────────────────────────────────────────────────────────

/// First-order all-pass filter.
#[derive(Clone)]
struct AllPass1 {
    coeff: f32,
    z1: f32,
}

impl AllPass1 {
    fn new() -> Self {
        Self {
            coeff: 0.0,
            z1: 0.0,
        }
    }

    fn set_freq(&mut self, freq: f32, sample_rate: f32) {
        let w = PI * freq / sample_rate;
        self.coeff = (w.tan() - 1.0) / (w.tan() + 1.0);
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.coeff * input + self.z1;
        self.z1 = flush_denormal(input - self.coeff * output);
        output
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
    }
}

/// Multi-stage phaser using cascaded all-pass filters.
pub struct Phaser {
    stages_l: Vec<AllPass1>,
    stages_r: Vec<AllPass1>,
    lfo_phase: f32,
    rate: f32,
    depth: f32,
    feedback: f32,
    mix: f32,
    num_stages: usize,
    min_freq: f32,
    max_freq: f32,
    sample_rate: f32,
    fb_l: f32,
    fb_r: f32,
}

impl Phaser {
    pub fn new(sample_rate: f32) -> Self {
        let num_stages = 6;
        Self {
            stages_l: (0..num_stages).map(|_| AllPass1::new()).collect(),
            stages_r: (0..num_stages).map(|_| AllPass1::new()).collect(),
            lfo_phase: 0.0,
            rate: 0.5,
            depth: 0.7,
            feedback: 0.5,
            mix: 0.5,
            num_stages,
            min_freq: 200.0,
            max_freq: 4000.0,
            sample_rate,
            fb_l: 0.0,
            fb_r: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "phaserRate" => self.rate = value.max(0.001),
            "phaserDepth" => self.depth = value.clamp(0.0, 1.0),
            "phaserFeedback" => self.feedback = value.clamp(-0.95, 0.95),
            "phaserMix" => self.mix = value.clamp(0.0, 1.0),
            "phaserStages" => {
                let n = (value as usize).clamp(2, 12);
                self.stages_l.resize_with(n, AllPass1::new);
                self.stages_r.resize_with(n, AllPass1::new);
                self.num_stages = n;
            }
            _ => {}
        }
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        let phase_inc = self.rate / self.sample_rate;
        self.lfo_phase += phase_inc;
        if self.lfo_phase >= 1.0 {
            self.lfo_phase -= 1.0;
        }

        let lfo = (self.lfo_phase * 2.0 * PI).sin() * 0.5 + 0.5; // 0-1
        let freq = self.min_freq + (self.max_freq - self.min_freq) * lfo * self.depth;

        // Set all-pass frequencies
        for stage in &mut self.stages_l {
            stage.set_freq(freq, self.sample_rate);
        }
        for stage in &mut self.stages_r {
            stage.set_freq(freq, self.sample_rate);
        }

        // Process through all-pass chain
        let mut ap_l = left + self.fb_l * self.feedback;
        let mut ap_r = right + self.fb_r * self.feedback;

        for stage in &mut self.stages_l {
            ap_l = stage.process(ap_l);
        }
        for stage in &mut self.stages_r {
            ap_r = stage.process(ap_r);
        }

        self.fb_l = flush_denormal(ap_l);
        self.fb_r = flush_denormal(ap_r);

        let out_l = left * (1.0 - self.mix) + ap_l * self.mix;
        let out_r = right * (1.0 - self.mix) + ap_r * self.mix;
        (out_l, out_r)
    }

    pub fn reset(&mut self) {
        for s in &mut self.stages_l {
            s.reset();
        }
        for s in &mut self.stages_r {
            s.reset();
        }
        self.lfo_phase = 0.0;
        self.fb_l = 0.0;
        self.fb_r = 0.0;
    }
}
