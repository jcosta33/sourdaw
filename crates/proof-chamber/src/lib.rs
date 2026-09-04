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
pub mod output_stage;
pub mod proof_chamber;
pub mod reverse;
pub mod spring;
pub mod vintage;

use convolution::ConvolutionEngine;
use fdn::FdnReverb;
use hybrid::HybridReverb;
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

/// Which engine renders.
///
/// The five a wire value selects carry nothing: their engines are built once in
/// `ProofChamberInstance::new` and live in `ExposedEngines`, so this enum is
/// only a discriminant. That is what makes `set_param("algorithm", …)`
/// allocation-free — it arrives from the AudioWorklet's `port.onmessage`, on
/// the render thread, and it used to construct the engine it selected (#3307).
///
/// The two convolution-backed variants carry theirs instead, because no wire
/// value constructs them: `select_unexposed_engine` is Rust-only, off the audio
/// thread, and free to allocate. The consequence is that leaving one — which
/// only that same Rust-only path can arrive at — drops it, so a `set_param`
/// reached with one of these live frees a buffer. That is the crate's existing
/// convolution exception rather than a new one; nothing on the wire can put an
/// instance into that state.
enum ReverbEngine {
    Plate,
    Fdn8,
    Fdn16,
    Spring,
    Reverse,
    Convolution(Box<ConvolutionEngine>),
    Hybrid(Box<HybridReverb>),
}

/// Every engine an `algorithm` write can select, all of them allocated once.
///
/// Held together rather than switched between, because the switch runs on the
/// render thread: an FDN-16 built there allocates sixteen delay lines and a
/// pre-delay buffer inside a 2.67 ms quantum, and a malloc that misses the
/// deadline is an audible dropout. The one that becomes active is put back to
/// its constructor state by `reset`, which reuses these allocations.
struct ExposedEngines {
    plate: ProofChamber,
    fdn8: FdnReverb,
    fdn16: FdnReverb,
    spring: SpringReverb,
    reverse: ReverseReverb,
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
// Parameter cache
// ---------------------------------------------------------------------------

/// Longest parameter name the cache stores, in bytes.
///
/// The longest name any engine answers to is `saturation_type` (15), so this
/// is roughly double the requirement. A longer name is not cached rather than
/// truncated — a truncated key would collide with a real one and replay the
/// wrong value into the wrong arm. It is still forwarded live, so the cached
/// set is a subset of the forwarded set rather than equal to it; the bound is
/// what keeps that subset total in practice.
const MAX_CACHED_NAME_LEN: usize = 32;

/// How many distinct forwarded names the cache holds.
///
/// The union of every exposed engine's `get_param_names` is 24, of which 22
/// are cacheable once `algorithm` and `vintage` are excluded. The headroom
/// covers the engine-native aliases that are accepted but not advertised
/// (`rt60`, `rt60_hf`, `feedback`, `reverse_time`, `dispersion`,
/// `ir_stretch`, the six `ir_eq_*`, `hybrid_mode`, `hybrid_blend`,
/// `conv_mix`) and anything a preset or a model-emitted write invents.
///
/// The limit is a bound, not a policy: it exists because growing the backing
/// store would allocate on the audio thread. Past it `record` evicts the
/// least-recently-written entry rather than refusing the incoming one — see
/// there for why that direction.
const PARAMETER_CACHE_CAPACITY: usize = 64;

/// One remembered `set_param` write.
///
/// The name is stored inline rather than as a `String` because `set_param` is
/// reached from the audio thread: `String::from(name)` would allocate on the
/// first write of every name, and `tests/reverb_process_rt.rs` plus
/// `numeric_automation_setter_does_not_allocate` both pin that it does not.
#[derive(Clone, Copy)]
struct CachedParameter {
    name: [u8; MAX_CACHED_NAME_LEN],
    name_len: usize,
    value: f32,
}

impl CachedParameter {
    fn new(name: &str, value: f32) -> Option<Self> {
        let bytes = name.as_bytes();
        if bytes.len() > MAX_CACHED_NAME_LEN {
            return None;
        }
        let mut stored = [0_u8; MAX_CACHED_NAME_LEN];
        stored[..bytes.len()].copy_from_slice(bytes);
        Some(Self {
            name: stored,
            name_len: bytes.len(),
            value,
        })
    }

