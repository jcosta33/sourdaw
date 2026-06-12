# Arrangement module audit

> **Last adversarial verification pass: 2026-04-28.** All open issues
> in this audit have been re-checked against the current source tree.
> New issues #32–#51 added; issue #76 removed (false positive on
> verification — see `## Resolved`). Cross-module-import count revised
> upward from 346 to 582 (across 362 files).

## Scope

This audit covers `src/modules/Arrangement/` in full — timeline rendering
(canvas2d + WebGPU), timeline interactions (mouse / pointer / wheel /
gesture), tracks, clips, take lanes, markers, sections, adjustment layers,
ruler, minimap, render-model construction, the `stores/`, `useCases/`,
`repositories/`, `services/`, `transformers/`, `events/`, and the
`presentations/{views,hooks,renderers,helpers}` trees.

It explicitly excludes:

- The implementation details of cross-module callers (`Toaster`,
  `Grinder`, `GrandBoule`, `MIDI`, `Automation`, `AudioEngine`, `Workspace`,
  `Transport`, `Command`) except where they are reached from inside this
  module.
- `clipboard/`, `clipStretch/`, `clipLoop/`, `clipGainEnvelope/`,
  `vca/`, `vcaFader/`, `freezeBounce/`, `mixerSnapshot/`,
  `scratchPad/`, `groupComping/`, `device/`, `marker/`, `preset/`,
  `recording/`, `warp/`, `groove/`, `audioAnalysis/`, `songStructureDetection`,
  `rippleMove/`, `rippleDelete/`, `rippleInsert/` deeply — they are sampled
  but not exhaustively reviewed.

It is an adversarial review: bugs, race conditions, store-subscription
churn, drag/wheel listener leaks, canvas DPR/unit mismatches, clip/track
invariants, off-by-ones, contract leakage, type soundness, and
React anti-patterns.

Related spec: none on disk.

---

## Goal

A correctness-first arrangement surface for the DAW:

- The timeline canvas renderers (`createCanvasRenderer`, `createWebGpuRenderer`)
  draw pixel-accurate frames using DPR-correct units; per-frame work is
  bounded by viewport, not by total clip count.
- Auto-scroll respects user intent: a manual scroll during playback wins
  until the user explicitly opts back in.
- Drag/wheel/gesture handlers attach exactly once per surface, clean up
  reliably even on unmount mid-drag, and never double-bind on the same
  canvas.
- Clip/track invariants are enforced at use-case boundaries: clips are
  never silently dropped, `startBeat < endBeat`, deleting a clip removes
  its warp/MIDI/automation tail, removing a track preserves cross-store
  consistency.
- Stores are minimal, subscribed via `useStore`, and don't trigger
  cascading re-renders for unrelated changes (e.g. ruler subscribes to
  tempo, not to all tracks).
- AGENTS.md hard rules: no `any`/`as any`/`as unknown as`, no `useMemo`/
  `useCallback`/`React.memo`, no `forwardRef`, no namespace imports, no
  `&&` rendering, no cross-module imports of internals; one function per
  `useCases/`/`repositories/` file, single-object params on multi-arg
  functions, model isolation, use-case types stay private.

---

## Relevant code paths

### Renderers / canvas

- `presentations/views/TimelineSurface.tsx`
- `presentations/renderers/createCanvasRenderer.ts`
- `presentations/renderers/createWebGpuRenderer.ts`
- `presentations/renderers/clipDrawing.ts`
- `useCases/buildTimelineRenderModel.ts`
- `useCases/initTimelineRenderer.ts`
- `models/RendererBackend.ts`
- `models/TimelineRenderModel.ts`

### Interaction / hooks

- `presentations/hooks/useTimelineInteractions.ts`
- `presentations/hooks/useTimelineGestures.ts`
- `presentations/hooks/useTimelineFileDrop.ts`
- `presentations/hooks/useTracks.ts`
- `presentations/helpers/timelineMouse.ts`
- `presentations/helpers/timelineTools.ts`
- `useCases/timelineInteractions/*.ts`
- `useCases/timelineInteractions/hitTestClip/*.ts`

### Track / track-list views

- `presentations/views/TrackListView.tsx`
- `presentations/views/TrackHeader.tsx`
- `presentations/views/TrackHeader/{InlineTrackName,InputSelector,LevainLoadingSpinner,TrackLevelIndicator,ResizeHandle}.tsx`
- `presentations/views/TrackContextMenu.tsx`
- `presentations/views/MiniMasterSpectrum.tsx`
- `presentations/views/TakeLanesView.tsx`

### Chrome (ruler / minimap / arrangement bar / marker / adjustment layers)

- `presentations/views/BeatRulerBar.tsx`
- `presentations/views/TimelineMinimap.tsx`
- `presentations/views/TimelineChromeSurface.tsx`
- `presentations/views/ArrangementBar.tsx`
- `presentations/views/MarkerLane.tsx`
- `presentations/views/AdjustmentLayerStrip.tsx`
- `presentations/views/ClipContextMenu.tsx`
- `presentations/views/TimelineEmptyMenu.tsx`

### Stores

- `stores/{trackStore,timelineViewStore,markerStore,takeLaneStore,scratchPadStore,gainEnvelopeStore,grooveStore,vcaGroupStore,adjustmentLayer,groupComping}.ts`
- `stores/{clipDragPreviewRef,activeRecordingRef,warpStates,clipboardStore}.ts`
- `stores/{appendTrack,appendClipToTrack,updateClipInStore,persistDeviceParam}.ts`

### Use cases (sampled)

- `useCases/{addTrack,createTrack,renameTrack,duplicateTrack,removeTrack}.ts`
- `useCases/clip/{addClip,removeClip,moveClip,duplicateClip,duplicateClipCore,duplicateClipToNextBar,acceptGhostClip,dismissGhostClip,ghostClips}.ts`
- `useCases/{updateClip,replaceClipAudioBuffer,trackTemplate,trackZoom}.ts`
- `useCases/{timelineQueries,timelineViewActions}.ts`
- `useCases/{getArrangementHandlers,getAllTracks,getTrackById,getTrackStoreState,setTrackState,setTrackStoreState}.ts`
- `useCases/clipEditing/{trimClipStart,trimClipEnd,slipClipContent,toggleInlineEditing,...}.ts`
- `useCases/timelineInteractions/{beginClipDrag,getTrackAtY,hitTestClip*,hitTestClipEdge,hitTestAutomationSubLane,setPlayheadFromClick,snapToGrid,snapToGridOrClips,snapToZeroCrossing}.ts`

### Models

- `models/{Track,TrackTemplate,Marker,WarpMarker,TimelineRenderModel,TakeLane,ScratchPadSection,DeviceParameter,DeviceParameterTypes,SoundPreset,FillTransitionTypes,MixerSnapshotTypes,RendererBackend,colorPalette,AutomationViewTypes,MidiNoteViewTypes}.ts`

### Repositories / services / transformers / events

- `repositories/track/*.ts`, `repositories/trackTemplate/*.ts`,
  `repositories/presets/**`, `repositories/{clipIdCounter,getPlatformPlugins}.ts`
- `services/{applySoloLogic,findClipById,computeTrackHash,getUpstreamSubgraph,snapSplitBeatToZeroCrossing}.ts`
- `transformers/{clipDspTransformers,automationTransformers,velocityCurveTransformer}.ts`
- `events/{TrackAddedEvent,TrackRemovedEvent,TrackSelectionChangedEvent,FreezeStateChangedEvent}.ts`

---

## Current behavior

**No module barrel `index.ts`.** Other modules import deeply via
`#/modules/Arrangement/stores`, `#/modules/Arrangement/useCases`,
`#/modules/Arrangement/events`, and even `#/modules/Arrangement/models/Track`,
`#/modules/Arrangement/useCases/freezeBounce/initStalenessDetection`,
`#/modules/Arrangement/useCases/createTrack`. **Re-verified 2026-04-28:
582 cross-module import lines across 362 files** (`grep -rE
"modules/Arrangement" src --include="*.ts" --include="*.tsx" | grep -v
"src/modules/Arrangement/"`). The audit previously reported 346; the
true number is ~70% higher and growing. Architectural debt is
accelerating, not idle.

**Two Web Audio renderers + one WGSL renderer.** `TimelineSurface` mounts
a single canvas and a `ResizeObserver`, then calls `initTimelineRenderer`
which prefers WebGPU and falls back to canvas2d. The render loop is owned
by `animationScheduler`. Per frame, the loop reads
`buildTimelineRenderModel()` and hands it to `renderer.render(model)`.
Both renderers iterate every track and every clip on every frame; neither
does horizontal viewport culling at the clip level (the WebGPU one culls
at draw time inside the inner loop; canvas2d does not).

**Render-model cache.** `buildTimelineRenderModel` shallow-compares seven
upstream stores by reference; if any changed it rebuilds the entire
`TrackRenderModel[]` (including walking every clip's MIDI notes,
ghost clips, variation lanes, alternatives). Otherwise it mutates
`renderCache.model.playheadPosition` and `dataDirty=false` and returns the
same reference. A separate "recording overlay" path mutates the
endBeat of pre-cloned clip refs to grow recording clips at frame rate
without rebuilding the cache. A "drag preview" overlay rebuilds a
preview track array each frame from `clipDragPreviewRef`.

**Auto-scroll.** `timelineViewStore.autoScrollEnabled` defaults to `true`.
`useTimelineGestures` sets it to `false` when the user wheels horizontally
during playback. `TimelineSurface` has a separate effect that subscribes
to `transportStore` and forces `autoScrollEnabled=true` on every transport
change while `isPlaying`.

**Drag listeners.** `useTimelineInteractions` keeps drag state in refs
and `useState` and dispatches via React event handlers on the canvas.
`TrackListView`, `BeatRulerBar`, `TimelineMinimap`, `MarkerLane`,
`ArrangementBar`, `AdjustmentLayerStrip`, `TakeLanesView`, and
`ResizeHandle` each set up their own drag handlers that attach
`mousemove` + `mouseup` listeners to `window`/`document` on mousedown
and remove them on mouseup. None of them clean up if the component
unmounts mid-drag.

**Stores.** Most are `createStore<...>()`-backed. `warpStates` is a bare
exported `Map` with no subscription. `clipDragPreviewRef`,
`activeRecordingRef`, `previewDirtyFlag` are bare `{ current }`/`{ value }`
holders. `groupComping`, `gainEnvelopeStore`, `markerStore`, `takeLaneStore`,
`scratchPadStore`, `grooveStore`, `adjustmentLayer`, `vcaGroupStore`,
`timelineViewStore`, `trackStore` are stores. Module-level mutable
counters live in `models/Track.ts` (`trackColorCounter`) and
`useCases/trackTemplate.ts` (`templateCache`).

**Tests.** Most use cases and stores have spec files. Many cast
fixtures with `as any`/`as unknown as` and the
`useTimelineInteractions.spec.tsx` harness uses `as any` repeatedly to
construct `MouseEvent`s and canvas refs.

---

## Findings

1. **No root `index.ts` for the `Arrangement` module.** Every other
   module (Automation, AudioEngine, etc.) imports from the deep paths
   directly. AGENTS.md mandates: "Cross-module imports MUST only target
   the destination module's root `index.ts`". This is a wholesale
   contract-boundary failure: 346 deep cross-module imports across the
   repo. `#/modules/Arrangement/models/Track` and
   `#/modules/Arrangement/useCases/createTrack` are imported as-if they
   were public surface, when they are private.

2. **`stores/index.ts` re-exports model types.** `Track`, `Device`,
   `Clip` (lines 25), `AdjustmentEffectType`, `AdjustmentLayer`,
   `AdjustmentLayerState`, `AdjustmentParameter`, `AdjustmentRegion`
   (lines 32-38), `GrooveTemplate` (line 44), and `MarkerStoreState`,
   `ScratchPadStoreState`, `TakeLaneStoreState`, `VcaGroupState`,
   `GrooveState`, `GainEnvelopeStoreState`, `ClipGainEnvelope`,
   `GainEnvelopePoint`. AGENTS.md "Model isolation": models are strictly
   private. The fact that downstream modules can import `Track` directly
   means a model change cascades. This is the canonical AGENTS.md
   violation.

3. **`useCases/index.ts` re-exports use-case types.** `ResolvedClip`
   (line 91), `VariationNote` (line 45). AGENTS.md "Use-case types stay
   private": "Do not `export type` from `useCases/` for other modules".
   `useCases/timelineQueries.ts:3` re-exports `MarkerStoreState` from
   the use-case surface, an even harsher violation (a store type laundered
   through a use-case file).

4. **`useCases/timelineViewActions.ts` is an indirection layer for
   intra-module imports.** Re-exports from `Automation`, `AudioAnalysis`,
   `AudioEngine`, `Command`, `Transport`, `Workspace` (lines 42-53).
   AGENTS.md: "The root `index.ts` is for **other** modules; it is not
   an indirection layer for intra-module code." This file is consumed
   only by tests (one test imports it; no production caller). Effectively
   dead architecture-violating code.

5. **Canvas DPR mismatch in `createCanvasRenderer`.**
   `createCanvasRenderer.ts:14-19`: `ctx.clearRect(0, 0, width * dpr,
   height * dpr)` is called *before* `ctx.scale(dpr, dpr)`. With dpr=2,
   `clearRect(0, 0, 2*w, 2*h)` in unscaled coords clears the whole
   backing store correctly. But `width` and `height` are CSS pixels
   (from `resize(w, h)`) — they are stored as the CSS dim, then
   `canvas.width = w * dpr`. After `ctx.scale(dpr, dpr)`, drawing in CSS
   coords is correct. However, `clearRect` happens *before* the scale,
   so the call clears in *device* coords (same effect, but conceptually
   wrong; if the dpr ever changes mid-frame, e.g. dragging between
   monitors, the clear under-clears). Mixing is also confusing for
   anyone debugging — the same call would clear `w*h` in CSS coords
   after the scale.

6. **Canvas renderer culls nothing horizontally.**
   `createCanvasRenderer.ts:203` `for (const clip of track.clips) {
   drawClip(...) }` — every clip on every track is passed through
   `drawClip`, which builds `roundRect`, gradients, and stroke paths
   for clips that may extend hundreds of viewport widths off-screen.
   The browser clips during paint, but path construction, gradient
   construction (`createLinearGradient` per clip per frame, `clipDrawing.ts:80,90`),
   and `setLineDash`/`stroke` calls all execute. With ~1k clips, this
   is O(N) per frame even at zoomed-in views.

7. **Duplicate gesture-listener registration on the same canvas.**
   `TimelineSurface.tsx:223-257` `useEffect` registers
   `gesturestart/gesturechange/gestureend` listeners on `canvasRef.current`.
   The same canvas is then passed to `useTimelineInteractions(canvasRef)`,
   which calls `useTimelineGestures(canvasRef)`, which registers the
   *same three listeners* on the same canvas
   (`useTimelineGestures.ts:63-65`). Both effects add separate
   `onGestureChange` handlers; both call `zoomTimeline(delta * 2)` on
   each Safari pinch — meaning every pinch zooms by 2× the intended
   delta. Double-fire bug.

