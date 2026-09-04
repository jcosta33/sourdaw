# crates/proof-chamber — Agent Guidelines

"Dutch Oven" algorithmic and convolution reverb DSP engine compiling to WebAssembly (`public/wasm/proof-chamber/proof_chamber.wasm`).

## Domain Ownership

- Owns high-performance reverb DSP algorithms (Dattorro Plate, FDN-8, FDN-16, Spring, Reverse, shimmer pitch-shifting, 6-band Decay Rate EQ, and partitioned IR convolution).
- Generates AudioWorklet processor bindings via `scripts/gen-proof-chamber-worklet.ts`.
- Does not own UI presentation (`src/modules/ProofChamber`) or WebAudio send/return routing (`Routing`).

## Real-Time Invariants & Traps

- **Algorithmic Zero Allocation**: Algorithmic reverb modes (Plate, FDN, Spring, Reverse) MUST execute with zero heap allocations on the real-time audio thread (`tests/reverb_process_rt.rs`).
- **Selection Allocates Nothing**: `set_param` reaches Rust from the worklet's `port.onmessage`, so _every_ parameter arm is audio-thread code — the algorithm selector included. The engines a wire value can select are built once in `ProofChamberInstance::new`; a switch selects one and calls its `reset`, which reuses those buffers (`algorithm_switch_does_not_allocate`, `the_algorithm_arm_selects_rather_than_constructs`).
- **A Reset Engine Is A Fresh Engine**: `reset` and the constructor must leave an engine in the same state, because the parameter replay after a switch is written against a factory-fresh engine. Every default has two writers, and `tests/engine_reset_is_factory_fresh.rs` renders one against the other rather than trusting them to agree.
- **Convolution Exception**: Partitioned IR convolution allocates scratch frames at partition boundaries. This allocation is pinned as a measured exception in `reverb_process_rt.rs` and must not be masked.
- **WASM Build Freshness**: DSP modifications require running `pnpm wasm:proof-chamber` and committing updated artifacts in `public/wasm/proof-chamber/`.

## Verification

```bash
cargo test --package proof-chamber
pnpm wasm:proof-chamber
pnpm wasm:verify
```