    fn name(&self) -> &str {
        // The bytes were copied whole out of a `&str`, so the prefix is valid
        // UTF-8 by construction. The fallback exists so this is not a panic
        // site on the audio thread; it is unreachable.
        core::str::from_utf8(&self.name[..self.name_len]).unwrap_or("")
    }
}

/// Every parameter write that has been forwarded to an engine, in
/// most-recent-write order, so a newly selected engine can be handed the
/// state its predecessor was running with.
///
/// # Why this lives in the instance and not at the action layer
///
/// `set_param("algorithm", n)` puts the engine it selects back to its
/// constructor state. Something has to re-tell that engine what the user had
/// set, and the obvious place to do it looked like the write path: after
/// dispatching the algorithm change, re-dispatch every other parameter.
///
/// That layer cannot host it. The replay has to be sourced from project truth
/// (`Device.parameterValues`) rather than a panel store, or it writes stale
/// values back into the CRDT and out to peers. But `handleSetDeviceParameter`
/// reports `isNoop` when the incoming value already equals the stored one, and
/// `executeAppActionBatch` skips every action whose handler reports it — so
/// sourcing the replay from truth makes every replayed action a no-op by
/// construction. The two requirements contradict each other.
///
/// The category error is treating a resync as a state change. Nothing about
/// project state changed when the algorithm did; the *engine* lost its state,
/// and `executeAppAction`'s no-op filter is correct for the job it actually
/// has. So the resync belongs where the loss happens, which is here.
///
/// The layer also decides the blast radius. `set_param` is the one choke point
/// every writer passes through — the device panel, the space tiles, the
/// generic Inspector fallback, MIDI learn, automation, undo, remote peers and
/// the `projectTrackToLiveStrip` projection — so a writer that has never heard
/// of the cache cannot bypass it. A replay bolted onto any one of those
/// writers would fix that writer only.
///
/// # What is cached
///
/// Exactly the names that reach an engine, which is enforced structurally:
/// `record` is called immediately before the forward, after `algorithm` and
/// `vintage` have already returned. Those two are instance state, not engine
/// state — `algorithm` *is* the selection and `vintage` lives on a
/// processor that survives it — so replaying either into an engine would be
/// wrong.
///
/// Everything else is cached, **including names the current engine drops**.
/// `gravity` means nothing to the spring and `matrix` means nothing to the
/// plate, but a cache that only remembered what the selected engine reads
/// would forget them while passing through, and the destination engine that
/// does read them would come back to defaults. That is the recurring shape of
/// this defect, one level down.
///
/// # Ordering
///
/// Entries replay in most-recent-write order, which is why this is a `Vec` and
/// not a map: map iteration order is unspecified, and some arms are
/// order-sensitive. `set_param` forwards `diffusion` to the spring and then
/// derives `dispersion` from it, so whichever of the two was written last
/// decides the allpass coefficients. Replaying in first-insertion order would
/// invert that pair whenever the earlier-introduced name was rewritten later.
/// `tests/algorithm_switch_parameter_retention.rs` discriminates the two.
///
/// # Prior latch exception eliminated
///
/// This is a cache of values, not a log of writes, so any latch fired by a value
/// that was later overwritten would not be reproduced. Previously,
/// `ProofChamber::set_param`'s `freeze` arm switched `shimmer.enabled` off as a
/// side effect, leaving shimmer permanently silenced after `freeze` was turned
/// off until a round trip or re-send restored it.
///
/// Shimmer is now dynamically derived at process time (`shimmer && !freeze`),
/// exactly as `decay`, `input_gain`, and `damp` are, eliminating that
/// write-latch asymmetry. Both the live engine and a round trip now agree with
/// the cached parameters.
struct ParameterCache {
    entries: Vec<CachedParameter>,
}

impl ParameterCache {
    fn new() -> Self {
        Self {
            entries: Vec::with_capacity(PARAMETER_CACHE_CAPACITY),
        }
    }

