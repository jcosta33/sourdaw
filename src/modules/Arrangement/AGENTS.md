# Arrangement module — Agent Guidelines

Owns arrangement tracks, clips, comping/take lanes, markers, sections, VCA groups, adjustment layers, scratch pads, track alternatives, mixer snapshots, and device chain topology; does not own audio DSP graph execution (AudioEngine), raw MIDI notes (MIDI), parameter automation curves (Automation), or playback clock transport (Transport).

## Public Contract Surface

- `stores/`: `trackStore` (`Track`, `Clip`, `Device`), `clipSelectionStore`, `markerStore`, `scratchPadStore`, `takeLaneStore`, `timelineViewStore`, `adjustmentLayerStore`, `vcaGroupStore`, `gainEnvelopeStore`, `grooveStore`, `warpStateStore`, `mixerSnapshotStore`, `deriveEffectiveAudibility`, `persistDeviceParam`, `clampDeviceParamWrite`, `resolveEligibleDeviceWriteTarget`, `resolveEligibleClipWriteTarget`, `updateClipInStore`, `appendClipToTrack`, `appendTrack`, `readMusicalRange`, `readMusicalRangeInputs`.
- `useCases/`: Track lifecycle (`addTrack`, `removeTrack`, `duplicateTrack`, `freezeTrack`, `unfreezeTrack`, `flattenTrack`, `setTrackGain`/`Pan`/`Color`), clip editing (`addClip`, `removeClip`, `duplicateClip`, `splitClip`, `trimClipStart`/`End`, `glueClips`, `reverseClip`, `normalizeClip`, `slipClipContent`), comping (`addTake`, `addTakeLane`, `flattenComp`, `createCompGroup`, `resolveClipsWithComping`), adjustment layers, device chain management (`compileAddDeviceAction`, `bypassDevice`, `setDeviceParameter`, `persistDevicePatch`), device family membership (`isReverbDeviceType`), time operations (`duplicateTimeRange`, `insertTime`, `deleteTime`), markers/sections and musical range resolution (`resolveMusicalRange`), scratch pad, track alternatives, VCA groups, audio warp/stretch, agent render receipt admission (`admitAgentRenderReceipt`), mixing recipe catalog (`getMixRecipeCatalog`).
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
- **One Musical Range Law:** A section reference, bar range, or beat range becomes beats only through `models/MusicalRange.ts`, read by `resolveMusicalRange` against a caller's snapshot and by `readMusicalRange` against the live project. An exact section name wins; otherwise an ordinal counts among sections of one name family ordered by start. A number written after the name ("Chorus 2") counts only in a family whose names carry no numbers; where they do, it is a name, and one no section bears is unknown rather than a position. Word and suffixed ordinals ("second chorus", "2nd chorus") always count. A reference no section answers is read against markers by the same rules, a marker being a named position whose range runs to the nearest later marker or section start, or else to the arrangement end (`getLastClipEndBeat`'s law, `models/ArrangementEnd.ts`). Two places that match equally are reported as `ambiguous-section` with both candidates and are never picked between, so a planner can ask rather than guess.
- **Device Selection Metadata:** A descriptor's `characterTags` (the algorithm it runs) and `effectFamily` (the kind of effect it is) are the only way another module selects devices by meaning; callers keep no device-id lists. Both are catalogue metadata, so neither enters the command-replay descriptor version.
- **Presets Published As Recipes:** `getMixRecipeCatalog` returns the authored recipes, then the factory chain presets published as recipes of the same shape, each marked by an `origin` naming its preset and the preset's contract fingerprint (`getPresetContractVersion`, the version the preset discovery manifest also publishes). Only factory presets that are effect chains qualify; user presets and genre or character templates are not published. Each preset device is an `insert` step and each stored parameter a window whose minimum equals its maximum, so applying one writes the stored values through `recipe.expand`'s `addDevice` and `setDeviceParameter`, never through `loadPreset`. Descriptors and roles come only from the preset's authored tags and category through the catalog vocabulary, never from a device's behaviour: a tag names a character the author intended and is not proof of an algorithm (a tube-tagged preset need not run a tube algorithm). A preset whose tags name no produced descriptor, or whose category and tags name no role, or holding a device that is not an effect or a value its parameter cannot hold as stored, is not published; a corrective descriptor (`muddy`, `thin`) is never read from a tag. Prerequisites, contraindications and metrics stay empty because the catalog defines them per recipe, not per descriptor. The authored catalog arrays and their coverage spec stay authored-only; preset recipes carry their own validation in `buildPresetMixRecipes.spec.ts`.

## Verification

```bash
pnpm vitest run src/modules/Arrangement
pnpm deps:validate
```
