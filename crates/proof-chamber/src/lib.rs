//! Dutch Oven — Sourdaw's flagship multi-engine reverb.
//!
//! Algorithms: Dattorro plate, FDN-8, FDN-16, Spring, Convolution, Hybrid.
//! Features: shimmer, freeze, gravity, saturation, decay rate EQ, vintage modes.
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod convolution;
pub mod decay_eq;
pub mod fdn;
pub mod hybrid;
pub mod proof_chamber;
pub mod reverse;
pub mod spring;
pub mod vintage;

use convolution::ConvolutionEngine;
use fdn::FdnReverb;
use hybrid::{HybridMode, HybridReverb};
use proof_chamber::ProofChamber;
use reverse::ReverseReverb;
use spring::SpringReverb;
use vintage::{VintageMode, VintageProcessor};
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Algorithm enum
// ---------------------------------------------------------------------------

enum ReverbEngine {
    Plate(ProofChamber),
    Fdn8(FdnReverb),
    Fdn16(FdnReverb),
    Spring(SpringReverb),
    Convolution(ConvolutionEngine),
    Hybrid(HybridReverb),
    Reverse(ReverseReverb),
}

// ---------------------------------------------------------------------------
// WASM instance — unified interface
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct ProofChamberInstance {
    engine: ReverbEngine,
    vintage: VintageProcessor,
    sample_rate: f32,
    out_left: Vec<f32>,
    out_right: Vec<f32>,
}

#[wasm_bindgen]
impl ProofChamberInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let max_block = 1024;
        Self {
            engine: ReverbEngine::Plate(ProofChamber::new(sample_rate)),
            vintage: VintageProcessor::new(sample_rate),
            sample_rate,
            out_left: vec![0.0; max_block],
            out_right: vec![0.0; max_block],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        // Global params
        match name {
            "algorithm" => {
                let sr = self.sample_rate;
                self.engine = match value as u8 {
                    0 => ReverbEngine::Plate(ProofChamber::new(sr)),
                    1 => ReverbEngine::Fdn8(FdnReverb::new(sr, 8)),
                    2 => ReverbEngine::Fdn16(FdnReverb::new(sr, 16)),
                    3 => ReverbEngine::Spring(SpringReverb::new(sr)),
                    4 => ReverbEngine::Convolution(ConvolutionEngine::new(sr)),
                    5 => ReverbEngine::Hybrid(HybridReverb::new(sr)),
                    6 => ReverbEngine::Reverse(ReverseReverb::new(sr)),
                    _ => ReverbEngine::Plate(ProofChamber::new(sr)),
                };
                return;
            }
            "vintage" => {
                self.vintage.set_mode(match value as u8 {
                    0 => VintageMode::Modern,
                    1 => VintageMode::Eighties,
                    2 => VintageMode::Seventies,
                    _ => VintageMode::Modern,
                });
                return;
            }
            _ => {}
        }

        // Forward to current engine
        match &mut self.engine {
            ReverbEngine::Plate(p) => p.set_param(name, value),
            ReverbEngine::Fdn8(f) | ReverbEngine::Fdn16(f) => f.set_param(name, value),
            ReverbEngine::Spring(s) => s.set_param(name, value),
            ReverbEngine::Convolution(c) => c.set_param(name, value),
            ReverbEngine::Hybrid(h) => h.set_param(name, value),
            ReverbEngine::Reverse(r) => r.set_param(name, value),
        }
    }

    /// Load an IR for the convolution engine.
    pub fn load_ir(&mut self, ir_data: Vec<f32>, channels: u8) {
        match &mut self.engine {
            ReverbEngine::Convolution(c) => c.load_ir(&ir_data, channels as usize),
            ReverbEngine::Hybrid(h) => h.convolution.load_ir(&ir_data, channels as usize),
            _ => {}
        }
    }

    pub fn process(&mut self, left_in: &[f32], right_in: &[f32], frames: u32) -> *const f32 {
        let size = (frames as usize).min(1024);
        self.out_left[..size].copy_from_slice(&left_in[..size]);
        self.out_right[..size].copy_from_slice(&right_in[..size]);

        match &mut self.engine {
            ReverbEngine::Plate(p) => {
                p.process(&mut self.out_left[..size], &mut self.out_right[..size])
            }
            ReverbEngine::Fdn8(f) | ReverbEngine::Fdn16(f) => {
                f.process(&mut self.out_left[..size], &mut self.out_right[..size])
            }
            ReverbEngine::Spring(s) => {
                s.process(&mut self.out_left[..size], &mut self.out_right[..size])
            }
            ReverbEngine::Convolution(c) => {
                c.process(&mut self.out_left[..size], &mut self.out_right[..size])
            }
            ReverbEngine::Hybrid(h) => {
                h.process(&mut self.out_left[..size], &mut self.out_right[..size])
            }
            ReverbEngine::Reverse(r) => {
                r.process(&mut self.out_left[..size], &mut self.out_right[..size])
            }
        }

        // Apply vintage character
        self.vintage
            .process(&mut self.out_left[..size], &mut self.out_right[..size]);

        self.out_left.as_ptr()
    }

    pub fn get_right_ptr(&self) -> *const f32 {
        self.out_right.as_ptr()
    }

    /// Report plugin latency in samples for PDC (delay compensation).
    /// The convolution head size is the minimum latency.
    pub fn get_latency(&self) -> u32 {
        match &self.engine {
            ReverbEngine::Convolution(_) => 128, // HEAD_SIZE
            ReverbEngine::Hybrid(_) => 128,
            _ => 0, // algorithmic reverbs have zero latency
        }
    }

    pub fn get_param_names(&self) -> String {
        let mut names: Vec<&str> = vec!["algorithm", "vintage"];
        let engine_names: Vec<&str> = match &self.engine {
            ReverbEngine::Plate(p) => p.param_names(),
            ReverbEngine::Fdn8(_) | ReverbEngine::Fdn16(_) => vec![
                "mix",
                "rt60",
                "damping",
                "predelay",
                "size",
                "mod_depth",
                "early_late",
                "matrix",
                "saturation",
            ],
            ReverbEngine::Spring(s) => s.param_names(),
            ReverbEngine::Convolution(c) => c.param_names(),
            ReverbEngine::Hybrid(h) => h.param_names(),
            ReverbEngine::Reverse(r) => r.param_names(),
        };
        names.extend(engine_names);
        serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
    }
}