    /// Remember `name = value`, moving an existing name to the back so the
    /// order of entries is the order the writes last arrived in.
    ///
    /// RT-safe: the backing store is allocated once at construction and the
    /// capacity guard below keeps it from growing, so neither the rewrite path
    /// (`remove` + `push` within capacity, a memmove of at most 64 small Copy
    /// structs) nor the insert path allocates.
    fn record(&mut self, name: &str, value: f32) {
        if let Some(index) = self.entries.iter().position(|entry| entry.name() == name) {
            let mut entry = self.entries.remove(index);
            entry.value = value;
            self.entries.push(entry);
            return;
        }

        // A full cache evicts its oldest entry rather than refusing the write
        // that has just arrived. Refusing it is the worse direction by some
        // distance: the incoming name would be forwarded live and then
        // dropped at the next algorithm switch, which is #1544 again, silently
        // and permanently for that name — while the entry being protected is
        // the one nobody has touched for longest. Entries are already held in
        // recency order, so the victim is the front.
        //
        // Unreachable through any writer that exists: `ProofChamberNode`
        // sends descriptor ids, the `dutch-oven` descriptor declares 22
        // forwarded ids, and the accepted aliases take the union to the low
        // thirties against a limit of 64. The arm is here because
        // `handleSetDeviceParameter` does no descriptor validation and
        // `parameterValues` is an unvalidated string-keyed CRDT map, so the
        // limit is reachable in principle by something that invents names.
        if self.entries.len() >= PARAMETER_CACHE_CAPACITY {
            self.entries.remove(0);
        }

        if let Some(entry) = CachedParameter::new(name, value) {
            self.entries.push(entry);
        }
    }
}

// ---------------------------------------------------------------------------
// WASM instance — unified interface
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct ProofChamberInstance {
    engines: ExposedEngines,
    active: ReverbEngine,
    vintage: VintageProcessor,
    sample_rate: f32,
    out_left: Vec<f32>,
    out_right: Vec<f32>,
    nan_flush_count: u64,
    params: ParameterCache,
    fdn_damping_version: u8,
}

#[wasm_bindgen]
impl ProofChamberInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let max_block = 1024;
        Self {
            engines: ExposedEngines {
                plate: ProofChamber::new(sample_rate),
                fdn8: FdnReverb::new(sample_rate, 8),
                fdn16: FdnReverb::new(sample_rate, 16),
                spring: SpringReverb::new(sample_rate),
                reverse: ReverseReverb::new(sample_rate),
            },
            active: ReverbEngine::Plate,
            vintage: VintageProcessor::new(sample_rate),
            sample_rate,
            out_left: vec![0.0; max_block],
            out_right: vec![0.0; max_block],
            nan_flush_count: 0,
            // Empty, so an instance that is never written to renders its
            // constructor defaults and a first `algorithm` write replays
            // nothing into the engine it builds.
            params: ParameterCache::new(),
            // Missing from legacy project parameter maps by design.
            fdn_damping_version: 1,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        // Global params
        match name {
            "fdn_damping_version" => {
                self.fdn_damping_version = match value {
                    1.0 => 1,
                    2.0 => 2,
                    _ => return,
                };
                self.apply_fdn_damping_version();
                return;
            }
            "algorithm" => {
                self.active = match value as u8 {
                    0 => ReverbEngine::Plate,
                    1 => ReverbEngine::Fdn8,
                    2 => ReverbEngine::Fdn16,
                    3 => ReverbEngine::Spring,
                    6 => ReverbEngine::Reverse,
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
                    _ => ReverbEngine::Plate,
                };
                // The engine selected above is still holding the tail and the
                // parameter values it had when it was last live. This is what
                // the reconstruction that used to stand here produced for free,
                // and what the replay below is written against: it puts the
                // engine back to exactly its constructor state, reusing the
                // buffers it already owns rather than allocating new ones.
                self.reset_active_engine();
                self.apply_fdn_damping_version();
                // The engine above is factory-fresh and knows nothing about
                // the sound the user had built. Without this line every
                // parameter is discarded on every algorithm change, which is
                // measurable as a round-tripped plate rendering bit-identical
                // to one that was never told anything (#1544).
                self.replay_cached_parameters();
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

        // Remembered here rather than anywhere earlier, so the cache holds
        // exactly the set of names that reach an engine: `algorithm` and
        // `vintage` have already returned above, and everything past this
        // point is forwarded. Recording before the forward also means a name
        // the current engine drops is still remembered for one that reads it.
        self.params.record(name, value);
        self.forward_to_engine(name, value);
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
        match &mut self.active {
            ReverbEngine::Convolution(c) => c.load_ir(&ir_data, channels as usize),
            ReverbEngine::Hybrid(h) => h.convolution.load_ir(&ir_data, channels as usize),
            _ => {}
        }
    }

    pub fn process(&mut self, left_in: &[f32], right_in: &[f32], frames: u32) -> *const f32 {
        let size = (frames as usize).min(1024);
        self.out_left[..size].copy_from_slice(&left_in[..size]);
        self.out_right[..size].copy_from_slice(&right_in[..size]);

        // One match on the active discriminant per block, exactly as before:
        // the engines moved out of the enum, the dispatch did not change shape
        // and no per-sample branch was added.
        match &mut self.active {
            ReverbEngine::Plate => self
                .engines
                .plate
                .process(&mut self.out_left[..size], &mut self.out_right[..size]),
            ReverbEngine::Fdn8 => self
                .engines
                .fdn8
                .process(&mut self.out_left[..size], &mut self.out_right[..size]),
            ReverbEngine::Fdn16 => self
                .engines
                .fdn16
                .process(&mut self.out_left[..size], &mut self.out_right[..size]),
            ReverbEngine::Spring => self
                .engines
                .spring
                .process(&mut self.out_left[..size], &mut self.out_right[..size]),
            ReverbEngine::Reverse => self
                .engines
                .reverse
                .process(&mut self.out_left[..size], &mut self.out_right[..size]),
            ReverbEngine::Convolution(c) => {
                c.process(&mut self.out_left[..size], &mut self.out_right[..size])
            }
            ReverbEngine::Hybrid(h) => {
                h.process(&mut self.out_left[..size], &mut self.out_right[..size])
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
        match &self.active {
            ReverbEngine::Convolution(_) => 128, // convolution::GLOBAL_LATENCY (HEAD_SIZE)
            ReverbEngine::Hybrid(_) => 128,
            _ => 0, // algorithmic reverbs have zero latency
        }
    }

    pub fn get_param_names(&self) -> String {
        let mut names: Vec<&str> = vec!["algorithm", "vintage"];
        let engine_names: Vec<&str> = match &self.active {
            ReverbEngine::Plate => self.engines.plate.param_names(),
            ReverbEngine::Fdn8 | ReverbEngine::Fdn16 => {
                let mut names = vec![
                    "mix",
                    // The host-facing name is the descriptor's `decay`; `rt60`
                    // stays accepted as the seconds-native alias but is not
                    // advertised.
                    "decay",
                    "damping",
                    "predelay",
                    "size",
                    "mod_depth",
                    "early_late",
                    "matrix",
                    "saturation",
                ];
                names.extend(decay_eq::PARAM_NAMES);
                names.extend(output_stage::OutputStage::PARAM_NAMES);
                names.push(output_stage::OutputStage::WIDTH);
                names
            }
            ReverbEngine::Spring => self.engines.spring.param_names(),
            ReverbEngine::Reverse => self.engines.reverse.param_names(),
            ReverbEngine::Convolution(c) => c.param_names(),
            ReverbEngine::Hybrid(h) => h.param_names(),
        };
        names.extend(engine_names);
        serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
    }
}

/// Rust-only affordances, deliberately outside the `#[wasm_bindgen]` block
/// above so none of this reaches the JS surface.
impl ProofChamberInstance {
    /// Hand `name = value` to whichever engine is currently selected.
    ///
    /// One function rather than a call at each site, so the two callers — a
    /// live write and a replayed one — provably take the same path. A replay
    /// that went straight to an engine's `set_param` would skip the spring's
    /// derived `dispersion` write below and silently diverge from what a live
    /// write does.
    fn forward_to_engine(&mut self, name: &str, value: f32) {
        match &mut self.active {
            ReverbEngine::Plate => self.engines.plate.set_param(name, value),
            ReverbEngine::Fdn8 => self.engines.fdn8.set_param(name, value),
            ReverbEngine::Fdn16 => self.engines.fdn16.set_param(name, value),
            ReverbEngine::Spring => {
                self.engines.spring.set_param(name, value);
                if name == "diffusion" {
                    self.engines.spring.set_param("dispersion", value);
                }
            }
            ReverbEngine::Reverse => self.engines.reverse.set_param(name, value),
            // `decay` is converted to an IR stretch inside the convolution
            // engine itself, so the hybrid path below inherits it unchanged.
            ReverbEngine::Convolution(c) => c.set_param(name, value),
            ReverbEngine::Hybrid(h) => h.set_param(name, value),
        }
    }

    /// Tell the selected engine which damping curve the instance is on, if it
    /// is one of the two that has one.
    fn apply_fdn_damping_version(&mut self) {
        let version = self.fdn_damping_version;
        match &self.active {
            ReverbEngine::Fdn8 => self.engines.fdn8.set_damping_version(version),
            ReverbEngine::Fdn16 => self.engines.fdn16.set_damping_version(version),
            _ => {}
        }
    }

    /// Put the selected engine back into the state its constructor leaves it
    /// in, reusing every buffer it already owns.
    ///
    /// This is the whole of what the `algorithm` arm's reconstruction used to
    /// buy, minus the allocation: an engine that was live earlier is still
    /// carrying its tail and the parameters written to it, and the replay that
    /// follows a switch assumes a factory-fresh engine underneath it.
    fn reset_active_engine(&mut self) {
        match &mut self.active {
            ReverbEngine::Plate => self.engines.plate.reset(),
            ReverbEngine::Fdn8 => self.engines.fdn8.reset(),
            ReverbEngine::Fdn16 => self.engines.fdn16.reset(),
            ReverbEngine::Spring => self.engines.spring.reset(),
            ReverbEngine::Reverse => self.engines.reverse.reset(),
            // Constructed on selection rather than kept, so one that is live
            // is already as fresh as `select_unexposed_engine` left it.
            ReverbEngine::Convolution(_) | ReverbEngine::Hybrid(_) => {}
        }
    }

    /// Switch to an engine no wire value selects.
    ///
    /// Not exported to JS, which is the whole point: the worklet has no way to
    /// call it, so a preset, a project file or a model-emitted parameter write
    /// cannot reach these engines. It exists so they stay under test — the
    /// allocation pin in `tests/reverb_process_rt.rs` needs to drive the
    /// convolution render path — rather than being quietly untested code that
    /// nobody can run at all.
    ///
    /// This is the one selection that still *constructs*, and it is allowed to:
    /// it is not reachable from the audio thread, and preallocating a
    /// partitioned convolution into every instance to spare an allocation no
    /// worklet can trigger would cost every project memory for an engine
    /// nothing can select.
    pub fn select_unexposed_engine(&mut self, which: UnexposedEngine) {
        let sr = self.sample_rate;
        self.active = match which {
            UnexposedEngine::Convolution => {
                ReverbEngine::Convolution(Box::new(ConvolutionEngine::new(sr)))
            }
            UnexposedEngine::Hybrid => ReverbEngine::Hybrid(Box::new(HybridReverb::new(sr))),
        };
        // Same replay as the wire path, so this site cannot drift into the
        // defect that one came out of. What the replay does not carry is the
        // impulse response: `load_ir` state is not a parameter and is not
        // cached, so a reconstruction still drops it. That is the
        // same defect shape one level down, and it is not fixed here because
        // `load_ir` has no caller anywhere in the application — when a
        // transport for it exists, it needs the same treatment.
        self.replay_cached_parameters();
    }

    /// Re-tell the current engine every parameter that has been written since
    /// construction, in the order those writes last arrived.
    ///
    /// Indexed rather than iterated because the loop needs the cache and the
    /// engine at once; `CachedParameter` is `Copy`, so each entry is lifted
    /// out and the borrow of `self.params` ends before the forward.
    ///
    /// Every write here is a `set_param` forward and nothing more, so this runs
    /// under the same allocation contract as a live automation write: an
    /// `algorithm` change reaches it from the render thread, and
    /// `algorithm_switch_does_not_allocate` pins that the whole path is silent
    /// to the allocator.
    ///
    /// It used to say allocation happened here, because it only ever followed
    /// an engine construction that had just allocated every delay buffer, and
    /// because an FDN `size` write rebuilt its delay table. Neither is true:
    /// the tank is allocated once for its longest reachable delay
    /// (`crates/proof-chamber/tests/fdn_size_automation_rt.rs`), and the
    /// selection ahead of this resets a preallocated engine rather than
    /// building one (#3307).
    fn replay_cached_parameters(&mut self) {
        for index in 0..self.params.entries.len() {
            let entry = self.params.entries[index];
            self.forward_to_engine(entry.name(), entry.value);
        }
    }

    /// Return the active engine to its constructor defaults, clear the parameter
    /// cache, and clear output buffers.
    pub fn reset(&mut self) {
        self.reset_active_engine();
        self.apply_fdn_damping_version();
        self.params = ParameterCache::new();
        self.out_left.fill(0.0);
        self.out_right.fill(0.0);
        self.nan_flush_count = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::{ProofChamberInstance, ReverbEngine, UnexposedEngine};
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

    /// Every wire value a stored `algorithm` can hold, plus one that no arm
    /// claims: the fallthrough used to construct a plate, so a rejected value
    /// paid the same allocation a real one did.
    const WIRE_VALUES: [f32; 6] = [0.0, 1.0, 2.0, 3.0, 6.0, 9.0];

    #[test]
    fn algorithm_switch_does_not_allocate() {
        // #3307. `ProofChamberInstance::set_param` is called from the
        // AudioWorklet's `port.onmessage`, which runs in
        // `AudioWorkletGlobalScope` — the render thread — and the `algorithm`
        // arm used to build the selected engine there: sixteen delay lines and
        // a pre-delay buffer for FDN-16, inside a 2.67 ms quantum.
        //
        // A violation aborts the process with `memory allocation of N bytes
        // failed` rather than failing this assertion, because
        // `assert_no_alloc`'s handler calls `std::alloc::handle_alloc_error`.
        let mut instance = ProofChamberInstance::new(48_000.0);

        // Written to before the switches so the replay has entries to carry:
        // an empty cache would leave `replay_cached_parameters` iterating
        // nothing, and the replay is on the same audio-thread path.
        instance.set_param("mix", 0.7);
        instance.set_param("decay", 0.62);
        instance.set_param("size", 0.37);
        instance.set_param("diffusion", 0.72);
        instance.set_param("shimmer", 1.0);
        instance.set_param("fdn_damping_version", 2.0);

        assert_no_alloc(|| {
            for value in WIRE_VALUES {
                instance.set_param("algorithm", value);
            }
            // And back down, so every ordered pair of engines is entered from
            // something other than the plate at least once.
            for value in WIRE_VALUES.iter().rev() {
                instance.set_param("algorithm", *value);
            }
        });
    }

    /// The source between `start` and `end`, with both anchors required to be
    /// unique so the span cannot silently widen or land somewhere else.
    fn span_between<'a>(source: &'a str, label: &str, start: &str, end: &str) -> &'a str {
        for anchor in [start, end] {
            assert_eq!(
                source.matches(anchor).count(),
                1,
                "`{label}` is anchored on `{anchor}`, which no longer appears \
                 exactly once in the production source"
            );
        }
        let from = source.find(start).expect("anchor counted above");
        let to = source.find(end).expect("anchor counted above");
        assert!(to > from, "`{label}` anchors are out of order");
        &source[from..to]
    }

    #[test]
    fn the_algorithm_arm_selects_rather_than_constructs() {
        // The allocation guard above only reds while the engines it drives stay
        // allocation-free to build. This one is about the shape of the code:
        // the defect was a constructor call on the switch path, so that path is
        // asserted to hold none. Same instrument as
        // `audio_thread_handle_uses_only_derived_thread_traits` in
        // `crates/daw-engine/src/audio_thread.rs`.
        //
        // The scan covers `reset_active_engine` as well as the arm itself,
        // because the arm delegates the per-engine work to it: an arm holding
        // no constructor still reaches one if the method it calls builds the
        // engine instead of resetting it, which is the same defect one frame
        // down the stack.
        //
        // Everything below `mod tests` is cut off first: the anchors are
        // written out again here, and a scan over its own anchors is a scan
        // over nothing in particular.
        let source = include_str!("lib.rs");
        let production = &source[..source
            .find("mod tests {")
            .expect("this module still declares itself above its anchor literals")];

        // `reset_active_engine` runs to the next item, so that item's doc
        // comment is inside the span. That is slack, not a hole — a doc comment
        // naming a constructor is not a call, and the alternative is matching
        // braces in a substring scan.
        let spans = [
            span_between(
                production,
                "the `algorithm` arm",
                "\"algorithm\" => {",
                "\"vintage\" =>",
            ),
            span_between(
                production,
                "`reset_active_engine`",
                "fn reset_active_engine(&mut self) {",
                "pub fn select_unexposed_engine",
            ),
        ];

        for span in spans {
            assert!(
                !span.contains("::new("),
                "the algorithm switch path constructs an engine again (#3307); \
                 it runs on the render thread, so it must select one of the \
                 engines built in `ProofChamberInstance::new` and reset it"
            );
        }
    }

    fn fdn_hf_ratio(instance: &ProofChamberInstance) -> f32 {
        let reverb = match &instance.active {
            ReverbEngine::Fdn8 => &instance.engines.fdn8,
            ReverbEngine::Fdn16 => &instance.engines.fdn16,
            _ => panic!("expected an FDN engine"),
        };
        reverb.rt60_hf / reverb.rt60
    }

    #[test]
    fn damping_version_survives_algorithm_reconstruction() {
        let mut instance = ProofChamberInstance::new(48_000.0);
        instance.set_param("fdn_damping_version", 2.0);
        instance.set_param("damping", 0.3);
        instance.set_param("algorithm", 1.0);
        assert!((fdn_hf_ratio(&instance) - 0.5).abs() < 1e-6);

        instance.set_param("algorithm", 0.0);
        instance.set_param("algorithm", 2.0);
        assert!((fdn_hf_ratio(&instance) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn missing_damping_version_preserves_legacy_project_sound() {
        let mut instance = ProofChamberInstance::new(48_000.0);
        instance.set_param("damping", 0.3);
        instance.set_param("algorithm", 1.0);
        assert!((fdn_hf_ratio(&instance) - 0.35).abs() < 1e-6);
    }

    #[test]
    fn unknown_damping_version_does_not_select_or_replace_supported_semantics() {
        let mut instance = ProofChamberInstance::new(48_000.0);
        instance.set_param("fdn_damping_version", 3.0);
        instance.set_param("damping", 0.3);
        instance.set_param("algorithm", 1.0);
        assert!((fdn_hf_ratio(&instance) - 0.35).abs() < 1e-6);

        instance.set_param("fdn_damping_version", 2.0);
        instance.set_param("fdn_damping_version", 3.0);
        assert!((fdn_hf_ratio(&instance) - 0.5).abs() < 1e-6);
    }
}
