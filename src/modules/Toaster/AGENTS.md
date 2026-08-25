# Toaster module — Agent Guidelines

16-pad drum sampler and step sequencer instrument (16-level pitch/velocity modes, per-step sound locks, euclidean pattern generation, pattern morphing, groove assignment, and note repeat); does not own timeline arrangement tracks or global transport state (Arrangement/Transport).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `compileToasterTrackStackActions`, `getDefaultPadNames`, `getToasterPresetDeviceState`, `prepareOfflineToaster`, `setToasterEventBus`, `initToasterSubscribers`, `initToasterKitPersistence`, `getToasterPresets`, `setToasterGrooveAssignmentExecutor`.
- **Stores** (`stores/index.ts`): `defaultToasterState`, `toasterStore`, `resetToasterDeviceLifecycleState`.
- **Views** (`presentations/views/index.ts`): `ToasterPanel`.
- **Events** (`events/index.ts`): No public events.

## Key Subsystems

- **Kit & Pad Models** (`models/`): Kit structure (`ToasterKit`), runtime state (`ToasterKitState`), and pad update messages (`PadStoreUpdate`).
- **Step Sequencer & Sound Locks** (`useCases/sequencerPlayback.ts`, `useCases/soundLocks/`): Real-time step scheduling, euclidean distribution (`applyEuclidean`), pattern morphing, and per-step sound locks.
- **Param Bridge** (`useCases/toasterParamBridge/`): Pad parameter queue and immediate/throttled engine parameter updates.
- **Presets & Kits** (`repositories/toasterPresets.ts`): Factory drum kits and sequence pattern templates.

## Invariants & Traps

- Sound locks permit per-step parameter and sample overrides without permanently altering the pad's base kit configuration.
- 16-levels mode temporarily distributes a single pad's pitch or velocity across all 16 pads; exiting restores the root kit layout.
- Playback scheduling coordinates with global Transport lookahead ticks via `toasterSubscriber` without introducing timing jitter.

## Verification

- `pnpm vitest run src/modules/Toaster`
- `cargo test --package daw-dsp -- toaster`
- `pnpm deps:validate`
