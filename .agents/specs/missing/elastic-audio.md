# Elastic Audio — Transient-Aware Time Stretch

## Goal

The user selects an audio clip, opens the Elastic Audio editor, sees the clip waveform with auto-detected transient markers, drags markers to correct or refine, clicks "Quantize to Grid", and the clip is time-stretched so every transient lands on a grid beat — without repitching vocals or smearing drum hits. Sensitivity adjustment and manual add/remove of transient markers are live and undoable. The workflow is non-destructive: the original audio is untouched, the clip just carries a set of warp markers that the existing stretch engine consumes.

## Goal (one-liner restatement)

Ship the user-facing transient-detection + quantization workflow that the `handleDetectTransients` / `handleQuantizeTransients` handler stubs already expect.

## Current state

The use-case directory `src/modules/AudioEngine/useCases/elasticAudio/` referenced in the deadcode audit does not exist on disk today. What exists:

- `src/modules/Command/models/AppAction.ts:369-370` — two action types:
  ```
  | { type: 'detectTransients'; payload: { clipId: string; sensitivity?: number } }
  | { type: 'quantizeTransients'; payload: { clipId: string } }
  ```
- `src/modules/AudioEngine/handlers/finalFeature/handleDetectTransients.ts` — stub that only calls `notifyUser`. Does not detect anything.
- `src/modules/AudioEngine/handlers/finalFeature/handleQuantizeTransients.ts` — stub that only calls `notifyUser('Transients quantized to grid', 'success')`. Does not mutate state.
- `src/modules/Command/models/commands/miscCommands.ts:200-210` — Command Palette entry `quantize-to-grid-elastic` dispatches `detectTransients` on the selected clip.
- `src/modules/Arrangement/models/Track.ts:79` — `StretchMode = 'off' | 'repitch' | 'timestretch'` on `Clip`.
- `src/modules/Arrangement/models/WarpMarker.ts` — existing warp marker model (per-clip time-stretch control).
- `src/modules/Arrangement/useCases/warp/` — existing infrastructure: `addWarpMarker`, `moveWarpMarker`, `removeWarpMarker`, `enableWarping`, `disableWarping`, `setStretchMode`, `setDefaultAlgorithm`.
- `src/modules/AudioEngine/useCases/audioWarping/` — existing warp-algorithm parameter surface (`setWarpAlgorithm`, `setStretchRatio`, `setFormantPreservation`).

