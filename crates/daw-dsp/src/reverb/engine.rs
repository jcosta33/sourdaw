//! Reverb Engine Wrapper for Dutch Oven

use crate::reverb::dattorro::DattorroTank;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ProofChamberEngine {
    plate: DattorroTank,
    sample_rate: f32,

    // User parameters
    pub mix: f32,          // 0.0 to 1.0
    pub pre_delay_ms: f32, // 0 to 500ms

    // Simple ring buffer for pre-delay (zero-allocation)
    pre_delay_buffer: Vec<f32>,
    pre_delay_idx: usize,

    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
}

#[wasm_bindgen]
impl ProofChamberEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let max_pre_delay_samples = (sample_rate * 0.5).ceil() as usize;
        let block_size = 4096;
        Self {
            plate: DattorroTank::new(sample_rate),
            sample_rate,
            mix: 0.5,
            pre_delay_ms: 15.0,
            pre_delay_buffer: vec![0.0; max_pre_delay_samples],
            pre_delay_idx: 0,
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
        }
    }

    /// Update internal Dattorro plate parameters smoothly
    pub fn set_parameters(
        &mut self,
        mix: f32,
        pre_delay_ms: f32,
        decay: f32,
        bandwidth: f32,
        damping: f32,
        diffusion: f32, // Maps to input_1, input_2, decay_1, decay_2
        excursion_samples: f32,
    ) {
        self.mix = mix.clamp(0.0, 1.0);
        self.pre_delay_ms = pre_delay_ms.clamp(0.0, 500.0);

        self.plate.decay = decay.clamp(0.0, 1.0);
        self.plate.bandwidth = bandwidth.clamp(0.0, 0.999999);
        self.plate.damping = damping.clamp(0.0, 0.999999);
        self.plate.excursion_samples = excursion_samples;

        // Map abstract 0-1 diffusion to Dattorro specific nodes
        self.plate.input_diffusion_1 = diffusion * 0.750;
        self.plate.input_diffusion_2 = diffusion * 0.625;
        self.plate.decay_diffusion_1 = diffusion * 0.70;

        // Decay diffusion 2 is strictly coupled to decay in the spec
        self.plate.decay_diffusion_2 = (decay + 0.15).clamp(0.25, 0.50);
    }

    pub fn get_input_left_ptr(&mut self) -> *mut f32 {
        self.input_left.as_mut_ptr()
    }

    pub fn get_input_right_ptr(&mut self) -> *mut f32 {
        self.input_right.as_mut_ptr()
    }

    pub fn get_output_left_ptr(&self) -> *const f32 {
        self.output_left.as_ptr()
    }

    pub fn get_output_right_ptr(&self) -> *const f32 {
        self.output_right.as_ptr()
    }

    pub fn process_block(&mut self, size: u32) {
        let len = (size as usize).min(self.input_left.len());
        let pd_samples = (self.pre_delay_ms * 0.001 * self.sample_rate).floor() as usize;
        let pd_len = self.pre_delay_buffer.len();

        for i in 0..len {
            // Un-decorrelate input matrix to mono for tank
            let mono_in = (self.input_left[i] + self.input_right[i]) * 0.5;

            // Write to pre-delay
            self.pre_delay_buffer[self.pre_delay_idx] = mono_in;

            // Read from pre-delay
            let read_idx = (self.pre_delay_idx + pd_len - (pd_samples % pd_len)) % pd_len;
            let verb_in = self.pre_delay_buffer[read_idx];

            self.pre_delay_idx = (self.pre_delay_idx + 1) % pd_len;

            // Process tank
            let (wet_l, wet_r) = self.plate.process(verb_in);

            // Mix
            self.output_left[i] = self.input_left[i] * (1.0 - self.mix) + wet_l * self.mix;
            self.output_right[i] = self.input_right[i] * (1.0 - self.mix) + wet_r * self.mix;
        }
    }
}
