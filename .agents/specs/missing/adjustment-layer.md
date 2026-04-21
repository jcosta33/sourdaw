# Adjustment Layer — Non-Destructive Timeline Effects

## Goal

The user clicks "Add Adjustment Layer" above the timeline, picks an effect (EQ, compressor, reverb, delay, saturation, filter, stereo-width, volume, pan), and sees a translucent band layered over a selection of tracks. Dragging the band's endpoints defines where the effect applies along the timeline (regions). The effect processes the sum of all affected tracks during that region, fading in/out at region boundaries. The user can stack multiple layers; layers are fully non-destructive and survive project reload. Think: Photoshop adjustment layers, but for audio over time.

## Current state

This is the most-built-of-the-seven features. Partial integration is already in place.

What exists:
- `src/modules/Arrangement/stores/adjustmentLayer.ts` — full store: `AdjustmentLayer`, `AdjustmentRegion`, `AdjustmentParameter`, `AdjustmentEffectType` (9 types: `eq | compressor | reverb | delay | saturation | filter | stereo-width | volume | pan`), `EFFECT_PRESETS` mapping each type to default params, `LAYER_COLORS`.
- `src/modules/Arrangement/useCases/adjustmentLayer/` — 9 use-cases:
  - `createAdjustmentLayer` — wired via `handleCreateAdjustmentLayer`.
  - `addAdjustmentRegion`, `removeAdjustmentRegion` — unwired.
  - `removeAdjustmentLayer`, `toggleAdjustmentLayer` — unwired.
  - `setLayerParameter`, `setLayerMix` — unwired.
  - `getLayerCount`, `getActiveLayersAtBeat` — unwired.
- `src/modules/Arrangement/handlers/batchFeature/handleCreateAdjustmentLayer.ts` — wired to the `createAdjustmentLayer` AppAction. Handler is undoable.
- `src/modules/Command/models/AppAction.ts:368` — `{ type: 'createAdjustmentLayer'; payload: { name: string; effectType: string } }`.
- Command palette entries at `miscCommands.ts:188-196` for EQ and Compressor layers.

What is missing:
- **Audio graph integration** — layers are data; they do not process audio. The audio engine never reads `adjustmentLayerStore`.
- **UI** — no timeline overlay, no layer header row, no region drag handles, no param editor.
- **Persistence** — `AdjustmentLayerState` is not serialised into `ProjectData`.
- **Undo for layer mutations other than create** — the other 8 use-cases have no handlers, hence no `executeAppAction` entry point and no undo.
- **Affected-track selection UX** — `affectedTrackIds` is in the store but no UI writes to it.
- **Region rendering** — `regions` exist in the store but no canvas renders them.

## Design

### Where an adjustment layer inserts in the audio graph

An adjustment layer sits **on a virtual bus** inserted above the tracks it affects. Concretely:

```
 Tracks 1..N (affected by layer L)
        │
        │ (existing direct-to-master routing)
        ▼
 (normal signal path continues to master — UNCHANGED when L's region is off)

 During a region where L is active:
        │
        ▼
 Tracks 1..N get their output redirected to  ─►  AdjustmentBus(L)
                                                 │
                                                 ▼
                                              L's effect DSP
                                                 │
                                        blend (mix 0..1), region fade
                                                 │
                                                 ▼
                                              Master (or the next layer's input)
```

Multiple layers stack by chaining their buses bottom-up: the topmost layer (lowest `insertionIndex`) is closest to master.

### The `insertionIndex` model

`AdjustmentLayer.insertionIndex` is an integer in the same ordering as track order in the store. Semantics: "this layer sits above tracks at index ≥ insertionIndex". Analogous to Photoshop layer position. The audio engine sorts layers by `insertionIndex` ascending and builds the bus chain accordingly.

Conflict between `affectedTrackIds` (explicit) and `insertionIndex` (implicit below):
- If `affectedTrackIds` is non-empty, it wins. The layer affects exactly those tracks.
- If `affectedTrackIds` is empty, the layer affects all tracks at index ≥ `insertionIndex` (the "below" rule).

### Region activation and fades

`getActiveLayersAtBeat(beat)` already exists and returns currently-active layers. During scheduling, the audio engine computes a per-block layer activation:

For each render block (128 samples ~= 2.9 ms @ 44.1 kHz), compute the block's beat range. For each layer:
- If no regions → layer is always on at `blend = 1`.
- Else find any region where `beat ∈ [startBeat, endBeat)`. Within the region, compute fade-in/out envelopes based on `fadeInBeats` / `fadeOutBeats`.

