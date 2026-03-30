//! Grinder — Sourdaw's amp simulator, cabinet loader, pedalboard host,
//! and neural-capture playback engine.
//!
//! Hybrid system: white-box circuit modeling + black-box neural capture,
//! low-latency cabinet processing, and progressive-disclosure UX.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod triode;
pub mod tone_stack;
pub mod power_amp;
pub mod transformer;
pub mod cabinet;
pub mod input;
pub mod pedals;
pub mod neural;
pub mod params;
pub mod engine;

use engine::GrinderEngine;
use wasm_bindgen::prelude::*;

/// WASM-exported Grinder instance for AudioWorklet.
#[wasm_bindgen]
pub struct GrinderInstance {
    engine: GrinderEngine,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
}

#[wasm_bindgen]
impl GrinderInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 128;
        Self {
            engine: GrinderEngine::new(sample_rate),
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
        }
    }

    pub fn get_input_left_ptr(&mut self) -> *mut f32 {
        self.input_left.as_mut_ptr()
    }

    pub fn get_input_right_ptr(&mut self) -> *mut f32 {
        self.input_right.as_mut_ptr()
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;
        if self.input_left.len() < size {
            self.input_left.resize(size, 0.0);
            self.input_right.resize(size, 0.0);
            self.output_left.resize(size, 0.0);
            self.output_right.resize(size, 0.0);
        }

        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

        self.engine.process_block(
            &mut self.output_left[..size],
            &mut self.output_right[..size],
        );

        self.output_left.as_ptr()
    }

    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_right.as_ptr()
    }

    pub fn get_input_db(&self) -> f32 { self.engine.input_db() }
    pub fn get_preamp_db(&self) -> f32 { self.engine.preamp_db() }
    pub fn get_power_amp_db(&self) -> f32 { self.engine.power_amp_db() }
    pub fn get_output_db(&self) -> f32 { self.engine.output_db() }
    pub fn get_sag_voltage(&self) -> f32 { self.engine.sag_voltage() }
    pub fn get_latency_samples(&self) -> u32 { self.engine.latency_samples() }
}
