//! Crust — Sourdaw's true-peak mastering limiter.
//!
//! Look-ahead limiting against an ITU-R BS.1770-4 inter-sample peak detector,
//! with saturation, optional multiband operation, M/S processing, dither and a
//! full EBU R 128 loudness meter set for the panel.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod bands;
pub mod engine;
pub mod limiter;
pub mod oversample;
pub mod params;
pub mod saturator;

use crate::primitives::sanitize_block;
use engine::CrustEngine;
use wasm_bindgen::prelude::*;

/// WASM-exported Crust instance for AudioWorklet. An *effect*: it processes
/// input audio rather than generating it.
#[wasm_bindgen]
pub struct CrustInstance {
    engine: CrustEngine,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl CrustInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 4096;
        Self {
            engine: CrustEngine::new(sample_rate),
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
            nan_flush_count: 0,
        }
    }

    /// Pointer to the input left buffer — the caller writes input audio here.
    pub fn get_input_left_ptr(&mut self) -> *mut f32 {
        self.input_left.as_mut_ptr()
    }

    /// Pointer to the input right buffer.
    pub fn get_input_right_ptr(&mut self) -> *mut f32 {
        self.input_right.as_mut_ptr()
    }

    /// Set a parameter by its snake_case engine name.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Clear the held true-peak maximum behind the panel's TP reset.
    pub fn reset_true_peak(&mut self) {
        self.engine.reset_true_peak();
    }

    /// Process a block. Input must already be written to the input buffers.
    /// Returns a pointer to the output left buffer.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        // Clamp to the allocated size so an oversized request cannot grow a
        // buffer on the audio thread.
        let size = (block_size as usize).min(4096);

        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

        self.engine
            .process_block(&mut self.output_left[..size], &mut self.output_right[..size]);

        self.nan_flush_count += sanitize_block(&mut self.output_left[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.output_right[..size]) as u64;

        self.output_left.as_ptr()
    }

    /// Pointer to the output right buffer (call after `process`).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_right.as_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction. Non-zero means a poisoned block was caught at the wasm
    /// output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    pub fn get_gr_db(&self) -> f32 {
        self.engine.meters().gr_db
    }

    pub fn get_input_db(&self) -> f32 {
        self.engine.meters().input_db
    }

    pub fn get_output_db(&self) -> f32 {
        self.engine.meters().output_db
    }

    pub fn get_lufs_integrated(&self) -> f32 {
        self.engine.meters().lufs_integrated
    }

    pub fn get_lufs_short_term(&self) -> f32 {
        self.engine.meters().lufs_short_term
    }

    pub fn get_lufs_momentary(&self) -> f32 {
        self.engine.meters().lufs_momentary
    }

    pub fn get_lra(&self) -> f32 {
        self.engine.meters().lra
    }

    /// Held true-peak maximum in dBTP.
    pub fn get_true_peak_max(&self) -> f32 {
        self.engine.meters().true_peak_max
    }

    /// 1.0 when the held true-peak maximum is above the configured ceiling.
    pub fn get_true_peak_exceeded(&self) -> f32 {
        if self.engine.meters().true_peak_exceeded {
            1.0
        } else {
            0.0
        }
    }

    /// Delay imposed on the audio path, in samples, for host compensation.
    pub fn get_latency_samples(&self) -> u32 {
        self.engine.latency_samples() as u32
    }
}
