//! Cabinet engine with non-uniform partitioned convolution,
//! parametric speaker model, and back-EMF interaction.

use std::f32::consts::PI;

/// Non-uniform partitioned convolution: short head (time-domain) + long tail (FFT).
/// For now implements the time-domain head section for zero added latency.
pub struct CabinetConvolver {
    // Time-domain head (first 128 samples of IR)
    head_ir_1: Vec<f32>,
    head_ir_2: Vec<f32>,
    head_buffer: Vec<f32>,
    head_write_pos: usize,
    head_length: usize,

    // Mic configuration
    mic_1_enabled: bool,
    mic_1_gain: f32,
    mic_1_pos_x: f32, // 0 = center, 1 = edge
    mic_1_pos_y: f32, // 0 = on-axis, 1 = off-axis
    mic_1_distance: f32,
    
    mic_2_enabled: bool,
    mic_2_gain: f32,
    mic_2_pos_x: f32,
    mic_2_pos_y: f32,
    mic_2_distance: f32,

    mic_blend: f32, // 0.0 = mic1, 1.0 = mic2
    room_amount: f32,

    // Filter states for mic positions
    mic_1_lp: f32,
    mic_2_lp: f32,

    // IR loaded flag
    ir_loaded: bool,
    enabled: bool,
    sample_rate: f32,
}