8. **`useTimelineGestures` `onWheel` ignores its viewport in `setScrollY`.**
   `useTimelineGestures.ts:54-59`: the local computation correctly clamps
   to `totalTrackHeight - viewHeight`, but then calls
   `setScrollY(value)` (single-arg) — which routes through
   `timelineViewStore.ts:62` `setScrollY(scrollY, viewportHeight = 200)`.
   The store-level clamp uses `viewportHeight=200` (a hardcoded fallback)
   to recompute `maxY`, *re-clamping after the hook already clamped*. If
   the actual viewport is 800 px tall and the project is 1000 px tall,
   the hook permits scrolling to 200, but the store re-clamps to
   `Math.max(0, 1000-200) = 800` — passes through. If the project is
   1800 px and the canvas is 1600 px, the hook permits 200, store clamps
   to `Math.max(0, 1800-200) = 1600` — also passes through. So in
   practice the store clamp is a no-op when `viewportHeight=200`, but
   the API contract is wrong (and any caller that legitimately needs the
   clamp without passing the height gets it wrong).

9. **Auto-scroll fights manual scroll on every transport mutation.**
   `TimelineSurface.tsx:210-221`:

    ```
    useEffect(() => {
        const unsubscribe = transportStore.subscribe(() => {
            const transport = transportStore.value;
            if (!transport) return;
            if (transport.isPlaying) {
                setAutoScroll(true);
            }
        });
        ...
    }, []);
    ```

    Combined with `useTimelineGestures.ts:51-53` (which sets autoScroll
    to false on a manual horizontal wheel during playback), this means:
    user starts playing → wheels right → `setAutoScroll(false)` →
    *any* transport store change (tempo edit, metronome toggle, loop
    toggle, master gain change — anything in `TransportState` that mutates
    while `isPlaying`) re-fires the subscriber and resets autoScroll to
    `true`. The user's manual scroll intent is silently overridden. Note:
    `transportStore` is broad — even a `playheadPosition` write to the
    store (if any path does that instead of using `playheadPositionRef`)
    would re-fire the subscriber 60×/s and continually force autoScroll
    on.

10. **`TimelineSurface` `markDirty` subscribes to 8 stores.**
    `TimelineSurface.tsx:274-281` subscribes to `transportStore`,
    `timelineViewStore`, `trackStore`, `workspaceStore`, `markerStore`,
    `tempoMapStore`, `timeSignatureMapStore`, `takeLaneStore`. Any write
    to any of these schedules a redraw. `transportStore` mutations
    (transport changes, master gain, playhead writes) flip the `dirty`
    flag every frame regardless of whether the new value affected the
    visual surface. The render loop already does
    `if (isPlaying) { dirty = true }`, so the transport subscription
    is redundant during playback and over-eager during idle. A
    finer-grained "dirty signal store" would reduce unnecessary frames.

11. **`buildTimelineRenderModel` rebuilds on `transportStore` writes.**
    `buildTimelineRenderModel.ts:131-141`: `transportState !== renderCache.transport`
    triggers a full track-list rebuild. Any transport change (tempo,
    master gain, count-in, punch-in, isLooping toggle) invalidates the
    cached track render model. None of those fields affect the
    `TrackRenderModel[]` — only `tempo`, `timeSignatureNumerator`,
    `timeSignatureDenominator`, and `playheadPosition` end up in the
    model. The other 16 transport fields trigger pointless rebuilds.
    `playheadPosition` already isn't in transportState here (it's read
    from the ref).

12. **`recordingOverlayCache` mutates clip refs that may already be in
    a previous frame's render output.** `buildTimelineRenderModel.ts:83-89`:
    "Fast path: reuse the pre-cloned overlay and just nudge the endBeat
    of the recording clips we already cloned." The comment claims the
    clips are owned by the cache, but the previous frame's
    `previewTracks` (line 333) builds a `clipById` map, then constructs
    a fresh `clips` array per track — but if the same render-model is
    handed to two consumers in a single tick (e.g. `PresenceOverlay`'s
    `trackIdToY` callback at `TimelineSurface.tsx:434` calls
    `buildTimelineRenderModel()` again), the second call re-uses the
    cached overlay and mutates the same clip refs that the first
    consumer is reading. Race-on-shared-state.

13. **`buildTimelineRenderModel` invoked from React render path.**
    `TimelineSurface.tsx:434` (inside `trackIdToY` for `PresenceOverlay`)
    calls `buildTimelineRenderModel()` per render — every time
    `marqueeSelection` changes or a clip is dragged. Same with
    `useTimelineInteractions.ts:438` calling it on mousemove. The cache
    short-circuits if no store changed, but the cache check itself
    walks the seven shallow refs. Worse: the model returned by the
    cache may be the recording overlay or the drag preview, not the
    underlying tracks — so `trackIdToY` returns an offset based on a
    "preview" view of the world, which is what we want for clip dragging
    but not what we want for resolving collaborator positions.

14. **`BeatRulerBar` calls `drawRuler` synchronously during render.**
    `BeatRulerBar.tsx:253-255`:

    ```
    if (canvasRef.current) {
        drawRuler(canvasRef.current, playheadPositionRef.current);
    }
    ```

    This is a side-effect during render — every component render
    paints the canvas. Combined with `useStore(timelineViewStore, ...)`
    + `useStore(transportStore, ...)` (lines 64-65), every transport
    field change re-renders this component (most of them are not
    reflected in the ruler) and *also* triggers a synchronous draw.

15. **`BeatRulerBar` rAF effect has unstable dep.**
    `BeatRulerBar.tsx:243`: `useEffect(..., [isPlaying, drawRuler])`.
    `drawRuler` is a function declaration *inside the component body*
    (line 76), so a new identity every render. The effect re-registers
    its rAF callback every render → unsubscribes the old one,
    schedules a new one → animationScheduler churn. In practice the
    `crypto.randomUUID()` per effect re-run produces a new id each
    cycle; the previous callback is unregistered, but only because the
    cleanup runs first. The whole structure is hostile to the React
    Compiler.

16. **`useEffect` cleanup mismatch in `BeatRulerBar`.** Same effect
    starts the rAF only when `isPlaying`; but the *render-time*
    `drawRuler` call runs unconditionally. Result: while paused,
    every component render paints the canvas; while playing, both the
    render-time draw *and* the rAF loop paint, doubling canvas writes
    per second of playback when any prop or store changes.

17. **`TimelineMinimap` global drag listeners leak on unmount.**
    `TimelineMinimap.tsx:241-242`: `document.addEventListener('mousemove',
    ..., 'mouseup', ...)`. The cleanup is wired only inside the
    `handleMouseUp` callback. If the component unmounts mid-drag (e.g.
    user drags then opens a panel that closes the minimap), the
    listeners remain on `document` for the lifetime of the page, leaking
    memory and accidentally writing to `timelineViewStore` when the
    user mouses elsewhere. Same pattern in `TrackHeader/ResizeHandle.tsx:30-31`,
    `MarkerLane.tsx:111-112`, `ArrangementBar.tsx:166-167`,
    `AdjustmentLayerStrip.tsx:187-188,248-249`.

18. **`getMinimapMetrics` walks every clip on every mousemove.**
    `TimelineMinimap.tsx:152-175`: per-mousemove the function loops over
    all tracks × clips to find `maxEndBeat`. With ~50 tracks × ~50 clips,
    that's 2500 ops per mousemove (60 Hz). Memoize the project length
    or read it from the cached render model.

19. **`TimelineMinimap` only resizes via `ResizeObserver` for width.**
    `TimelineMinimap.tsx:133-150`: the observer only updates `containerWidth`,
    triggering the draw effect. But the per-row track height
    `clampedLaneHeight = Math.min(...)` is computed from
    `trackCount`, not from the resized height — so the render
    `MINIMAP_HEIGHT` is the constant `28` and the lane heights compress
    indefinitely as tracks accumulate. With 100 tracks that's 0.26 px
    per lane.

20. **`MarkerLane` and `ArrangementBar` use a `4000`-pixel cull.**
    `MarkerLane.tsx:189` `if (left < -50 || left > 4000) return null;`
    `ArrangementBar.tsx:281` same shape. The cull threshold is hardcoded
    in pixels — unrelated to actual viewport width. On a 5K display
    (~5120 px wide), the right half of marker labels and section bars
    is silently invisible.