Fade result is a `blend ∈ [0, 1]` multiplied by `layer.mix`. This becomes the wet/dry crossfade gain.

### Runtime implementation

A new class `AdjustmentBusNode` at `src/modules/AudioEngine/engine/AdjustmentBusNode.ts`:

```ts
class AdjustmentBusNode {
    constructor(public layerId: string, deps: { context: AudioContext; effectType: AdjustmentEffectType });
    inputSum: GainNode;   // summing junction for affected tracks
    effectIn: AudioNode;  // first node of effect chain
    effectOut: AudioNode; // last node of effect chain
    wetGain: GainNode;    // scheduled from region activation
    dryGain: GainNode;    // scheduled inversely
    output: GainNode;     // sends to next layer or master

    scheduleActivation(events: Array<{ time: number; blend: number }>): void;
    setParam(name: string, value: number): void;
    setMix(value: number): void;
    setBypass(bypassed: boolean): void;
    destroy(): void;
}
```

Effect chains are built with the existing `DEVICE_FACTORIES` entries (eq / compressor / reverb / delay / filter / bitcrusher / etc.) where they overlap. For types not yet in `DEVICE_FACTORIES` (saturation, stereo-width, pan), add dedicated factories — they're one-node wrappers around existing Web Audio primitives.

Track-to-bus routing change: `TrackNode.routeOutput()` normally connects to `masterGain` or a bus. Extended logic: if a layer's `affectedTrackIds` includes this track, route to the topmost active layer's `inputSum` instead. On layer-state change, `TrackNode.rebuildChain()` is called on affected tracks (existing mechanism).

### Scheduling integration

A new `scheduleAdjustmentLayers` use-case runs alongside `scheduleAudioClips` / `scheduleMidiClips` on every transport start and loop wrap. For each layer and each region intersecting the scheduled window, it calls `AdjustmentBusNode.scheduleActivation` with ramps at region start + fade-in, and region end − fade-out.

## API surface

```ts
// Existing in-store ops — expose via AppActions (new)
type AdjustmentActions =
    | { type: 'createAdjustmentLayer'; payload: { name: string; effectType: string } } // EXISTS
    | { type: 'removeAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'toggleAdjustmentLayer'; payload: { layerId: string } }
    | { type: 'setLayerParameter'; payload: { layerId: string; paramName: string; value: number } }
    | { type: 'setLayerMix'; payload: { layerId: string; mix: number } }
    | { type: 'addAdjustmentRegion'; payload: { layerId: string; startBeat: number; endBeat: number; blend?: number } }
    | { type: 'removeAdjustmentRegion'; payload: { layerId: string; regionId: string } }
    | { type: 'moveAdjustmentRegion'; payload: { regionId: string; startBeat: number; endBeat: number } } // NEW, for drag
    | { type: 'setLayerFades'; payload: { regionId: string; fadeInBeats: number; fadeOutBeats: number } } // NEW
    | { type: 'setLayerAffectedTracks'; payload: { layerId: string; trackIds: string[] } }                // NEW
    | { type: 'setLayerInsertionIndex'; payload: { layerId: string; insertionIndex: number } };           // NEW

// New use-cases
export function moveAdjustmentRegion(regionId: string, startBeat: number, endBeat: number): void;
export function setLayerFades(regionId: string, fadeInBeats: number, fadeOutBeats: number): void;
export function setLayerAffectedTracks(layerId: string, trackIds: string[]): void;
export function setLayerInsertionIndex(layerId: string, insertionIndex: number): void;

// New engine/scheduling surface
// src/modules/AudioEngine/useCases/adjustmentLayer/buildAdjustmentBus.ts
export function buildAdjustmentBus(layer: AdjustmentLayer, deps: BusDeps): AdjustmentBusNode;

// src/modules/AudioEngine/useCases/adjustmentLayer/scheduleAdjustmentLayers.ts
export function scheduleAdjustmentLayers(windowStartBeat: number, windowEndBeat: number): void;

// Query
export function getLayersAffectingTrack(trackId: string): AdjustmentLayer[];
```

## UI / UX

