# Crumbs module — Agent Guidelines

Multi-mode creative sampler and granular instrument (Classic, Granular, Slicer, Looper, 16-pad Multi-sample), including transient slice detection, smart looping, and sample buffer transfer; does not own DAW track sequencing, MIDI recording, or global sample asset storage (Arrangement/SampleLibrary).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `commitCrumbsDeviceState`, `ensureCrumbsInstanceFromProject`, `hydrateCrumbsStateFromProject`, `initCrumbsDeviceStatePersistence`, `panicCrumbs`, `prepareCrumbsEngine`.
- **Stores** (`stores/index.ts`): `crumbsStore`, `padStore`, `sliceStore`.
- **Views** (`presentations/views/index.ts`): `CrumbsPanel`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Repositories & Bridge** (`repositories/crumbsBridge/`): Worklet and engine node communication (`loadSample`, `setCrumbsMode`, `setCrumbsParam`, `crumbsNoteOn`, `crumbsNoteOff`, `crumbsAllSoundOff`, `detectOnsets`, `detectSmartLoopPoints`, `getWaveformPeaks`, `getCrumbsPosition`).
- **Sample Decoding** (`repositories/sampleTransfer/`): Audio file decoding via AudioContext (`decodeCrumbsSampleFile`).
- **Lifecycle & Persistence** (`useCases/crumbsLifecycle/`, `useCases/commitCrumbsDeviceState.ts`): Instance lifecycle and Automerge CRDT state synchronization.
- **Param Bridge** (`useCases/crumbsParamBridge/`): Throttled real-time parameter streaming during UI interaction, committed on gesture completion.

## Invariants & Traps

- Disk streaming mode is native-only (`crates/daw-dsp/src/crumbs/`). In browser / WebAudio WASM, audio renders exclusively from an in-memory sample pool populated by decoded PCM pushed over the worklet port (`add_sample`).
- Real-time parameter preview is throttled to prevent message flooding; persistence to project CRDT occurs on commit (`commitCrumbsDeviceState`).
- Slice markers and pad regions must stay clamped within the bounds of the active decoded sample buffer.

## Verification

- `pnpm vitest run src/modules/Crumbs`
- `cargo test --package daw-dsp -- crumbs`
- `pnpm deps:validate`