21. **`AdjustmentLayerStrip` cull asymmetry.**
    `AdjustmentLayerStrip.tsx:621-623`: `if (left + width < 100 || left > 4000) return null;`
    The left cull condition is `left + width < 100` (anything ending
    before x=100), then later applies `left: Math.max(110, left)`. The
    `100`/`110` magic numbers don't match (`< 100` cull, render at `≥
    110`); a region whose right edge is at x=105 would be drawn at left
    110 with a width that wraps under the 110-clamped sidebar — visual
    ghost.

22. **`ArrangementBar` and `MarkerLane` `&&` rendering.**
    `ArrangementBar.tsx:361,364`, `MarkerLane.tsx:251,256`,
    `TrackHeader.tsx:156`, `TrackListView.tsx:353`,
    `TakeLanesView.tsx:370`. AGENTS.md hard rule: "Never render with
    `&&` — use ternaries or early returns." The `MidiLearnButton.tsx:82`
    case is a value selector, not a render-presence guard, but still
    violates the literal rule.

23. **`hitTestClip.ts` uses `Math.min(...notes.map(...))` /
    `Math.max(...notes.map(...))`.** `hitTestClip.ts:52-53`. For a clip
    with thousands of MIDI notes, this stack-overflows. The WebGPU
    renderer already worked around this same issue (`createWebGpuRenderer.ts:307-321`
    has the comment "Math.max(...arr) would stack-overflow on large
    spreads") but the canvas-side `clipDrawing.ts:351-352` and the hit
    tester `hitTestClip.ts:52-53` still spread.

24. **`hitTestClip` calls `buildTimelineRenderModel()` and the caller
    re-calls it.** `hitTestClip.ts:17` invokes
    `buildTimelineRenderModel()`. `useTimelineInteractions.handleMouseMove`
    (line 438) also invokes it. Each `mousemove` triggers two cache
    checks in the same tick. The cache short-circuits, but the
    seven-store reference compare happens twice. Worse: between the two
    calls, a store can mutate (e.g. presence broadcast updating
    `collaborationStore`), invalidating cache freshness assumptions for
    no benefit.

25. **`snapToGridOrClips` threshold is in beats, not pixels.**
    `snapToGridOrClips.ts:10`: `SNAP_THRESHOLD = 0.25` (beats). At
    `pixelsPerBeat = 80` (max), 0.25 beat = 20 px (sensible). At
    `pixelsPerBeat = 2` (min), 0.25 beat = 0.5 px (invisible). At
    typical pixelsPerBeat=12, 0.25 beat = 3 px (too small). Snap is
    perceptually inconsistent across zoom levels. Should be a fixed
    pixel distance converted to beats.

26. **`addClip` doesn't validate invariants.**
    `useCases/clip/addClip.ts:6-45`: no check that `endBeat >
    startBeat`, no check that `startBeat >= 0`, no check that the track
    exists. If `track` is undefined, `inferredType` falls back to
    `'audio'`; `updateTrack` is called with the missing trackId and
    silently does nothing — the clip is *not* added but the function
    returns the constructed `Clip` object as if it had been. Caller
    has no way to detect this.

27. **`moveClip` silently drops clip on non-existent target track.**
    `useCases/clip/moveClip.ts:34-38`:

    ```
    setTrackState({
        ...state,
        tracks: tracksWithoutClip.map((time) =>
            time.id === targetTrackId ? { ...time, clips: [...time.clips, movedClip!] } : time
        ),
    });
    ```

    `tracksWithoutClip` already removed the clip from its source track.
    If `targetTrackId` doesn't match any track id, the `.map` yields
    every track unchanged — so the clip is gone. No error, no return
    value, no rollback. AI-generated `moveClip` calls with a stale
    track id will silently delete the clip.

28. **`moveClip` parameters are positional, signature mismatch with
    AGENTS.md.** `moveClip(clipId, targetTrackId, startBeat,
    originalStartBeat?)` — four positional args. Same for `setTrackHeight`
    in `ResizeHandle.tsx`, `setLoopRegion`, `seekPlayhead`,
    `addMarker`, `moveMarker`, `removeMarker`, `setMarkerColor`,
    `addSection`, `moveSection`, `resizeSection`, `setSectionColor`,
    `renameSection`, `addTake`, `setCompRegion`, `setInputMonitoring`,
    `setTrackColor`, `setTrackGain`, `armTrack`, `renameTrack`,
    `selectTrack`, `setEnvelope` (gainEnvelopeStore), `addWarpMarker`,
    `slipClipContent`, `trimClipStart`, `trimClipEnd`, etc. AGENTS.md:
    "Functions with more than one parameter take a single object param."

29. **`createTrack`/`normalizeTrack` two functions per file.**
    `useCases/createTrack.ts` exports both. AGENTS.md "One Function Per
    File: Every useCase and repository file must export exactly ONE
    function." Same in `useCases/timelineInteractions/snapToGrid.ts`
    (`getGridSnap` + `snapToGrid`), `useCases/trackTemplate.ts`
    (`saveTrackAsTemplate`, `loadTrackTemplate`, `getTrackTemplates`,
    `deleteTrackTemplate`), `stores/gainEnvelopeStore.ts`
    (`getEnvelope`, `setEnvelope`, `getAllEnvelopes`, `__resetGainEnvelopesForTest`),
    `stores/groupComping.ts` (`getNextGroupId`, `getNextTakeSetId`,
    `getNextRegionId`), `stores/warpStates.ts` (`getWarpState`,
    `addWarpMarker`), `stores/timelineViewStore.ts` (`zoomTimeline`,
    `scrollTimeline`, `setScrollX`, `setAutoScroll`, `toggleAutoScroll`,
    `setScrollY`).

30. **`useCases/createTrack.ts` is a pass-through.** Lines 10-12 and
    14-16 are zero-value re-wraps of `models/Track`'s exports. The
    file exists only to satisfy "useCases wrap models" cosmetically.

31. **Module-level mutable counters violate racing-safety.**
    `models/Track.ts:157` `let trackColorCounter = 0` increments per
    `createTrack` call. Two parallel test files calling
    `createTrack({ kind: 'audio', name: 'A' })` get different colors
    depending on file load order. HMR resets the counter mid-session.
    `useCases/trackTemplate.ts:9` `let templateCache: TrackTemplate[]
    | null = null` is racing-unsafe under concurrent `getTrackTemplates`
    calls (each may re-load).

32. **`warpStates` is a bare `Map`, not a store.**
    `stores/warpStates.ts:10`: `export const warpStates = new
    Map<string, WarpState>()`. No `subscribe` API. UI that displays
    warp markers must poll. Worse: removing a clip
    (`useCases/clip/removeClip.ts:5-18`) does not delete its warp state
    entry — orphans accumulate over a long session, leaking memory and
    making CRDT-sync inconsistent.

33. **`removeClip` doesn't clean up adjacent state.**
    `useCases/clip/removeClip.ts`: removes the clip from tracks, cleans
    up `midiStore` notesByClipId/ccByClipId/pitchBendByClipId. But:
    - Does not clean `gainEnvelopeStore.envelopes[clipId]`.
    - Does not clean `warpStates` (issue #32).
    - Does not clean `clipDragPreviewRef.current` if mid-drag.
    - Does not clean `activeRecordingRef` if recording.
    - Does not clean `clipboardStore` if the clip was on the clipboard.
    - Does not clean automation lanes scoped to the clip (calls into
      `Automation` use cases needed; absent here).
    Each is a leak vector.

34. **`getNextClipId` uses 32 bits of randomness.**
    `repositories/clipIdCounter.ts:9`: `crypto.randomUUID().slice(0, 8)`.
    Birthday collision at ~65k clip creations. A long session that
    creates and deletes thousands of clips (e.g. AI generation looping
    over takes) can collide. Source clip A gets reused id, ghost clip
    B's id collides with A — mid-drag the drag-preview map keys
    collide and one clip becomes two. Use the full UUID.

35. **`activeRecordingRef` and `clipDragPreviewRef` lack any
    invariant.** `stores/activeRecordingRef.ts:4`: `current: string[]`.
    `buildTimelineRenderModel` already noticed (`buildTimelineRenderModel.ts:309-313`)
    that "transport says we are not recording but the recording ref
    still holds clip IDs" can drift, and logs a one-shot warning. The
    fact that we need a one-shot drift detector here is itself a
    finding — the source of truth for "am I recording" should not be
    duplicated across `transportStore.isRecording` and
    `activeRecordingRef.current`. Either:
    - Make `activeRecordingRef` derive from `transportStore`
      (subscriber-driven), or
    - Make `transportStore.isRecording` a derived boolean from the ref's
      length.

36. **`previewDirtyFlag` is a bare `{ value: boolean }`.**
    `stores/clipDragPreviewRef.ts:37`: any subscriber must poll. The
    render loop in `TimelineSurface.tsx:308-311` does poll, but no
    `useStore` would catch a write — this is the canonical case where
    a store is replaced by a "ref + poll" because the writers don't
    want to rebuild the render model. That's fine for the rAF loop, but
    *writers* of `previewDirtyFlag.value = true` (e.g.
    `useTimelineInteractions.ts:243,409,477`) flip the flag and rely on
    the render loop running. If the render loop is paused (component
    unmounted between mount and animationScheduler tick), the dirty
    flag stays stuck `true` and the next mount re-uses it.

37. **`gainEnvelopeStore` exports test-only function.**
    `stores/gainEnvelopeStore.ts:60-62` `__resetGainEnvelopesForTest`.
    This is bundled in production. AGENTS.md / general practice: gate
    behind `import.meta.env.MODE === 'test'` or move to a test util.

38. **`drawClip` uses `Date.now()` for animation.**
    `clipDrawing.ts:28,39`: `Date.now() / 150`, `Date.now() / 1000`.
    `Date.now()` is ms-precision and changes only when the system clock
    ticks (and is subject to clock jumps). Use `performance.now()` for
    monotonic, sub-ms animation timing.

39. **`clipDrawing.ts` allocates two gradients per clip per frame.**
    Lines 80-83 (`bodyGrad`) and 90-93 (`depthGrad`) call
    `ctx.createLinearGradient(...)` per clip per frame. With 1k clips
    and 60 fps, that's 120k gradient allocations per second. Static
    color stops don't need a gradient at all; both `bodyGrad`'s stops
    are identical (`clip.color, clip.color`), so the gradient is a fancy
    no-op solid fill — a `ctx.fillStyle = clip.color` would suffice.

40. **`clipDrawing.ts:411` `iterations < 100` magic loop bound.**
    The MIDI-note loop iteration cap is 100 (and the WebGPU one is
    `MAX_NOTES_PER_CLIP = 300`). Inconsistent visual fidelity between
    backends; a clip with 200 notes shows 200 in WebGPU but only 100
    in canvas2d.

41. **`clipDrawing.ts` `drawWaveformPeaks` allocates per peak rect.**
    The waveform path computes peak indices in a tight loop and calls
    `ctx.fillRect` per bin. With ~2000 bins per clip × dozens of audio
    clips, fillRect dominates frame budget (issue not unique here, but
    canvas2d has no batching).

42. **`createWebGpuRenderer` calls `colorToRgba` per rect.**
    `createWebGpuRenderer.ts:251`. With ~10k rects per frame, that's
    10k regex matches against `oklch(...)` per frame. Cache by string
    key.

43. **`createWebGpuRenderer` calls `resolveToken` inside `addRect`'s
    color branch on every rect.** Lines 262-263, 444. `resolveToken`
    likely reads CSSOM (an expensive call into the layout engine).
    Hoist outside the per-frame loop.

44. **`createWebGpuRenderer.dispose` calls `device.destroy()`.**
    Line 511: a single `<TimelineSurface>` re-mount destroys the
    WebGPU device. If multiple consumers share devices in the future,
    this is a footgun; for now, `dispose` also `.destroy()`s the
    only buffer (`gpuBuf.destroy()`) before the device — order matters
    for WebGPU drivers and some implementations error. Should
    `device.destroy()` only.

45. **`MAX_RECTS = 32768` is silently exceeded with no warning.**
    `createWebGpuRenderer.ts:248-250`: `if (rectCount >= MAX_RECTS)
    return;` — silently drops. With many tracks and high zoom, the
    user sees clips disappear with no log. Add `logger.warn` once per
    overflow.

46. **`TimelineSurface` `marqueeStyle` IIFE re-runs on every parent
    state change.** `TimelineSurface.tsx:61-117`: the IIFE walks all
    tracks every render to compute `top`/`bottom`/`height`. Per the
    React Compiler this is *probably* memoized, but the algorithm is
    O(N) on every render. Two inefficiencies stack: `for (const [idx,
    track] of tracks.entries())` finds the top/bottom track index, then
    a *second* loop `for (let i = 0; i <= bottomTrackIdx; i++)`
    accumulates Y offset. The per-track height is hardcoded to
    `TRACK_HEIGHT_VALUES.normal` — **wrong**: tracks have variable
    `height` (set by `ResizeHandle`, persisted in `track.height`), but
    the marquee box assumes uniform `normal` rows. So the marquee
    visually misaligns when any track is `compact` or `large`.

47. **`TrackListView` draggable rows + Cmd/Ctrl reorder.**
    `TrackListView.tsx:264-279`: every row is `draggable` with native
    DnD. Native drag sets `dataTransfer` but `handleDrop` ignores it
    and reads `dragTrackIdRef.current`. If the user drags a row out of
    the window and drops elsewhere, `dragend` fires but `drop` doesn't —
    `dragTrackIdRef` is cleared on `dragend`, OK. However, the `index`
    parameter passed to `handleDrop` is the *visible* index;
    `reorderTrack` is called with the *global* index resolved by
    matching `visibleTracks[index].id` in the global `tracks` list.
    With folder collapse, two visible rows can map to the same global
    index slot if a parent and its child are both in `tracks` but the
    child is hidden. The lookup `tracks.findIndex((t) => t.id ===
    visibleTracks[index]?.id)` works only because they share an id, but
    the meaning of "drop *here*" between two visible rows is ambiguous
    when invisible rows are between them.

48. **`TrackListView` uses `useStore(timelineViewStore, defaultTimelineView)`
    yet only reads `scrollY`.** `TrackListView.tsx:72-73`. The whole
    `TimelineViewState` is subscribed for one field, so any
    pixelsPerBeat / scrollX / autoScrollEnabled change re-renders the
    entire track list (which has its own ResizeObserver-free,
    non-virtualised list of `TrackHeader`s). The per-row deep tree
    (`TrackHeader` + `TakeLanePanel`) re-renders on every horizontal
    pan.

49. **`TrackListView` `handleScroll` writes to store without rAF
    throttling.** Line 89-98: every pixel of scroll → store write →
    `useStore` notify → `useLayoutEffect` re-syncs `el.scrollTop`. The
    `isSyncingRef` guard prevents the immediate echo, but there's no
    rAF batching — heavy scrolls spam the store at 60+ Hz.

50. **`TrackListView.useLayoutEffect` echo prevention is fragile.**
    `TrackListView.tsx:75-87`:

    ```
    if (Math.abs(el.scrollTop - scrollY) > 1) {
        isSyncingRef.current = true;
        el.scrollTop = scrollY;
        requestAnimationFrame(() => { isSyncingRef.current = false; });
    }
    ```

    The 1-pixel threshold + rAF flag means: external `setScrollY(101)`
    while user is dragging at scrollTop=100 → effect runs → sets
    scrollTop=101, isSyncingRef=true → user wheels another pixel
    → handleScroll early-returns → user thinks scroll lagged. Race
    between user scroll and external store writes. Fragile.

51. **`MarkerLane` `dragRef` set but never read after assignment.**
    `MarkerLane.tsx:88-92`: writes `dragRef.current` but never reads
    `dragRef.current.markerId` etc.; the function uses `lastBeat`
    closure. The ref serves only to gate `handleLaneContextMenu`
    (line 116) — a single boolean would do. Dead state.

52. **`MarkerLane.handleMarkerDragStartStable` listener leaks on
    unmount.** Issue #17 again. Same comment for `ArrangementBar`
    and `AdjustmentLayerStrip`.

53. **`AdjustmentLayerStrip` two `previewRef`/`fadePreviewRef`
    `useEffect`s that copy state into refs.**
    `AdjustmentLayerStrip.tsx:252-260`. On every drag-step state
    update, the effect copies `dragPreview` → `previewRef.current` and
    `fadePreview` → `fadePreviewRef.current`. The `handleUp` closure
    reads from the ref so it gets the latest value at mouseup. But
    React batches state updates, so the ref might not have the very
    latest value when the user releases — particularly if the mouseup
    fires synchronously in the same micro-task as the last mousemove
    setState. The `useEffect` runs *after* commit, so it lags one
    React-commit behind the dispatched setState. On a fast drag-and-
    release, the committed value sent to `executeAppAction` may be one
    frame behind the user's final position.

54. **`AdjustmentLayerStrip.executeAppAction` is the dispatch path; it
    bypasses the use-case layer.** Lines 175, 236, 266, 274, 278, 282,
    286, 290, 294, 299. UI directly serialises actions to the command
    bus instead of calling the use case. Mixed responsibility — other
    presentations call the use cases directly (`MarkerLane.removeMarker`,
    `TrackHeader.muteTrack`). Inconsistent dispatch surface.

55. **`AdjustmentLayerStrip.EMPTY_RANGE_SENTINEL` lifetime mutability
    risk.** Lines 679-687: a frozen-by-convention but not-frozen-in-fact
    object representing "the full lane". `Object.freeze` would make
    accidental mutation impossible. Without it, any code path that
    reads `region` and writes `region.startBeat = ...` mutates the
    sentinel, leaking state across all layers.

56. **`TimelineMinimap` viewport drag mutates store at 60+ Hz.**
    `TimelineMinimap.tsx:218-233`: every mousemove calls
    `timelineViewStore.set({ ...currentViewState, scrollX:
    targetScrollX })`. No throttling, no rAF batching. Every consumer
    of `timelineViewStore` re-renders per pixel of drag. The comment
    on `BeatRulerBar` admits this is exactly the problem the loop
    preview was added to avoid; the same problem persists here.

57. **`useTimelineInteractions` `getCanvasCoords` recomputes
    `getBoundingClientRect` per event.** Per `mousemove` (60+ Hz)
    + per `mousedown`/`mouseup`. `getBoundingClientRect` triggers a
    style/layout flush; combining with the ResizeObserver in
    `TimelineSurface` it can cause layout thrashing. Cache the rect
    in a ref; invalidate on `ResizeObserver`.

58. **`useTimelineInteractions.handleMouseMove` calls
    `buildTimelineRenderModel()` for drag track-resolution.** Line 438.
    Already discussed in #24, but worth flagging: the hot path of
    dragging a clip rebuilds the render model snapshot to find which
    track is under the cursor. The cache-key check against seven
    stores happens at 60+ Hz during drag. A simpler `getTrackAtY` over
    `trackStore` (already imported) skipping the render-model
    indirection would suffice for this purpose.

59. **`useTimelineInteractions.handleMouseDown` Ctrl/Cmd+Shift slip
    only fires on `select` tool.** Lines 154-171: the slip-edit guard
    is a top-level `if`, but the `dragMode` calc at line 213-216 only
    enters `trim-start`/`stretch` for `tool === 'select'`. So
    Ctrl+Shift+drag while the `cut` tool is active falls through to
    nothing. Tool-mode and modifier-key affordances are tangled.

60. **`useTimelineInteractions.handlePointerMove` two-finger pinch
    leaks pointer events.** Lines 925-948: `pointersRef.current.set(...)`
    is called regardless of how many pointers are tracked. If a third
    pointer joins (touchscreen + Apple Pencil + finger), the two-finger
    branch picks the first two; the third's deltas leak into next
    frames. Cap the map at 2.

61. **`TrackHeader/ResizeHandle` resize listener leak (issue #17).**
    Plus `setTrackHeight(trackId, value)` is positional. Plus the
    handle uses `event.currentTarget.parentElement` to read starting
    height — fragile against any wrapper change in `TrackHeader.tsx`.

62. **`MiniMasterSpectrum` raf manual instead of `animationScheduler`.**
    Lines 60: `requestAnimationFrame(draw)`. Every mounted
    `MiniMasterSpectrum` runs its own rAF, racing the timeline rAF and
    the ruler rAF. Centralised scheduler exists; inconsistently used.

63. **`MiniMasterSpectrum` reads `canvas.height`/`canvas.width` instead of
    cssDim × dpr.** Lines 49-50: `canvasHeight = canvas.height`. The
    `<canvas>` element in JSX (line 108) hardcodes `width={180}
    height={80}` and never DPR-scales. So on a 2× display the spectrum
    is rendered at 180×80 device pixels stretched to 90×40 CSS — half
    resolution. No DPR handling at all.

64. **`MiniMasterSpectrum` reads `getMasterAnalyser` once; analyser
    instance can change.** Lines 28-30: a `try { analyser =
    getMasterAnalyser() } catch { return }`. If the engine is
    re-initialised (HMR, output-device change), the captured
    `analyser` is stale; the `dataArray` keeps pulling zeros. The
    effect deps are `[isSelected]` — analyser change does not retrigger.

65. **`TimelineMinimap` viewport indicator can show "outside" the
    minimap.** Line 117: `ctx.fillRect(viewportStartPx, 0,
    viewportWidthPx, MINIMAP_HEIGHT)`. With the user at scrollX
    larger than `totalBeats * pixelsPerBeat` (project shrunk after
    a delete), `viewportStartPx > canvasWidth`; the rect is drawn
    off-canvas (no error), but the user sees no indicator and no way
    back. Should clamp.

66. **`ArrangementBar` resize math allows negative width.** Line 297:
    `width: left < 0 ? width + left : width`. When `left + width` is
    smaller than `(EDGE_ZONE = 6)`, the section becomes invisible but
    still hit-testable for the resize-edge zone (line 85-90). User
    can grab the right edge of an "invisible" section; the
    `detectEdge` then resolves to the wrong edge. Conflates
    geometry and hitbox.

67. **`ArrangementBar` minimum-duration clamp asymmetric.** Lines
    140-141 (resize-left) clamp to 4 beats: `if (lastEnd - lastStart <
    4) lastStart = lastEnd - 4`. Line 145 (resize-right) clamps
    `Math.max(origStart + 4, ...)`. So sections cannot be shorter
    than 4 beats, but `addSection` (line 217) creates them at 16 beats
    — 4 is the runtime invariant, undocumented. AddSection respects
    nothing here — a future caller could make a 1-beat section and
    the next resize would expand it forcibly.

68. **`TakeLanesView.TakeLanePanel` adds resize state but doesn't
    track resize.** `TakeLanesView.tsx:251-255`: the `handleStripMount`
    callback ref reads `getBoundingClientRect().width` once when the
    element mounts; never updates on viewport resize. Take rows on
    a resized window display at the original mount width.

69. **`TakeLanesView.TakeRow` uses `onMouseLeave` to cancel drag.**
    Lines 127-129: leaving the row cancels the drag; if the user
    drag-and-flicks past the row's bottom edge the comp region is
    silently discarded. UX: drag over rows should commit, not cancel.

70. **`TakeLanePanel.handleAddTakeFromClips`'s `addTake` positional
    args.** Line 286 / 289: `addTake(trackId, sourceClip.id, name,
    startBeat, endBeat)` — 5 positional args.

71. **Test fixtures use `as any` and `as unknown as`.**
    - `presentations/hooks/__tests__/useTimelineInteractions.spec.tsx:145,154,159,167,173,182,194,206,210,215`
    - `presentations/hooks/__tests__/useTimelineGestures.spec.tsx:89,106,107`
    - `presentations/hooks/__tests__/useTimelineFileDrop.spec.tsx:91,113,148,177,198`
    - `stores/__tests__/persistDeviceParam.spec.ts:13,32,34,59,61,66,69`
    - `stores/__tests__/arrangementMiscStores.spec.ts:20,27,68`
    - `repositories/trackTemplate/__tests__/trackTemplates.spec.ts:27`
    - `presentations/renderers/__tests__/clipDrawing.spec.ts:59`
    AGENTS.md "TypeScript — soundness" forbids these.

72. **`buildTimelineRenderModel` non-null assertion at write site.**
    Lines 296-297: `renderCache.model!.dataDirty = false`,
    `renderCache.model!.playheadPosition = ...`. The assertion is
    earned by the `if (dataChanged)` branch above setting it, but a
    future refactor that drops the assignment in that branch would
    fail at runtime. The flow is brittle.

73. **`TrackListView` IIFE `marqueeSelection` only handles single-track
    height.** Discussed in #46.

74. **`TimelineSurface.handleScrollToPlayhead` on unsubscribed event
    bus.** Lines 198-202: subscribes via `onScrollToPlayhead` (a
    `Workspace` event helper). If the event helper is keyed on
    `transportStore` mutations (a common pattern), and the helper
    re-fires every transport tick, the canvas scrolls every frame.
    Need to confirm the helper's contract — flagged as risk pending.

75. **`TimelineSurface` separate `useEffect` per concern but shared
    deps.** Five `useEffect`s mounted at component init; they don't
    coordinate. The render-loop effect reads transport state inside
    a callback while the auto-scroll effect *writes* transport state
    (via `setAutoScroll`). Reasoning about the order is tricky.

76. **`useTimelineInteractions` `pushUndoEntry` closure captures
    `preview.positions` Map by reference.** Lines 716-719: in the redo
    closure, `for (const [clipId, pos] of preview.positions)` iterates
    over a *live* map. By the time redo runs, `clipDragPreviewRef.current`
    has been cleared (line 681) and the map *should* be the captured
    one — but the `Map` object is the same reference held by
    `clipDragPreviewRef.current.positions` at undo creation time. Since
    `clipDragPreviewRef.current = null` only nulls the ref, the map
    survives — until the *next* drag overwrites with a new Map (line
    242: `clipDragPreviewRef.current = { positions: new Map(originals),
    originals }`). If a redo of a duplicate drag happens *after* a new
    drag has started, the map iterated is the *new* drag's positions
    map — wrong duplication. Stash a snapshot via `new Map(preview.positions)`.

77. **`useTimelineInteractions.handleMouseUp` ripple-move undo
    captures plan but not full state.** Lines 768-803: the undo
    closure restores via `setTrackState({ ...state2, tracks:
    updatedTracks })` reading the *current* `getTrackStoreState()` —
    which may have changed since the undo was pushed. The map of
    `shiftMap` is correct, but if other clips were added/removed since,
    they remain. Mixed-state undo. Probably correct for "ripple move"
    semantics, but not documented.

78. **`useTimelineInteractions.handleMouseUp` rubber-band hit detection
    uses `model.tracks` but the drag started with `trackStore.value?.tracks`.**
    Lines 624-649: rubberband hit-tests against the render model
    (visible tracks). But marquee selection at line 652 stores
    `hitTrackIds` — these are the visible tracks. Collapsed-folder
    children are not selectable. Probably correct UX, but the marquee
    shows track-row spans starting from `top` indices, and `top` is
    computed from `model.tracks` not `trackStore.tracks` — so an
    earlier click against the same coordinates is consistent.

79. **`stripSilence` and other use cases not covered for invariants.**
    Sampling: `useCases/clipEditing/trimClipStart`, `trimClipEnd`,
    `slipClipContent`, etc. all rely on `setTrackState` to commit; a
    failure (e.g. `state` is `null`) returns silently. The pattern is
    pervasive. No tests verify "what happens when track is gone
    mid-operation".

80. **Race: `recordingOverlayCache.handles` clip ref shared with
    `getMasterAnalyser` reading.** When two consumers call
    `buildTimelineRenderModel` in the same tick and one is in the
    record overlay path, mutating `handles[i].clip.endBeat`, the
    other consumer reads the mutated clip mid-iteration. JS is
    single-threaded so the iteration completes atomically, but the
    semantics — that the clip's endBeat changed from one read-call to
    the next — are still surprising. Document or copy-on-read.

81. **`useTimelineInteractions` pinch-zoom delta is symmetrical
    with mouse-wheel ctrl+zoom.** Lines 943-944 in pointermove use
    `delta > 0 ? 2 : -2` (clamped), while wheel uses
    `-event.deltaY * 0.005`. Pinch is much more aggressive than
    wheel. Different feel between trackpad pinch (zooms 2 ppb per step)
    and Ctrl+wheel (zooms ~0.005 × deltaY).

82. **`zoomTimeline` clamps to `[2, 80]`.** Hardcoded. With long
    projects (~1000 beats) at 2 ppb, the entire project fits in 2000
    px — fine. With short projects (~16 beats) at 80 ppb, 1280 px is
    used. A user can never zoom further out than 2 ppb (project no
    longer fits) or further in than 80 (single beat = 80 px). No
    accommodation for very dense MIDI editing or very long arrangements.

83. **`TimelineSurface.aria-description` is hardcoded.** Line 408. Not
    localised. No reduced-motion handling for the spinning import
    overlay (line 398, `animate-spin`). Onboarding hints in canvas
    text (`createCanvasRenderer.ts:200` "Drop audio/MIDI here or use
    Draw tool") are baked in English.

84. **`TimelineSurface` import overlay has `aria-hidden` implicit only.**
    Lines 395-401 the importing dialog uses `pointer-events-none` and
    has no role/aria-live, so screen readers don't announce "Importing
    audio…".

85. **Drag/wheel/gesture handlers don't honour `prefers-reduced-motion`.**
    The 60-Hz preview re-renders during drag, smooth scroll on
    `setScrollX`, the marquee animation, the recording-overlay
    `Math.sin(Date.now() / 150)` flash on generating clips — none of
    these query `window.matchMedia('(prefers-reduced-motion: reduce)')`.

86. **`drawClip` "generating" pulse uses `Math.sin(Date.now() / 150)`
    in a non-rAF-driven path.** `clipDrawing.ts:28`. Called only when
    the timeline is invalidated; frame jitter visible if `dirty=true`
    is set sporadically.

87. **`AdjustmentLayerStrip` calls `executeAppAction` with `payload`
    typed by inference.** Lines 175-182 and similar: payload shape is
    not validated against the action's contract. The `Command` action
    union must already cover this (typed bus); but local
    `setLayerParameter(layerId, paramName, value)` calls with arbitrary
    strings/numbers (line 289) bypass any typing.

88. **`useTimelineInteractions.handleMouseDown.sub-lane paint` only
    activates when `automationVisibility !== 'hidden'`.** Line 134.
    Sound enough. But the *automation panel hidden* state still
    accepts paints if the user is on the automation tool — which
    falls through to `handleAutomationTool` regardless. So users can
    paint automation onto a hidden lane, see no preview, and only
    discover it when they show the lane. Mute this branch when hidden.

89. **`TrackHeader` `setInputMonitoring` cycle map drives a button
    label that is wrong.** Line 49-51: `auto → on`, `on → off`,
    `off → auto`. The button shows `INPUT_MONITORING_LABEL[
    track.inputMonitoring][0]` (line 251) — first letter of *current*
    state. So clicking from `auto` produces `O` (for `on`), but the
    shown letter is `A` (for `auto`). The user sees `A`, clicks,
    expects something to happen, but the state moves to `on` showing
    `O` — *next* click changes to `off`. The `A→O→F→A` cycle is
    correct, the label is correct, but the LatchButton's `active` is
    `track.inputMonitoring === 'on'`, so only `on` shows as active.
    `auto` (a useful default) shows inactive. UX confusion.

90. **`TrackHeader.tsx` disabled-state buttons use cosmetic
    `aria-disabled` only via `disabled` prop in some places, missing
    in others.** Inconsistent disabled handling between Latch buttons
    and the Solo logic.

91. **`MiniMasterSpectrum`-without-master returns `null`.** Lines
    85-87. Subtle: if `masterTrack` is null at first render, the
    canvas effect never runs (canvas isn't rendered). When master is
    later added, the effect's deps `[isSelected]` re-evaluate; but the
    canvas may still not be mounted on the same render that sets
    masterTrack. Dual-effect dependence on canvas presence and analyser
    presence is brittle.

92. **`TrackContextMenu` calls `setInputMonitoring(track.id, value)`
    positional, plus `armTrack`, `setTrackColor`, `renameTrack`,
    `removeTrack`, `freezeTrack`, `unfreezeTrack`, `flattenTrack`,
    `bounceTrack`, `addClip`, `importMidiFile`, `importAudioClipToTrack`
    — all positional or partial-object, none in the AGENTS.md object
    shape.

93. **`MarkerLane.menuRef`/`AdjustmentLayerStrip.menuRef` close on
    `mousedown` — but the menus also handle the same `mousedown`
    inside their content.** `MarkerLane.tsx:67`,
    `AdjustmentLayerStrip.tsx:110`. The `if (menuRef.current &&
    !menuRef.current.contains(event.target as Node))` is correct, but
    if the user clicks inside the menu on a *button*, React's
    synthetic event won't have run yet — the native `mousedown`
    bubbles through `window` first, the contains-check passes, but
    the menu re-renders *before* the React click handler runs. In
    practice the menu still closes before the click is dispatched on
    fast clicks. Race manifests as "I clicked the menu item but the
    menu just closed".

94. **`TimelineMinimap` lacks keyboard scrolling.** ARIA `role="slider"`
    is set (line 253) but no `onKeyDown` handler increments the
    `aria-valuenow`. Screen-reader users who tab onto the minimap
    cannot move the viewport.

95. **`BeatRulerBar` cleared `loopPreviewRef` only on mouseup, but
    can leak.** Lines 286-291: `if (event.buttons !== 1) {
    loopDragRef.current = null; loopPreviewRef.current = null; ... }`
    — handles the case where the user releases outside the canvas.
    But scrubDragRef is also cleared. OK. Note: since the buttons
    check is in `handleMouseMove`, a pure mousedown→mouseup with no
    move never triggers the cleanup; the early-return path at the top
    only fires after at least one move. Edge case ok in practice.

96. **`useTimelineFileDrop` (not read in detail) imports cross-modules.**
    Imported from `presentations/hooks/useTimelineFileDrop.ts` — should
    be presentation-only logic. Reaches into `Workspace`,
    `AudioEngine`. Sampled imports: many cross-module hits via deep
    paths. Same broader contract violation as #1.

97. **`scratchPadStore` has no clear-on-clip-remove path.** Not read
    in detail, but the same orphan pattern as #33 likely applies.

98. **`groupComping` `getNext*Id` UUIDs.** `stores/groupComping.ts:45-53`
    fixed in a previous note (issue 122.1) but the file still exports
    three functions. Move to `repositories/`.

99. **No explicit virtual-scrolling for the track list.**
    `TrackListView` renders every visible track header into the DOM.
    With hundreds of tracks, react reconciliation per scroll/zoom
    becomes painful. No `<react-window>`-style windowing. Same for
    `TakeLanesView`.

100. **`TimelineSurface.tsx` `handleZoomToFit` and `handleZoomToSelection`
     compute `getBoundingClientRect` and write to `timelineViewStore`.**
     Lines 119-180: each handler reads container width via
     `getBoundingClientRect()` synchronously. Forces a layout flush.
     Fine for one-shot user actions, but if the events fire repeatedly
     (e.g. the keyboard-shortcut bus emits the event per key press
     held), multiple flushes per frame. No debounce.

---

## Priorities

(Re-ordered 2026-04-28 to surface the highest-impact correctness bugs ahead of the architectural cleanups.)

1. **`duplicateClipCore` loses every per-clip property except name + audioBufferId** (issue #33-new) — every Cmd+D / Alt-drag / "duplicate to next bar" silently strips fades, gain envelope, mute, lock, color, custom audio offset, loop config, stretch, warp. Highest-impact data-loss bug in the module.
2. **`moveClip` silently drops clips on bad target track + `addClip`/`updateTrack` silent no-ops** (issues #9, #26, #27, plus repository-level #43) — silent data loss / silent no-op pervasive across the canonical write path.
3. **Marquee selection box uses wrong height table** (issue #32-new) — `TimelineSurface` uses `TRACK_HEIGHT_VALUES.normal=64` while real tracks default to `track.height=80` and are user-resizable; the marquee never matches the actual layout.
4. **No root `index.ts` + 582 deep cross-module imports across 362 files** (issues #1, #2, #3, #4, #50) — wholesale contract failure that blocks any safe refactor; ~70% larger surface than the audit's earlier 346 measurement.
5. **`removeClip` orphans state across stores** (issue #33) plus **`warpStates` is a bare Map** (#32) — clip deletion leaves gainEnvelope, warp, and ghost-clip records pointing at non-existent clips. Memory + correctness leak. **Compounds with #1 above** — every duplicate also doesn't *clone* gainEnvelope/warpStates, so duplication and deletion both leave inconsistent stores.
6. **Drag listener leaks across 5+ components** (issues #17, #52, #61, #93) — every drag-style component leaks `mousemove`/`mouseup` listeners on `window`/`document` if unmounted mid-drag.
7. **Auto-scroll fights manual scroll + duplicate gesture-listener registration** (issues #6, #7, #9-original) — Safari pinch zooms 2× the intended delta; auto-scroll resets every transport tick.
8. **Canvas2D culls nothing horizontally + per-frame allocations** (#4, #6-orig, #39, #41) — frame budget collapses past ~500 clips on the default backend.
9. **`buildTimelineRenderModel` rebuilds on irrelevant transport changes + invoked from React render path** (#11, #13, #51-new) — cache churn that flows into all three renderers; MasterGain slider drag invalidates render cache 60×/s.
10. **`useTimelineFileDrop` JSON.parse + `as` assertion + silent catch** (issue #35-new) — type-unsafe boundary, swallowed errors, NaN clip durations on malformed payloads.
11. **`Math.min/max(...notes.map)` in canvas2d clip drawing + hit test** (#23) — stack overflow on long MIDI clips. WebGPU already worked around it; the sibling code paths still spread.
12. **`BeatRulerBar` paints during render and re-registers rAF every render** (#14, #15, #16) — biggest React anti-pattern in the module.
13. **`MiniMasterSpectrum` rAF runs continuously regardless of selection + no DPR** (issue #40-new + #62/#63 originals).
14. **32-bit ID truncation across 33 call sites** (issue #23 re-scoped) — birthday collisions plausible in long AI-generation sessions.
15. **`TrackHeader` input-monitoring button has divergent `toggle` semantics** (issue #44-new) — keyboard toggle skips `auto`, button cycles `auto→on→off`; users have two non-equivalent paths to the same control.
16. **Multi-function-per-file violations** (#29) — pervasive AGENTS.md non-compliance.

---

## Open issues

### 1. No root `index.ts`; cross-module imports go to deep paths

**Problem:** `src/modules/Arrangement/` has no `index.ts`. **582
cross-module import lines across 362 files** (re-verified 2026-04-28)
target subpaths (`#/modules/Arrangement/stores`,
`#/modules/Arrangement/useCases`, `#/modules/Arrangement/events`,
`#/modules/Arrangement/models/Track`,
`#/modules/Arrangement/repositories/...`). AGENTS.md mandates a single
root `index.ts` as the cross-module surface and forbids deep imports.
Severity is **higher** than originally reported — the deep-import
count is ~70% above the 346 baseline cited in earlier audit drafts.

