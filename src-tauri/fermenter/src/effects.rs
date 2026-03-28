/// Stereo ping-pong delay effect.
pub struct StereoDelay {
    buffer_l: Vec<f32>,
    buffer_r: Vec<f32>,
    write_pos: usize,
    sample_rate: f32,
}

impl StereoDelay {
    pub fn new(sample_rate: f32) -> Self {
        // Max 2 seconds at the given sample rate
        let max_samples = (sample_rate * 2.0) as usize;
        Self {
            buffer_l: vec![0.0; max_samples],
            buffer_r: vec![0.0; max_samples],
            write_pos: 0,
            sample_rate,
        }
    }

    /// Read from a delay buffer with linear interpolation for fractional delay.
    #[inline]
    fn read_interp(buffer: &[f32], write_pos: usize, delay_samples: f32) -> f32 {
        let len = buffer.len();
        let idx_f = delay_samples;
        let idx_i = idx_f as usize;
        let frac = idx_f - idx_i as f32;

        let i0 = (write_pos + len - idx_i) % len;
        let i1 = (write_pos + len - idx_i - 1) % len;

        buffer[i0] * (1.0 - frac) + buffer[i1] * frac
    }

    /// Process a stereo block with ping-pong delay.
    /// `time_ms`: 10-2000, `feedback`: 0-0.95, `mix`: 0-1.
    pub fn process_block(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        time_ms: f32,
        feedback: f32,
        mix: f32,
    ) {
        let time_ms = time_ms.clamp(10.0, 2000.0);
        let feedback = feedback.clamp(0.0, 0.95);
        let mix = mix.clamp(0.0, 1.0);
        let delay_samples = time_ms * 0.001 * self.sample_rate;
        let max_delay = self.buffer_l.len() as f32 - 1.0;
        let delay_samples = delay_samples.min(max_delay).max(1.0);
        let dry = 1.0 - mix;

        let block_size = left.len().min(right.len());
        for i in 0..block_size {
            let dl = Self::read_interp(&self.buffer_l, self.write_pos, delay_samples);
            let dr = Self::read_interp(&self.buffer_r, self.write_pos, delay_samples);

            // Ping-pong: left input feeds right delay, right input feeds left delay
            self.buffer_l[self.write_pos] = left[i] + dr * feedback;
            self.buffer_r[self.write_pos] = right[i] + dl * feedback;

            left[i] = left[i] * dry + dl * mix;
            right[i] = right[i] * dry + dr * mix;

            self.write_pos = (self.write_pos + 1) % self.buffer_l.len();
        }
    }
}

/// Stereo chorus effect with modulated delay lines.
pub struct StereoChorus {
    buffer_l: Vec<f32>,
    buffer_r: Vec<f32>,
    write_pos: usize,
    lfo_phase_l: f32,
    lfo_phase_r: f32,
    sample_rate: f32,
}

impl StereoChorus {
    pub fn new(sample_rate: f32) -> Self {
        // Need enough buffer for max modulated delay: ~20ms
        let buf_size = (sample_rate * 0.05) as usize; // 50ms safety margin
        Self {
            buffer_l: vec![0.0; buf_size],
            buffer_r: vec![0.0; buf_size],
            write_pos: 0,
            lfo_phase_l: 0.0,
            lfo_phase_r: 0.25, // 90-degree offset for stereo
            sample_rate,
        }
    }

    /// Read from buffer with linear interpolation.
    #[inline]
    fn read_interp(buffer: &[f32], write_pos: usize, delay_samples: f32) -> f32 {
        let len = buffer.len();
        let idx_f = delay_samples;
        let idx_i = idx_f as usize;
        let frac = idx_f - idx_i as f32;

        let i0 = (write_pos + len - idx_i) % len;
        let i1 = (write_pos + len - idx_i - 1) % len;

        buffer[i0] * (1.0 - frac) + buffer[i1] * frac
    }

    /// Process stereo block.
    /// `rate`: 0.1-5 Hz, `depth`: 0-1, `mix`: 0-1.
    pub fn process_block(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        rate: f32,
        depth: f32,
        mix: f32,
    ) {
        let rate = rate.clamp(0.1, 5.0);
        let depth = depth.clamp(0.0, 1.0);
        let mix = mix.clamp(0.0, 1.0);
        let dry = 1.0 - mix;

        // Base delay: 10ms, modulation range: up to 5ms
        let base_delay_samples = 0.010 * self.sample_rate;
        let mod_depth_samples = 0.005 * self.sample_rate * depth;
        let phase_inc = rate / self.sample_rate;
        let max_delay = self.buffer_l.len() as f32 - 2.0;

        let block_size = left.len().min(right.len());
        for i in 0..block_size {
            // LFO values (sine)
            let lfo_l = (self.lfo_phase_l * std::f32::consts::TAU).sin();
            let lfo_r = (self.lfo_phase_r * std::f32::consts::TAU).sin();

            // Modulated delay times
            let delay_l = (base_delay_samples + lfo_l * mod_depth_samples).clamp(1.0, max_delay);
            let delay_r = (base_delay_samples + lfo_r * mod_depth_samples).clamp(1.0, max_delay);

            // Write dry signal into delay buffer
            self.buffer_l[self.write_pos] = left[i];
            self.buffer_r[self.write_pos] = right[i];

            // Read modulated delay
            let wet_l = Self::read_interp(&self.buffer_l, self.write_pos, delay_l);
            let wet_r = Self::read_interp(&self.buffer_r, self.write_pos, delay_r);

            left[i] = left[i] * dry + wet_l * mix;
            right[i] = right[i] * dry + wet_r * mix;

            // Advance LFO phases
            self.lfo_phase_l += phase_inc;
            if self.lfo_phase_l >= 1.0 { self.lfo_phase_l -= 1.0; }
            self.lfo_phase_r += phase_inc;
            if self.lfo_phase_r >= 1.0 { self.lfo_phase_r -= 1.0; }

            self.write_pos = (self.write_pos + 1) % self.buffer_l.len();
        }
    }
}

