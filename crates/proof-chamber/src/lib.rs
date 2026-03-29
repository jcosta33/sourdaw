//! Proof Chamber — Sourdaw's flagship reverb engine.
//!
//! Dattorro plate reverb with shimmer, freeze, modulation.
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod proof_chamber;

use proof_chamber::ProofChamber;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct ProofChamberInstance {
    engine: ProofChamber,
    out_left: Vec<f32>,
    out_right: Vec<f32>,
}

#[wasm_bindgen]
impl ProofChamberInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let max_block = 1024;
        Self {
            engine: ProofChamber::new(sample_rate),
            out_left: vec![0.0; max_block],
            out_right: vec![0.0; max_block],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Process stereo audio. Input is copied, processed in-place, output returned via pointers.
    pub fn process(&mut self, left_in: &[f32], right_in: &[f32], frames: u32) -> *const f32 {
        let size = (frames as usize).min(1024);
        self.out_left[..size].copy_from_slice(&left_in[..size]);
        self.out_right[..size].copy_from_slice(&right_in[..size]);
        self.engine.process(&mut self.out_left[..size], &mut self.out_right[..size]);
        self.out_left.as_ptr()
    }

    pub fn get_right_ptr(&self) -> *const f32 {
        self.out_right.as_ptr()
    }

    pub fn get_param_names(&self) -> String {
        serde_json::to_string(&self.engine.param_names()).unwrap_or_else(|_| "[]".to_string())
    }
}
