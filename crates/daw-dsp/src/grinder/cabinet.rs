//! Cabinet engine with non-uniform partitioned convolution,
//! parametric speaker model, and back-EMF interaction.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

/// Longest IR head this convolver keeps. The buffers are sized to it once at
/// construction and filled in place afterwards: `load_ir_slot` and
/// `load_builtin` are reachable from `set_param("cabIrSlot", …)`, which the
/// AudioWorklet calls on the audio thread, so neither may allocate.
const MAX_HEAD_LENGTH: usize = 128;

/// Non-uniform partitioned convolution: short head (time-domain) + long tail (FFT).
/// For now implements the time-domain head section for zero added latency.
pub struct CabinetConvolver {
    // Time-domain head (first MAX_HEAD_LENGTH samples of IR)
    head_ir_1: [f32; MAX_HEAD_LENGTH],
    head_ir_1_length: usize,
    head_ir_2: [f32; MAX_HEAD_LENGTH],
    head_ir_2_length: usize,
    head_buffer: [f32; MAX_HEAD_LENGTH],
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
    room_lp: f32,
    room_buffer: Vec<f32>,
    room_write_pos: usize,

    // IR loaded flag
    ir_loaded: bool,
    enabled: bool,
    sample_rate: f32,
}

impl CabinetConvolver {
    pub fn new(sample_rate: f32) -> Self {
        let room_buffer_length = ((sample_rate * 0.080) as usize).max(512);
        Self {
            head_ir_1: [0.0; MAX_HEAD_LENGTH],
            head_ir_1_length: 0,
            head_ir_2: [0.0; MAX_HEAD_LENGTH],
            head_ir_2_length: 0,
            head_buffer: [0.0; MAX_HEAD_LENGTH],
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
            room_lp: 0.0,
            room_buffer: vec![0.0; room_buffer_length],
            room_write_pos: 0,
            ir_loaded: false,
            enabled: true,
            sample_rate,
        }
    }

    /// Load an impulse response into a specific slot. Copies into the
    /// construction-time buffers; never allocates.
    pub fn load_ir_slot(&mut self, slot: u32, ir_data: &[f32]) {
        let head_len = ir_data.len().min(MAX_HEAD_LENGTH);

        let (head_ir, head_ir_length) = if slot == 1 {
            (&mut self.head_ir_1, &mut self.head_ir_1_length)
        } else {
            (&mut self.head_ir_2, &mut self.head_ir_2_length)
        };
        head_ir[..head_len].copy_from_slice(&ir_data[..head_len]);
        head_ir[head_len..].fill(0.0);
        *head_ir_length = head_len;

        self.head_length = self.head_length.max(head_len);
        self.ir_loaded = true;
    }

    /// Load built-in cabinet IRs. Synthesised straight into the slot buffers;
    /// never allocates.
    pub fn load_builtin(&mut self, cab_type: u32) {
        let length = MAX_HEAD_LENGTH;
        let sample_rate = self.sample_rate;
        let ir1 = &mut self.head_ir_1;
        let ir2 = &mut self.head_ir_2;
        ir1.fill(0.0);
        ir2.fill(0.0);

        match cab_type {
            0 => {
                // 4x12 closed-back: tight, punchy
                ir1[0] = 0.8;
                ir2[0] = 0.7;
                for i in 1..length {
                    let t = i as f32 / sample_rate;
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
                    let t = i as f32 / sample_rate;
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
                    let t = i as f32 / sample_rate;
                    ir1[i] = (-t * 150.0).exp() * (1000.0 * 2.0 * PI * t).sin() * 0.35;
                    ir2[i] = (-t * 170.0).exp() * (1050.0 * 2.0 * PI * t).sin() * 0.32;
                }
            }
        }

        // Normalize
        normalize_ir(ir1);
        normalize_ir(ir2);

        self.head_ir_1_length = length;
        self.head_ir_2_length = length;
        self.head_length = self.head_length.max(length);
        self.ir_loaded = true;
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

            if self.mic_1_enabled && k < self.head_ir_1_length {
                out1 += in_val * self.head_ir_1[k];
            }
            if self.mic_2_enabled && k < self.head_ir_2_length {
                out2 += in_val * self.head_ir_2[k];
            }
        }

