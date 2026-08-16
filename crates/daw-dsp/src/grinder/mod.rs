//! Grinder — Sourdaw's amp simulator, cabinet loader, pedalboard host,
//! and neural-capture playback engine.
//!
//! Hybrid system: white-box circuit modeling + black-box neural capture,
//! low-latency cabinet processing, and progressive-disclosure UX.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod cabinet;
pub mod engine;
pub mod input;
pub mod neural;
pub mod oversample;
pub mod params;
pub mod pedals;
pub mod power_amp;
pub mod tone_stack;
pub mod transformer;
pub mod triode;

use crate::primitives::sanitize_block;
use engine::GrinderEngine;
use params::GRINDER_AUTOMATABLE_PARAM_COUNT;
use wasm_bindgen::prelude::*;

const MAX_GRINDER_BLOCK_SIZE: usize = 2048;
const GRINDER_AUTOMATION_BUFFER_SIZE: usize =
    GRINDER_AUTOMATABLE_PARAM_COUNT + GRINDER_AUTOMATABLE_PARAM_COUNT * MAX_GRINDER_BLOCK_SIZE;

/// WASM-exported Grinder instance for AudioWorklet.
#[wasm_bindgen]
pub struct GrinderInstance {
    engine: GrinderEngine,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
    automation_values: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl GrinderInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        Self {
            engine: GrinderEngine::new(sample_rate),
            input_left: vec![0.0; MAX_GRINDER_BLOCK_SIZE],
            input_right: vec![0.0; MAX_GRINDER_BLOCK_SIZE],
            output_left: vec![0.0; MAX_GRINDER_BLOCK_SIZE],
            output_right: vec![0.0; MAX_GRINDER_BLOCK_SIZE],
            automation_values: vec![0.0; GRINDER_AUTOMATION_BUFFER_SIZE],
            nan_flush_count: 0,
        }
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

    pub fn get_automation_values_ptr(&mut self) -> *mut f32 {
        self.automation_values.as_mut_ptr()
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Clear every amp stage's runtime state without disturbing parameters.
    /// The host calls this on transport stop or seek so filter memories,
    /// envelopes, cabinet ring buffers and meters do not carry the previous
    /// playhead position into the new one.
    pub fn reset(&mut self) {
        self.engine.reset();
    }

    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;
        if size > MAX_GRINDER_BLOCK_SIZE {
            return std::ptr::null();
        }

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

    pub fn process_automated(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;
        if size > MAX_GRINDER_BLOCK_SIZE {
            return std::ptr::null();
        }

        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

        self.engine.process_block_automated(
            &mut self.output_left[..size],
            &mut self.output_right[..size],
            &self.automation_values,
            MAX_GRINDER_BLOCK_SIZE,
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

    pub fn get_input_db(&self) -> f32 {
        self.engine.input_db()
    }
    pub fn get_preamp_db(&self) -> f32 {
        self.engine.preamp_db()
    }
    pub fn get_power_amp_db(&self) -> f32 {
        self.engine.power_amp_db()
    }
    pub fn get_output_db(&self) -> f32 {
        self.engine.output_db()
    }
    pub fn get_gate_open(&self) -> f32 {
        self.engine.gate_open()
    }
    pub fn get_gate_envelope_db(&self) -> f32 {
        self.engine.gate_envelope_db()
    }
    pub fn get_sag_voltage(&self) -> f32 {
        self.engine.sag_voltage()
    }
    pub fn get_latency_samples(&self) -> u32 {
        self.engine.latency_samples()
    }
    /// Static per-tier CPU estimate for the selected neural tier and budget —
    /// not a measurement of the running host. Present it as an expected cost,
    /// never as observed load.
    pub fn get_neural_cpu_percent(&self) -> f32 {
        self.engine.neural_cpu_percent()
    }
    pub fn get_neural_warmup_progress(&self) -> f32 {
        self.engine.neural_warmup_progress()
    }
}

#[cfg(test)]
mod automatable_param_contract {
    use super::params::{
        normalize_automatable_param, GrinderAutomatableParamDomain,
        GRINDER_AUTOMATABLE_PARAM_CONTRACT,
    };

    #[derive(Debug, serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct WebAutomatableParamDescriptor {
        name: String,
        min_value: f32,
        max_value: f32,
        default_value: f32,
        domain: GrinderAutomatableParamDomain,
    }

    #[test]
    fn native_and_web_registries_match() {
        let native = GRINDER_AUTOMATABLE_PARAM_CONTRACT
            .iter()
            .map(|param| {
                (
                    param.name,
                    param.minimum,
                    param.maximum,
                    param.default,
                    param.domain,
                )
            })
            .collect::<Vec<_>>();
        let expected = vec![
            ("gain", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
            ("bass", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
            ("mid", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
            ("treble", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
            (
                "presence",
                0.0,
                10.0,
                5.0,
                GrinderAutomatableParamDomain::Raw,
            ),
            (
                "resonance",
                0.0,
                10.0,
                5.0,
                GrinderAutomatableParamDomain::Raw,
            ),
            ("master", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
            (
                "inputGain",
                -24.0,
                24.0,
                0.0,
                GrinderAutomatableParamDomain::DecibelsToLinear,
            ),
            (
                "outputGain",
                -24.0,
                24.0,
                0.0,
                GrinderAutomatableParamDomain::DecibelsToLinear,
            ),
            (
                "transformerDrive",
                0.0,
                1.0,
                0.3,
                GrinderAutomatableParamDomain::Raw,
            ),
            (
                "negFeedback",
                0.0,
                1.0,
                0.5,
                GrinderAutomatableParamDomain::Raw,
            ),
        ];

        assert_eq!(native, expected);

        let web_contract: Vec<WebAutomatableParamDescriptor> = serde_json::from_str(include_str!(
            "../../../../src/modules/AudioEngine/services/grinderAudioParamContract.json"
        ))
        .expect("web Grinder AudioParam contract must remain valid JSON");
        let web = web_contract
            .iter()
            .map(|param| {
                (
                    param.name.as_str(),
                    param.min_value,
                    param.max_value,
                    param.default_value,
                    param.domain,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            web, native,
            "native and web Grinder parameter registries diverged"
        );
        assert_eq!(normalize_automatable_param("gain", -1.0), Some(0.0));
        assert_eq!(normalize_automatable_param("gain", 12.0), Some(10.0));
        assert_eq!(normalize_automatable_param("inputGain", 12.0), Some(12.0));
        assert_eq!(normalize_automatable_param("outputGain", 30.0), Some(24.0));
        assert_eq!(normalize_automatable_param("negFeedback", f32::NAN), None);
    }
}
