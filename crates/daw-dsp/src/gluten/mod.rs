//! Gluten — Sourdaw's multi-topology bus compressor.
//!
//! Four compression topologies: VCA (SSL G-Bus), Opto (LA-2A),
//! FET (1176), Diode Bridge (Neve 33609). Shared gain computer,
//! sidechain processing, stereo linking, M/S, lookahead, parallel mix.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod detector;
pub mod diode;
pub mod engine;
pub mod fet;
pub mod gain_computer;
pub mod lookahead;
pub mod opto;
pub mod oversample;
pub mod params;
pub mod sidechain;
pub mod smoother;
pub mod stereo;
pub mod vca;

use crate::primitives::sanitize_block;
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
    nan_flush_count: u64,
    /// External sidechain input buffers
    sc_left: Vec<f32>,
    sc_right: Vec<f32>,
}

#[wasm_bindgen]
impl GlutenInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 4096;
        Self {
            engine: GlutenEngine::new(sample_rate),
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
            nan_flush_count: 0,
            sc_left: vec![0.0; block_size],
            sc_right: vec![0.0; block_size],
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

    /// Get pointer to external sidechain left buffer.
    pub fn get_sc_left_ptr(&mut self) -> *mut f32 {
        self.sc_left.as_mut_ptr()
    }

    /// Get pointer to external sidechain right buffer.
    pub fn get_sc_right_ptr(&mut self) -> *mut f32 {
        self.sc_right.as_mut_ptr()
    }

    /// Set a parameter by name.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Process a block. Input must already be written to input buffers.
    /// Returns pointer to output left buffer.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;
        // Clamp to max 4096 to avoid audio-thread allocation
        let size = size.min(4096);

        // Copy input to output, then process in-place
        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

        // Pass external sidechain if available
        self.engine
            .set_ext_sc(&self.sc_left[..size], &self.sc_right[..size]);

        self.engine.process_block(
            &mut self.output_left[..size],
            &mut self.output_right[..size],
        );

        self.nan_flush_count += sanitize_block(&mut self.output_left[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.output_right[..size]) as u64;

        self.output_left.as_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
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

    /// Get latency in samples (lookahead delay) for host compensation.
    pub fn get_latency_samples(&self) -> u32 {
        self.engine.latency_samples()
    }

    /// Get crest factor (peak/RMS ratio in dB).
    pub fn get_crest(&self) -> f32 {
        self.engine.current_crest()
    }

    /// Get phase correlation (-1 to +1).
    pub fn get_phase_corr(&self) -> f32 {
        self.engine.current_phase_corr()
    }
}