/// Simplified Dattorro plate reverb.
/// Based on Jon Dattorro's "Effect Design Part 1" (JAES, 1997).
/// Canonical base sample rate: 29761 Hz — all delay lengths scale proportionally.

const BASE_SR: f32 = 29761.0;

// Pre-delay lengths (samples at 29761 Hz)
const APF1_LEN: usize = 142;
const APF2_LEN: usize = 107;
const APF3_LEN: usize = 379;
const APF4_LEN: usize = 277;

// Tank delay lengths
const DELAY1_LEN: usize = 672;
const DELAY2_LEN: usize = 1800;
const DELAY3_LEN: usize = 908;
const DELAY4_LEN: usize = 2656;

// Allpass decay coefficients
const APF_COEFF: f32 = 0.7;
const DECAY: f32 = 0.5;

struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
}

impl DelayLine {
    fn new(max_len: usize) -> Self {
        Self { buffer: vec![0.0; max_len.max(1)], write_pos: 0 }
    }

    #[inline]
    fn read(&self, delay: usize) -> f32 {
        let len = self.buffer.len();
        let idx = (self.write_pos + len - delay.min(len - 1)) % len;
        self.buffer[idx]
    }

    #[inline]
    fn write(&mut self, sample: f32) {
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();
    }
}

pub struct PlateReverb {
    // Input diffusion allpasses
    apf1: DelayLine,
    apf2: DelayLine,
    apf3: DelayLine,
    apf4: DelayLine,
    // Tank delays
    del1: DelayLine,
    del2: DelayLine,
    del3: DelayLine,
    del4: DelayLine,
    // Scaled delay lengths for current sample rate
    apf1_len: usize,
    apf2_len: usize,
    apf3_len: usize,
    apf4_len: usize,
    del1_len: usize,
    del2_len: usize,
    del3_len: usize,
    del4_len: usize,
    // Tank state
    tank_l: f32,
    tank_r: f32,
    decay: f32,
    mix: f32,
    damping: f32,
    damp_state: f32,
}

impl PlateReverb {
    pub fn new(sample_rate: f32) -> Self {
        let scale = sample_rate / BASE_SR;
        let s = |base: usize| -> usize { (base as f32 * scale).round() as usize };

        Self {
            apf1: DelayLine::new(s(APF1_LEN) + 1),
            apf2: DelayLine::new(s(APF2_LEN) + 1),
            apf3: DelayLine::new(s(APF3_LEN) + 1),
            apf4: DelayLine::new(s(APF4_LEN) + 1),
            del1: DelayLine::new(s(DELAY1_LEN) + 1),
            del2: DelayLine::new(s(DELAY2_LEN) + 1),
            del3: DelayLine::new(s(DELAY3_LEN) + 1),
            del4: DelayLine::new(s(DELAY4_LEN) + 1),
            apf1_len: s(APF1_LEN),
            apf2_len: s(APF2_LEN),
            apf3_len: s(APF3_LEN),
            apf4_len: s(APF4_LEN),
            del1_len: s(DELAY1_LEN),
            del2_len: s(DELAY2_LEN),
            del3_len: s(DELAY3_LEN),
            del4_len: s(DELAY4_LEN),
            tank_l: 0.0,
            tank_r: 0.0,
            decay: DECAY,
            mix: 0.3,
            damping: 0.5,
            damp_state: 0.0,
        }
    }

    pub fn set_params(&mut self, decay: f32, mix: f32, damping: f32) {
        self.decay = decay.clamp(0.0, 0.99);
        self.mix = mix.clamp(0.0, 1.0);
        self.damping = damping.clamp(0.0, 0.99);
    }

    #[inline]
    fn allpass(dl: &mut DelayLine, input: f32, len: usize, coeff: f32) -> f32 {
        let delayed = dl.read(len);
        let output = -coeff * input + delayed;
        dl.write(input + coeff * output);
        output
    }

    /// Process stereo input, return (left, right) with reverb mixed in.
    #[inline]
    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let input = (left + right) * 0.5;

        // Input diffusion
        let d1 = Self::allpass(&mut self.apf1, input, self.apf1_len, APF_COEFF);
        let d2 = Self::allpass(&mut self.apf2, d1, self.apf2_len, APF_COEFF);

        // Tank left
        let in_l = d2 + self.tank_r * self.decay;
        let t1 = Self::allpass(&mut self.apf3, in_l, self.apf3_len, -self.decay);
        self.del1.write(t1);
        let t2 = self.del1.read(self.del1_len);
        // Damping (one-pole lowpass)
        self.damp_state = t2 * (1.0 - self.damping) + self.damp_state * self.damping;
        self.del2.write(self.damp_state * self.decay);
        self.tank_l = self.del2.read(self.del2_len);

        // Tank right
        let in_r = d2 + self.tank_l * self.decay;
        let t3 = Self::allpass(&mut self.apf4, in_r, self.apf4_len, -self.decay);
        self.del3.write(t3);
        let t4 = self.del3.read(self.del3_len);
        self.del4.write(t4 * self.decay);
        self.tank_r = self.del4.read(self.del4_len);

        // Mix dry/wet
        let wet_l = self.tank_l;
        let wet_r = self.tank_r;
        let dry = 1.0 - self.mix;
        (left * dry + wet_l * self.mix, right * dry + wet_r * self.mix)
    }
}
