# Levain module — Agent Guidelines

Orchestral multi-sample acoustic instrument engine (strings, brass, woodwinds, percussion, choir) with articulation switching, legato transitions, round-robin sample playback, and multi-microphone balancing; does not own MIDI track recording or arrangement sequencing (Arrangement/MIDI).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `getDecodedBankDiagnostics`, `getLevainArticulationId`, `commitLevainDeviceState`, `hydrateLevainStateFromProject`, `initLevainDeviceStatePersistence`, `prepareOfflineLevain`, `registerLevainDevice`, `unregisterLevainDevice`.
- **Stores** (`stores/index.ts`): `defaultLevainState`, `levainStore`, `setEngineReady`, `LevainState`.
- **Views** (`presentations/views/index.ts`): `LevainPanel`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Sample Bank Loader** (`repositories/sampleLoader/`): Remote manifest parser (`sampleManifest.ts`), multi-microphone audio fetcher, and background decoder (`loadInstrumentFromManifest`, `createDecodedBankResource`).
- **Instrument Catalog** (`models/LevainPatch.ts`): Source-of-truth instrument IDs (`INSTRUMENT_IDS`), articulation mappings, dynamic velocity layers, and microphone position mixes (close, tree, ambient).
- **Param Bridge** (`useCases/levainParamBridge/`): Registers device instances with the AudioEngine node, synchronizes macro controls, and prepares offline render state (`prepareOfflineLevain`).
- **Store & State** (`stores/levainStore.ts`): Reactive state for active instrument selection, articulation switches, and download/decoding readiness.

## Invariants & Traps

- `INSTRUMENT_IDS` is the runtime source-of-truth; unknown or misspelled IDs in saved projects must be caught early before issuing network requests.
- Decoded sample banks are cached in memory pools; AudioWorklet/WASM triggers playback from pre-allocated buffers without blocking the audio thread.

## Verification

- `pnpm vitest run src/modules/Levain`
- `cargo test --package daw-dsp -- levain`
- `pnpm deps:validate`
