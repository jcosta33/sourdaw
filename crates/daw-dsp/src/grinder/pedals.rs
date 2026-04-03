//! Pedalboard DSP: overdrive, distortion, fuzz, compressor, wah, delay, reverb.

use std::f32::consts::PI;

/// Tube Screamer-style overdrive: non-inverting op-amp with anti-parallel diodes.
pub struct OverdrivePedal {
    drive: f32,
    tone: f32,
    level: f32,
    enabled: bool,
    lp_state: f32,
    hp_state: f32,
    sample_rate: f32,
}

impl OverdrivePedal {
    pub fn new(sample_rate: f32) -> Self {
        Self { drive: 0.5, tone: 0.5, level: 0.5, enabled: false, lp_state: 0.0, hp_state: 0.0, sample_rate }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "drive" => self.drive = value / 10.0,
            "tone" => self.tone = value / 10.0,
            "level" => self.level = value / 10.0,
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled { return input; }
        let dt = 1.0 / self.sample_rate;

        // Input high-pass (removes low-end mud before clipping)
        let hp_freq = 300.0 + (1.0 - self.drive) * 400.0;
        let hp_coeff = (2.0 * PI * hp_freq * dt).min(0.5);
        self.hp_state += hp_coeff * (input - self.hp_state);
        let hp_out = input - self.hp_state;

        // Gain stage with anti-parallel diode soft clipping
        let gained = hp_out * (1.0 + self.drive * 20.0);
        let clipped = Self::diode_clip(gained);

        // Tone control (output low-pass)
        let tone_freq = 1000.0 + self.tone * 5000.0;
        let lp_coeff = (2.0 * PI * tone_freq * dt).min(0.99);
        self.lp_state += lp_coeff * (clipped - self.lp_state);

        self.lp_state * self.level
    }

    fn diode_clip(x: f32) -> f32 {
        // Asymmetric soft clipping (anti-parallel silicon diodes)
        if x >= 0.0 {
            (x * 2.0).tanh() * 0.7
        } else {
            (x * 1.8).tanh() * 0.75
        }
    }

    pub fn reset(&mut self) { self.lp_state = 0.0; self.hp_state = 0.0; }
}

/// RAT-style distortion: hard clipping with slew rate limiting.
pub struct DistortionPedal {
    drive: f32,
    tone: f32,
    level: f32,
    enabled: bool,
    lp_state: f32,
    prev_output: f32,
    slew_rate: f32,
    sample_rate: f32,
}

impl DistortionPedal {
    pub fn new(sample_rate: f32) -> Self {
        Self { drive: 0.5, tone: 0.5, level: 0.5, enabled: false, lp_state: 0.0, prev_output: 0.0, slew_rate: 0.1, sample_rate }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "drive" => { self.drive = value / 10.0; self.slew_rate = 0.05 + (1.0 - self.drive) * 0.3; }
            "tone" => self.tone = value / 10.0,
            "level" => self.level = value / 10.0,
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled { return input; }
        let dt = 1.0 / self.sample_rate;

        let gained = input * (1.0 + self.drive * 30.0);

        // Slew rate limiting (op-amp characteristic)
        let delta = gained - self.prev_output;
        let max_slew = self.slew_rate * self.sample_rate * dt;
        let slew_limited = self.prev_output + delta.clamp(-max_slew, max_slew);

        // Hard clipping (shunt diodes)
        let clipped = slew_limited.clamp(-0.8, 0.8);
        self.prev_output = clipped;

        // Tone
        let tone_freq = 800.0 + self.tone * 6000.0;
        let lp_coeff = (2.0 * PI * tone_freq * dt).min(0.99);
        self.lp_state += lp_coeff * (clipped - self.lp_state);

        self.lp_state * self.level
    }

    pub fn reset(&mut self) { self.lp_state = 0.0; self.prev_output = 0.0; }
}

/// Fuzz: transistor-style with bias sensitivity and cleanup with guitar volume.
pub struct FuzzPedal {
    fuzz: f32,
    tone: f32,
    level: f32,
    enabled: bool,
    bias: f32,
    lp_state: f32,
    sample_rate: f32,
}

impl FuzzPedal {
    pub fn new(sample_rate: f32) -> Self {
        Self { fuzz: 0.7, tone: 0.5, level: 0.5, enabled: false, bias: 0.5, lp_state: 0.0, sample_rate }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "fuzz" => self.fuzz = value / 10.0,
            "tone" => self.tone = value / 10.0,
            "level" => self.level = value / 10.0,
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled { return input; }
        let dt = 1.0 / self.sample_rate;

        let gained = input * (1.0 + self.fuzz * 50.0);

        // Transistor-style clipping with bias sensitivity
        let biased = gained + (self.bias - 0.5) * 0.3;
        let clipped = if biased > 0.0 {
            1.0 - (-biased * 3.0).exp()
        } else {
            -(1.0 - (biased * 3.0).exp())
        };

        // Bias choke: at extreme fuzz, signal chokes under hot input
        let choke = if self.fuzz > 0.7 { 1.0 - (input.abs() * self.fuzz * 0.5).min(0.5) } else { 1.0 };

        // Tone
        let tone_freq = 500.0 + self.tone * 4000.0;
        let lp_coeff = (2.0 * PI * tone_freq * dt).min(0.99);
        self.lp_state += lp_coeff * (clipped * choke - self.lp_state);

        self.lp_state * self.level
    }