impl CabinetConvolver {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            head_ir_1: Vec::new(),
            head_ir_2: Vec::new(),
            head_buffer: Vec::new(),
            head_write_pos: 0,
            head_length: 0,
            mic_1_enabled: true,
            mic_1_gain: 1.0,
            mic_1_pos_x: 0.3,
            mic_1_pos_y: 0.1,
            mic_1_distance: 0.2,
            mic_2_enabled: false,
            mic_2_gain: 1.0,
            mic_2_pos_x: 0.6,
            mic_2_pos_y: 0.3,
            mic_2_distance: 0.5,
            mic_blend: 0.0,
            room_amount: 0.1,
            mic_1_lp: 0.0,
            mic_2_lp: 0.0,
            ir_loaded: false,
            enabled: true,
            sample_rate,
        }
    }

    /// Load an impulse response into a specific slot.
    pub fn load_ir_slot(&mut self, slot: u32, ir_data: &[f32]) {
        let head_len = ir_data.len().min(128);
        let ir = ir_data[..head_len].to_vec();
        
        if slot == 1 {
            self.head_ir_1 = ir;
        } else {
            self.head_ir_2 = ir;
        }
        
        if self.head_buffer.len() < head_len {
            self.head_buffer = vec![0.0; head_len];
        }
        self.head_length = self.head_length.max(head_len);
        self.ir_loaded = true;
    }

    /// Load built-in cabinet IRs.
    pub fn load_builtin(&mut self, cab_type: u32) {
        let length = 128;
        let mut ir1 = vec![0.0_f32; length];
        let mut ir2 = vec![0.0_f32; length];

        match cab_type {
            0 => {
                // 4x12 closed-back: tight, punchy
                ir1[0] = 0.8;
                ir2[0] = 0.7;
                for i in 1..length {
                    let t = i as f32 / self.sample_rate;
                    ir1[i] = (-t * 200.0).exp() * (1200.0 * 2.0 * PI * t).sin() * 0.3
                        + (-t * 400.0).exp() * (3500.0 * 2.0 * PI * t).sin() * 0.1;
                    ir2[i] = (-t * 180.0).exp() * (1100.0 * 2.0 * PI * t).sin() * 0.35
                        + (-t * 450.0).exp() * (3800.0 * 2.0 * PI * t).sin() * 0.12;
                }
            }
            1 => {
                // 2x12 open-back: warm, airy
                ir1[0] = 0.6;
                ir2[0] = 0.55;
                for i in 1..length {
                    let t = i as f32 / self.sample_rate;
                    ir1[i] = (-t * 100.0).exp() * (800.0 * 2.0 * PI * t).sin() * 0.4
                        + (-t * 150.0).exp() * (2200.0 * 2.0 * PI * t).sin() * 0.2;
                    ir2[i] = (-t * 120.0).exp() * (850.0 * 2.0 * PI * t).sin() * 0.38
                        + (-t * 180.0).exp() * (2400.0 * 2.0 * PI * t).sin() * 0.22;
                }
            }
            _ => {
                // 1x12 combo: balanced
                ir1[0] = 0.7;
                ir2[0] = 0.65;
                for i in 1..length {
                    let t = i as f32 / self.sample_rate;
                    ir1[i] = (-t * 150.0).exp() * (1000.0 * 2.0 * PI * t).sin() * 0.35;
                    ir2[i] = (-t * 170.0).exp() * (1050.0 * 2.0 * PI * t).sin() * 0.32;
                }
            }
        }

        // Normalize
        for ir in [&mut ir1, &mut ir2] {
            let max_val = ir
                .iter()
                .map(|x| x.abs())
                .fold(0.0_f32, f32::max)
                .max(0.001);
            for s in ir {
                *s /= max_val;
            }
        }

        self.load_ir_slot(1, &ir1);
        self.load_ir_slot(2, &ir2);
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if !self.ir_loaded || !self.enabled || self.head_length == 0 {
            return input;
        }

        // Write input to circular buffer
        self.head_buffer[self.head_write_pos] = input;

        // Time-domain convolution (head partition) for each mic
        let mut out1 = 0.0_f32;
        let mut out2 = 0.0_f32;

        for k in 0..self.head_length {
            let read_pos = (self.head_write_pos + self.head_length - k) % self.head_length;
            let in_val = self.head_buffer[read_pos];
            
            if self.mic_1_enabled && k < self.head_ir_1.len() {
                out1 += in_val * self.head_ir_1[k];
            }
            if self.mic_2_enabled && k < self.head_ir_2.len() {
                out2 += in_val * self.head_ir_2[k];
            }
        }

        // Apply position-based filters
        // mic1: more off-axis (Y) or edge (X) means more low-pass
        let cut1 = 1.0 - (self.mic_1_pos_x * 0.3 + self.mic_1_pos_y * 0.5).min(0.8);
        self.mic_1_lp += (out1 - self.mic_1_lp) * cut1;
        out1 = self.mic_1_lp * self.mic_1_gain;

        // mic2:
        let cut2 = 1.0 - (self.mic_2_pos_x * 0.3 + self.mic_2_pos_y * 0.5).min(0.8);
        self.mic_2_lp += (out2 - self.mic_2_lp) * cut2;
        out2 = self.mic_2_lp * self.mic_2_gain;

        self.head_write_pos = (self.head_write_pos + 1) % self.head_length;

        // Blend
        let w2 = self.mic_blend;
        let w1 = 1.0 - w2;
        
        out1 * w1 + out2 * w2
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "mic1Enabled" => self.mic_1_enabled = value > 0.5,
            "mic1Gain" => self.mic_1_gain = 10.0_f32.powf(value / 20.0),
            "mic1PositionX" => self.mic_1_pos_x = value.clamp(0.0, 1.0),
            "mic1PositionY" => self.mic_1_pos_y = value.clamp(0.0, 1.0),
            "mic1Distance" => self.mic_1_distance = value.clamp(0.0, 1.0),
            "mic2Enabled" => self.mic_2_enabled = value > 0.5,
            "mic2Gain" => self.mic_2_gain = 10.0_f32.powf(value / 20.0),
            "mic2PositionX" => self.mic_2_pos_x = value.clamp(0.0, 1.0),
            "mic2PositionY" => self.mic_2_pos_y = value.clamp(0.0, 1.0),
            "mic2Distance" => self.mic_2_distance = value.clamp(0.0, 1.0),
            "micBlend" => self.mic_blend = value.clamp(0.0, 1.0),
            "roomAmount" => self.room_amount = value.clamp(0.0, 1.0),
            _ => {}
        }
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
