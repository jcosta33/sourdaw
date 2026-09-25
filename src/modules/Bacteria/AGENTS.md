# Bacteria module — Agent Guidelines

Multiband creative multi-effects framework (crossover filtering, multi-model distortion, dynamic filtering, granular synthesis, spectral processing, Lorenz chaotic modulation, LFOs, and XY morph pad); does not own audio track routing or playback scheduling (AudioEngine/Arrangement).

## Public Contract Surface

- **Stores** (`stores/index.ts`): `bacteriaStore`, `updateBacteriaMeters`.
- **Views** (`presentations/views/index.ts`): `BacteriaPanel`.
- **Events** (`events/index.ts`): No public events.
- **Use Cases** (`useCases/index.ts`): `initBacteriaSubscribers`, `initBacteriaModAssignmentsPersistence`, `captureOfflineBacteria`, `prepareOfflineBacteria`. Internal parameter bridge and preset loaders otherwise consume state within the module.

## Key Subsystems

- **Patch Model** (`models/BacteriaPatch.ts`): Up to 6 processing bands with crossover configurations (`lr4` or `linear-phase`), distortion engines (`soft-clip`, `hard-clip`, `foldback`, `wavefold`, `bitcrush`, `tube`, `breakdown`, `smudge`), granular windows (`hann`, `gaussian`), spectral blur/freeze, and Lorenz modulation (`sigma`, `rho`, `beta`, `speed`).
- **Parameter Bridge** (`useCases/bacteriaParamBridge/`): Bridges UI and project patch parameters to AudioEngine device parameters (`setBacteriaParamWithAudio`, `setBacteriaBandParamWithAudio`, `loadBacteriaPatchWithAudio`, `createFlushParam`).
- **Preset Catalog** (`useCases/bacteriaPresets.ts`): Factory presets and patch templates.
- **Meters & Telemetry** (`stores/bacteriaStore.ts`): Real-time input, band, and output level meter subscriptions.

## Invariants & Traps

- `modAssignments` are structured routing rows, never scalar engine parameters: the scalar bridge only transmits `(paramId, value)` pairs. The whole table reaches the engine as one replacement through the patch door (`updateDevicePatch` → the worklet's `set-mod-assignments`), from `loadBacteriaPatchWithAudio`, and from `setBacteriaModAssignmentsWithAudio`'s own extracted engine half, `pushBacteriaModAssignmentsToEngine`, which `hydrateBacteriaPatchFromProject` also calls directly. The engine table has no per-entry removal — removal, undo, and reload are clear-then-re-add. `snapshots` remain UI/persistence metadata with no engine push.
- The table also persists in project truth: `initBacteriaModAssignmentsPersistence` mirrors every session-store edit into the device's `deviceState` chunk (`BacteriaModAssignmentsState.ts`) through `commitBacteriaModAssignments`, skipping the write when the store already matches what the document holds. `bacteriaSubscriber.ts` re-applies that chunk through `setBacteriaModAssignmentsWithAudio` once a freshly built live worklet emits `audioDevice.loaded` — construction alone never reads the document. `BacteriaPanel`'s own mount/`deviceState`-change hydration (`hydrateBacteriaPatchFromProject`) projects the same chunk into the session table too, so an edit made before the worklet loads — or one made in a session with no live worklet at all — still builds on the saved rows instead of computing against an empty table and overwriting them. A chunk the projection actually changes is also pushed to the live engine through `pushBacteriaModAssignmentsToEngine` (#4756), so a collaborator's write reaches a mounted panel's node too; a foreign change with no panel mounted still reaches nothing live, which issue #4764 owns. The Web Audio offline export posts the same table from `prepareOfflineBacteria`, mapped through `mapBacteriaModAssignments` and refused above the live node's own 64-row limit; `captureOfflineBacteria` detaches it from `deviceState` up front for callers that need the value before graph construction can yield.
- Crossover slope is index-encoded (0=12 dB/oct, 1=24 dB/oct, 2=36 dB/oct, 3=48 dB/oct).
- DSP engine lives in `crates/daw-dsp/src/bacteria/` compiled to WASM; render path is strictly non-allocating.

## Verification

- `pnpm vitest run src/modules/Bacteria`
- `cargo test --package daw-dsp -- bacteria`
- `pnpm deps:validate`
