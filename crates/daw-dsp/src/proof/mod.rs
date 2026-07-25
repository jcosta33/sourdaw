//! Proof — Sourdaw's mastering suite.
//!
//! Reorderable signal chain: EQ → Multiband Dynamics → Stereo Imager →
//! Harmonic Exciter → Limiter, with inline metering taps, LUFS measurement,
//! true peak detection, and dithering.
//!
//! Compiles to WASM for AudioWorklet processing.

pub mod biquad;
pub mod chain;
pub mod crossover;
pub mod dither;
pub mod dynamic_eq;
pub mod eq;
pub mod exciter;
pub mod imager;
pub mod limiter;
pub mod linear_phase_eq;
pub mod match_eq;
pub mod metering;
pub mod multiband;
pub mod true_peak;

use chain::ProofChain;
use wasm_bindgen::prelude::*;
use crate::primitives::sanitize_block;

const NUM_MODULES: usize = 5;
const NUM_TAPS: usize = 6;

/// WASM-exported Proof mastering suite instance for AudioWorklet.
#[wasm_bindgen]
pub struct ProofInstance {
    chain: ProofChain,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl ProofInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 4096;
        Self {
            chain: ProofChain::new(sample_rate as f64),
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
            nan_flush_count: 0,
        }
    }

    pub fn get_input_left_ptr(&mut self) -> *mut f32 {
        self.input_left.as_mut_ptr()
    }
    pub fn get_input_right_ptr(&mut self) -> *mut f32 {
        self.input_right.as_mut_ptr()
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.chain.set_param(name, value);
    }

    /// Reorder the processing chain. Pass 5 module IDs (0=EQ, 1=Dyn, 2=Img, 3=Exc, 4=Lim).
    pub fn reorder(&mut self, m0: u8, m1: u8, m2: u8, m3: u8, m4: u8) {
        self.chain.reorder([m0, m1, m2, m3, m4]);
    }

    /// Process a block. Input must already be written to input buffers.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(4096);

        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

        self.chain.process(
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

    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_right.as_ptr()
    }

    // ── Metering ──────────────────────────────────────────────────────────

    pub fn get_input_lufs(&self) -> f32 {
        self.chain.input_lufs.get_lufs()
    }
    pub fn get_output_lufs(&self) -> f32 {
        self.chain.output_lufs.get_lufs()
    }
    pub fn get_output_st_lufs(&self) -> f32 {
        self.chain.output_st_lufs.get_lufs()
    }
    pub fn get_integrated_lufs(&self) -> f32 {
        self.chain.integrated_lufs.get_lufs()
    }
    pub fn get_true_peak_db(&self) -> f32 {
        self.chain.true_peak.get_true_peak_db()
    }
    pub fn get_lra(&self) -> f32 {
        self.chain.lra.get_lra()
    }
    pub fn get_ab_gain_offset(&self) -> f32 {
        self.chain.ab_gain_offset_db()
    }
    pub fn get_correlation(&self) -> f32 {
        self.chain.imager.get_correlation()
    }
    pub fn get_limiter_gr_db(&self) -> f32 {
        self.chain.limiter.get_gr_db()
    }

    /// Get per-band dynamics gain reduction. Returns 4 values.
    pub fn get_dynamics_gr(&self, band: u32) -> f32 {
        self.chain
            .dynamics
            .get_band_gr()
            .get(band as usize)
            .copied()
            .unwrap_or(0.0)
    }

    /// Get inline meter tap data. tap_idx 0 = input, 1-5 = after each module.
    pub fn get_tap_peak_l(&self, tap_idx: u32) -> f32 {
        self.chain
            .get_tap(tap_idx as usize)
            .map(|t| t.peak_db_l())
            .unwrap_or(-100.0)
    }
    pub fn get_tap_peak_r(&self, tap_idx: u32) -> f32 {
        self.chain
            .get_tap(tap_idx as usize)
            .map(|t| t.peak_db_r())
            .unwrap_or(-100.0)
    }

    pub fn get_module_order(&self) -> Vec<u8> {
        self.chain.get_module_order().to_vec()
    }

    pub fn get_latency_samples(&self) -> u32 {
        self.chain.latency_samples() as u32
    }

    pub fn reset_integrated(&mut self) {
        self.chain.integrated_lufs.reset();
        self.chain.true_peak.reset();
    }
}

