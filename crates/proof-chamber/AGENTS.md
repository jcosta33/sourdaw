# crates/proof-chamber — Agent Guidelines

"Dutch Oven" algorithmic and convolution reverb DSP engine compiling to WebAssembly (`public/wasm/proof-chamber/proof_chamber.wasm`).

## Domain Ownership

- Owns high-performance reverb DSP algorithms (Dattorro Plate, FDN-8, FDN-16, Spring, Reverse, shimmer pitch-shifting, 6-band Decay Rate EQ, and partitioned IR convolution).
- Generates AudioWorklet processor bindings via `scripts/gen-proof-chamber-worklet.ts`.
- Does not own UI presentation (`src/modules/ProofChamber`) or WebAudio send/return routing (`Routing`).

## Real-Time Invariants & Traps

- **Algorithmic Zero Allocation**: Algorithmic reverb modes (Plate, FDN, Spring, Reverse) MUST execute with zero heap allocations on the real-time audio thread (`tests/reverb_process_rt.rs`).
- **Convolution Exception**: Partitioned IR convolution allocates scratch frames at partition boundaries. This allocation is pinned as a measured exception in `reverb_process_rt.rs` and must not be masked.
- **WASM Build Freshness**: DSP modifications require running `pnpm wasm:proof-chamber` and committing updated artifacts in `public/wasm/proof-chamber/`.

## Verification

```bash
cargo test --package proof-chamber
pnpm wasm:proof-chamber
pnpm wasm:verify
```