        // Apply position-based filters.
        // More off-axis/edge or farther distance means less direct high end.
        let cut1 = ((1.0 - (self.mic_1_pos_x * 0.3 + self.mic_1_pos_y * 0.5).min(0.8))
            * (1.0 - self.mic_1_distance * 0.55))
            .clamp(0.08, 1.0);
        self.mic_1_lp = flush_denormal(self.mic_1_lp + (out1 - self.mic_1_lp) * cut1);
        let distance_gain_1 = 1.0 - self.mic_1_distance * 0.45;
        out1 = self.mic_1_lp * self.mic_1_gain * distance_gain_1;

        let cut2 = ((1.0 - (self.mic_2_pos_x * 0.3 + self.mic_2_pos_y * 0.5).min(0.8))
            * (1.0 - self.mic_2_distance * 0.55))
            .clamp(0.08, 1.0);
        self.mic_2_lp = flush_denormal(self.mic_2_lp + (out2 - self.mic_2_lp) * cut2);
        let distance_gain_2 = 1.0 - self.mic_2_distance * 0.45;
        out2 = self.mic_2_lp * self.mic_2_gain * distance_gain_2;

        self.head_write_pos = (self.head_write_pos + 1) % self.head_length;

        // Blend
        let w2 = self.mic_blend;
        let w1 = 1.0 - w2;
        let direct = out1 * w1 + out2 * w2;

        self.room_buffer[self.room_write_pos] = direct;
        let blended_distance =
            (self.mic_1_distance * w1 + self.mic_2_distance * w2).clamp(0.0, 1.0);
        let room = if self.room_amount > 0.001 {
            let tap_1 = self
                .read_room_tap((self.sample_rate * (0.012 + blended_distance * 0.006)) as usize);
            let tap_2 = self
                .read_room_tap((self.sample_rate * (0.021 + blended_distance * 0.010)) as usize);
            let tap_3 = self
                .read_room_tap((self.sample_rate * (0.034 + blended_distance * 0.016)) as usize);
            let reflections = tap_1 * 0.52 + tap_2 * 0.31 + tap_3 * 0.17;
            let room_cut_hz = 2_400.0 - blended_distance * 1_100.0;
            let room_coeff = (2.0 * PI * room_cut_hz.max(400.0) / self.sample_rate).min(0.65);
            self.room_lp = flush_denormal(self.room_lp + (reflections - self.room_lp) * room_coeff);
            self.room_lp * self.room_amount * (0.18 + blended_distance * 0.22)
        } else {
            0.0
        };
        self.room_write_pos = (self.room_write_pos + 1) % self.room_buffer.len();

        direct * (1.0 - self.room_amount * 0.16) + room
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
        self.mic_1_lp = 0.0;
        self.mic_2_lp = 0.0;
        self.room_lp = 0.0;
        self.room_buffer.fill(0.0);
        self.room_write_pos = 0;
    }

    fn read_room_tap(&self, delay_samples: usize) -> f32 {
        if self.room_buffer.is_empty() {
            return 0.0;
        }

        let delay = delay_samples.min(self.room_buffer.len().saturating_sub(1));
        let read_pos = if self.room_write_pos >= delay {
            self.room_write_pos - delay
        } else {
            self.room_buffer.len() - (delay - self.room_write_pos)
        };
        self.room_buffer[read_pos]
    }
}

/// Peak-normalise an IR head in place.
fn normalize_ir(ir: &mut [f32]) {
    let max_val = ir
        .iter()
        .map(|x| x.abs())
        .fold(0.0_f32, f32::max)
        .max(0.001);
    for s in ir {
        *s /= max_val;
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

    enabled: bool,
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
            enabled: true,
            sample_rate,
        }
    }

    /// `cabEnabled` gates the parametric speaker too, not just the IR
    /// convolver — otherwise the cabinet-disable toggle is inaudible in the
    /// Parametric and Both cabinet modes.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
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
        if !self.enabled {
            return input;
        }

        let dt = 1.0 / self.sample_rate;

        // Cabinet resonance: SVF tuned to resonance frequency
        let g = (PI * self.resonance_freq * dt).tan();
        let k = 1.0 / self.resonance_q;
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;

        let v3 = input - self.res_lp_state;
        let v1 = a1 * self.res_bp_state + a2 * v3;
        let v2 = self.res_lp_state + a2 * self.res_bp_state + g * a2 * v3;

        self.res_bp_state = flush_denormal(2.0 * v1 - self.res_bp_state);
        self.res_lp_state = flush_denormal(2.0 * v2 - self.res_lp_state);

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

