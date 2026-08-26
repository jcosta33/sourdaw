# GrandBoule module — Agent Guidelines

Acoustic grand piano physical modeling and multi-sample virtual instrument (string resonance, soundboard radiation, hammer attack modeling, una corda/sustain pedals, per-note parameter editing, and piano morphing); does not own MIDI track capture or audio track routing (Arrangement/AudioEngine).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `getGrandBouleHandlers`, `prepareOfflineGrandBoule`, `setGrandBouleEventBus`, `initGrandBouleSubscribers`, `setGrandBouleMorphBalance`, `setGrandBouleMorphEnabled`, `setGrandBouleMorphModel`, `setGrandBouleMorphPosition`.
- **Stores** (`stores/index.ts`): `grandBouleStore`, `createGrandBouleStore`, `resetGrandBouleStores`, `defaultGrandBouleState`, `createDefaultGrandBouleState`, `applyVelocityCurve`.
- **Views** (`presentations/views/index.ts`): `GrandBoulePanel`.
- **Events** (`events/index.ts`): No public events.
- **Handler Maps**: `getGrandBouleHandlers` exposes `setGrandBouleDeviceState`.

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

- `pnpm vitest run src/modules/GrandBoule`
- `cargo test --package daw-dsp -- grand_boule`
- `pnpm deps:validate`