What is missing:
- Any store for elastic-audio editor state (selected markers, sensitivity, tool mode).
- Any transient-detection DSP. No `detectTransients` use-case implementation.
- Any `quantizeTransients` use-case implementation.
- No UI — no editor panel, no tab, no marker rendering specific to transients (today's `WaveformEditor` renders warp markers but does not distinguish transient-origin markers).
- No distinction between user-locked markers and auto-detected markers (needed to preserve user edits on sensitivity change).

## Design

### Relationship to existing warp markers

Transient markers and warp markers are the **same data type** (`WarpMarker`) with one added discriminator field:

```ts
export type WarpMarker = {
    id: string;
    clipId: string;
    /** Time within the clip, in clip-local beats (not absolute timeline beats). */
    localBeat: number;
    /** Where this marker maps to after warping. Equals localBeat for un-moved markers. */
    targetBeat: number;
    locked: boolean;
    /** NEW: where this marker came from */
    origin: 'user' | 'transient-auto' | 'grid-snap';
    /** NEW: detection confidence (0..1); undefined for 'user' */
    confidence?: number;
};
```

`origin: 'transient-auto'` markers are re-computed on sensitivity change; `origin: 'user'` and `origin: 'grid-snap'` are preserved.

### Transient detection algorithm

Spectral flux with a median-filter adaptive threshold, as is standard for onset detection:

1. Decode the clip's audio buffer (reuse `audioBufferCache`).
2. FFT in 2048-sample windows with 512-sample hop.
3. Compute spectral flux per frame: `sum(max(|X_t[k]| - |X_{t-1}[k]|, 0))`.
4. Smooth with a 5-frame median filter.
5. Peak-pick: a frame is an onset if it exceeds `mean + sensitivity * std` of the surrounding 11-frame window.
6. Convert frame indices to beat positions using the clip's source tempo (from `Clip.stretchRatio` and project tempo).

Sensitivity maps `0..1` to `std multiplier 3..0.5` (low sensitivity = few strong hits, high sensitivity = many soft onsets). Default 0.5.

Implementation split:
- Pure detection: `src/modules/AudioEngine/useCases/elasticAudio/detectTransients.ts` — `(samples: Float32Array, sampleRate: number, sensitivity: number) => Array<{ sampleOffset: number; confidence: number }>`.
- Orchestration: `detectTransientsForClip(clipId, sensitivity)` — loads audio, runs detection in a worker, writes markers to the warp-marker store, diff-merging with existing user-locked markers.

### Quantize to grid

For each non-locked transient marker, compute the nearest grid beat (the project's current snap resolution — 1/16, 1/8, 1/4 etc from `transportStore.gridDivision`). Set `targetBeat` to that grid beat. The existing stretch engine consumes `localBeat → targetBeat` mappings already. Preserve `localBeat`; only move `targetBeat`.

Clip's `stretchMode` must be switched to `'timestretch'` if it was `'off'`. Clip's `stretchRatio` is computed from the total span ratio after quantization.

Undo: one grouped undo entry covering all marker mutations + the stretch mode change.

### Elastic editor state store

```ts
// src/modules/AudioEngine/stores/elasticAudio.ts
export type ElasticEditorTool = 'select' | 'add-marker' | 'remove-marker' | 'lock-marker';
export type ElasticAudioState = {
    /** Clip being edited (null = editor closed) */
    openClipId: string | null;
    /** Current tool mode */
    tool: ElasticEditorTool;
    /** Detection sensitivity (0..1) */
    sensitivity: number;
    /** Marker ids currently selected */
    selectedMarkerIds: string[];
    /** Has detection run at least once for this clip? */
    detected: boolean;
};
export const elasticAudioStore = createStore<ElasticAudioState>({ ... });
```

The store does **not** hold markers; markers live in the warp-marker store (shared with the existing warp workflow). This store only holds editor-UI state.

## API surface

```ts
// src/modules/AudioEngine/useCases/elasticAudio/detectTransients.ts
export function detectTransients(
    samples: Float32Array,
    sampleRate: number,
    sensitivity: number
): ReadonlyArray<{ sampleOffset: number; confidence: number }>;

// src/modules/AudioEngine/useCases/elasticAudio/detectTransientsForClip.ts
export function detectTransientsForClip(
    clipId: string,
    sensitivity: number
): Promise<Result<{ added: number; kept: number; removed: number }, ElasticError>>;

// src/modules/AudioEngine/useCases/elasticAudio/quantizeTransients.ts
export function quantizeTransients(clipId: string): Result<{ moved: number }, ElasticError>;

// src/modules/AudioEngine/useCases/elasticAudio/addManualMarker.ts
export function addManualMarker(clipId: string, localBeat: number): void;

// src/modules/AudioEngine/useCases/elasticAudio/toggleMarkerLock.ts
export function toggleMarkerLock(markerId: string): void;

// src/modules/AudioEngine/useCases/elasticAudio/removeMarker.ts
export function removeMarker(markerId: string): void;

// src/modules/AudioEngine/useCases/elasticAudio/openElasticEditor.ts
export function openElasticEditor(clipId: string): void;
export function closeElasticEditor(): void;

// src/modules/AudioEngine/useCases/elasticAudio/setSensitivity.ts
/** Live-adjusts detection sensitivity; re-runs detection for auto-origin markers
 *  only, preserving user + grid-snap markers. Debounced upstream. */
export function setSensitivity(sensitivity: number): Promise<void>;

// Error type
export type ElasticError =
    | { code: 'CLIP_NOT_FOUND'; clipId: string }
    | { code: 'CLIP_NOT_AUDIO'; clipId: string }
    | { code: 'NO_BUFFER'; clipId: string }
    | { code: 'NO_MARKERS_TO_QUANTIZE'; clipId: string };

// AppAction additions — extending existing `detectTransients`/`quantizeTransients`
// payloads to be fully handled (not stubs), and new interactive actions:
type ElasticActions =
    | { type: 'openElasticEditor'; payload: { clipId: string } }
    | { type: 'closeElasticEditor'; payload?: undefined }
    | { type: 'elasticSetSensitivity'; payload: { sensitivity: number } }
    | { type: 'elasticAddMarker'; payload: { clipId: string; localBeat: number } }
    | { type: 'elasticRemoveMarker'; payload: { markerId: string } }
    | { type: 'elasticToggleMarkerLock'; payload: { markerId: string } };
```

## UI / UX

- **Bottom panel tab** — add a new tab to the existing bottom panel (where MIDI editor and automation editor already live). Tab label: "Elastic". Visible only when the selected clip is audio.
- **Editor layout**:
  - Toolbar (top): Tool buttons (Select / Add / Remove / Lock), Sensitivity slider, Detect button, Quantize button, Stretch mode dropdown (`repitch` / `timestretch`), Algorithm dropdown (reuses `getAlgorithmInfo`).
  - Canvas (main): Waveform view with markers. Auto markers in blue (with confidence-based opacity), user markers in orange, locked markers with a small lock icon, grid-snap target ghost markers in dashed grey.
  - Detail strip (bottom): marker count, undoable action hints.
- **Drag to move**: dragging a marker moves its `targetBeat`, not `localBeat`. Dragging with Alt moves `localBeat` (advanced — re-locates where the transient *is*). Ctrl-drag snaps to the current grid division.
- **Sensitivity slider**: live recomputes on release (debounced 150 ms). Each recompute removes prior `transient-auto` markers and reinserts the new set, preserving `user` and `grid-snap` origins.
- **Keyboard**: `T` (transient tool), `G` (quantize), `Delete` (remove selected).
- **Command Palette**: existing `quantize-to-grid-elastic` entry stays; add `Elastic: Detect Transients`, `Elastic: Open Editor for Selected Clip`, `Elastic: Quantize Selected Clip`.

## Data model / persistence

Markers already persist in the warp-marker store (`WarpMarker[]`) and in `ProjectData.arrangement.warpMarkers`. Add the two new fields to that persisted type:

```ts
type PersistedWarpMarker = {
    id: string;
    clipId: string;
    localBeat: number;
    targetBeat: number;
    locked: boolean;
    origin?: 'user' | 'transient-auto' | 'grid-snap'; // NEW, default 'user' for pre-migration markers
    confidence?: number;                              // NEW
};
```

Migration: old markers without `origin` load as `origin: 'user'` — safe, because `user` markers are never auto-removed.

Elastic editor UI state (`openClipId`, `sensitivity`, `tool`, etc.) is **not** persisted — it is session-local. However, the last-used sensitivity is saved as a user preference at `userSettings.elasticAudio.defaultSensitivity` so a fresh detect on a new clip uses the user's preferred value.

## Integration points

- `src/modules/Arrangement/stores/warpMarkerStore.ts` (or wherever warp markers live — check `src/modules/Arrangement/useCases/warp/addWarpMarker.ts` for store) — extend with `origin` / `confidence`.
- `src/modules/Arrangement/useCases/warp/addWarpMarker.ts` — accept optional `origin`/`confidence` args.
- `src/modules/AudioEngine/handlers/finalFeature/handleDetectTransients.ts` — replace the stub body with `detectTransientsForClip(a.payload.clipId, a.payload.sensitivity ?? 0.5)` and surface the result via `notifyUser`.
- `src/modules/AudioEngine/handlers/finalFeature/handleQuantizeTransients.ts` — replace with `quantizeTransients(a.payload.clipId)`.
- `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts` — already respects warp markers and `stretchMode`; nothing to change.
- `src/modules/Workspace/presentations/views/ClipView/WaveformEditor.tsx` — extend the marker renderer to colour by `origin` and render a confidence halo.
- `src/modules/Workspace/presentations/views/BottomPanel/` — register the new `Elastic` tab.
- `src/modules/Transport/stores/transportStore.ts` — consume `gridDivision` in `quantizeTransients` for snap target.
- Detection runs in a dedicated worker to avoid blocking the UI on long clips. Reuse `src/modules/AudioEngine/services/` worker conventions.

## Risks / open questions

- **Stretch algorithm quality** — `timestretch` uses whatever `audioWarping/setDefaultAlgorithm` selects. We ship Elastic on top of the existing stretch; if the default algorithm smears transients, the feature looks bad. Mitigation: auto-switch to a transient-preserving algorithm (WSOLA or similar) when Quantize runs. Needs a concrete algo choice in `getAlgorithmInfo.ts`.
- **Tempo of source clip** — detection returns sample offsets; converting to beats requires a tempo. If the clip has no intrinsic tempo (one-shot), use 120 BPM as a placeholder and do not offer Quantize. UI must disable Quantize in that case.
- **Stereo handling** — detection runs on the mono downmix; markers apply to both channels. A stereo-sensitive onset detector can come later.
- **Marker explosion** — a 60-second busy clip might produce 400 markers at high sensitivity. Store size and render perf must handle this. Use a sparse array and virtualise the waveform marker renderer.
- **Undo granularity** — a sensitivity drag creates many intermediate states. Debounce + single undo entry per release, grouped by `generateGroupId()` from the undo helper.
- **Clip rendering invalidation** — adding warp markers invalidates the track's freeze state. Existing `freezeState: 'stale'` mechanism handles this; confirm it triggers on warp marker change (it already does, per `initStalenessDetection.ts`).
- **Open question**: should `detectTransients` produce the markers directly into the store or return them for confirmation first? Recommendation: direct into store — faster iteration, user can undo. Matches Ableton behaviour.

## Milestones

### M1 — Detection primitive + worker (one session)
- Pure `detectTransients` function with spectral-flux implementation.
- Dedicated worker at `src/modules/AudioEngine/workers/elasticAudioWorker.ts`.
- `detectTransientsForClip` orchestration: loads buffer, runs in worker, produces marker list.
- Replace `handleDetectTransients` stub.

### M2 — Marker store extension + quantize (one session)
- Add `origin` / `confidence` to `WarpMarker` with migration.
- Implement `quantizeTransients` snapping `targetBeat` to grid.
- Replace `handleQuantizeTransients` stub.
- Sensitivity-change diff-merge logic (preserve user/grid-snap, replace transient-auto).

### M3 — Editor store + manual marker ops (one session)
- `elasticAudioStore` + `openElasticEditor/closeElasticEditor/setSensitivity/addManualMarker/toggleMarkerLock/removeMarker` use-cases.
- Corresponding AppActions + handlers.
- Undo grouping via `generateGroupId()`.

### M4 — UI: bottom panel tab + waveform renderer (one session)
- Elastic tab component.
- Toolbar, sensitivity slider, dropdowns, buttons.
- Waveform marker renderer coloring by `origin`.
- Command Palette entries.

### M5 — Polish: algorithm auto-select + perf (one session)
- Auto-select `timestretch` algorithm optimised for transients.
- Marker virtualisation for dense detection.
- User preference `defaultSensitivity`.
- Performance test: 120 s clip detects in <1 s on CI.

## Tests

- **Unit** — `detectTransients.spec.ts` with synthetic signal: impulses every 0.25 s in 1 s of audio, sensitivity 0.5, expect exactly 4 onsets within ±2 ms.
- **Unit** — `detectTransients.spec.ts` noise-only signal: expect 0 or at most 1 false positive at sensitivity ≤ 0.5.
- **Integration** — `detectTransientsForClip.spec.ts`: given a fixture clip, run detection, inspect `warpMarkerStore` for the expected set. Rerun with different sensitivity and assert `transient-auto` markers replaced while `user`-origin markers preserved.
- **Integration** — `quantizeTransients.spec.ts`: place markers at odd beat positions, quantize, assert every non-locked `targetBeat` equals a grid position. Assert `stretchMode` flips from `off` to `timestretch`.
- **Undo** — entire detect + move-marker + quantize chain is one undo group? At minimum: quantize is a single undo entry.
- **Editor store** — open/close, tool switching, selection management.
- **Handler** — `handleDetectTransients` now delegates to the use-case; `handleQuantizeTransients` similarly.
- **E2E (Playwright)** — open an audio clip, click Quantize, assert the clip's warp markers render on the grid and transport playback still works.
