//! Gluten — Sourdaw's multi-topology bus compressor.
//!
//! Four compression topologies: VCA (SSL G-Bus), Opto (LA-2A),
//! FET (1176), Diode Bridge (Neve 33609). Shared gain computer,
//! sidechain processing, stereo linking, M/S, lookahead, parallel mix.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod gain_computer;
pub mod detector;
pub mod smoother;
pub mod vca;
pub mod opto;
pub mod fet;
pub mod diode;
pub mod sidechain;
pub mod stereo;
pub mod lookahead;
pub mod params;
pub mod engine;

use engine::GlutenEngine;
use wasm_bindgen::prelude::*;

/// WASM-exported Gluten instance for AudioWorklet.
/// Unlike instruments, this is an *effect* — it processes input audio.
#[wasm_bindgen]
pub struct GlutenInstance {
    engine: GlutenEngine,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
}

#[wasm_bindgen]
impl GlutenInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 128;
        Self {
            engine: GlutenEngine::new(sample_rate),
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
        }
    }

    /// Get pointer to input left buffer — caller writes input audio here.
    pub fn get_input_left_ptr(&mut self) -> *mut f32 {
        self.input_left.as_mut_ptr()
    }

    /// Get pointer to input right buffer.
    pub fn get_input_right_ptr(&mut self) -> *mut f32 {
        self.input_right.as_mut_ptr()
    }

    /// Set a parameter by name.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Process a block. Input must already be written to input buffers.
    /// Returns pointer to output left buffer.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;

        // Resize buffers if needed
        if self.input_left.len() < size {
            self.input_left.resize(size, 0.0);
            self.input_right.resize(size, 0.0);
            self.output_left.resize(size, 0.0);
            self.output_right.resize(size, 0.0);
        }

        // Copy input to output, then process in-place
        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

        self.engine.process_block(
            &mut self.output_left[..size],
            &mut self.output_right[..size],
        );

        self.output_left.as_ptr()
    }

    /// Get pointer to output right buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_right.as_ptr()
    }

    /// Get current gain reduction in dB (for metering).
    pub fn get_gr_db(&self) -> f32 {
        self.engine.current_gr_db()
    }

    /// Get current input level in dB (for metering).
    pub fn get_input_db(&self) -> f32 {
        self.engine.current_input_db()
    }

    /// Get current output level in dB (for metering).
    pub fn get_output_db(&self) -> f32 {
        self.engine.current_output_db()
    }
}
