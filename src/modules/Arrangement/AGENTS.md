# Arrangement module — Agent Guidelines

Owns arrangement tracks, clips, comping/take lanes, markers, sections, VCA groups, adjustment layers, scratch pads, track alternatives, mixer snapshots, and device chain topology; does not own audio DSP graph execution (AudioEngine), raw MIDI notes (MIDI), parameter automation curves (Automation), or playback clock transport (Transport).

## Public Contract Surface

- `stores/`: `trackStore` (`Track`, `Clip`, `Device`), `clipSelectionStore`, `markerStore`, `scratchPadStore`, `takeLaneStore`, `timelineViewStore`, `adjustmentLayerStore`, `vcaGroupStore`, `gainEnvelopeStore`, `grooveStore`, `warpStates`, `mixerSnapshotStore`, `deriveEffectiveAudibility`, `persistDeviceParam`, `clampDeviceParamWrite`, `resolveEligibleDeviceWriteTarget`, `resolveEligibleClipWriteTarget`, `updateClipInStore`, `appendClipToTrack`, `appendTrack`.
- `useCases/`: Track lifecycle (`addTrack`, `removeTrack`, `duplicateTrack`, `freezeTrack`, `unfreezeTrack`, `flattenTrack`, `setTrackGain`/`Pan`/`Color`), clip editing (`addClip`, `removeClip`, `duplicateClip`, `splitClip`, `trimClipStart`/`End`, `glueClips`, `reverseClip`, `normalizeClip`, `slipClipContent`), comping (`addTake`, `addTakeLane`, `flattenComp`, `createCompGroup`, `resolveClipsWithComping`), adjustment layers, device chain management (`compileAddDeviceAction`, `bypassDevice`, `setDeviceParameter`, `persistDevicePatch`), time operations (`duplicateTimeRange`, `insertTime`, `deleteTime`), markers/sections, scratch pad, track alternatives, VCA groups, audio warp/stretch.
- `events/`: `TrackAddedPayload`, `TrackRemovedPayload`, `FreezeStateChangedPayload`, `TrackSelectionChangedPayload`.
- `presentations/views/`: `AdjustmentLayerStrip`, `ArrangementBar`, `BeatRulerBar`, `MarkerLane`, `TimelineChromeSurface`, `TimelineMinimap`, `TakeLanesView`, `TimelineSurface`, `TrackListView`.
- Handlers: `getArrangementHandlers()` and `getSongStructureHandlers()`.

## Key Subsystems

- **Track & Clip Aggregate:** `trackStore` maintains the hierarchical track list (audio, MIDI, bus, folder, return), device chains, and clip placements.
- **Audibility Projection:** `deriveEffectiveAudibility` projects authoritative solo/mute states into per-track audibility maps consumed by the offline renderer and mixer UI without duplicating logic.
- **Freeze & Bounce Pipeline:** Tracks offline freeze/bounce state and invalidation staleness (`initStalenessDetection`, `cleanupUnusedFreezeFiles`).
- **Comping & Take Management:** Multi-take slicing and comp region resolution (`resolveClipsWithComping`).
- **Adjustment Layers & Scratch Pad:** Non-destructive bus-level effect overlays and sandbox arrangement sections.

## Invariants & Traps

- **Atomic Mutations & Undo:** Every track, adjustment layer, and clip edit must pass through registered handlers to guarantee undo graph consistency and freeze staleness invalidation.
- **Device Parameter Bounds:** Parameter writes must strictly pass through `clampDeviceParamWrite` and `persistDeviceParam` adhering to `models/DeviceParameterLaw.ts`.
- **Worklet Decoupling:** Worklets and DSP threads do not read `trackStore` directly; AudioEngine consumes immutable live track strip projections (`projectTrackToLiveStrip`).
- **Effective Audibility Single Source:** Never calculate custom solo/mute matrix logic in downstream modules — always consume `deriveEffectiveAudibility`.

## Verification

```bash
pnpm vitest run src/modules/Arrangement
pnpm deps:validate
```