- **Layer header row** — a new row above the first track, spanning the timeline ruler width. Each layer renders as a coloured band at its row index. Buttons: enable/disable, delete, settings (opens param editor popover).
- **Region handles** — each `AdjustmentRegion` renders as a resizable rect within its layer's band. Drag interior → move. Drag edge → resize. Alt-click within the band → add a new region at that beat position.
- **Fade handles** — two triangular handles on each region's corners; drag to change `fadeInBeats` / `fadeOutBeats`. Visual fade taper rendered as a gradient.
- **Affected tracks selector** — click the layer's gear icon → popover with a checkbox list of tracks. Default to "Below this layer" (empty `affectedTrackIds`, affects all tracks at `insertionIndex` ≥ layer's insertionIndex).
- **Parameter editor** — right-click the layer → popover with a generic parameter-list editor driven by `AdjustmentParameter[]` (name, value, min, max, unit). No custom UI per effect type for v1 — generic knobs.
- **Layer stacking** — layers render vertically in the header row, sorted by `insertionIndex`. Dragging a layer reorders it (changes `insertionIndex`).
- **Add layer menu** — "+" button at the top-right of the layer header strip, opens a menu of the 9 effect types.
- **Command Palette** — existing `create-adjustment-eq` and `create-adjustment-compressor`; add the other 7 types.

## Data model / persistence

Add to `ProjectData`:

```ts
type ProjectData = {
    // ...
    adjustmentLayers?: {
        layers: Array<{
            id: string;
            name: string;
            effectType: AdjustmentEffectType;
            parameters: Array<{ name: string; value: number; min: number; max: number; unit: string }>;
            affectedTrackIds: string[];
            insertionIndex: number;
            regions: Array<{
                id: string;
                startBeat: number;
                endBeat: number;
                blend: number;
                fadeInBeats: number;
                fadeOutBeats: number;
            }>;
            enabled: boolean;
            mix: number;
            color: string;
        }>;
    };
};
```

Hydration: extend `hydrateModuleStoresFromProjectData.ts` to call `adjustmentLayerStore.set({ layers: data.adjustmentLayers?.layers ?? [] })` after track hydration (so `affectedTrackIds` references exist).

Serialisation: `exportProjectFile.ts` serialises the store value directly — no transform needed since all fields are JSON-native.

Migration: new optional field. Projects without the field load with `{ layers: [] }`.

## Integration points

