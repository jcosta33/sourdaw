# GrandBoule module — Agent Guidelines

Acoustic grand piano physical modeling and multi-sample virtual instrument (string resonance, soundboard radiation, hammer attack modeling, una corda/sustain pedals, per-note parameter editing, and piano morphing); does not own MIDI track capture or audio track routing (Arrangement/AudioEngine).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`, `presentations/views/index.ts`.

## Key Subsystems

- **Engine Handle** (`repositories/grandBouleEngineHandle.ts`, `useCases/resolveGrandBouleEngine.ts`): Worker/WASM host bridge; runs live DSP in a dedicated Web Worker behind a SharedArrayBuffer ring, and runs offline rendering inline in AudioWorklet (`prepareOfflineGrandBoule`).
- **Models** (`models/`): Configuration (`GrandBouleConfig`), per-note voicing (`GrandBoulePerNoteParams`), MIDI calibration (`GrandBouleMidiCalibration`), and morph states (`GrandBouleMorphState`).
- **MIDI Calibration** (`useCases/calibrateGrandBouleMidi/`): Velocity response curves, sustain/sostenuto thresholds, and CC smoothing.
- **Store & State** (`stores/grandBouleStore.ts`): Reactive UI state, active note voices, and 3D piano model visualizer states.

## Invariants & Traps

- Threading model: Live playback executes in a dedicated Worker over SharedArrayBuffer ring buffers; offline rendering executes directly inside AudioWorklet where no real-time deadline exists.
- wasm-bindgen glue is a realm singleton; WASM module caching and lifecycle handshakes are managed via AudioEngine's worklet init infrastructure.
- Per-note parameter edits and morph coordinates must be sanitized and normalized before dispatching to the engine handle.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

- `pnpm guard --profile focused -- pnpm test:run <changed-spec>`
- `pnpm guard --profile focused -- pnpm cargo:test --package daw-dsp grand_boule`
- PR CI checks module boundaries; inspect that result after cross-module changes.