**Representative files:**

- (missing) `src/modules/Arrangement/index.ts`
- `src/utils/createFindDeviceRef.ts:1`
- `src/modules/GrandBoule/useCases/resolveGrandBouleEngine.ts:1-2`
- `src/modules/Toaster/useCases/createDrumTrackStack.ts:15`
- `src/modules/Grinder/useCases/grinderParamBridge/...` (multiple)
- `src/app/bootstrap.ts:6,16-17`
- `src/app/registerDependencies.ts:7`

**Needed:** Create `src/modules/Arrangement/index.ts` that re-exports
the curated cross-module surface (use cases, events, public stores,
public views) and migrate callers. Forbid deep imports via the
existing `eslint-plugin-deps` rule. This is a long mechanical refactor
but unblocks all subsequent contract enforcement.

### 2. `stores/index.ts` re-exports model types; `useCases/index.ts` and `useCases/timelineQueries.ts` re-export use-case + store types

**Problem:** AGENTS.md "Model isolation" forbids exporting models
across module boundaries. AGENTS.md "Use-case types stay private"
forbids `export type` from `useCases/`. Both rules are violated.

**Representative files:**

- `src/modules/Arrangement/stores/index.ts:25,32-38,44,47`
- `src/modules/Arrangement/useCases/index.ts:45,91`
- `src/modules/Arrangement/useCases/timelineQueries.ts:3`

