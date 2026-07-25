//! Bacteria — Sourdaw's creative multi-effects framework.
//!
//! Multi-band modular processor with distortion, filtering, granular,
//! spectral, modulation, and routing capabilities. Supports 1–6 bands
//! with LR4 or linear-phase crossover, serial/parallel/mid-side routing,
//! and a unified modulation engine.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod chorus;
pub mod convolution;
pub mod crossover;
pub mod distortion;
pub mod engine;
pub mod filter;
pub mod granular;
pub mod hilbert;
pub mod lofi;
pub mod modulation;
pub mod params;
pub mod spectral;
pub mod stft;
pub mod waveshaper;

use engine::BacteriaEngine;
use wasm_bindgen::prelude::*;
use crate::primitives::sanitize_block;

/// WASM-exported Bacteria instance for AudioWorklet.
#[wasm_bindgen]
pub struct BacteriaInstance {
    engine: BacteriaEngine,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl BacteriaInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 4096; // Pre-allocate maximum likely block size
        Self {
            engine: BacteriaEngine::new(sample_rate),
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
            nan_flush_count: 0,
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
        let size = (block_size as usize).min(self.input_left.len());

        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

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

    /// Get current input level in dB (for metering).
    pub fn get_input_db(&self) -> f32 {
        self.engine.current_input_db()
    }

    /// Get current output level in dB (for metering).
    pub fn get_output_db(&self) -> f32 {
        self.engine.current_output_db()
    }

    /// Get per-band levels packed as: [band0_db, band1_db, ... band5_db].
    pub fn get_band_levels_ptr(&self) -> *const f32 {
        self.engine.band_levels().as_ptr()
    }

    /// Get reported latency in samples.
    pub fn get_latency_samples(&self) -> u32 {
        self.engine.latency_samples()
    }

    /// Add a modulation assignment: `source_id` → `target_param` with scalar `amount`.
    ///
    /// Source IDs: 0=LFO1, 1=LFO2, 2=envelope follower, 3=Lorenz X, 4=Lorenz Z,
    /// 5=step sequencer, 6-13=macros 0-7.
    ///
    /// Target param IDs: 0=global mix, 1-6=band 0-5 gain (linear offset).
    pub fn add_mod_assignment(&mut self, source_id: u8, target_param: u16, amount: f32) {
        self.engine
            .add_mod_assignment(source_id, target_param, amount);
    }

    /// Add a macro mapping: macro `macro_index` (0-7) → `target_param`, remapped
    /// from the macro's 0-1 range into `[min_value, max_value]`.
    pub fn add_macro_mapping(
        &mut self,
        macro_index: u8,
        target_param: u16,
        min_value: f32,
        max_value: f32,
    ) {
        self.engine
            .add_macro_mapping(macro_index, target_param, min_value, max_value);
    }
}