#[cfg(test)]
mod tests {
    use super::{CabinetConvolver, SpeakerModel, MAX_HEAD_LENGTH};

    fn render_average_output(configure: impl FnOnce(&mut CabinetConvolver)) -> f32 {
        let mut cabinet = CabinetConvolver::new(48_000.0);
        cabinet.load_builtin(0);
        configure(&mut cabinet);

        let total = 4096;
        let mut sum = 0.0_f32;

        for index in 0..total {
            let low = ((index as f32 * 2.0 * std::f32::consts::PI * 180.0) / 48_000.0).sin() * 0.12;
            let high =
                ((index as f32 * 2.0 * std::f32::consts::PI * 3200.0) / 48_000.0).sin() * 0.05;
            let output = cabinet.process_sample(low + high);
            sum += output.abs();
        }

        sum / total as f32
    }

    #[test]
    fn mic_distance_changes_the_rendered_cabinet_output() {
        let close = render_average_output(|cabinet| {
            cabinet.set_param("mic1Distance", 0.0);
        });
        let far = render_average_output(|cabinet| {
            cabinet.set_param("mic1Distance", 1.0);
        });

        assert!(
            (close - far).abs() > 1.0e-3,
            "mic distance should audibly change cabinet output (close={close}, far={far})"
        );
    }

    /// F4: `cabEnabled` has to reach the parametric speaker, not only the IR
    /// convolver. A disabled speaker passes its input through untouched.
    #[test]
    fn a_disabled_speaker_model_is_a_bit_exact_bypass() {
        let mut speaker = SpeakerModel::new(48_000.0);
        speaker.set_param("cabResonanceFreq", 120.0);
        speaker.set_param("coneBreakup", 0.8);
        speaker.set_param("backEmf", 0.6);
        speaker.set_enabled(false);

        for index in 0..2_048 {
            let phase = (index as f32 * 2.0 * std::f32::consts::PI * 90.0) / 48_000.0;
            let input = phase.sin() * 0.4;
            assert_eq!(
                speaker.process_sample(input),
                input,
                "a disabled speaker must pass its input through unchanged"
            );
        }
        assert_eq!(speaker.back_emf(), 0.0);
    }

    /// F10: `cabIrSlot` reaches this from the audio thread, so a slot switch
    /// must refill the buffers it already owns rather than allocate new ones.
    #[test]
    fn reloading_an_ir_slot_reuses_the_construction_time_buffers() {
        let mut cabinet = CabinetConvolver::new(48_000.0);
        cabinet.load_builtin(0);
        let first_slot = cabinet.head_ir_1.as_ptr();
        let second_slot = cabinet.head_ir_2.as_ptr();

        cabinet.load_builtin(1);
        cabinet.load_builtin(2);
        cabinet.load_ir_slot(1, &[0.5_f32; 64]);

        assert_eq!(cabinet.head_ir_1.as_ptr(), first_slot);
        assert_eq!(cabinet.head_ir_2.as_ptr(), second_slot);
        assert_eq!(cabinet.head_ir_1.len(), MAX_HEAD_LENGTH);
        assert_eq!(cabinet.head_ir_1_length, 64);
        assert_eq!(
            cabinet.head_ir_1[64..],
            [0.0_f32; MAX_HEAD_LENGTH - 64],
            "a shorter IR must clear the tail of the slot it replaces"
        );
    }

    #[test]
    fn room_amount_changes_the_rendered_cabinet_output() {
        let dry = render_average_output(|cabinet| {
            cabinet.set_param("roomAmount", 0.0);
        });
        let roomy = render_average_output(|cabinet| {
            cabinet.set_param("roomAmount", 1.0);
        });

        assert!(
            (dry - roomy).abs() > 1.0e-3,
            "room amount should audibly change cabinet output (dry={dry}, roomy={roomy})"
        );
    }
}