    pub fn reset(&mut self) { self.lp_state = 0.0; }
}

/// Simple compressor pedal.
pub struct CompressorPedal {
    threshold: f32,
    ratio: f32,
    attack_coeff: f32,
    release_coeff: f32,
    envelope: f32,
    enabled: bool,
    sample_rate: f32,
}

impl CompressorPedal {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            threshold: super::params::db_to_linear(-20.0),
            ratio: 4.0,
            attack_coeff: (-1.0 / (0.01 * sample_rate)).exp(),
            release_coeff: (-1.0 / (0.2 * sample_rate)).exp(),
            envelope: 0.0,
            enabled: false,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "threshold" => self.threshold = super::params::db_to_linear(value),
            "ratio" => self.ratio = value.max(1.0),
            "attack" => self.attack_coeff = (-1.0 / (value.max(0.1) * 0.001 * self.sample_rate)).exp(),
            "release" => self.release_coeff = (-1.0 / (value.max(1.0) * 0.001 * self.sample_rate)).exp(),
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled { return input; }

        let abs_in = input.abs();
        if abs_in > self.envelope {
            self.envelope = abs_in + self.attack_coeff * (self.envelope - abs_in);
        } else {
            self.envelope = abs_in + self.release_coeff * (self.envelope - abs_in);
        }

        let gain = if self.envelope > self.threshold {
            let over_db = super::params::linear_to_db(self.envelope / self.threshold);
            let reduced = over_db / self.ratio;
            super::params::db_to_linear(reduced - over_db)
        } else {
            1.0
        };

        input * gain
    }

    pub fn reset(&mut self) { self.envelope = 0.0; }
}

/// Simple delay effect.
pub struct DelayPedal {
    buffer: Vec<f32>,
    write_pos: usize,
    delay_samples: usize,
    feedback: f32,
    mix: f32,
    enabled: bool,
    sample_rate: f32,
}

impl DelayPedal {
    pub fn new(sample_rate: f32) -> Self {
        let max_delay = (sample_rate * 2.0) as usize;
        Self {
            buffer: vec![0.0; max_delay],
            write_pos: 0,
            delay_samples: (0.375 * sample_rate as f32) as usize,
            feedback: 0.3,
            mix: 0.25,
            enabled: false,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "time" => self.delay_samples = ((value * 0.001 * self.sample_rate) as usize).min(self.buffer.len() - 1),
            "feedback" => self.feedback = value.clamp(0.0, 0.95),
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled { return input; }

        let read_pos = if self.write_pos >= self.delay_samples {
            self.write_pos - self.delay_samples
        } else {
            self.buffer.len() - (self.delay_samples - self.write_pos)
        };

        let delayed = self.buffer[read_pos];
        self.buffer[self.write_pos] = input + delayed * self.feedback;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();

        input * (1.0 - self.mix) + delayed * self.mix
    }

    pub fn reset(&mut self) { self.buffer.fill(0.0); self.write_pos = 0; }
}

/// Simple reverb (Schroeder-style with comb + all-pass filters).
pub struct ReverbPedal {
    comb_buffers: [Vec<f32>; 4],
    comb_write_pos: [usize; 4],
    ap_buffers: [Vec<f32>; 2],
    ap_write_pos: [usize; 2],
    decay: f32,
    mix: f32,
    enabled: bool,
}

impl ReverbPedal {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate as usize;
        Self {
            comb_buffers: [
                vec![0.0; sr * 1116 / 44100],
                vec![0.0; sr * 1188 / 44100],
                vec![0.0; sr * 1277 / 44100],
                vec![0.0; sr * 1356 / 44100],
            ],
            comb_write_pos: [0; 4],
            ap_buffers: [
                vec![0.0; sr * 556 / 44100],
                vec![0.0; sr * 441 / 44100],
            ],
            ap_write_pos: [0; 2],
            decay: 0.5,
            mix: 0.15,
            enabled: false,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => self.decay = value.clamp(0.0, 0.99),
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "enabled" => self.enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.enabled { return input; }

        // Parallel comb filters
        let mut comb_sum = 0.0_f32;
        for i in 0..4 {
            let len = self.comb_buffers[i].len();
            let delayed = self.comb_buffers[i][self.comb_write_pos[i]];
            self.comb_buffers[i][self.comb_write_pos[i]] = input + delayed * self.decay;
            self.comb_write_pos[i] = (self.comb_write_pos[i] + 1) % len;
            comb_sum += delayed;
        }
        comb_sum *= 0.25;

        // Series all-pass filters
        let mut ap_out = comb_sum;
        for i in 0..2 {
            let len = self.ap_buffers[i].len();
            let delayed = self.ap_buffers[i][self.ap_write_pos[i]];
            let temp = -0.5 * ap_out + delayed;
            self.ap_buffers[i][self.ap_write_pos[i]] = ap_out + 0.5 * delayed;
            self.ap_write_pos[i] = (self.ap_write_pos[i] + 1) % len;
            ap_out = temp;
        }

        input * (1.0 - self.mix) + ap_out * self.mix
    }

    pub fn reset(&mut self) {
        for buf in &mut self.comb_buffers { buf.fill(0.0); }
        for buf in &mut self.ap_buffers { buf.fill(0.0); }
        self.comb_write_pos = [0; 4];
        self.ap_write_pos = [0; 2];
    }
}