**Needed:** Strip `export type` from both barrels. Each consumer
module defines its own local type containing only the fields it uses
(per AGENTS.md "Model isolation"). For the few legitimate cases where
a payload type *must* cross modules, expose it via `events/` (the only
exception in AGENTS.md).

### 3. `useCases/timelineViewActions.ts` is an indirection layer for intra-module imports

**Problem:** The file re-exports from `Automation`, `AudioAnalysis`,
`AudioEngine`, `Command`, `Transport`, `Workspace`. AGENTS.md: "The
root `index.ts` is for **other** modules; it is not an indirection
layer for intra-module code." Only one test imports it; no production
code path.

**Representative files:**

- `src/modules/Arrangement/useCases/timelineViewActions.ts:42-53`
- `src/modules/Arrangement/useCases/__tests__/timelineViewActions.spec.ts`

**Needed:** Delete the cross-module re-exports. Migrate the test to
import directly. The file itself is probably deletable in full;
verify no stray `import { ... } from '../../useCases/timelineViewActions'`.

### 4. Canvas2D renderer DPR mismatch and no horizontal culling

**Problem:** `clearRect(0, 0, width * dpr, height * dpr)` is called
*before* `ctx.scale(dpr, dpr)`, mixing CSS and device coordinates in a
single function — confusing if not strictly wrong. Then `drawTracks`
iterates every clip on every track without horizontal viewport culling;
each clip allocates two gradients (`bodyGrad` + `depthGrad`) that have
identical color stops, plus a `roundRect` path, regardless of whether
the clip is on screen.

**Representative files:**

- `src/modules/Arrangement/presentations/renderers/createCanvasRenderer.ts:14-19,128-236`
- `src/modules/Arrangement/presentations/renderers/clipDrawing.ts:11-194`

**Needed:** Move `clearRect` after `ctx.scale(dpr, dpr)` (then call
in CSS coords). Add horizontal viewport culling at `drawTracks`:

```
const minX = -clipWidthPx;  // a few px slack
const maxX = canvasWidth + clipWidthPx;
if (x + w < minX || x > maxX) continue;
```

Drop the gradient allocation in `drawClip` since both stops are
identical — use `ctx.fillStyle = clip.color`.

### 5. `recordingOverlayCache` and shared clip refs across consumers

**Problem:** `buildTimelineRenderModel` mutates `handle.clip.endBeat`
in-place during recording; multiple consumers in the same tick
(`TimelineSurface` render loop, `useTimelineInteractions.handleMouseMove`,
`PresenceOverlay.trackIdToY`) read the same model back-to-back. The
mutation is intra-tick "safe" only because JS is single-threaded.
Future maintenance changing the order of consumers can introduce a
read of a half-mutated clip.

**Representative files:**

- `src/modules/Arrangement/useCases/buildTimelineRenderModel.ts:46-93,300-358`
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:434`
- `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts:438`

**Needed:** Either return a freshly-cloned clip array each frame
(predictable, slower) or document the mutation contract and add a
runtime assertion that the mutated handles are not held by external
code beyond the current frame. A `Object.freeze` on the returned
model in dev mode would catch accidental writes from consumers.

### 6. Auto-scroll fights manual scroll + duplicate gesture listener

**Problem:** Two cases:

- (a) `TimelineSurface.tsx:210-221` subscribes to `transportStore` and
    forces `setAutoScroll(true)` on *any* transport mutation while
    `isPlaying`. After a manual scroll (which set autoScrollEnabled =
    false), any tempo / metronome / loop / master-gain change re-enables
    auto-scroll. The user's manual intent is overridden.
- (b) `TimelineSurface.tsx:223-257` registers
    `gesturestart/gesturechange/gestureend` listeners on the canvas;
    `useTimelineGestures.ts:63-65` (called via
    `useTimelineInteractions`) registers the same three listeners on
    the same canvas. Both `onGestureChange` handlers fire per Safari
    pinch — `zoomTimeline(delta * 2)` is called twice → 2× pinch
    zoom.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:210-257`
- `src/modules/Arrangement/presentations/hooks/useTimelineGestures.ts:22-65`

**Needed:** (a) Only re-enable auto-scroll on a `play` *transition*
(false → true), not on every transport write. Either compute the
diff inside the subscriber (`prev.isPlaying !== curr.isPlaying`) or
move the auto-scroll-on-play behaviour into the play-action
handler. (b) Delete the gesture listeners in `TimelineSurface.tsx`;
the hook owns them. Audit any other component that calls both the
hook and the inline gesture pattern.

### 7. Drag listener leaks across many components

**Problem:** Five+ components attach `mousemove`/`mouseup` listeners
to `window`/`document` on mousedown and clean up only inside the
mouseup callback. If the component unmounts mid-drag, the listeners
remain.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx:241-242`
- `src/modules/Arrangement/presentations/views/TrackHeader/ResizeHandle.tsx:30-31`
- `src/modules/Arrangement/presentations/views/MarkerLane.tsx:111-112`
- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:166-167`
- `src/modules/Arrangement/presentations/views/AdjustmentLayerStrip.tsx:187-188,248-249`

**Needed:** Move the `addEventListener`/`removeEventListener` into a
`useEffect` keyed on `dragState !== null` so React's cleanup runs on
unmount. Or extract a shared `useGlobalDrag({onMove, onUp})` hook
that handles cleanup once.

### 8. `removeClip` orphans state in adjacent stores; `warpStates` is a bare Map

**Problem:** `useCases/clip/removeClip.ts` cleans midiStore but not
`gainEnvelopeStore`, `warpStates`, `clipDragPreviewRef`,
`activeRecordingRef`, or `clipboardStore`. `warpStates` is a bare
`Map` with no subscription mechanism, and removing a clip never
clears its warp entries — orphans accumulate indefinitely.

**Representative files:**

- `src/modules/Arrangement/useCases/clip/removeClip.ts`
- `src/modules/Arrangement/stores/warpStates.ts`
- `src/modules/Arrangement/stores/gainEnvelopeStore.ts:40-49`
- `src/modules/Arrangement/stores/clipDragPreviewRef.ts`
- `src/modules/Arrangement/stores/activeRecordingRef.ts`
- `src/modules/Arrangement/stores/clipboardStore.ts`

