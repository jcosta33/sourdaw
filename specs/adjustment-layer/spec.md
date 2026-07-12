---
type: spec
id: SPEC-adjustment-layer
title: Adjustment layers — non-destructive timeline effects
status: draft
owner: The Sourdaw team
sources:
  - specs/adjustment-layer/
---

# Adjustment layers — non-destructive timeline effects

## Intent

Let a user lay a translucent effect band (EQ, compressor, reverb, delay,
saturation, filter, stereo-width, volume, pan) over a span of the timeline so
it processes the sum of the affected tracks across that region, fading in and
out at the region edges. Layers are non-destructive, stackable, and survive a
project reload — Photoshop adjustment layers, for audio over time.

## Non-goals

- Per-track post-fader automation — layers operate on a bus, not on individual
  tracks; per-track moves stay in automation lanes.
- New effect DSP beyond wrapping existing `DEVICE_FACTORIES` plus thin
  saturation / stereo-width / pan factories.
- A crossfade between schedules on layer edit — hard rebuild via the existing
  `rebuildChain` path.

## Requirements

### AC-001 — Layer mutations are undoable actions

Every layer mutation (remove, toggle, set parameter, set mix, add/move/remove
region, set fades, set affected tracks, set insertion index) must be reachable
through an `AppAction` handler so it has an `executeAppAction` entry point and
undo/redo.

Verify with: `pnpm test:run -- adjustmentLayerHandlers`

### AC-002 — A layer processes the sum of its affected tracks

When a layer's region is active, the engine must route the affected tracks'
output through the layer's effect bus so the rendered output reflects the
effect across that span.

Verify with: `pnpm test:run -- buildAdjustmentBus`

### AC-003 — Regions fade in and out at their boundaries

Within a region, the wet/dry blend must ramp over `fadeInBeats` at the start
and `fadeOutBeats` at the end rather than switching abruptly.

Verify with: `pnpm test:run -- scheduleAdjustmentLayers`

### AC-004 — Affected-track resolution follows the explicit-then-below rule

When `affectedTrackIds` is non-empty the layer must affect exactly those
tracks; when empty it must affect every track at index ≥ its `insertionIndex`.

Verify with: `pnpm test:run -- getLayersAffectingTrack`

### AC-005 — Layers round-trip through the project file

When a project with adjustment layers is saved and reloaded, every layer's
regions, parameters, fades, affected tracks, mix, and insertion index must be
restored unchanged.

Verify with: `pnpm test:run -- adjustmentLayerPersistence`

### AC-006 — Stacked layers chain topmost-nearest-to-master

When multiple layers affect overlapping tracks, the engine must chain their
buses by ascending `insertionIndex` so the lowest index sits closest to master.

Verify with: `pnpm test:run -- adjustmentLayerChaining`

### AC-007 — The timeline exposes a draggable layer strip

The workspace must render a layer header strip above the tracks where each
region can be moved and resized and each layer toggled, deleted, and edited.

Verify with: `manual` — add an EQ layer, drag a region, confirm the band and handles render and the effect follows

### AC-008 — Mutating a layer marks affected tracks stale

When any layer that affects a track changes, that track's freeze state must
become `stale`.

Verify with: `pnpm test:run -- adjustmentLayerStaleness`

### AC-009 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-010 — Every effect type is user-creatable

All nine effect types (eq, compressor, reverb, delay, saturation, filter,
stereo-width, volume, pan) must be exposed as user-creatable controls reachable
from both the Command Palette and the add-layer "+" menu on the layer strip.

Verify with: `pnpm test:run -- adjustmentLayerCommands` — assert a Command
Palette entry and an add-layer menu item exist for each of the nine effect types

### AC-011 — The build extends the already-wired store surface

The existing implemented surfaces must remain the foundation the change builds
on: the nine store use-cases (`createAdjustmentLayer` wired via
`handleCreateAdjustmentLayer`; `addAdjustmentRegion`, `removeAdjustmentRegion`,
`removeAdjustmentLayer`, `toggleAdjustmentLayer`, `setLayerParameter`,
`setLayerMix`, `getLayerCount`, `getActiveLayersAtBeat` unwired), the
`createAdjustmentLayer` `AppAction` variant (originally `AppAction.ts:368`), and
the EQ/Compressor Command Palette entries (originally `miscCommands.ts:188-196`)
must continue to resolve, so new actions extend rather than replace them.

Verify with: `pnpm test:run -- adjustmentLayer` — assert the nine store
use-cases and the `createAdjustmentLayer` action remain present and importable

## Open questions

- [ ] (non-blocking) Should overlapping regions within one layer sum their
  blends (capped at 1) or take the max? Current design sums and caps; either
  satisfies AC-003.
- [ ] (non-blocking) `insertionIndex` is an integer and conflict-prone under
  concurrent edits; a fractional (LexoRank-style) key is a candidate. Integer
  with defensive renumber-on-load is sufficient for v1.

## Affected areas

- `src/modules/Arrangement/stores/adjustmentLayer.ts`
- `src/modules/Arrangement/useCases/adjustmentLayer/`
- `src/modules/Arrangement/handlers/batchFeature/`
- `src/modules/AudioEngine/engine/AdjustmentBusNode.ts`
- `src/modules/AudioEngine/engine/TrackNode.ts`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts`
- `src/modules/Transport/useCases/scheduling/`
- `src/modules/Workspace/presentations/views/Timeline/`
- `src/modules/Project/useCases/projectPersistence/`

## Dropped from sources

- Latency compensation for high-latency layer effects (e.g. convolution reverb)
  — folds into the existing `latencyCompensation` scan as a follow-up, not v1.
- CPU warning when stacking many reverb layers at one beat — UX polish, deferred.
- Per-effect custom parameter UI — v1 uses a generic knob grid driven by
  `AdjustmentParameter[]`.
