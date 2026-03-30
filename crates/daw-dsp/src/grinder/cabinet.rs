//! Cabinet engine with non-uniform partitioned convolution,
//! parametric speaker model, and back-EMF interaction.

use std::f32::consts::PI;

/// Non-uniform partitioned convolution: short head (time-domain) + long tail (FFT).
/// For now implements the time-domain head section for zero added latency.
pub struct CabinetConvolver {
    // Time-domain head (first 128 samples of IR)
    head_ir: Vec<f32>,
    head_buffer: Vec<f32>,
    head_write_pos: usize,
    head_length: usize,

    // IR loaded flag
    ir_loaded: bool,
    enabled: bool,
}

impl CabinetConvolver {
    pub fn new() -> Self {
        Self {
            head_ir: Vec::new(),
            head_buffer: Vec::new(),
            head_write_pos: 0,
            head_length: 0,
            ir_loaded: false,
            enabled: true,
        }
    }

    /// Load an impulse response.
    pub fn load_ir(&mut self, ir_data: &[f32]) {
        let head_len = ir_data.len().min(128);
        self.head_ir = ir_data[..head_len].to_vec();
        self.head_buffer = vec![0.0; head_len];
        self.head_write_pos = 0;
        self.head_length = head_len;
        self.ir_loaded = true;
    }

    /// Load a built-in cabinet IR.
    pub fn load_builtin(&mut self, cab_type: u32) {
        let length = 128;
        let mut ir = vec![0.0_f32; length];

        match cab_type {
            0 => {
                // 4x12 closed-back: tight, punchy
                ir[0] = 0.8;
                for i in 1..length {
                    let t = i as f32 / 44100.0;
                    ir[i] = (-t * 200.0).exp() * (1200.0 * 2.0 * PI * t).sin() * 0.3
                        + (-t * 400.0).exp() * (3500.0 * 2.0 * PI * t).sin() * 0.1;
                }
            }
            1 => {
                // 2x12 open-back: warm, airy
                ir[0] = 0.6;
                for i in 1..length {
                    let t = i as f32 / 44100.0;
                    ir[i] = (-t * 100.0).exp() * (800.0 * 2.0 * PI * t).sin() * 0.4
                        + (-t * 150.0).exp() * (2200.0 * 2.0 * PI * t).sin() * 0.2;
                }
            }
            _ => {
                // 1x12 combo: balanced
                ir[0] = 0.7;
                for i in 1..length {
                    let t = i as f32 / 44100.0;
                    ir[i] = (-t * 150.0).exp() * (1000.0 * 2.0 * PI * t).sin() * 0.35;
                }
            }
        }

        // Normalize
        let max_val = ir.iter().map(|x| x.abs()).fold(0.0_f32, f32::max).max(0.001);
        for s in &mut ir {
            *s /= max_val;
        }

        self.load_ir(&ir);
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.ir_loaded || !self.enabled || self.head_length == 0 {
            return input;
        }

        // Write input to circular buffer
        self.head_buffer[self.head_write_pos] = input;

        // Time-domain convolution (head partition)
        let mut output = 0.0_f32;
        for k in 0..self.head_length {
            let read_pos = (self.head_write_pos + self.head_length - k) % self.head_length;
            output += self.head_buffer[read_pos] * self.head_ir[k];
        }

        self.head_write_pos = (self.head_write_pos + 1) % self.head_length;
        output
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn reset(&mut self) {
        self.head_buffer.fill(0.0);
        self.head_write_pos = 0;
    }
}

/// Parametric speaker model: resonance, damping, cone breakup, back-EMF.
pub struct SpeakerModel {
    // Resonance filter
    resonance_freq: f32,
    resonance_q: f32,
    damping: f32,
    open_back: bool,

    // Cone breakup
    breakup_amount: f32,

    // Back-EMF
    back_emf_amount: f32,
    back_emf_state: f32,

    // Resonant filter state
    res_lp_state: f32,
    res_bp_state: f32,

    sample_rate: f32,
}

impl SpeakerModel {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            resonance_freq: 80.0,
            resonance_q: 2.0,
            damping: 0.5,
            open_back: false,
            breakup_amount: 0.3,
            back_emf_amount: 0.2,
            back_emf_state: 0.0,
            res_lp_state: 0.0,
            res_bp_state: 0.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "cabResonanceFreq" => self.resonance_freq = value.clamp(40.0, 200.0),
            "cabResonanceQ" => self.resonance_q = value.clamp(0.5, 10.0),
            "cabDamping" => self.damping = value,
            "cabOpenBack" => self.open_back = value > 0.5,
            "coneBreakup" => self.breakup_amount = value,
            "backEmf" => self.back_emf_amount = value,
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        let dt = 1.0 / self.sample_rate;

        // Cabinet resonance: SVF tuned to resonance frequency
        let g = (PI * self.resonance_freq * dt).tan();
        let k = 1.0 / self.resonance_q;
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;

        let v3 = input - self.res_lp_state;
        let v1 = a1 * self.res_bp_state + a2 * v3;
        let v2 = self.res_lp_state + a2 * self.res_bp_state + g * a2 * v3;

        self.res_bp_state = 2.0 * v1 - self.res_bp_state;
        self.res_lp_state = 2.0 * v2 - self.res_lp_state;

        // Open-back: reduce low-frequency content, add phase cancellation character
        let resonance_boost = if self.open_back {
            v1 * 0.3 // less low-end resonance
        } else {
            v2 * 0.5 * (1.0 - self.damping) // closed-back: more thump
        };

        // Cone breakup: band-limited saturation in upper mids
        let breakup = if self.breakup_amount > 0.01 {
            let hp = input - self.res_lp_state; // high-frequency content
            let saturated = (hp * (1.0 + self.breakup_amount * 3.0)).tanh();
            (saturated - hp) * self.breakup_amount * 0.3
        } else {
            0.0
        };

        // Back-EMF: feedback from speaker impedance into power amp
        let back_emf_signal = resonance_boost * self.back_emf_amount;
        self.back_emf_state = back_emf_signal;

        input + resonance_boost + breakup
    }

    /// Get back-EMF signal for power amp feedback.
    pub fn back_emf(&self) -> f32 {
        self.back_emf_state
    }

    pub fn reset(&mut self) {
        self.res_lp_state = 0.0;
        self.res_bp_state = 0.0;
        self.back_emf_state = 0.0;
    }
}