- `src/modules/AudioEngine/engine/AdjustmentBusNode.ts` — NEW. Wraps the effect chain + wet/dry crossfade. Reuses `DEVICE_FACTORIES` for effect nodes.
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts` — own a `Map<layerId, AdjustmentBusNode>` parallel to tracks. Subscribe to `adjustmentLayerStore` and create/destroy buses on layer lifecycle.
- `src/modules/AudioEngine/engine/TrackNode.ts` — `routeOutput()` checks `getLayersAffectingTrack(this.trackId)` and routes through the topmost active layer's `inputSum` instead of master. On layer add/remove/toggle, all affected tracks `scheduleRebuildChain()`.
- `src/modules/Transport/useCases/scheduling/` — add `scheduleAdjustmentLayers` call to the transport's main scheduling pass.
- `src/modules/Arrangement/handlers/batchFeature/` — new handler files for the 10 new/completed actions.
- `src/modules/Arrangement/useCases/getArrangementHandlers.ts` — register the new handlers.
- `src/modules/Workspace/presentations/views/Timeline/AdjustmentLayerStrip.tsx` — NEW. Renders the layer header row.
- `src/modules/Workspace/presentations/views/Timeline/AdjustmentRegion.tsx` — NEW. Individual region component with drag.
- `src/modules/Workspace/presentations/views/Timeline/AdjustmentLayerParamEditor.tsx` — NEW. Generic knob grid.
- `src/modules/Project/useCases/projectPersistence/` — extend for `adjustmentLayers`.
- `src/modules/Arrangement/useCases/adjustmentLayer/getActiveLayersAtBeat.ts` — already correct; reused by scheduling.

## Risks / open questions

- **Latency** — an adjustment layer adds one node path. Plugins like convolution reverb add multi-ms latency. Need to apply the existing latency-compensation machinery (`src/modules/AudioEngine/useCases/latencyCompensation/`). Plug into that module's `trackLatency` scan.
- **Freeze / stale** — mutating a layer invalidates affected tracks' freeze state. Hook into `initStalenessDetection.ts`: subscribe to `adjustmentLayerStore` and mark affected tracks stale on any change.
- **CPU** — stacking 5 reverb layers is expensive. UI warning when > 3 active layers include reverb at the same beat.
- **Region overlap within one layer** — if two regions overlap, `getActiveLayersAtBeat` treats either as activating. Decision: overlapping regions add their blends (capped at 1). This matches user expectation of overlapping gain stages.
- **Cross-bus routing to master** — the engine's `masterGain` is a single node; all layers must eventually feed it. Two layers affecting disjoint track sets can run in parallel; two layers affecting the same tracks must chain. The `AdjustmentBusNode` topology is derived per render-graph build.
- **Per-track pan/volume layer** — the `pan` and `volume` types are simple but operate on the sum signal, not on individual tracks' post-fader. This is intentional: adjustment layers operate on a bus. If the user wants per-track automation, they should use automation lanes.
- **CRDT — region ids** — region ids use `adjr-<uuid>`; already UUID-based, so CRDT-safe. Layer ordering via `insertionIndex` is an integer and conflict-prone on concurrent edits. Mitigation: store `insertionIndex` as a fractional key (LexoRank-style) so inserts between layers don't require renumbering. Decision: keep integer for v1, add defensive renumber on load if duplicates detected.
- **Open question**: does enabling/disabling a layer count as one undoable action or should toggle be non-undoable (as a mix control)? Recommendation: undoable, matches `toggleMute` on tracks.

## Milestones

### M1 — Complete the store-side API (one session)
- Implement `moveAdjustmentRegion`, `setLayerFades`, `setLayerAffectedTracks`, `setLayerInsertionIndex` use-cases.
- Add the 10 new AppAction variants.
- Write handlers for all 11 (existing `createAdjustmentLayer` + 10 new) in `handlers/batchFeature/`.
- Unit tests for each.

### M2 — Engine integration: single layer (one session)
- `AdjustmentBusNode` class with eq/compressor/gain/pan only (reuse `DEVICE_FACTORIES`).
- `createWebAudioEngine` subscribes to store, creates/destroys buses.
- `TrackNode.routeOutput` consults `getLayersAffectingTrack`.
- Offline render test: one layer with one region produces the expected gain reduction on the affected track.

### M3 — Scheduling: regions with fades (one session)
- `scheduleAdjustmentLayers` driving wet/dry crossfades.
- Integration with transport start / loop wrap / seek.
- Test: crossfade audible at region boundaries (offline render diff).

### M4 — UI: header strip + region drag (one session)
- `AdjustmentLayerStrip` component + `AdjustmentRegion` with drag/resize/fade-handles.
- `AdjustmentLayerParamEditor` generic knob grid.
- Add-layer menu.
- Command palette entries for all 9 effect types.

### M5 — Persistence + multi-layer stacking (one session)
- `ProjectData.adjustmentLayers` schema + hydration + serialisation.
- Multi-layer bus chaining (topmost nearest to master).
- Stacking tests with 3 overlapping layers.
- Freeze invalidation wire.

### (M6 — Effect coverage) — if M1–M5 are on schedule
- Add factories for `saturation`, `stereo-width` (currently absent from `DEVICE_FACTORIES`).

## Tests

- **Store API** — each of the 9 existing use-cases already has specs; keep them. Add specs for the 4 new use-cases.
- **Handler** — each of the 11 handlers: execute path produces the expected store mutation; undo reverses it; redo reproduces.
- **Engine: single-track, single-layer** — offline render a 10 s sine tone with a volume=-6dB adjustment layer having one region covering beats 2–6; assert output is -6dB between those beats and unchanged outside.
- **Engine: region fades** — same as above with 0.25-beat fade-in/out; assert a linear ramp across the fade span.
- **Engine: layer chaining** — two layers (volume and compressor), layer A index 0, layer B index 1, both affecting the same track; assert signal passes through A then B.
- **Engine: affected-tracks filter** — layer with `affectedTrackIds = [t1]` does not affect t2's output.
- **Persistence** — create 3 layers with regions and fades, save, reload in a fresh store, assert full equivalence.
- **Freeze staleness** — mutate a layer, assert affected tracks' `freezeState.status` becomes `'stale'`.
- **Overlap merging** — two regions [0,4] and [2,6] with blends 0.5, 0.5 within the same layer: assert effective blend at beat 3 = 1.0 (sum, capped).
- **Undo** — create + add region + move region + delete all undo in reverse order correctly.
- **E2E (Playwright)** — click "Add EQ Layer" in header strip, drag a region, play, assert EQ applied audibly (measure spectrum or mock effect node).
