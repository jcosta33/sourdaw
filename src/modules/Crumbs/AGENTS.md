# Crumbs module — Agent Guidelines

Multi-mode creative sampler and granular instrument (Classic, Granular, Slicer, Looper, 16-pad Multi-sample), including transient slice detection, smart looping, and sample buffer transfer; does not own DAW track sequencing, MIDI recording, or global sample asset storage (Arrangement/SampleLibrary).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `commitCrumbsDeviceState`, `ensureCrumbsInstanceFromProject`, `hydrateCrumbsStateFromProject`, `initCrumbsDeviceStatePersistence`, `markCrumbsEngineAttached`, `panicCrumbs`, `prepareCrumbsEngine`, `retractEveryCrumbsEngineAttachment`, `syncCrumbsNativeInstances`.
- **Stores** (`stores/index.ts`): `crumbsEngineAttachmentStore`, `readAttachedCrumbsInstanceIds` — read-only. The mirror's writes are use cases, never store mutators, because a foreign module mutates through this module's use cases.
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
- The native instance's lifetime is the device's presence on the project, never a panel's mount: `syncCrumbsNativeInstances` creates and destroys it, because the mapper splices a Crumbs device onto its strip by the instance the engine holds. Restoring the saved sample on that appearance must not change the device's `playbackKey` — `load_sample` already selects the sample inside the instance, and a store write would commit a document chunk and dirty a just-opened project.
- Instance state is not evidence that a sampler exists. `ensureCrumbsInstanceFromProject` seeds a device's entry from project truth on every panel mount, including after a failed create was rolled back, so the panel's readiness readout comes from `crumbsNativeLifecycleStore` (`creating` / `bound` / `failed`, written only by `syncCrumbsNativeInstances`) or from the attachment mirror — never from the entry's presence on a native build.
- A pad trigger sounds both carriers (`triggerPadOn` / `triggerPadOff`). Exactly one is audible — a natively carried strip has its Web Audio twin gated out of the mix, and an uncarried one has no native chain entry for the device — and neither side is knowable from the use case.

## Verification

- `pnpm vitest run src/modules/Crumbs`
- `cargo test --package daw-dsp -- crumbs`
- `pnpm deps:validate`
