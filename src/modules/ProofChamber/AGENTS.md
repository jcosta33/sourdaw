# ProofChamber module — Agent Guidelines

"Dutch Oven" algorithmic reverb and spatial chamber effect (Plate, FDN-8, FDN-16, Spring, Reverse reverb, per-band decay rate EQ, shimmer pitch-shifting, and impulse response loading); does not own auxiliary send/return track routing (Arrangement/MixerConsole).

## Public Contract Surface

- **Views** (`presentations/views/index.ts`): `ProofChamberPanel`.
- **Stores**: `chamberStore` (`stores/chamberStore.ts`).
- **Use Cases**: Internal use cases (`decodeImpulseResponse`, `hydrateChamberStateFromProject`, `updateChamberEngine`, `registerChamberInstance`).
- **Events**: No public events.

## Key Subsystems

- **Reverb Models** (`models/ProofChamberState.ts`): Reverb algorithm types (`PROOF_CHAMBER_ALGORITHMS`: `['plate', 'fdn-8', 'fdn-16', 'spring', 'reverse']`), space models, plate saturation curves, and 6-band Decay Rate EQ (`decayEq0`..`decayEq5`).
- **Algorithm Gating** (`models/ProofChamberAlgorithmGating.ts`): Parameter availability rules per active reverb algorithm.
- **DSP Engine Bridge** (`useCases/proofChamber/`): IR file decoding, project state hydration, and WebAudio/WASM node parameter synchronization.
- **Rust DSP Crate** (`crates/proof-chamber/`): Independent Rust DSP crate compiling to WASM (`public/wasm/proof_chamber.wasm`).

## Invariants & Traps

- The user-facing device ID is "Dutch Oven", but the owning module is `ProofChamber` (there is no separate Dutch Oven module).
- Algorithmic modes (Plate, FDN) run with zero allocations on the real-time audio thread. Convolution IR mode builds scratch frames per partition boundary and is pinned as an allocation exception in `crates/proof-chamber/tests/reverb_process_rt.rs`.
- Decay Rate EQ parameters are 6 distinct flat fields (`decayEq0`..`decayEq5`) rather than an array to match single-key parameter mapping and Automerge persistence.

## Verification

- `pnpm vitest run src/modules/ProofChamber`
- `cargo test --package proof-chamber`
- `pnpm deps:validate`
