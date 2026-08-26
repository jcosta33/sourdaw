# Grinder module — Agent Guidelines

Guitar amplifier modeler, Neural Amp Modeler (NAM) host, cabinet impulse response (IR) convolver, and multi-effects pedalboard chain; does not own track routing or global project preset management (AudioEngine/Project).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `loadGrinderPatchWithAudio`, `moveGrinderPedalInChainWithAudio`, `recallGrinderSnapshotWithAudio`, `setGrinderMicParamWithAudio`, `setGrinderParamWithAudio`, `setGrinderPedalParamWithAudio`, `exportGrinderNeuralModel`, `importGrinderNeuralModels`, `removeGrinderNeuralModel`, `restoreGrinderNeuralLibrary`, `grinderPresets`.
- **Stores** (`stores/index.ts`): `grinderStore`, `grinderNeuralLibraryStore`, `grinderTelemetryStore`.
- **Views** (`presentations/views/index.ts`): `GrinderPanel`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Patch Model** (`models/GrinderPatch.ts`): Patch state for pre/post-amp pedalboard slots, preamp models, tone stack, power amp, cabinet IR slots, dual microphone parameters, and NAM neural models.
- **NAM Parser & Neural Host** (`services/parseGrinderNamFile.ts`): Parses `.nam` neural network weights and metadata JSON files for inference in WASM/native.
- **Neural Library Persistence** (`repositories/neuralLibraryPersistence/`): Storage for imported neural models with lock safety (`withGrinderNeuralLibraryWriteLock`).
- **Param Bridge** (`useCases/grinderParamBridge/`): Streams pedal reordering, mic adjustments, and snapshot recalls to the audio node.

## Invariants & Traps

- Output level at the engine boundary is pinned to a strict ±1 dB band with a −0.3 dB safety limiter idle at shipped defaults (`crates/daw-dsp/tests/engine_output_level.rs`). Any tonal or stage changes must verify output level calibration.
- NAM model loading and IR parsing allocate only during file load; real-time block rendering in `daw-dsp::grinder` is strictly non-allocating and non-blocking.
- Pedal reordering must synchronize both the UI chain order and the audio DSP node routing simultaneously.

## Verification

- `pnpm vitest run src/modules/Grinder`
- `cargo test --package daw-dsp -- grinder`
- `pnpm deps:validate`
