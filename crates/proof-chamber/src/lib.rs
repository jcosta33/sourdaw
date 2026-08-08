//! Dutch Oven — Sourdaw's flagship multi-engine reverb.
//!
//! Algorithms: Dattorro plate, FDN-8, FDN-16, Spring, Convolution, Hybrid.
//! Features: shimmer, freeze, gravity, saturation, decay rate EQ, vintage modes.
//! Compiles to both native (Rust library) and WASM (AudioWorklet).

pub mod convolution;
pub mod decay_curve;
pub mod decay_eq;
pub mod early_reflections;
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

/// Replace every non-finite sample (NaN, +Inf, -Inf) in `block` with silence,
/// returning the count scrubbed (DSP-8). A single non-finite sample in a
/// WebAudio output buffer propagates and can silence the whole downstream
/// graph, so the reverb output is scrubbed at the boundary before the buffer
/// pointer is returned to the AudioWorklet. RT-safe: no allocation, one branch
/// per sample.
#[inline]
fn sanitize_block(block: &mut [f32]) -> usize {
    let mut scrubbed = 0;
    for sample in block.iter_mut() {
        if !sample.is_finite() {
            *sample = 0.0;
            scrubbed += 1;
        }
    }
    scrubbed
}

/// Install `console_error_panic_hook` once at wasm module init so a Rust panic
/// surfaces a readable message on the JS console instead of an opaque
/// `unreachable` trap that silently poisons the AudioWorklet instance (WB-6).
/// Wasm-only by construction; the native build is unaffected.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

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

/// An engine that is built and renders, but that no `algorithm` wire value
/// selects.
///
/// Named rather than numbered so the reason travels with the call: these two
/// are convolution-backed, they need an impulse response, and no transport
/// delivers one yet. When one exists, they get wire values in `set_param` and
/// this type goes away.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnexposedEngine {
    Convolution,
    Hybrid,
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
    nan_flush_count: u64,
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
            nan_flush_count: 0,
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
                    6 => ReverbEngine::Reverse(ReverseReverb::new(sr)),
                    // 4 (Convolution) and 5 (Hybrid) are reserved, not free.
                    // Both are built and both render, but both need an impulse
                    // response and nothing can deliver one: `load_ir` has no
                    // caller anywhere in the application and no impulse
                    // responses ship. Selecting either would hand the user an
                    // engine that passes its dry input through and calls the
                    // result reverb, so they fall through to Plate until an IR
                    // transport exists. Their numbers stay assigned, because
                    // this dispatch is a wire format — `algorithm` is written
                    // into project files and replayed verbatim — and reusing 4
                    // or 5 for something else would silently repoint any value
                    // already stored.
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
            ReverbEngine::Spring(s) => {
                s.set_param(name, value);
                if name == "diffusion" {
                    s.set_param("dispersion", value);
                }
            }
            // `decay` is converted to an IR stretch inside the convolution
            // engine itself, so the hybrid path below inherits it unchanged.
            ReverbEngine::Convolution(c) => c.set_param(name, value),
            ReverbEngine::Hybrid(h) => h.set_param(name, value),
            ReverbEngine::Reverse(r) => r.set_param(name, value),
        }
    }

    pub fn set_param_by_id(&mut self, param_id: u32, value: f32) {
        let name = match param_id {
            0 => "mix",
            1 => "decay",
            _ => return,
        };
        self.set_param(name, value);
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

        self.nan_flush_count += sanitize_block(&mut self.out_left[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.out_right[..size]) as u64;

        self.out_left.as_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    pub fn get_right_ptr(&self) -> *const f32 {
        self.out_right.as_ptr()
    }

    /// Report plugin latency in samples for PDC (delay compensation).
    /// The convolution wet path is aligned so every IR tap lands at its
    /// absolute index plus HEAD_SIZE: tail-stage inputs are delayed to their
    /// segment offsets, and the head/dry reference takes the remaining 128.
    pub fn get_latency(&self) -> u32 {
        match &self.engine {
            ReverbEngine::Convolution(_) => 128, // convolution::GLOBAL_LATENCY (HEAD_SIZE)
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
                // The host-facing name is the descriptor's `decay`; `rt60` stays
                // accepted as the seconds-native alias but is not advertised.
                "decay",
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

/// Rust-only affordances, deliberately outside the `#[wasm_bindgen]` block
/// above so none of this reaches the JS surface.
impl ProofChamberInstance {
    /// Switch to an engine no wire value selects.
    ///
    /// Not exported to JS, which is the whole point: the worklet has no way to
    /// call it, so a preset, a project file or a model-emitted parameter write
    /// cannot reach these engines. It exists so they stay under test — the
    /// allocation pin in `tests/reverb_process_rt.rs` needs to drive the
    /// convolution render path — rather than being quietly untested code that
    /// nobody can run at all.
    pub fn select_unexposed_engine(&mut self, which: UnexposedEngine) {
        let sr = self.sample_rate;
        self.engine = match which {
            UnexposedEngine::Convolution => ReverbEngine::Convolution(ConvolutionEngine::new(sr)),
            UnexposedEngine::Hybrid => ReverbEngine::Hybrid(HybridReverb::new(sr)),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::{ProofChamberInstance, UnexposedEngine};
    use assert_no_alloc::{assert_no_alloc, AllocDisabler};

    #[global_allocator]
    static ALLOCATOR: AllocDisabler = AllocDisabler;

    #[test]
    fn convolution_latency_matches_global_alignment_reference() {
        let mut instance = ProofChamberInstance::new(48_000.0);
        // Algorithmic engines report zero latency.
        assert_eq!(instance.get_latency(), 0);

        // Wire value 4 no longer reaches Convolution, so this goes through the
        // Rust-only selector the engine's own tests use.
        instance.select_unexposed_engine(UnexposedEngine::Convolution);
        assert_eq!(
            instance.get_latency(),
            128,
            "tail-stage inputs are delayed to their absolute segment offsets and the head/dry reference takes the remainder, so the aligned wet path's latency is the head size (128)"
        );
    }

    #[test]
    fn numeric_automation_setter_does_not_allocate() {
        let mut instance = ProofChamberInstance::new(48_000.0);

        assert_no_alloc(|| {
            instance.set_param_by_id(0, 0.75);
            instance.set_param_by_id(1, 0.8);
            instance.set_param_by_id(u32::MAX, 0.5);
        });
    }
}