**Needed:** Convert `warpStates` to a `Store<Record<clipId,
WarpState>>` (matching `gainEnvelopeStore`'s pattern). In `removeClip`
delete the entry from each adjacent store. Add a regression test:
add+remove 1000 clips and assert all six stores are empty.

### 9. `moveClip` silently drops clips on bad target track; `addClip` lacks invariants

**Problem:** `moveClip(clipId, targetTrackId, ...)` removes the clip
from its source track, then attempts to append to the target track via
`tracks.map(t => t.id === targetTrackId ? ...)`. If `targetTrackId`
matches no track, the clip is gone with no return value, no log, no
rollback. `addClip` accepts any `startBeat`/`endBeat`/`trackId` without
validation — a non-existent track silently makes `updateTrack` a no-op
but the function still returns the constructed Clip object as if it
succeeded.

**Re-verified 2026-04-28:** `addClip` now takes a single object param
(AGENTS.md compliant) — the positional-arg subset of this issue is
resolved for `addClip`. But the invariant gaps remain: no `endBeat >
startBeat` check, no `startBeat >= 0` check, no track-existence check.
`moveClip` is still positional (`clipId, targetTrackId, startBeat,
originalStartBeat?`) and still silently drops on bad target. The
silent drop is amplified by `handleAddClip` and `handleMoveClip`
(`handlers/clip/handleAddClip.ts:7`, `handleMoveClip.ts:6-8`)
discarding the return value: even when `addClip` returns `null`, the
command bus reports success.

**Blast radius:** `updateTrack` itself silently no-ops on bad
trackId (`repositories/track/updateTrack.ts:10-13`) — every caller
that mutates by trackId has the same swallow-on-stale-id behavior.
`mapAllTracks` is benign because it iterates all tracks, but
`updateTrack` is the canonical write path and ~30 use cases dispatch
through it.

**Representative files:**

- `src/modules/Arrangement/useCases/clip/moveClip.ts:34-38`
- `src/modules/Arrangement/useCases/clip/addClip.ts:6-45`

**Needed:** Both functions return `Result<Clip, { reason: 'no-track' |
'invariant-violation' }>` (the project already uses neverthrow per
user memory). Validate `endBeat > startBeat`, `startBeat >= 0`,
`trackId` exists. Log on failure. Add tests that assert non-existent
trackId is rejected, not silently swallowed.

### 10. `BeatRulerBar` paints canvas during render and reregisters rAF every render

**Problem:** `BeatRulerBar.tsx:253-255` calls `drawRuler(canvasRef.current)`
synchronously during the React render — a side effect during render. The
`useEffect(..., [isPlaying, drawRuler])` reregisters its rAF callback
every render because `drawRuler` is a function declaration that gets a
new identity each render.

**Representative files:**

- `src/modules/Arrangement/presentations/views/BeatRulerBar.tsx:243-256`

**Needed:** Move the discrete-state paint into a `useEffect` keyed on
the actual inputs (pixelsPerBeat, scrollX, loopStart, loopEnd, etc.).
Define `drawRuler` outside the component or hoist its inputs so the
React Compiler can stabilise its identity. The rAF effect dep array
should not depend on `drawRuler`.

### 11. `Math.min(...notes.map(...))` / `Math.max(...notes.map(...))` stack-overflow risk

**Problem:** Two call sites still spread MIDI notes into Math.min/max.
The WebGPU renderer already documented and fixed this. The canvas2D
sibling and the hit tester did not.

**Representative files:**

- `src/modules/Arrangement/presentations/renderers/clipDrawing.ts:351-352`
- `src/modules/Arrangement/useCases/timelineInteractions/hitTestClip/hitTestClip.ts:52-53`

**Needed:** Replace with the same single-pass loop the WebGPU
renderer uses (`createWebGpuRenderer.ts:312-321`). Test with a clip
holding ~100k MIDI notes (synthesised) and assert no
RangeError.

### 12. `buildTimelineRenderModel` rebuilds on every transport mutation; invoked from render path

**Problem:** The cache key includes `transportStore` (16 fields), but
only `tempo` / `timeSignatureNumerator` / `timeSignatureDenominator`
end up in the model. Master gain, count-in, punch-in changes
invalidate the entire track-render cache for nothing. Separately, the
function is called inline from `TimelineSurface.PresenceOverlay`'s
`trackIdToY` callback (line 434), reentering the cache check from
React render.

**Representative files:**

- `src/modules/Arrangement/useCases/buildTimelineRenderModel.ts:117-358`
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:425-450`

**Needed:** Narrow the cache key — split `transportStore` into
"things the timeline cares about" (tempo, time sig, isLooping,
loopStart, loopEnd, isRecording) and key the cache on those alone.
Stop calling `buildTimelineRenderModel` from React render; precompute
a `trackYOffsets` map once when `tracks` change and pass it via prop
or context.

### 13. `Math.min`/`Math.max` and gradient-per-clip allocations dominate canvas2D frame

**Problem:** `clipDrawing.ts:80-93` allocates `bodyGrad` and
`depthGrad` per clip per frame. `bodyGrad` has identical color stops
(`clip.color, clip.color`) — it's a fancy solid fill. `depthGrad` could
be cached per `(trackHeight, padding)` shape since neither depends on
the clip. `drawWaveformPeaks` calls `fillRect` per bin per clip per
frame.

**Representative files:**

- `src/modules/Arrangement/presentations/renderers/clipDrawing.ts:80-100,389-460`

**Needed:** Replace `bodyGrad` with `ctx.fillStyle = clip.color`.
Cache `depthGrad` keyed on (clipY, clipH); reset only when track
heights change. Batch waveform fillRects via a single `Path2D` per
track.

### 14. WebGPU renderer per-rect overhead

**Problem:** `addRect` (closure inside `render`), `colorToRgba`
(regex per call), `resolveToken` (CSSOM read per call) all called
~10k times per frame. Plus `MAX_RECTS = 32768` silently drops without
warning.

**Representative files:**

- `src/modules/Arrangement/presentations/renderers/createWebGpuRenderer.ts:42-81,228-481`

**Needed:** Hoist `colorToRgba` cache (Map<string, [r,g,b,a]>); call
`resolveToken` once at module init or on theme change, not per
rect. Lift `addRect` to a free function with explicit args. Add
`logger.warn` once per render-frame when `rectCount === MAX_RECTS`.

### 15. `snapToGridOrClips` threshold is in beats, not pixels

**Problem:** `SNAP_THRESHOLD = 0.25` beats. At 80 ppb that's 20 px;
at 2 ppb that's 0.5 px. Snap is invisible at low zoom and aggressive
at high zoom.

**Representative files:**

- `src/modules/Arrangement/useCases/timelineInteractions/snapToGridOrClips.ts:10`

**Needed:** Convert to a fixed pixel threshold (e.g. 8 px) divided
by `pixelsPerBeat`. Update tests in
`__tests__/snapToGridOrClips.spec.ts` accordingly.

### 16. Drag-listener leaks specifically in `TimelineMinimap` viewport drag

**Problem:** `TimelineMinimap.tsx:218-242` attaches `document`
listeners during the drag and removes them only on mouseup. Plus
walks all clips on every mousemove (`getMinimapMetrics` calls a
`for (track of tracks) for (clip of track.clips)` loop).

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx:152-242`

**Needed:** Move listeners into a `useEffect` keyed on `isDraggingRef`.
Memoise `maxEndBeat` (compute once in the layout effect, store in
ref or state). Clamp viewport indicator within canvas width (issue
#65).

### 17. Pinch zoom 2× delta + inconsistent pinch vs wheel feel

**Problem:** Duplicate gesture listeners (issue #6) plus pinch in
`useTimelineInteractions.handlePointerMove` (lines 943-944) uses
fixed `±2` ppb steps while wheel zoom in `useTimelineGestures` uses
proportional `-deltaY * 0.005`. Different feel.

**Representative files:**

- `src/modules/Arrangement/presentations/hooks/useTimelineGestures.ts:43-46`
- `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts:925-948`
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:223-257`

**Needed:** Single source for zoom math: `proportional(delta,
currentPpb)` shared by all paths. Remove the duplicate gesture block.

### 18. Hardcoded pixel-cull thresholds (`50`, `100`, `4000`)

**Problem:** `MarkerLane.tsx:189` `if (left < -50 || left > 4000) return null`,
`ArrangementBar.tsx:281` same shape, `AdjustmentLayerStrip.tsx:621-623`
asymmetric `100`/`110`. Magic constants disconnected from actual
viewport width.

**Representative files:**

- `src/modules/Arrangement/presentations/views/MarkerLane.tsx:189`
- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:281`
- `src/modules/Arrangement/presentations/views/AdjustmentLayerStrip.tsx:621-635`

**Needed:** Read viewport width from the parent (or via a shared
`useViewportWidth()` hook). Cull against
`viewportWidth + slackPx`. Replace `100`/`110` with `LEFT_GUTTER_PX`
named constants.

### 19. `&&` rendering scattered across views

**Problem:** AGENTS.md hard rule violated.

**Re-verified 2026-04-28** by `grep -rEn " && [<(\"]"`:

- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:361,364` — `{contextMenu.kind === 'empty' && (` and `'section' && (`
- `src/modules/Arrangement/presentations/views/MarkerLane.tsx:251,256` — `{contextMenu.kind === 'empty' && (` and `'marker' && (`
- `src/modules/Arrangement/presentations/views/TrackHeader.tsx:156` — `{isStale && (`
- `src/modules/Arrangement/presentations/views/TrackListView.tsx:353` — `{templates.length > 0 && (` (inside `AddTrackMenu`)

The `MidiLearnButton.tsx:82` case is `existingMapping && !isLearningThis ? ... : 'M'` — a ternary with `&&` *inside the condition*, not a render-presence guard. Not a violation; remove from list.

The `TakeLanesView.tsx:370` case is `{activeCompRegions.length > 0 && laneWidthPx > 0 ? (...) : null}` — a ternary with `&&` in the condition. Not a violation; remove from list.

**Needed:** Replace each remaining `cond && <X />` with `cond ? <X /> : null`. Mechanical refactor.

### 20. Multi-function-per-file violations across stores and useCases

**Problem:** AGENTS.md "One Function Per File: Every useCase and
repository file must export exactly ONE function." Stores aren't
covered by this rule, but several store files mix imperative
helpers (`getX`, `setX`, `addY`) with the store creation, which
duplicates the responsibility of the use-case layer.

**Representative files:**

- `src/modules/Arrangement/useCases/createTrack.ts` (`createTrack`, `normalizeTrack`)
- `src/modules/Arrangement/useCases/timelineInteractions/snapToGrid.ts` (`getGridSnap`, `snapToGrid`)
- `src/modules/Arrangement/useCases/trackTemplate.ts` (4 functions)
- `src/modules/Arrangement/useCases/timelineQueries.ts` (1 fn but type re-export)
- `src/modules/Arrangement/stores/gainEnvelopeStore.ts` (`getEnvelope`, `setEnvelope`, `getAllEnvelopes`, `__resetGainEnvelopesForTest`)
- `src/modules/Arrangement/stores/groupComping.ts` (3 ID generators)
- `src/modules/Arrangement/stores/warpStates.ts` (`getWarpState`, `addWarpMarker`)
- `src/modules/Arrangement/stores/timelineViewStore.ts` (6 actions)

**Needed:** Split each multi-function file into one-fn-per-file
under `useCases/`. Keep the store creation in `stores/` but move the
imperative helpers to `useCases/`. `__resetGainEnvelopesForTest`
should be moved to a `__tests__/helpers/` or gated by env mode.

### 21. Module-level mutable counters; racing-unsafe template cache

**Problem:** `models/Track.ts:157` `let trackColorCounter = 0` is
HMR-ephemeral, test-leaking. `useCases/trackTemplate.ts:9` `let
templateCache: TrackTemplate[] | null = null` is racing-unsafe under
concurrent calls.

**Representative files:**

- `src/modules/Arrangement/models/Track.ts:157-161`
- `src/modules/Arrangement/useCases/trackTemplate.ts:9-16`

**Needed:** Replace `trackColorCounter` with a deterministic hash of
the track id (`hashCode(trackId) % palette.length`). Replace
`templateCache` with a Promise-singleton (or remove the cache —
`loadTrackTemplates()` is presumably cheap LocalStorage I/O).

### 22. Positional-args function signatures pervasive

**Problem:** AGENTS.md "Functions with more than one parameter take
a single object param". Module-wide pattern across 20+ functions:
`moveClip`, `setTrackHeight`, `setLoopRegion`, `seekPlayhead`,
`addMarker`, `moveMarker`, `removeMarker`, `setMarkerColor`,
`addSection`, `moveSection`, `resizeSection`, `setSectionColor`,
`renameSection`, `addTake`, `setCompRegion`, `setInputMonitoring`,
`setTrackColor`, `setTrackGain`, `armTrack`, `renameTrack`,
`selectTrack`, `setEnvelope`, `addWarpMarker`, `slipClipContent`,
`trimClipStart`, `trimClipEnd`, `beginClipDrag`, `snapToGridOrClips`,
`hitTestClip`, etc.

**Re-verified 2026-04-28:** `addClip` was migrated to a single
object param (`useCases/clip/addClip.ts:6-15`). All others above are
still positional.

**Representative files:** see issue #28 list above.

**Needed:** Refactor each multi-arg function to a single
`<FunctionName>Input` object param. Mostly mechanical.

### 23. 32-bit ID truncation pervasive across the module

**Problem:** `repositories/clipIdCounter.ts:9`
`crypto.randomUUID().slice(0, 8)` — 32 bits of entropy. Birthday
collision at ~65k clip creations.

**Re-verified 2026-04-28:** This is **not localised** to
`clipIdCounter.ts`. **33 separate call sites** within
`src/modules/Arrangement/` use `.slice(0, 8)` to truncate UUIDs
(`grep -rEn "\.slice\(0, 8\)" src/modules/Arrangement | wc -l → 33`):

- Models: `Track.ts:167,176,178`, `Marker.ts:18,27`, `WarpMarker.ts:28`,
  `TakeLane.ts:26,37`, `ScratchPadSection.ts:27`
- Use cases: `trackTemplate.ts:25,56`, `duplicateTrack.ts:16,20,22,38,47,56,106`,
  `vcaFader/createVCAGroup.ts:10`, plus more
- Repositories: `clipIdCounter.ts:9`

`getNextGroupId` / `getNextTakeSetId` / `getNextRegionId`
(`stores/groupComping.ts:45-53`) correctly use **full UUIDs**, so the
pattern is mixed within the module. Within a single project session
this matters: clip dup loops (AI generation, ripple operations,
"duplicate to next bar" hammered) routinely create thousands of
clips and dozens of devices/notes/CCs/PBs in a single user session.

**Representative files:**

- `src/modules/Arrangement/repositories/clipIdCounter.ts:9`
- `src/modules/Arrangement/models/Track.ts:167,176,178`
- `src/modules/Arrangement/models/Marker.ts:18,27`
- `src/modules/Arrangement/models/WarpMarker.ts:28`
- `src/modules/Arrangement/models/TakeLane.ts:26,37`
- `src/modules/Arrangement/models/ScratchPadSection.ts:27`
- `src/modules/Arrangement/useCases/trackTemplate.ts:25,56`
- `src/modules/Arrangement/useCases/duplicateTrack.ts:16,20,22,38,47,56,106`
- `src/modules/Arrangement/useCases/vcaFader/createVCAGroup.ts:10`

**Needed:** Strip the `.slice(0, 8)` everywhere. Use full UUIDs
unconditionally — the 28 wasted bytes per ID are not worth a
session-corrupting collision. A repo-wide grep for `\.slice\(0, 8\)`
should return zero hits in `src/modules/Arrangement/` after this is
done.

### 24. `previewDirtyFlag` and `activeRecordingRef` lack invariants/subscriptions

**Problem:** Bare `{ value: boolean }` and `{ current: string[] }`
with no subscription. Writers depend on the rAF loop running, but
the rAF can be paused (unmount/remount). Drift detected at runtime
(`buildTimelineRenderModel.ts:309-313`) but not prevented.

**Representative files:**

- `src/modules/Arrangement/stores/clipDragPreviewRef.ts`
- `src/modules/Arrangement/stores/activeRecordingRef.ts`

**Needed:** Either upgrade to `createStore<...>()` (use the existing
store infrastructure that supports `useStore` + `subscribe`) and let
the rAF loop subscribe explicitly, or document the
"writer-must-trigger-render-loop" contract and gate writes behind a
helper that asserts the loop is running.

### 25. Tests use `as any` and `as unknown as` for fixtures

**Problem:** Many spec files cast partial fixtures to `any` to
satisfy types, breaking AGENTS.md "TypeScript — soundness".

**Representative files:**

- `src/modules/Arrangement/presentations/hooks/__tests__/useTimelineInteractions.spec.tsx:145+`
- `src/modules/Arrangement/presentations/hooks/__tests__/useTimelineGestures.spec.tsx:89,106,107`
- `src/modules/Arrangement/presentations/hooks/__tests__/useTimelineFileDrop.spec.tsx:91+`
- `src/modules/Arrangement/stores/__tests__/persistDeviceParam.spec.ts:13,32+`
- `src/modules/Arrangement/stores/__tests__/arrangementMiscStores.spec.ts:20,27,68`
- `src/modules/Arrangement/repositories/trackTemplate/__tests__/trackTemplates.spec.ts:27`
- `src/modules/Arrangement/presentations/renderers/__tests__/clipDrawing.spec.ts:59`

**Needed:** Build typed fixture factories that produce full `Track`,
`Clip`, `MouseEvent`-like objects. `Partial<T>` + `as T` is also
forbidden — use complete fixtures or use `vi.mocked(fn)` with the
real generic.

### 26. `MiniMasterSpectrum` no DPR; per-rAF allocation; analyser-not-resubscribed

**Problem:** Canvas dimensions hardcoded `width={180} height={80}`
without DPR scaling — half-resolution on retina. `getMasterAnalyser()`
is called once at mount; analyser changes don't retrigger the effect.
Per-rAF reads canvas.width/height from element but never dpr-scales.

**Representative files:**

- `src/modules/Arrangement/presentations/views/MiniMasterSpectrum.tsx:16-110`

**Needed:** Read the analyser via a store (or watch a "audio engine
ready" flag). Apply DPR scaling on mount and on `devicePixelRatio`
change (matchMedia query). Use `animationScheduler.register` instead
of bare rAF.

### 27. `TimelineMinimap` no keyboard support, no clamping of viewport indicator

**Problem:** `role="slider"` is set but no `onKeyDown` handler — keyboard
users cannot move the viewport. Also, when `scrollX` exceeds the
project width (e.g. project shrunk after delete), the viewport
indicator is drawn off-canvas with no recovery.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx:117,253-257`

**Needed:** Add `onKeyDown` for ArrowLeft/ArrowRight/Home/End that
mutate `timelineViewStore.scrollX`. Clamp `viewportStartPx` and
`viewportWidthPx` to `[0, canvasWidth]` for display.

### 28. `TrackListView` re-renders on every `timelineViewStore` change

**Problem:** Subscribes to the entire `TimelineViewState` to read
`scrollY` only. Every horizontal pan re-renders the whole track list.
No virtualisation; with hundreds of tracks each `TrackHeader` (with
its own buttons + tooltips) re-renders too.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TrackListView.tsx:72-87`

**Needed:** Use a narrow selector (e.g. `useStore(timelineViewStore,
defaultView, (s) => s.scrollY)`) so subscription fires only on scrollY
change. Long-term: virtualised track list (react-window / virtual).

### 29. Adjustment layer drag preview ref-via-effect lag

**Problem:** `AdjustmentLayerStrip.tsx:252-260`: `useEffect` copies
`dragPreview` state into `previewRef.current` after each commit. The
`handleUp` closure reads from the ref. On a fast drag-and-release
where the last mousemove and mouseup both fire in the same React
batch, the ref may lag one commit behind — committing a stale
position via `executeAppAction`.

**Representative files:**

- `src/modules/Arrangement/presentations/views/AdjustmentLayerStrip.tsx:133-260`

**Needed:** Compute the final position from the last mousemove
event directly (the `lastDelta` pattern used in `MarkerLane`). Drop
the state-via-ref-via-effect indirection.

### 30. `ArrangementBar` minimum-section-duration enforced asymmetrically

**Problem:** Resize-left clamp at 4 beats, resize-right at 4 beats,
but `addSection` creates 16-beat sections. Also, the body cursor
uses `EDGE_ZONE = 6` px for resize handle detection on a section
that may render at width 4 beats × ppb (e.g. 8 px at 2 ppb) — the
"body" hitbox is invisible.

**Representative files:**

- `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:46-208`

**Needed:** Document the minimum (and a `MIN_SECTION_BEATS = 4`
constant). Clamp `EDGE_ZONE` to `Math.min(6, sectionWidth / 3)` so
small sections still have a body.

### 31. `getMinimapMetrics` and `MiniMasterSpectrum.canvas` width 4000 px cull-related

**Problem:** Width-related magic numbers `4000` (cull) and `300`
(stripe limit) and `2000` (waveform bins max) are scattered without
shared constants.

**Representative files:**

- across `presentations/views/`, `presentations/renderers/`

**Needed:** Hoist into a single `presentations/helpers/timelineConstants.ts`
with names like `CULL_SLACK_PX`, `MAX_WAVEFORM_BINS`,
`MAX_NOTES_PER_CLIP`. Document each.

### 32. Marquee selection box uses `TRACK_HEIGHT_VALUES.normal=64` while real tracks default to `track.height=80` and are user-resizable

**Problem:** `TimelineSurface.tsx:91-117` builds the marquee selection
overlay by accumulating `TRACK_HEIGHT_VALUES.normal` (64 px) per
track. But:

- `models/Track.ts:198` initialises `height: 80` for new tracks.
- `useCases/toggleTrackState/setTrackHeight.ts:3-5` lets the user resize tracks freely between 30 and 300 px.
- `buildTimelineRenderModel.ts:162` and the canvas renderer both render with `track.height`, not `TRACK_HEIGHT_VALUES`.

So **the marquee box never matches the actual layout**. With default
tracks (80 px), the marquee top/bottom are offset by 16 px per track
above the start row (and growing). With user-resized tracks, the
offset is unbounded. The audit's earlier #46 underestimated this —
the bug isn't "uniform vs variable", it's that the overlay reads a
*completely different* height table than the renderer.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:91-117`
- `src/modules/Arrangement/models/Track.ts:198` (default `height: 80`)
- `src/modules/Workspace/useCases/workspaceQueries/helpers.ts` (`TRACK_HEIGHT_VALUES = { compact: 40, normal: 64, large: 96 }`)
- `src/modules/Arrangement/useCases/buildTimelineRenderModel.ts:162` (`baseHeight = ... track.height`)

**Needed:** Use the same height computation as the renderer. Either
(a) read `track.height` from the same `currentTrackStore.tracks`
already in the IIFE, or (b) call `buildTimelineRenderModel` once
(it's already cached) and use `model.tracks[i].height`. Folder
tracks must use 26 px (matching the render-model rule).

### 33. `duplicateClipCore` loses every per-clip property except name and audioBufferId

**Problem:** `useCases/clip/duplicateClipCore.ts:9-39` calls
`addClip({ trackId, startBeat, endBeat: startBeat + duration, name:
'… (copy)', type: clip.type, audioBufferId: clip.audioBufferId })`.
The new clip is **a default clip with the original's name and audio
buffer**. Every other field is silently dropped:

- `gain`, `fadeInBeats`, `fadeOutBeats`, `color`, `muted`, `locked`
- `loopEnabled`, `loopLength`, `audioOffsetBeats`, `midiOffsetBeats`
- `stretchRatio`, `assetHash`, `parentClipId`, `isLinkedInstance`
- `gainEnvelopeStore` entry (not duplicated; original's envelope ignored)
- `warpStates` entry for the source clip (not duplicated)

`duplicateClipAutomation` and `duplicateClipNotes` are explicitly
called for automation and MIDI — but the rest is lost. A user who
duplicates a faded, muted, loop-enabled audio clip with a custom
gain envelope gets back a vanilla clip pointing at the same buffer.

**Representative files:**

- `src/modules/Arrangement/useCases/clip/duplicateClipCore.ts:9-39`
- `src/modules/Arrangement/useCases/clip/addClip.ts` (the 9-field input is too narrow to carry a full clip)
- All callers via `duplicateClip` (context menu, Cmd+D), `duplicateClipToNextBar`, and Alt+drag duplicate in `useTimelineInteractions.ts:692,717`

**Needed:** `addClip` should accept a full `Clip` shape (or a new
`duplicateClipFull(sourceClipId, computeStartBeat)` use case should
clone the entire clip — including gainEnvelope and warpStates — into
the new id). Add a regression test asserting that
`duplicateClipCore` of a clip with `fadeInBeats=2, gain=1.5,
loopEnabled=true, loopLength=4` yields a copy with all four fields
intact.

### 34. `addClip` and `moveClip` handlers discard return values

**Problem:** `addClip` returns `Clip | null` and `moveClip` is `void`,
but their command-bus handlers do not surface failure to the
caller:

- `handlers/clip/handleAddClip.ts:7` calls `addClip(alpha.payload)` and discards the result.
- `handlers/clip/handleMoveClip.ts:6-8` calls `moveClip(...)` (which is `void`) — no failure path.

So even if `addClip` were updated to return `Result<Clip,
{reason}>` (per issue #9 `Needed`), the existing handler infrastructure
would still report "command applied" to the user. Fixing #9 must
update the handlers in the same change set.

**Representative files:**

- `src/modules/Arrangement/handlers/clip/handleAddClip.ts:5-12`
- `src/modules/Arrangement/handlers/clip/handleMoveClip.ts:5-12`

**Needed:** When #9's `Result` migration lands, `createHandler`'s
`execute` must propagate the failure into the command-bus return,
so the user sees a toast on bad target track. Same for any other
silent-no-op use case (issue #79).

### 35. `useTimelineFileDrop` does `JSON.parse` of attacker-supplied payloads with `as` assertions and silent catch

**Problem:** `presentations/hooks/useTimelineFileDrop.ts:49-82`:

```
const aiRenderData = event.dataTransfer.getData('application/x-sourdaw-ai-render');
if (aiRenderData) {
    try {
        const render = JSON.parse(aiRenderData) as {
            name: string;
            bufferId: string;
            durationSeconds: number;
        };
        ...
        addClip({ ..., audioBufferId: render.bufferId, ... });
    } catch {
        /* ignored */
    }
}
```

Same pattern at lines 88-94 for `application/x-sourdaw-sample`.

Two AGENTS.md violations:

1. `JSON.parse(...) as { ... }` — type assertion on external
   payload with no runtime validation. AGENTS.md "TypeScript —
   soundness" forbids this: "runtime validation at I/O boundaries
   (e.g. Zod)". Drag-and-drop dataTransfer is a textbook I/O
   boundary.
2. `catch { /* ignored */ }` — silent error swallow with a
   self-contradicting comment. User feedback memory: "comments
   signal hacks; rewrite code to be self-evident" + "fix root
   causes; never wrap errors in try/catch or defensive branches".

**Risk:** A non-conforming payload (e.g. partial AI render with
missing `bufferId`) silently fails the drop with no user feedback.
A malformed `durationSeconds: "not a number"` flows directly into
`Math.ceil((render.durationSeconds / 60) * model.tempo)` and
produces `NaN` or a garbage clip duration.

**Representative files:**

- `src/modules/Arrangement/presentations/hooks/useTimelineFileDrop.ts:49-82,84-…`

**Needed:** Define Zod schemas for `aiRenderData` and `sampleData`
in a `transformers/` file, parse with `.safeParse`, route validation
failures through `notifyUser` (already imported here). Drop the
`try/catch` — the only paths that throw are the JSON parser and the
schema validator, and both should produce a user-visible error.

### 36. `RULER_HEIGHT` is duplicated in two places, both `= 0`

**Problem:** `presentations/helpers/timelineMouse.ts:11` and
`useCases/timelineInteractions/hitTestClip/helpers.ts:1` both
export `const RULER_HEIGHT = 0`. The two files are independent;
changing one would silently leave the other at 0 and produce a
mouse-Y / hit-test-Y mismatch. This is a half-removed magic
constant — the original ruler height was non-zero, the constant
was zeroed in place but not deleted.

**Representative files:**

- `src/modules/Arrangement/presentations/helpers/timelineMouse.ts:11`
- `src/modules/Arrangement/useCases/timelineInteractions/hitTestClip/helpers.ts:1`

**Needed:** Delete both. Update the few subtraction call sites
(`getContentY = (canvasY, scrollY) => canvasY - RULER_HEIGHT +
scrollY`) to drop the term. If the ruler height is ever non-zero
again (re-introduced as a `BeatRulerBar` overlay on the canvas),
the value lives in `BeatRulerBar.tsx` already and can be imported.

### 37. `TimelineSurface.useEffect`s coordinate poorly: 5 effects all keyed on `[]` race for cleanup order

**Problem:** `TimelineSurface.tsx` mounts five separate `useEffect`s
keyed on `[]`:

- L119-208 — workspace event subscriptions
- L210-221 — auto-scroll-on-play subscriber
- L223-257 — gesture listeners (duplicate of `useTimelineGestures`, see #6)
- L259-371 — render loop + ResizeObserver + 8 store subscriptions
- (implicit via `useTimelineInteractions(canvasRef)` at L57 — internal `useTimelineFileDrop` + `useTimelineGestures` effects)

Cleanup order on unmount is the reverse of mount order. The render
loop effect's cleanup unsubscribes 8 stores; the auto-scroll effect's
cleanup unsubscribes `transportStore` separately. Both touch
`transportStore.subscribe` independently and the order of unsubscribe
matters for any subscriber that's mid-flight when the unmount lands.

If a transport mutation fires between `setAutoScroll(true)`
(auto-scroll effect line 217) and the render loop's `markDirty`
subscription (line 274), the dirty flag is set on a render that
won't run because cleanup has already disposed the renderer. Race.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:119-371`

**Needed:** Consolidate the 5 effects into one (the render loop
already subscribes to all 8 stores; folding auto-scroll + gestures
+ event subscriptions into the same effect ensures a single
unmount-order point). Or, at minimum, hoist the
`transportStore.subscribe` for auto-scroll into the render loop
effect's `markDirty` flow with a transition-detector closure (see
issue #6 (a)).

### 38. `TimelineSurface.markDirty` subscription unsubscribes 8 stores manually — fragile reordering

**Problem:** Lines 274-281 and 362-369 are mirror-image lists. Any
new store added to the render loop must be added in two places (the
subscribe and the cleanup). A change to one half without the other
silently leaks subscriptions or stops invalidating on a store.
There is no `Array.from(...).forEach(unsub => unsub())` pattern.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:274-281,362-369`

**Needed:** Build the unsubscribe list once: `const unsubs = [
transportStore, timelineViewStore, ...].map(s => s.subscribe(markDirty))`,
then `for (const u of unsubs) u()` in cleanup. Same pattern is
already in use at lines 198-206 of the same file.

### 39. `TimelineMinimap.containerRef.current!` non-null assertion in mousedown can be stale

**Problem:** `TimelineMinimap.tsx:192` does `const rect =
containerRef.current!.getBoundingClientRect();` inside
`handleMouseDown`. The bang is "earned" by the calling React
synthetic event, where the element exists. But the stored `rect` is
captured *once at mousedown* and used inside the `handleMouseMove`
closure (line 218) — even though `containerRef` is not stable
(component can re-render and re-mount). If the user starts dragging
the minimap while a panel resize re-mounts the chrome, the captured
rect is from the old mount; the move closure computes from a stale
geometry.

Same pattern at line 226: `const moveX = moveEvent.clientX - rect.left`
uses the captured rect, not a fresh `getBoundingClientRect()`.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx:192,218,226`

**Needed:** Re-read `containerRef.current?.getBoundingClientRect()`
inside `handleMouseMove`, with a guard. Or, use Pointer Events with
`setPointerCapture` so the minimap survives DOM remounts mid-drag.

### 40. `MiniMasterSpectrum` rAF runs continuously regardless of selection state; canvas hardcoded `width=180 height=80`

**Problem:** `presentations/views/MiniMasterSpectrum.tsx:59-78` —
`requestAnimationFrame(draw)` re-schedules itself every frame
unconditionally. The effect deps are `[isSelected]`, so when
`isSelected` changes, the effect re-runs (cancelling the rAF and
starting a new one) — but on every frame in between, the rAF runs
even when the master spectrum is invisible / not selected. Always-on
60 Hz cost.

Worse, the `<canvas width={180} height={80}>` JSX (line 108) sets
the *backing-store size* directly; the effect reads
`canvas.height/width` at lines 49-50 (returns 180/80). On a 2× DPR
display the `<canvas>` is rendered at 180×80 backing pixels stretched
to 90×40 CSS by the surrounding `w-full h-full` classes — half
resolution, blurry. **No DPR scaling at all.** The bar count is
based on `bufferLength`, not on canvas width — so on a wider
container the bars are clipped at index 90/2=45 instead of using
the available space.

The audit's earlier #62/#63 noticed both, but the always-on rAF cost
even when the master is unselected adds another vector.

**Representative files:**

- `src/modules/Arrangement/presentations/views/MiniMasterSpectrum.tsx:16-110`

**Needed:** Gate the rAF on `isSelected` (or use
`document.visibilityState` to pause when the page is hidden).
Resize the canvas backing store to `containerWidth * dpr × 80 *
dpr` and apply `ctx.scale(dpr, dpr)`. Re-trigger the effect on
analyser change (subscribe to `audioEngineReady` flag). Use
`animationScheduler` instead of bare rAF.

### 41. Many ID generators truncate to 8 hex digits; collision risk amplified across long sessions

(See expanded #23 above — listed here to surface the breadth.)

### 42. `clipDrawing.ts` MIDI-note loop cap is 100 in canvas2d but 300 in WebGPU; fidelity diverges by backend

**Problem:** `clipDrawing.ts:411` — `while (loopOffset < clipDuration && iterations < 100)`.
The WebGPU equivalent (`createWebGpuRenderer.ts:331`) caps at
`MAX_NOTES_PER_CLIP = 300`. A clip with 200 notes shows 200 in
WebGPU and 100 in canvas2d. Same model, different visuals depending
on which backend the user's GPU happened to enable. This is the
"correctness-first" goal violated by inconsistency.

**Representative files:**

- `src/modules/Arrangement/presentations/renderers/clipDrawing.ts:411`
- `src/modules/Arrangement/presentations/renderers/createWebGpuRenderer.ts:331`

**Needed:** Hoist the cap into a shared `presentations/helpers/timelineConstants.ts`
constant `MAX_NOTES_PER_CLIP_RENDER`; both backends import.

### 43. `getTrackState` returns a strict subset of `TrackStoreState`, losing `ghostClips` field

**Problem:** `repositories/track/getTrackState.ts:4-12` exports a
`TrackState = { tracks, selectedTrackId }` and a function returning
`TrackState | null`. But the actual store shape (`stores/trackStore.ts:23-28`)
is `TrackStoreState = { tracks, selectedTrackId, ghostClips? }`.

Use cases that read via `getTrackState()` cannot see `ghostClips` —
even though those clips are part of the canonical truth. The
canonical reader is `trackStore.value` directly, used by
`buildTimelineRenderModel.ts:117` and many use cases. So we have
*two* canonical reads with *different* type contracts: one truncates
`ghostClips`, the other doesn't. Use cases that go through the
repository (and that's the AGENTS.md rule —
"repositories/" is the I/O surface, useCases consume them) get the
truncated view; use cases that bypass and `import { trackStore }`
directly see the full state. Inconsistent.

**Representative files:**

- `src/modules/Arrangement/repositories/track/getTrackState.ts:4-12`
- `src/modules/Arrangement/stores/trackStore.ts:23-28`
- All useCases that import `getTrackState` and need ghost clips

**Needed:** `getTrackState` returns `TrackStoreState | null`, not a
custom subset. Or, if `ghostClips` is intentionally hidden from
the read API, document why and forbid the direct `trackStore.value`
import outside `buildTimelineRenderModel`.

### 44. `TrackHeader.LatchButton` "active" state contradicts the button label for `auto` input monitoring

**Problem:** `TrackHeader.tsx:240-252` sets
`active={track.inputMonitoring === 'on'}`, while the displayed
letter is `INPUT_MONITORING_LABEL[track.inputMonitoring][0]` (`A`
for auto, `O` for on, `O` for off).

- `auto` → label `A`, latch `inactive` (gray).
- `on` → label `O`, latch `active` (highlighted).
- `off` → label `O`, latch `inactive` (gray).

Two states (`on` and `off`) share the same letter `O`; they're
distinguishable only by the latch active/inactive state. A user
toggling between off and on sees the same letter both times — the
state transition is conveyed only through the highlight. Worse,
`auto` (the *default*, the "smart" mode) shows as inactive. Visual
confusion + accessibility issue (a screen reader on `aria-label`
includes the verbose label, but the letter alone is uninformative).

Separately, `toggleInputMonitoring` (`useCases/toggleTrackState/toggleInputMonitoring.ts:11`)
cycles `on ↔ off`, **skipping `auto`**. Meanwhile `TrackHeader`
uses `INPUT_MONITORING_CYCLE` (`auto → on → off → auto`). Two
divergent definitions of "toggle" — a keybind that calls
`toggleInputMonitoring` produces different behaviour from the
button.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TrackHeader.tsx:49-53,240-252`
- `src/modules/Arrangement/useCases/toggleTrackState/toggleInputMonitoring.ts:6-12`

**Needed:** One definition of "toggle". Consolidate `INPUT_MONITORING_CYCLE`
into the use case. Use distinct letters/icons (`A`, `I`, `M` —
auto/input/mute) or distinct latch colors (mint=auto, cyan=on,
gray=off) so the state is visually unambiguous without depending on
the highlight.

### 45. `MarkerLane.dragRef.current` is written but only read as a presence flag

**Problem:** `MarkerLane.tsx:88-92` writes `dragRef.current = {
markerId, startClientX, originalBeat }`; lines 116, 183 only ever
check `if (dragRef.current)` — never reading the fields. The closure
tracks marker movement via the local `lastBeat` variable in
`handleMarkerDragStartStable`. The full `DragState` ref is dead
state.

This is benign today, but signals confused intent. Harder
consequence: a sibling `ArrangementBar` has the same `dragRef`
pattern (`ArrangementBar.tsx:119-125`) where the fields *are* read
during `handleSectionMouseDown` — so a developer copying from one
to the other will hit confusion.

**Representative files:**

- `src/modules/Arrangement/presentations/views/MarkerLane.tsx:33-37,88-92,116,183`

**Needed:** Replace `dragRef` with a boolean ref `const
isDraggingRef = useRef(false)` if only the presence check is used.

### 46. `TimelineMinimap.useLayoutEffect` reads `containerWidth` from React state but writes via `setContainerWidth` — first paint shows zero-width minimap

**Problem:** `TimelineMinimap.tsx:147` initialises
`containerWidth` after the ResizeObserver effect runs, via
`setContainerWidth(container.getBoundingClientRect().width)`. The
draw effect (line 37-131) depends on `[tracks, pixelsPerBeat,
scrollX, containerWidth]`. On first render, `containerWidth = 0`
(initial state), so the canvas is drawn with `rect.width = 0` →
empty minimap. Only after the layout effect runs and triggers a
re-render does the second draw populate it.

This is a 1-frame visual glitch. Acceptable but unprofessional.
Same pattern more visible in `TakeLanesView.handleStripMount`
(issue #68): the layout reads after mount but doesn't update on
resize.

**Representative files:**

- `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx:37-150`

**Needed:** Read `containerRef.current?.getBoundingClientRect()`
inside the draw effect (already done at line 44), and ignore the
`containerWidth` state — drop the `useState` and the `useLayoutEffect`
that maintains it. The ResizeObserver alone is enough to invalidate
on size change (set the state inside the observer to force the draw
effect to re-run).

### 47. `previewDirtyFlag` set to `true` *and* the render loop is unmounted between flag-set and read → next mount runs a stale draw

**Problem:** `useTimelineInteractions.handleMouseUp` at line 681-682
clears `clipDragPreviewRef.current = null` and sets
`previewDirtyFlag.value = true`. The render loop reads + clears the
flag on its next tick (`TimelineSurface.tsx:308-311`). If the
component unmounts between the two events (e.g. user holds a
keyboard shortcut to switch workspace mode in the same tick as a
mouseup), the flag stays `true` until the next mount — which then
runs a frame for a drag that ended in a previous component
lifetime. Visually benign (the new mount immediately rebuilds the
model from real stores), but the "dirty-flag-as-shared-mutable-
global" pattern doesn't survive React unmount/mount lifecycle.

**Representative files:**

- `src/modules/Arrangement/stores/clipDragPreviewRef.ts:37`
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:308-311`
- `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts:681-682`

**Needed:** Reset `previewDirtyFlag.value = false` on
`TimelineSurface` mount (or convert to a real store with a
subscribe). Same for `activeRecordingRef.current = []` if no
recording is in flight at mount.

### 48. Issue #76's claim about shared `Map` reference is incorrect; remove

**Problem:** Earlier issue #76 claimed
`useTimelineInteractions.handleMouseUp`'s redo closure iterates a
live, shared `preview.positions` Map that a *new* drag can
overwrite. **Re-verified 2026-04-28: this is wrong.** Line 242
constructs `clipDragPreviewRef.current = { positions: new
Map(originals), originals }` — a *new* `Map` object. The captured
`preview` const in the redo closure retains a reference to the
original (now-detached) Map, not the new one. There is no aliasing
bug.

**Representative files:**

- `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts:242,716-719`

**Needed:** Remove issue #76 from the audit (resolved-on-verification
— it was never a real bug). The line numbers and the iteration
shape are still worth a code comment to prevent future regressions
("`preview` is captured by closure; new drags create a new map ref
and do not alias").

### 49. Drag listeners in MarkerLane and AdjustmentLayerStrip don't use the existing `useContextMenuDismiss` hook (issue #93's mitigation already exists, just unused)

**Problem:** `useContextMenuDismiss` (`src/utils/UI/useContextMenuDismiss.ts:6`)
exists and is consumed by `TrackContextMenu`, `ClipContextMenu`,
`TimelineEmptyMenu`, `ArrangementBar` for menu-dismiss-on-outside-
click. `MarkerLane.tsx:62-73` and
`AdjustmentLayerStrip.tsx:105-129` re-implement the same
window-mousedown subscription pattern inline, and neither survives
component unmount mid-menu-open (the audit's earlier #93 ranges
apply only here, not to the views that already use the shared hook).

**Representative files:**

- `src/modules/Arrangement/presentations/views/MarkerLane.tsx:62-73`
- `src/modules/Arrangement/presentations/views/AdjustmentLayerStrip.tsx:105-129`
- `src/utils/UI/useContextMenuDismiss.ts:6`

**Needed:** Migrate the two laggard views to `useContextMenuDismiss`.
Mechanical and removes a class of leak.

### 50. Cross-module imports of `Track`/`Clip`/`Device` etc. via `stores/index.ts` block model isolation — **cascading change risk**

**Problem:** `stores/index.ts:25,32-38,44,47` re-exports model types
(`Track`, `Device`, `Clip`, `AdjustmentLayer`, `AdjustmentRegion`,
`GrooveTemplate`, `GainEnvelopePoint`, …). AGENTS.md "Model
isolation": models are *strictly private*. A grep across the repo
confirms downstream modules (`GrandBoule`, `Toaster`, `Workspace`,
`Collaboration`, etc.) consume `Track` and `Clip` directly. Any
shape change to `Track` / `Clip` cascades — multiple modules break
at compile time, blocking even small refactors of an internal field.

**Re-verified 2026-04-28:** sample query
`grep -rEn "from '#/modules/Arrangement/(stores|models)" src
| grep -v "src/modules/Arrangement"` returns dozens of hits
including direct imports of `models/Track`. The model surface is
fully leaked.

**Representative files:**

- `src/modules/Arrangement/stores/index.ts:25,32-38,44,47`
- `src/modules/Arrangement/stores/trackStore.ts:8-19` (re-exports model types)
- Cross-module consumers: `GrandBoule/useCases/resolveGrandBouleEngine.ts:1-2`, `Toaster/useCases/createDrumTrackStack.ts:15`, etc.

**Needed:** This is an extension of #2 with a tighter measurement.
Each downstream consumer must define a local "view type" containing
only the fields it uses. Migration is large but mechanical.

### 51. `transportStore` field cardinality drives `buildTimelineRenderModel` cache invalidations on every transport mutation including `masterGain` and `playheadPosition` writes

**Problem:** Defining issue #11 with a tighter measurement.
`TransportState` has 22+ fields (per `BeatRulerBar.tsx:41-63`):
isPlaying, isRecording, isLooping, overdub, metronome,
metronomeVolume, tempo, tsNum, tsDenom, playheadPosition, loopStart,
loopEnd, scheduleGrainMs, punchInEnabled, punchInBeat, punchOutBeat,
countInEnabled, countInBars, preRollEnabled, preRollBars,
masterGain, ... etc.

`buildTimelineRenderModel` reads `transportState !==
renderCache.transport` (line 132) → a single `masterGain` slider
twiddle invalidates the render model. Only `tempo`,
`timeSignatureNumerator`, `timeSignatureDenominator` (and indirectly
`isLooping`, `loopStart`, `loopEnd` via the canvas renderer's
`drawLoopRegion`) actually feed the model.

Also: if any path writes `transportStore.value.playheadPosition`
(rather than the `playheadPositionRef.current` ref), the cache
invalidates 60×/s during playback. Worth grepping.

**Representative files:**

- `src/modules/Arrangement/useCases/buildTimelineRenderModel.ts:117-141`
- `src/modules/Transport/stores/transportStore.ts` (field shape)

**Needed:** Replace the `renderCache.transport` reference comparison
with a tuple of only the relevant fields:
`renderCache.transportRelevant = { tempo, tsNum, tsDenom,
isLooping, loopStart, loopEnd, isRecording }`. Compare each.

---

## Open questions

- [ ] Should the module's root `index.ts` (issue #1) include views?
      AGENTS.md says yes for `presentations/views/` but the deep
      imports today bypass it; how to migrate without breaking each
      caller in the same PR?
- [ ] Is `useCases/timelineViewActions.ts` (issue #3) actually used
      somewhere I missed (e.g. via dynamic import in tests)? If not,
      delete it.
- [ ] Should `MiniMasterSpectrum` (issue #26) live here or move to
      `AudioEngine` / a top-level "master visualizer" module? It's the
      only Arrangement view that touches an `AnalyserNode`.
- [ ] What's the user-visible behaviour of an HMR-reset
      `trackColorCounter` (issue #21)? Today: existing tracks keep
      their saved color (they read from CRDT/storage), but new tracks
      added after HMR reuse the first palette entry. Acceptable?
- [ ] Are the multi-touch pinch-zoom (issue #17) and Safari
      `gesturechange` (#6) ever both fired in the same gesture? On a
      MacBook trackpad with `gesturechange` enabled, `pointermove` 2-
      finger does not fire the same way. Confirm before deduping.
- [ ] Is the `scratchPadStore` orphan-cleanup (issue #97) the same
      severity as `gainEnvelopeStore`? Sample the use cases to
      confirm.

---

## Risks

- **Silent data corruption on every Cmd+D / Alt-drag / Duplicate**
  (issue #33-new). Every duplicated clip silently loses fades, gain
  envelope, mute, lock, color, audio offset, loop config, stretch,
  warp, asset hash. Users see "duplicate" produce a different clip.
  This is the **single highest-impact bug** identified in this audit.
- **Silent data loss on `moveClip` to bad track** (issue #9). AI
  agents that compute target tracks based on stale state will silently
  delete user clips. No telemetry, no toast, no recovery.
- **Silent no-ops on `updateTrack` with stale id** (the same pattern
  manifests across every "set X on track Y" use case). Cmd-handler
  layer reports success regardless.
- **Marquee selection box never matches actual track layout** (#32-new).
  Users selecting clips via marquee see the box cover one set of
  tracks while the selection-set captures a different set.
- **JSON.parse + `as` assertion + silent catch on drag-and-drop**
  (#35-new). Malformed AI-render or sample payload produces NaN clip
  durations or no-op drops with no user feedback.
- **Memory leaks on long sessions** (issues #8, #32). Every clip
  delete leaks a `gainEnvelopeStore` record + a `warpStates` entry +
  potentially clipboard / drag preview / recording entries. Over
  thousands of edits, the project document grows unboundedly.
- **Drag listener leaks** (issue #7) accumulate per session. Each
  unmounted-mid-drag attaches global listeners that call store mutators
  on subsequent events forever. After enough panel toggles during
  drags, the listener count is in the thousands and document mouse
  events trigger N store writes.
- **Auto-scroll override** (issue #6) means users cannot inspect a
  recorded section while playback continues — the viewport snaps
  forward on every transport tick. Manual workaround: pause, scroll,
  resume — defeating the purpose of auto-scroll.
- **Frame budget collapse with many clips** (issues #4, #13, #14).
  Current allocation patterns scale linearly with clip count, not
  with visible-clip count. A 5-minute project with 500 clips at low
  zoom has all 500 paths constructed per frame.
- **Architectural drift** (issues #1, #2, #3, #4) is at the level
  where any well-meaning refactor breaks 50+ deep imports. The
  contract surface is so leaked that AGENTS.md's "Domain-Driven
  Architecture" preamble does not describe this module today.
- **Stack overflow on long MIDI clips** (issue #11). A user importing
  a long polyphonic MIDI file (drum tracks, dense pads) crashes hit-
  test and canvas drawing.
- **`addClip`/`moveClip` invariant gaps** (issue #9) silently
  corrupt CRDT state — replicas may diverge if one peer's clip lands
  with `endBeat < startBeat` while another rejects it.
- **HMR-fragile state** (issue #21) makes development demos
  inconsistent: track colors flip on every reload.

---

## Suggested approaches

- **Phase 1 — contract surface.** Create `src/modules/Arrangement/index.ts`,
  curate the cross-module re-exports (use cases, events, public stores,
  views, no models, no use-case types). Migrate the ~20 cross-module
  consumers. Strip `export type` from `stores/index.ts` and
  `useCases/index.ts`. Delete `useCases/timelineViewActions.ts`. Run
  `pnpm deps:validate` after each batch.
- **Phase 2 — invariant tightening.** `addClip`, `moveClip`, `removeClip`
  return `Result` types. `removeClip` cleans gainEnvelope, warpStates,
  drag preview, recording ref, clipboard. Add invariant tests.
- **Phase 3 — drag listener cleanup.** Extract `useGlobalDrag({onMove,
  onUp})` and migrate the five+ components that hand-roll drag
  listeners. Each migration is local and testable.
- **Phase 4 — render performance.** Cull horizontally in canvas2D.
  Cache color → rgba in WebGPU. Hoist gradient construction. Replace
  `Math.min(...notes.map)` spreads with single-pass loops.
- **Phase 5 — store narrowing.** Convert `warpStates` to a real store.
  Add narrow selectors for `TrackListView` / `BeatRulerBar` so
  unrelated transport changes don't invalidate them.
- **Phase 6 — AGENTS.md compliance sweep.** `&&` rendering → ternary;
  positional args → object params; multi-fn files → split. Mostly
  mechanical, single commit each.
- **Phase 7 — auto-scroll fix.** Move auto-scroll re-enable to the
  play-action handler (state-transition trigger), drop the
  transportStore subscription. Audit duplicate gesture listeners.

---

## Recommendation

Start with **issue #33-new** (`duplicateClipCore` data loss). One
file plus a regression test. Direct user impact — every Cmd+D loses
data today. Cheapest win in the audit.

Then **issue #9 + #34-new** (`moveClip` silent drop, `addClip`
silent no-op, handler discards return value) and **issue #8**
(`removeClip` orphans). Localised to ~5 files plus tests; land them
as one PR with a property-based regression test ("any sequence of
add/move/remove/duplicate leaves no orphans, never silently drops
clips, and propagates failures to the command bus").

Then **issue #32-new** (marquee height mismatch) — a 5-line fix in
`TimelineSurface.tsx` that resolves a long-standing visual bug.

Then **issue #7** (drag listener leaks) — extract `useGlobalDrag`
and migrate the five components. Mechanical; removes a class of
leak.

Then **issue #1** (root `index.ts` + deep import migration) —
mechanical, large surface area (582 imports), but should land before
any further contract-affecting refactor. After this, the rest of
the audit's issues can land in any order: each is local and
independently verifiable.

Then **issue #35-new** (file-drop type safety): introduce Zod
schemas for `aiRenderData` and `sampleData`, wire failures through
`notifyUser`, drop the silent catch.

Finally **issue #6** (auto-scroll + duplicate gesture) — small but
high-visibility UX win; ideal for a stand-alone PR after the safety
nets above are in place.

---

## Resolved

- **Partial: `addClip` positional args.** `useCases/clip/addClip.ts:6-15`
  now accepts a single object param. The remaining issues with `addClip`
  (no invariants, no `Result` return, handler discards return value)
  are tracked under #9 and #34. (Re-verified 2026-04-28.)
- **Partial: `getNext*Id` (groupComping).** `stores/groupComping.ts:45-53`
  uses full `crypto.randomUUID()`. The 32-bit-truncation pattern still
  applies to **33 other call sites** within the module — see issue
  #23 (re-scoped).
- **`useContextMenuDismiss` exists and is partially adopted.**
  `TrackContextMenu`, `ClipContextMenu`, `TimelineEmptyMenu`, and
  `ArrangementBar` use the shared hook for outside-click dismiss.
  `MarkerLane` and `AdjustmentLayerStrip` still re-implement the
  pattern inline — see issue #49.
- **Issue #76 incorrect on verification.** The "live Map ref shared
  between dragging session and redo closure" claim is not a real
  bug — `clipDragPreviewRef.current = { positions: new Map(originals),
  originals }` creates a fresh Map per drag. Removed and re-archived
  here for posterity. See issue #48.
