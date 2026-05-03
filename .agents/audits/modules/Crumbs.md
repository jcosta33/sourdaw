# Crumbs module audit

## Scope

This audit covers `src/modules/Crumbs/` in full — all files: `models/`,
`repositories/`, `stores/`, `useCases/` (including `crumbsLifecycle/`,
`crumbsParamBridge/`, `triggerPad/`, `recording/`, `updateSliceMarker/`),
`presentations/components/`, `presentations/views/`, and their
co-located `__tests__/`.

It explicitly **excludes** the Rust DSP / audio-thread sampler
(`crates/daw-dsp/src/crumbs/**` — `voice.rs`, `engine.rs`, sinc
interpolation, voice stealing) and the Tauri command surface
(`src-tauri/src/commands/crumbs.rs`) except where called from the TS
bridge. Sampler-internal concerns (Sinc interpolation edge cases, voice
stealing, sample-rate conversion, loop-point glitches, audio-thread
allocations) live in those files and are out of scope here, but
**boundary contracts** between the TS module and them are in scope.

It is an adversarial review: bugs, races, contract gaps, off-by-ones,
architectural violations, type-soundness escapes, audio-thread-rule
adjacency, performance, and testing gaps.

Related spec: none on disk.

---

## Goal

A correctness-first sampler frontend for the DAW:

- A single, well-typed bridge (`repositories/crumbsBridge.ts`) carries
  every parameter the user can change and every read the UI needs, with
  no silent dead-code branches in non-Tauri.
- Stores (`crumbsStore`, `padStore`, `sliceStore`) are the source of
  truth for the React UI; backend writes are reflected eagerly and
  guarded against optimistic-update race conditions.
- Use cases are thin: one function per file, single object param per
  AGENTS.md, narrow types end-to-end (no `string` for parameter names
  that map to a finite Rust enum, no `string` for known categories).
- The crumbs module exposes a **single** root `index.ts` for external
  consumers (none today). Internal imports are relative; cross-module
  consumers (Workspace, Fermenter) import from that root only.
- Tests assert behaviour — not "function is defined". DSP / pitch / BPM
  / sample-loading paths have positive coverage and edge cases.
- AGENTS.md hard rules: no `any`, no assertion escapes, no
  `useMemo`/`useCallback`/`React.memo`, no `forwardRef`, no positional
  multi-arg signatures, no namespace imports, no cross-module imports
  of internals, type-`export` from `useCases/` forbidden.
- Audio-thread adjacency: every TS bridge call is non-blocking, every
  store write is allocation-light on the polling/rAF path, and no path
  spams the audio-thread command queue when the queue is full.

---

## Relevant code paths

- `src/modules/Crumbs/models/CrumbsTypes.ts`
- `src/modules/Crumbs/repositories/crumbsBridge.ts`
- `src/modules/Crumbs/stores/crumbsStore.ts`
- `src/modules/Crumbs/stores/padStore.ts`
- `src/modules/Crumbs/stores/sliceStore.ts`
- `src/modules/Crumbs/useCases/loadSample.ts`
- `src/modules/Crumbs/useCases/handleFileDrop.ts`
- `src/modules/Crumbs/useCases/setCrumbsMode.ts`
- `src/modules/Crumbs/useCases/positionTracking.ts`
- `src/modules/Crumbs/useCases/smartLoopPoints.ts`
- `src/modules/Crumbs/useCases/voiceStacking.ts`
- `src/modules/Crumbs/useCases/crumbsLifecycle/initCrumbsEngine.ts`
- `src/modules/Crumbs/useCases/crumbsLifecycle/teardownCrumbsEngine.ts`
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts`
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamThrottled.ts`
- `src/modules/Crumbs/useCases/triggerPad/triggerPadOn.ts`
- `src/modules/Crumbs/useCases/triggerPad/triggerPadOff.ts`
- `src/modules/Crumbs/useCases/triggerPad/allSoundOff.ts`
- `src/modules/Crumbs/useCases/recording/armCrumbsRecording.ts`
- `src/modules/Crumbs/useCases/recording/stopCrumbsRecording.ts`
- `src/modules/Crumbs/useCases/updateSliceMarker/debouncedUpdateMarkerPosition.ts`
- `src/modules/Crumbs/useCases/updateSliceMarker/detectAndSetSlices.ts`
- `src/modules/Crumbs/presentations/components/CrumbsControls.tsx`
- `src/modules/Crumbs/presentations/components/PadGrid.tsx`
- `src/modules/Crumbs/presentations/components/SliceOverlay.tsx`
- `src/modules/Crumbs/presentations/components/WaveformDisplay.tsx`
- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx`
- `src/modules/Crumbs/presentations/views/index.ts`
- All co-located `__tests__/` files.

---

## Current behavior

**No root `index.ts`.** External consumers import the panel directly
from a presentation path: `AppShell.tsx:21` does
`import { CrumbsPanel } from '#/modules/Crumbs/presentations/views'`.
That deep-imports a private `presentations/views/` path and bypasses
the contract boundary AGENTS.md mandates.

**Bridge.** `crumbsBridge.ts` exposes 14 async functions wrapping
`tauriInvoke`. The browser-mode strategy is split: data-returning
calls throw via `ensureTauri()`; void calls (note on/off, set param,
set mode, recording) silently return. There is no `Result`-style
return; consumers learn about non-Tauri by wrapping each call in
`try/catch` (or by missing data they cannot otherwise distinguish from
"backend hasn't computed it yet").

**Stores.** Three top-level stores (`crumbsStore`, `padStore`,
`sliceStore`), each shaped as `Record<string, State>` keyed by
`instanceId`. Every mutator is a `store.update(s => ...)` reducer that
re-spreads the entire instance map and the entire instance state on
every change. There is **no** automatic backend-→-store reflection
path — store writes happen optimistically when the UI calls a
mutator, then a fire-and-forget `setCrumbsParamThrottled` send goes to
the bridge. If the backend rejects the value (param queue full, param
clamps, etc.), the UI keeps showing the un-applied value forever.

**Lifecycle.** `initCrumbsEngine` calls `ensureInstance`,
`ensurePadInstance`, `ensureSliceInstance`, then `createCrumbsInstance`
on the bridge. Sample rate is **hard-coded to 44100** in
`CrumbsPanel.tsx:82` regardless of the actual `AudioContext.sampleRate`.
`teardownCrumbsEngine` reverses (store-remove, bridge-destroy). There
is **no** retry / cleanup if `createCrumbsInstance` rejects mid-init —
stores are populated as-if the engine exists; subsequent param sets
will silently no-op (queue not created on the backend) and the UI
shows "Ready".

**Position tracking.** `positionTracking.ts` opens a 30 Hz Tauri poll
(`setInterval`) plus a 60 Hz rAF interpolator per `instanceId`. The
poll is an `async` IIFE inside `setInterval`, so a slow IPC call can
overlap successive ticks (no in-flight guard). The rAF and the
listener `for-of` loop run **even when there are no samples and no
playback**, just so the cursor can render at zero. Polling is short-
circuited in non-Tauri (`isTauri()` check), but the listener Set still
accumulates listeners — each new subscription triggers `startPolling`
which immediately returns, leaving the session pointing at a dead
poll.

**Param bridge.** `setCrumbsParamImmediate` does a one-shot
`setCrumbsParam(...).catch(logger.warn)`. `setCrumbsParamThrottled`
uses a shared `createRafBatcher` keyed by `${instanceId}_${param}`,
storing the **last** value per (instance, param) and flushing once
per rAF. There is no flushing on tab blur, no abort on instance
teardown, and the cache key uses `_` as a separator without escaping —
two instances `"a_b"` and `"a"` with param `"b_x"` and `"b_x"` (or
similar) would collide on `"a_b_x"`. The collision risk is largely
theoretical given how `instanceId` is generated, but undocumented.

**Pad grid.** `PadGrid.tsx` is a 4×4 grid of `<button>`s with an
`onMouseDown` triggering `handleTrigger` → `onTriggerPad`. There is
**no `onMouseUp` / `onPointerUp`** — `triggerPadOn` is fired but
`triggerPadOff` is never wired through the UI. For samples with a long
release (or `oneShot: false`) the held-note convention is broken.
`onClick` handles selection; `onMouseDown` already calls
`e.preventDefault()` so `onClick` may not fire on every browser.

**Slice overlay.** `SliceOverlay.tsx` registers global
`pointermove`/`pointerup` listeners on `document` per drag, captures
the **container's bounding rect** at drag-start, and never updates it
during the drag. If the panel resizes mid-drag (e.g. devtools open,
window resize, sidebar toggle), the drag scales to the wrong width.
The dragged frame is also **not committed to the backend** — the
debounced update writes to `sliceStore` only, never to the engine via
`setCrumbsParam('loopStart' | 'loopEnd' | 'sliceMarker', ...)`. So
slice positions exist in UI state but are never reflected in playback.

**Waveform display.** Canvas-based, uses `window.devicePixelRatio` and
`getBoundingClientRect()`. The draw effect lists `[peaks, color,
backgroundColor, height]` as deps but does **not** observe canvas
size — a window resize re-runs only when peaks/colors change, leaving
the canvas stretched/distorted. The cursor `useEffect` re-subscribes
when `instanceId | totalFrames | onPositionSubscribe` change, which
includes a fresh function reference for `subscribeToPosition` each
render of `CrumbsPanel` (it's imported from a module, so stable in
this case, but the parent passes it as a prop without memoisation —
that's correct under React Compiler, but a brittle assumption to bake
into a passed-in callback).

**Tests.** Of 24 spec files, **15 are placeholder "should export X"
tests** that import the module via `import * as subject` and assert
`typeof subject.foo === 'function' || === 'object'`. They exercise no
behaviour and would still pass if the implementation were `export const
foo = {}`. Only six specs (`loadSample`, `setCrumbsMode`, `triggerPad`,
`handleFileDrop`, `crumbsParamBridge`, and the four component renders)
do anything meaningful; even those have gaps. The
`CrumbsPanel.spec.tsx` mocks `#/infra/store/useStore` but the panel
uses `#/infra/store/useStoreSelector` — the mock factory never
applies.

---

## Findings

1. **No module root `index.ts`.** Every other `src/modules/<X>/`
   ships a root barrel. Crumbs has only `presentations/views/index.ts`,
   and external consumers (`AppShell.tsx`) deep-import from the
   private presentation path. AGENTS.md "Cross-module imports MUST only
   target the destination module's root `index.ts`" is violated by the
   one external consumer.

2. **`CrumbsPanel.spec.tsx` mock targets the wrong store hook.** The
   panel uses `useStoreSelector` (`CrumbsPanel.tsx:15,69-71`); the
   spec mocks `#/infra/store/useStore` (`CrumbsPanel.spec.tsx:6-8`).
   The mock never applies; the test renders against the **real**
   stores. Combined with the test only asserting
   `expect(document.body).toBeTruthy()`, the panel could regress to a
   blank `<div/>` and these tests would still pass.

3. **Placeholder export-only tests.** ~~Fifteen~~ **Fourteen** files
   in `useCases/**/__tests__/` and `useCases/__tests__/` perform no
   behaviour assertions — they assert the export exists with a
   permissive `typeof === 'function' || 'object'`. Listed at the end
   of issue #3 below. AGENTS.md "TypeScript — soundness — Tests:
   assert the actual contract (values, shape, or error text)" is
   ignored systematically across the module. (2026-04-28: counted
   exactly 14 via `grep -l "import \* as subject"`; corrected from
   the original "fifteen".)

4. **Sample rate hard-coded to 44100 at engine init.**
   `CrumbsPanel.tsx:82` calls `initCrumbsEngine(deviceId, 44100)`. A
   user on a 48 kHz interface will trigger every per-sample rate
   conversion in the Rust sampler against a wrong host rate, which
   biases pitch tracking and loop-point timing. The actual
   `AudioContext.sampleRate` is never queried.

5. **Type unsafety: `param` and `algorithm` are `string`.**
   `crumbsBridge.setCrumbsParam(..., param: string, value: number)` and
   `setCrumbsParamImmediate/Throttled(..., param: string, ...)` accept
   any string. The Rust side `parse_crumbs_param` in
   `src-tauri/src/commands/crumbs.rs:641` matches a finite list of
   names; a typo on the TS side becomes a runtime IPC error logged via
   `logger.warn` and the user sees no parameter change. AGENTS.md
   "TypeScript — soundness" requires a discriminated union here. Same
   for `algorithm: OnsetAlgorithm` in
   `repositories/crumbsBridge.ts:98` — the type exists but the
   parameter is forwarded as a plain string into IPC without
   validation; `detectAndSetSlices` defaults to `'superflux'` and the
   Rust side accepts only three literals.

6. **Optimistic-update store writes never reconcile with the
   backend.** Every UI handler in `CrumbsPanel.tsx` (envelope, filter,
   gain, tune, pan, loop) calls a store mutator and then a
   `setCrumbsParamThrottled` IPC — but if the IPC fails (queue full,
   instance gone, param parse error), the store keeps the new value
   forever. No drift detection, no rollback, no health probe. The 30 Hz
   poll only reads metering and position, not parameters.

7. **No `triggerPadOff` wired to the UI.** `PadGrid.tsx:99-102` only
   handles `onMouseDown`. There is no `onMouseUp`/`onPointerUp` /
   `onMouseLeave` / `onTouchEnd` to send `triggerPadOff`. Samples
   marked `oneShot: false` (or with non-zero release where the user
   needs note-off to start the release) are stuck in the held state
   until `allSoundOff` or another trigger of the same MIDI note
   chokes them. `triggerPadOff` is exported but only called from
   tests.

8. **Slice marker drags never touch the engine.**
   `debouncedUpdateMarkerPosition` writes to `sliceStore` only
   (`useCases/updateSliceMarker/debouncedUpdateMarkerPosition.ts:16`).
   The Rust engine has no concept that the slice marker moved, so the
   playback continues to use whatever onset positions
   `detectAndSetSlices` originally pushed. The user drags a marker, the
   UI updates, audio doesn't.

9. **Slice overlay caches stale `containerRect` for the entire
   drag.** `SliceOverlay.tsx:50` reads `containerRect` at
   `pointerdown` and uses it for every `pointermove`. A panel resize,
   scroll, or DPR change mid-drag yields wrong frame deltas. There is
   also no `setPointerCapture` — pointer events on element removal
   (re-render) lose the listener if the marker DOM disappears.

10. **`positionTracking.ts` overlapping IPC calls and dead poll.**
    The `setInterval` callback fires an async IIFE without guarding
    in-flight (`positionTracking.ts:60-70`). On a slow disk or
    bridge-thread contention, two `getCrumbsPosition` calls overlap;
    `lastPolledFrame` and `prevPolledFrame` can update out of order
    (await-resume order != dispatch order), causing the rAF
    interpolator to compute negative deltas. Additionally,
    `subscribeToPosition` adds a listener and calls `startPolling`,
    which **early-returns** in non-Tauri without setting `pollTimer`;
    subsequent rAF (also not started in non-Tauri) means the listener
    Set holds references that will never be invoked. On the browser
    build, `WaveformDisplay` ends up with a permanent no-op
    subscription.

11. **rAF interpolation extrapolates past 1.0 silently.**
    `positionTracking.ts:76` clamps `t = Math.min(elapsed/POLL, 1)`;
    when polling stops or hangs, `t` stays at 1 forever and the
    interpolator returns `lastPolledFrame` — fine. But the same
    interpolation is unguarded against `lastPolledFrame <
    prevPolledFrame` (e.g. backend resets position to 0), producing a
    backwards scrub for one tick. With the SP-404-style recorder
    arming this is visible as a flash to the start.

12. **Audio file path resolution is fragile in browser drag.**
    `handleFileDrop.ts:61-66` reads `('path' in file)` and falls back
    to `file.webkitRelativePath || file.name`. None of those are real
    on-disk paths in a browser; only `'path' in file` works in Tauri
    (and only for some file-drop pathways — Tauri's FileDropEvent gives
    paths via the event, not via `File.path`). The browser fallback
    feeds `file.name` (basename) to `loadSampleFromPath` which then
    tries to decode `kick.wav` from CWD on the Rust side and fails. The
    `if (!isTauri())` guard at line 52 partially covers this, but only
    after a `logger.warn`; the `else` path is structurally broken.

13. **`setCrumbsMode` typo: log message reads "Failed to crumbs
    mode".** `setCrumbsMode.ts:18` — small but visible in user
    diagnostics.

14. **`PadGrid` `onClick` may not fire after `onMouseDown` calls
    `preventDefault`.** `PadGrid.tsx:99-102` `e.preventDefault()` on
    `mousedown` cancels the focus-on-mousedown step, which on some
    browsers prevents the synthesised click. Selection (`onSelectPad`)
    can therefore desync from triggering. Combine with the missing
    keyboard support — pads are `<button>`s with no `onKeyDown` for
    Space/Enter triggering — and accessibility is broken.

15. **`PadGrid` no-key keyboard shortcuts.** Pads carry MIDI notes
    `36..51` (`createDefaultPad` at `models/CrumbsTypes.ts:165`). No
    QWERTY-mapping or Space/Enter trigger. The presentation owns the
    `onMouseDown → handleTrigger` path; touch is implicit but the
    velocity is hardcoded `100` (`CrumbsPanel.tsx:194`).

16. **Velocity is constant `100`.** `CrumbsPanel.tsx:194`
    `triggerPadOn(deviceId, index, 100)`. The grid is described as
    "velocity-sensitive" in the comment (`PadGrid.tsx:2`) but the only
    velocity input is a fixed integer. Pointer-pressure events
    (`PointerEvent.pressure`) are available but unused.

17. **`useCases/recording/armCrumbsRecording.ts` is a one-line
    pass-through with positional args.** Same shape as
    `repositories/crumbsBridge.armRecording`. AGENTS.md "Functions
    with more than one parameter take a single object param" is
    violated; the use case adds zero value (no validation, no store
    mutation, no error mapping) — equivalent to issue #14 in the
    AudioAnalysis audit's `audioAi/*.ts` problem.

18. **`crumbsParamBridge` `setCrumbsParamImmediate` is unused.**
    Grep across the module: only the test imports it. Production code
    uses `setCrumbsParamThrottled` exclusively
    (`smartLoopPoints.ts:26-29`, `voiceStacking.ts:14-22`,
    `CrumbsPanel.tsx:112`). Dead code or pre-mature abstraction.

19. **Store-mutator API takes positional args.**
    - `setFilterParams(instanceId, cutoff?, resonance?, type?)`
      (`crumbsStore.ts:158`).
    - `setLoopParams(instanceId, mode?, start?, end?)`
      (`crumbsStore.ts:179`).
    - `setMetering(instanceId, peakLeft, peakRight, activeVoices)`
      (`crumbsStore.ts:260`).
    - `setMarkers(instanceId, markers, autoDetected)`
      (`sliceStore.ts:38`).
    - `assignSampleToPad(instanceId, index, sampleId, name)`
      (`padStore.ts:78`).
    - `armRecording(instanceId, threshold, targetPad,
      maxDurationSecs)` (`crumbsBridge.ts:139`).
    - `getWaveformPeaks(instanceId, sampleId, level, channel = 0)`
      (`crumbsBridge.ts:77`).
    - `setCrumbsParamImmediate / Throttled(instanceId, param, value)`
      (param-bridge).
    - `triggerPadOn(instanceId, padIndex, velocity)` (positional).
      AGENTS.md mandates a single object param for >1-arg functions.

20. **No `armCrumbsRecording` payload validation.** `threshold`
    (linear amplitude), `targetPad` (0-15), `maxDurationSecs` (positive
    finite) are forwarded without checks. The hard-coded UI values are
    `0.01` / `selectedPadIndex` / `60` (`CrumbsPanel.tsx:217`); no
    documentation on units. `targetPad` past `pads.length - 1` would
    be silently accepted by IPC and rejected on the Rust side as
    out-of-range with no UI feedback.

21. **`loadSampleFromPath` test fixture has wrong type.**
    `__tests__/loadSample.spec.ts:30` uses `sampleId: 's1'` (string)
    where the production `CrumbsLoadResult.sampleId` is `number`
    (`models/CrumbsTypes.ts:65`). The test passes only because
    `expect.objectContaining({ sampleId: 's1' })` does a value
    comparison without type-checking the runtime; the cast through
    `mockResolvedValue` widens via `vi.fn`'s `any`-ish return inference.
    A real rejection of mistyped IPC data would not be caught.

22. **`loadSampleFromPath` doesn't auto-load waveform mipmap level
    or fall back gracefully.** `loadSample.ts:37`
    `getWaveformPeaks(instanceId, result.sampleId, 0)` always asks for
    level 0 (finest). For long samples (a 60-second recording at 44.1
    kHz mono = 2.6 M frames; level 0 mipmap is at the smallest bin, so
    likely returns ~5000-10000 pairs). For short samples this is fine;
    for SP-404-style 60-second recordings the IPC payload is
    enormous. There is no resolution-aware level selection. The
    `WaveformDisplay` does not even know the canvas width when
    fetching peaks (its bin width is computed at draw time).

23. **`isAudioFile` allocates an array per call.**
    `handleFileDrop.ts:21` `Array.from(AUDIO_EXTENSIONS).some(...)` —
    `Set` already has `.has(...)` semantics; this is a per-drop
    allocation and a needless O(n) scan. Replace with `for (const ext
    of AUDIO_EXTENSIONS) if (lower.endsWith(ext)) return true`. Cheap
    fix; ugly bug in a hot path.

24. **`positionTracking` listener `Set` iteration on rAF allocates
    iterator per frame.** `positionTracking.ts:81` `for (const
    listener of session.listeners)` allocates a new iterator per
    frame. With one listener this is sub-microsecond, but the audit
    rule "rAF/poll paths allocation-light" is violated cosmetically.
    More importantly: on rAF, calling listeners synchronously inside
    `tick` — if any listener throws (e.g. WaveformDisplay setState
    after unmount), the rAF tick itself throws and `requestAnimationFrame(tick)`
    is never called again. The position tracker dies silently.

25. **`positionTracking.ts` uses `setInterval` over 30 Hz instead of
    `setTimeout` self-rescheduling.** A long IPC call (200 ms) under
    `setInterval(33ms)` will schedule 6 callbacks behind it, each
    starting another async IIFE. With the in-flight bug (issue #10) the
    backend gets DoS'd by the UI in slow conditions.

26. **`PadGrid` `flashTimers` keyed by index, not pad id.**
    `PadGrid.tsx:32` `flashTimers.current[index]` maps drum-index, but
    the parent re-orders pads (`reorderPad` in `padStore`). After a
    reorder, an in-flight flash timer on index 3 will hit the new pad
    at that index, not the original one, producing visual glitches.
    Pads have `id`; key by `pad.id`.

27. **`PadGrid` `flashTimers` cleanup on unmount only — no reset
    on `padPeaks`/`pads` change.** If the parent recreates the array,
    timers fire onto stale state. Minor, but bug-prone in tests.

28. **`SliceOverlay` doesn't capture pointer.** No
    `setPointerCapture(e.pointerId)`. If the user drags out of the
    window or onto a child element that doesn't propagate, the
    `pointerup` may be missed and the document-level listener stays
    attached forever. Memory leak per stuck drag.

29. **`WaveformDisplay` canvas ignores resize.** No `ResizeObserver`,
    no `window.resize` handler. The draw effect runs only on `[peaks,
    color, backgroundColor, height]`. The canvas is `width: 100%`,
    so a sidebar toggle resizes the parent — the canvas pixel grid
    stays at the old DPR-scaled size and stretches.

30. **`WaveformDisplay` cursor render uses
    `canvas.getBoundingClientRect()` per frame.** `WaveformDisplay.tsx:94`
    inside the position callback (running at 60 Hz). `getBoundingClientRect`
    forces a layout flush. At 60 Hz this is ~5 ms forced reflow per
    frame on a complex panel. Cache the canvas width and listen for
    resize.

31. **Module leaks per-instance state via module-level `Map`s.**
    `positionTracking.ts:24` `sessions = new Map<string, PollingSession>()`,
    `debouncedUpdateMarkerPosition.ts:3` `pendingUpdates = new
    Map<string, ...>`. Both keyed by composite strings derived from
    `instanceId`. There is no cross-shutdown cleanup hook; an HMR or
    fast user navigation away from `CrumbsPanel` while a debounce is
    pending leaves the timer pointing at a removed store. The timer
    callback then writes to a non-existent instance (`updateMarkerPosition`
    no-ops on missing instance, harmless) — but the pattern leaks as a
    long-tail growth.

32. **`crumbsParamBridge` `cacheKey` collision.**
    `setCrumbsParamThrottled.ts:17` `${instanceId}_${param}` — a
    deviceId containing `_` (e.g. `dev_id` + param `gain` → key
    `dev_id_gain`) collides with another deviceId+param pair. Use a
    safer separator (` ` or pipe-with-escape), or a tuple key.

33. **`stores/sliceStore.addMarker` re-sorts on every add.** O(n log
    n) per click is fine at 16-32 markers; at 256 markers (after an
    "Auto-detect slices" with onset-dense audio) it's still cheap but
    needlessly so — onset positions arrive sorted from the backend.
    Insert preserving sort order with binary search if it grows. Small.

34. **`detectAndSetSlices` ID generation collides on overlap.**
    `detectAndSetSlices.ts:19` `id: \`onset-${i}\``. If the user runs
    auto-detect twice (with different algorithms) before any user
    intervention, the IDs from the second run replace the first via
    `setMarkers` — fine. But if a user manually adds markers via
    `addMarker` (uses `crypto.randomUUID()`-prefixed IDs), then re-runs
    auto-detect (which overwrites markers entirely with `setMarkers`),
    the manual markers vanish silently. UX expects "merge", not
    "replace".

35. **`AppShell.tsx` deep-imports `presentations/views`.**
    `src/modules/Workspace/presentations/views/AppShell.tsx:21`
    `import { CrumbsPanel } from '#/modules/Crumbs/presentations/views';`.
    AGENTS.md: "Cross-module imports MUST only target the destination
    module's root `index.ts`." Without a root `index.ts`, this is the
    workaround in place. Fix: add a root `index.ts` that re-exports
    `presentations/views` and switch the consumer.

36. **Tests do not exercise the (instanceId, sampleId, mode) state
    machine.** No spec verifies that `switchCrumbsMode` properly
    transitions store and IPC together. No spec verifies that
    `loadSampleFromPath` cleans up on failure (the `setLoading(false)`
    in `catch` is exercised only weakly — no spec asserts that
    `setActiveSample` is *not* called on error). No spec verifies that
    `teardownCrumbsEngine` fires after `initCrumbsEngine` failure. No
    spec covers the `position` polling lifecycle (start/stop/race).

37. **No tests for the param-name → Rust enum contract.** A rename in
    `parse_crumbs_param` (Rust) silently breaks the TS side because
    the TS side passes raw strings. Coupled with #5: an integration
    test should round-trip every TS param string through the Rust
    parser. Without it, parameter additions on either side drift.

38. **`triggerPad` velocity range mismatch.** `triggerPadOn` accepts
    `velocity: number = 100`. MIDI velocity is 0..127 (u8 on the Rust
    side). The TS type is unbounded `number`; passing 200 silently
    overflows the Rust `u8` (Tauri's serde will reject negative or
    >255, but 128 is a valid u8). No runtime validation.

39. **`createDefaultPad` returns a `PadConfig` whose `name` and
    `color` cannot be `undefined`.** `models/CrumbsTypes.ts:165` uses
    `PAD_COLORS[index % PAD_COLORS.length]!` — non-null assertion on
    `PAD_COLORS` indexing. AGENTS.md "TypeScript — soundness" forbids
    `!` to silence the compiler when the value is genuinely
    well-defined. Refactor to a typed-tuple of length-16 or use
    `at(index % len) ?? PAD_COLORS[0]!` (still asserts on the
    fallback). Same pattern at `createDefaultPad`'s `name` derivation
    is fine; the `color!` is the soundness escape.

40. **`midiNoteToName` `names[note % 12]!`.** Same `!` escape
    (`models/CrumbsTypes.ts:215`). `names` is a fixed length 12 array
    so it's safe in practice, but AGENTS.md asks to fix it via type
    or `?? throw`.

41. **`updatePad` (`padStore.ts:60`) uses `inst.pads[index]!` after
    a length check — soundness ok, but the `pads[index] = { ...pads[index]!, ...updates }`
    construct uses `!` again on a value already verified by the
    `inst.pads[index]` check. Refactor to capture a typed binding
    above the spread.

42. **`reorderPad` (`padStore.ts:140-143`) splice + ! with
    semantics-sensitive return.** `pads.splice(fromIndex, 1)` returns
    `[movedPad]`; the spec asserts the bounds before the splice but
    the destructure uses `!` to silence the `T | undefined` widening.
    Replace with explicit length assertions.

43. **`stores/sliceStore.addMarker` (`:63`) generates IDs with
    `slice-${crypto.randomUUID()}`.** The prefix is redundant, the
    UUID is globally unique. Cosmetic.

44. **`setActiveSample` snaps `rootNote` to `60` on missing
    detection.** `crumbsStore.ts:113` `rootNote: sample.detectedRoot ??
    60`. There is no UI to manually set rootNote (the panel does not
    expose it). For a percussive sample with no detected root, rootNote
    becomes C4 — fine for "do nothing" but if a user wants to play it
    chromatically via pad MIDI notes, the pitch shift is computed
    relative to a C4 the sample isn't tuned to, producing a tone-deaf
    transposition. Add the rootNote to the UI or document the
    constraint.

45. **`setLoading(false)` is duplicated in `loadSampleFromPath`.**
    `loadSample.ts:43` and `:45` — try and catch both call it. If the
    inner waveform-peak `getWaveformPeaks` throws (caught at line 39),
    we still set `setLoading(false)` at line 43. If the outer
    `loadSample` throws, we set false at line 45 and rethrow. Single
    `finally` block is cleaner.

46. **`handleCrumbsFileDrop`'s file path probing is broken in
    Tauri v2.** Tauri v2's drag-drop event passes file **paths**
    through a separate Tauri event channel (`onDragDrop`/`onFileDrop`),
    not via a `File.path` property. The HTML5 `DragEvent.dataTransfer.files`
    array gives Browser `File` objects with no `.path`. The
    `('path' in file)` branch never fires in production Tauri.

47. **`PadGrid.MiniWaveform` re-builds the SVG path string per
    render.** `PadGrid.tsx:163-171` constructs a string in a JS
    `for`-loop. With 16 pads × ~64 bins = ~1024 string concatenations
    per panel render. React Compiler memoises but the inputs (`peaks`,
    `color`) change on every backend reflection. Consider a `<path>`
    `d` attribute computed once and held until peaks change — same as
    the data itself.

48. **`presentations/views/index.ts` is an unnecessary indirection.**
    A one-line re-export of `CrumbsPanel`. Either the module needs a
    proper root `index.ts` (issue #1) and this is collapsed away, or
    it stays as is. Either way it does not help any consumer.

49. **`createCrumbsInstance` returns `void` even when the
    backend errors silently.** `repositories/crumbsBridge.ts:29-34` —
    in non-Tauri, returns early; in Tauri, awaits `tauriInvoke` and
    discards the result. If the Rust side returns an `Err(...)`,
    `tauriInvoke` will reject; the `init` use case catches it via
    `.catch(logger.warn)` in `CrumbsPanel.tsx:82-84`. The store remains
    populated as if the engine exists. Subsequent param sets are
    silent no-ops on the backend (the instance is not registered).
    Add a per-instance `isReady` flag; gate UI on it.

50. **No integration test for the `armCrumbsRecording`/`stopCrumbsRecording`
    pair.** Only export-presence tests. The state machine "armed → 
    recording → stopped → sample appears on selectedPad" is core SP-404
    UX and entirely untested.

51. **Logger string typos / inconsistent formatting.**
    `setCrumbsMode.ts:18` "Failed to crumbs mode:".
    `loadSample.ts:40` "Waveform peak loading failed:".
    `triggerPadOn.ts:20` "Note trigger failed:".
    Consistent format `[Crumbs] <action> failed:` would help log
    triage.

52. **No accessibility on `PadGrid`.** Pads are `<button>`s but lack
    `aria-pressed` / `aria-label` / `role`. Drag-and-drop reorder is
    mouse-only — no keyboard alternative. Pads have a name (`Pad 1`)
    that is announced, but no indication of "selected" or "playing".
    `WaveformDisplay` and `SliceOverlay` are pure visual; markers are
    not focusable.

53. **`SliceOverlay` re-renders the entire markers map on every
    change.** No keying issue (uses `marker.id`), but the parent
    re-renders on `slices.markers` change, which (`useStoreSelector`)
    re-fires whenever any field on the slice instance changes. With
    50+ markers, drag-debounce updates re-render the whole overlay at
    20 Hz.

54. **Module structure has no `services/` despite needing one.**
    Heuristics like `categoryToMode` (`handleFileDrop.ts:24`) and the
    suggested-mode mapping live in use cases. AGENTS.md "Services
    layer (`services/`): Pure, stateless helpers that operate on
    domain types within one module." The mapping is pure and
    domain-typed; it belongs in `services/`. Cosmetic but
    architectural drift.

55. **`positionTracking.subscribeToPosition` returns a teardown that
    can race with re-subscription.** `:115-121` — if the same listener
    is added and removed very quickly (e.g. fast HMR), the size
    transitions 0 → 1 → 0 → 1 may interleave with the `startPolling /
    stopPolling` calls. There is no guard that the session in
    `sessions.get(instanceId)` is the same one that started the poll.
    Edge-case but real under HMR.

56. **`CrumbsPanel` `useEffect` for init/teardown depends only on
    `deviceId`.** A `deviceId` change triggers cleanup of the previous
    instance, but the dependency on `useStoreSelector` defaults to
    `defaultCrumbsState` even after teardown — the UI shows "Ready"
    for a freshly-created device while the engine is still being
    constructed (race with `initCrumbsEngine`'s async `await`).

57. **No tests for `voiceStacking.updateVoiceStack`'s param
    forwarding.** `voiceStacking.spec.ts` is export-presence only. The
    `if (updates.stackCount !== undefined)` triple-branch is uncovered.

---

## Priorities

> **Numbering note:** Findings #1–#57 (above) and Open Issues
> #1–#41 (below) are **two separate numbered lists**. The
> `Priorities` section originally referenced **Findings** numbers;
> the parenthetical references in this section are kept in their
> original form. Reverify by file:line for each.

Updated 2026-04-28 after the adversarial pass:

1. **Sample rate hard-coded** (Finding #4 / Open Issue #4) — bumped
   from #5 to #1: every non-44.1 kHz interface plays back ~145
   cents sharper than intended on tonal samples. Visibly wrong on
   most modern audio interfaces (48 kHz default). One-line fix
   blocked only by deciding the source of truth.
2. **Slice mode is theatrical** (Finding #8 / Open Issue #8 + new
   Open Issue #33) — neither the marker drags nor the active-slice
   selection reach the engine, AND the overlay paints at a width
   that doesn't match the canvas it sits over. The whole mode is
   non-functional from the user's perspective.
3. **Pad triggering missing note-off and constant velocity**
   (Findings #7, #15, #16 / Open Issue #7) — held notes on
   non-oneshot samples drone forever; the "velocity-sensitive" comment
   in `PadGrid.tsx:2` is documentation drift.
4. **Optimistic store writes never reconcile** (Finding #6 /
   Open Issue #6) — silent UI/engine divergence on any IPC failure;
   gain control specifically can show 200% while engine is at 100%.
5. **String-typed parameter names cross IPC unchecked** (Findings
   #5, #37, #38 / Open Issues #5, #34) — TS-Rust contract drift
   only caught via `logger.warn`. New Open Issue #38 documents that
   even the test suite uses a name (`'gain'`) the Rust side
   rejects.
6. **Test coverage is theatrical** (Findings #2, #3, #36, #37, #50,
   #57 / Open Issues #2, #3, #36) — 14 placeholder specs (originally
   "fifteen" — one count discrepancy noted), a misdirected mock in
   `CrumbsPanel.spec.tsx`, AND duplicate placeholder shells that
   shadow the consolidated specs. Regression-detection capacity is
   near zero.
7. **Missing root `index.ts` and external deep-import** (Findings
   #1, #35 / Open Issues #1, #32) — AGENTS.md contract violation
   in `AppShell.tsx`. Mechanical fix; first-touch.
8. **`positionTracking.ts` racing IPC, dead browser poll, dead
   listener Set** (Findings #10, #11, #18, #19, #25, #55 / Open
   Issue #10) — `setInterval` without in-flight guard,
   non-monotonic frame updates, listeners-never-invoked on browser
   build, no rAF error containment.
9. **`paramBatcher` is a module-level singleton that survives
   teardown** (new Open Issue #37) — dev-visible warns when the
   user switches devices mid-drag.
10. **Slice overlay drag UX** (Findings #9, #28 / Open Issue #9 +
    new Open Issue #33) — stale `containerRect`, no
    `setPointerCapture`, hard-coded width prop.
11. **`WaveformDisplay` resize / layout-flush** (Findings #29, #30
    / Open Issue #16) — visual glitch + 5 ms reflow at 60 Hz.
12. **Web-build behaviour is silently broken but renders healthy**
    (new Open Issue #41) — no audio in browser, but UI implies
    everything works. E2E runs are deceptive.

---

## Adversarial verification — 2026-04-28

A second pass walked every cited file:line. Notes for each open issue
appear inline below. New issues discovered during the pass are
appended after issue #32 as #33 onward.

Summary of the pass:

- **All 32 originally-open issues are still present** at the cited
  file:line. Nothing has been resolved since the original audit.
- **Severity bumps:** issues #6, #8, #10 deserve a sharper framing —
  see the per-issue notes. The shared module-level `paramBatcher` in
  `setCrumbsParamThrottled.ts:8` is more fragile than originally
  described (cross-instance singleton, never disposed).
- **Severity downgrade for #19** — the HMR risk is real but a smaller
  blast radius than #6/#10 since the timers are short-lived.
- **New issues:** #33 (`SliceOverlay` width hard-coded to 600 vs fluid
  canvas — geometry mismatch is worse than the stale-rect concern in
  #9), #34 (envelope keys forwarded as raw IPC param names with no
  validation), #35 (`category` cast through `as` is unchecked
  Rust-side widening), #36 (placeholder spec files are duplicated by
  consolidated specs — dead test files), #37 (no flush-on-teardown on
  the param batcher → in-flight knob drag right before unmount is
  lost), #38 (`crumbsParamBridge.spec.ts` documents a bogus param
  name `'gain'` that the Rust `parse_crumbs_param` rejects), #39
  (`MiniWaveform` non-null `peaks[i*2]!` reads on a length already
  derived from `peaks.length / 2` — escape hatch where a tuple type
  belongs), #40 (`reorderPad` mutates `pads` and `channelStrips` in
  parallel but only validates `pads.length` for bounds — silent skew
  if the two arrays ever drift), #41 (no AudioWorklet / web-build
  story — the entire UI is wired to Tauri-only IPC, with no graceful
  degradation; the panel renders, the stores accept writes, but no
  audio plays and no errors surface).

---

## Open issues

### 1. No module root `index.ts`; external consumer deep-imports `presentations/views`

**Problem:** Crumbs has no `src/modules/Crumbs/index.ts`. The only
external consumer (`Workspace/presentations/views/AppShell.tsx:21`)
imports from `#/modules/Crumbs/presentations/views`, breaking the
contract boundary. AGENTS.md "Cross-module imports MUST only target
the destination module's root `index.ts`."

**Representative files:**

- `src/modules/Crumbs/` (no `index.ts`)
- `src/modules/Crumbs/presentations/views/index.ts` (single re-export)
- `src/modules/Workspace/presentations/views/AppShell.tsx:21`

**Needed:** Add `src/modules/Crumbs/index.ts` that re-exports
`{ CrumbsPanel } from './presentations/views'` (and any other
externally-needed runtime values — none exist today). Update the
`AppShell` import to `#/modules/Crumbs`.

**Verified 2026-04-28:** `ls src/modules/Crumbs/index.ts` → "No
such file or directory". `AppShell.tsx:21` confirmed deep-import.
`presentations/views/index.ts` is a one-line re-export of
`CrumbsPanel`, so the fix is mechanical: add a root barrel that
either re-exports from the views barrel or replaces it.

**Severity:** Mechanical / contract violation. **P1.** Trivial to
fix; should not block other work.

### 2. `CrumbsPanel.spec.tsx` mocks the wrong store hook; assertions are vacuous

**Problem:** The panel uses `useStoreSelector`
(`CrumbsPanel.tsx:15,69-71`); the spec mocks `#/infra/store/useStore`
(`CrumbsPanel.spec.tsx:6-8`). The mock factory is dead. The four `it`
blocks all assert `expect(document.body).toBeTruthy()` (always true)
or `expect(buttons.length).toBeGreaterThanOrEqual(0)` (always true).

**Representative files:**

- `src/modules/Crumbs/presentations/views/__tests__/CrumbsPanel.spec.tsx`
- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx`

**Needed:** Mock `#/infra/store/useStoreSelector` and replace the
"truthy" assertions with concrete contract checks: panel renders
"Ready" or "Loading", clicking a mode chip calls `switchCrumbsMode`,
drag-over toggles the drop overlay, etc.

**Verified 2026-04-28:** `CrumbsPanel.spec.tsx:6-8` mocks
`#/infra/store/useStore` — but `CrumbsPanel.tsx:15` imports
`useStoreSelector` from `#/infra/store/useStoreSelector`. Different
module path, so the mock factory is dead. All four `it` blocks
assert `expect(document.body).toBeTruthy()` (always true) or
`buttons.length).toBeGreaterThanOrEqual(0)` (always true).

**Deepening:** The panel still renders because `useStoreSelector`
falls back to `defaultCrumbsState/defaultPadState/defaultSliceState`
when the store is empty (the deviceId `"test-device"` was never
populated). So the "real" store is consulted, returns nothing, and
the defaults render. A regression that breaks `CrumbsPanel` (e.g.
removing the entire JSX body) would still pass `expect(document.body
).toBeTruthy()`. Confirms the original framing.

**Severity:** **P1** — gate any other test work on fixing this.

### 3. Fourteen placeholder export-only spec files (originally counted as fifteen)

**Problem:** Spec files import `* as subject` and assert
`typeof subject.foo === 'function' || === 'object'`. They exercise no
behaviour and would still pass if the implementation were
`export const foo = {}`.

**Representative files:**

- `useCases/__tests__/positionTracking.spec.ts`
- `useCases/__tests__/smartLoopPoints.spec.ts`
- `useCases/__tests__/voiceStacking.spec.ts`
- `useCases/triggerPad/__tests__/triggerPadOn.spec.ts`
- `useCases/triggerPad/__tests__/triggerPadOff.spec.ts`
- `useCases/triggerPad/__tests__/allSoundOff.spec.ts`
- `useCases/recording/__tests__/armCrumbsRecording.spec.ts`
- `useCases/recording/__tests__/stopCrumbsRecording.spec.ts`
- `useCases/crumbsLifecycle/__tests__/initCrumbsEngine.spec.ts`
- `useCases/crumbsLifecycle/__tests__/teardownCrumbsEngine.spec.ts`
- `useCases/crumbsParamBridge/__tests__/setCrumbsParamImmediate.spec.ts`
- `useCases/crumbsParamBridge/__tests__/setCrumbsParamThrottled.spec.ts`
- `useCases/updateSliceMarker/__tests__/debouncedUpdateMarkerPosition.spec.ts`
- `useCases/updateSliceMarker/__tests__/detectAndSetSlices.spec.ts`

**Needed:** Replace each with a behaviour spec: mock the bridge /
store, call the use case, assert what was forwarded and what was
mutated. AGENTS.md "TypeScript — soundness — Tests" mandates this.

**Verified 2026-04-28:** Every cited file matches the pattern. The
14 export-only specs perform `import * as subject` and assert
`typeof === 'function' || === 'object'` — passing if the export is
literally `export const foo = {}`. Sample (positionTracking.spec.ts):

```ts
expect(subject.getInterpolatedPosition).toBeDefined();
const t = typeof subject.getInterpolatedPosition;
expect(t === 'function' || t === 'object').toBe(true);
```

**Note:** the placeholder specs at
`triggerPad/__tests__/triggerPadOn.spec.ts`,
`triggerPad/__tests__/triggerPadOff.spec.ts`, and
`triggerPad/__tests__/allSoundOff.spec.ts` are **wholly redundant**
with the consolidated, meaningful spec at
`triggerPad/__tests__/triggerPad.spec.ts`. Delete the three
placeholders rather than rewriting them. See new issue **#36**
(duplicate placeholder shells).

**Severity:** **P1** — without these, the module has effectively
zero unit-test coverage on the use-case layer. AGENTS.md "Force
Empirical Proof" cannot be honoured.

### 4. Sample rate hard-coded to 44100 in panel

**Problem:** `CrumbsPanel.tsx:82` `initCrumbsEngine(deviceId, 44100)`.
A 48 kHz interface lies to the Rust sampler; pitch tracking and
loop-point timing become biased.

**Representative files:**

- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:82`

**Needed:** Read `audioContext.sampleRate` (via AudioEngine) or query
the Rust side for the host rate. Pass the actual rate. Add a test
that verifies `initCrumbsEngine` forwards the supplied rate.

**Verified 2026-04-28:** `CrumbsPanel.tsx:82` literally:
`initCrumbsEngine(deviceId, 44100)`. There is no read of
`audioContext.sampleRate` anywhere in the module (`grep
-rn "AudioContext\|sampleRate" src/modules/Crumbs/` confirms this
— the only `sampleRate` references are the type field and the
`activeSample.sampleRate` UI display).

**Deepening — what actually breaks:** the Rust DSP is
explicitly out of scope for this audit, but the contract is in
scope. The Rust side uses this `sampleRate` for: (a) sinc
interpolation phase increments per voice, (b) loop-point detection
window sizing, (c) BPM and pitch detection windowing. A 48 kHz host
fed a 44.1 kHz sample rate biases:

- **Pitch:** every produced note plays back ~8.84% sharper than
  intended (ratio 48000/44100 = 1.0884). For tonal samples on a
  48 kHz interface this is ~145 cents — well over a semitone — and
  is audible immediately.
- **Loop timing:** `loopStart`/`loopEnd` are stored in frames; the
  engine resamples at the wrong target, so loop boundaries drift.
- **Detected BPM:** the analysis runs at `sample_rate as f64` per
  `classify_sample` (`src-tauri/src/commands/crumbs.rs:674`); the
  reported BPM in the UI is correct for the *file*, but the
  *playback* does not match.

**Severity:** **P1** — visibly broken on every non-44.1 kHz
interface. Affects every rendered note. Higher priority than the
audit ranks (currently #5 in Priorities; should be top three).

### 5. Param names and onset algorithms are `string`-typed across IPC

**Problem:** `setCrumbsParam(..., param: string, ...)`,
`setCrumbsParamImmediate/Throttled(..., param: string, ...)`,
`detectOnsets(..., algorithm: OnsetAlgorithm)` — the TS side accepts
arbitrary strings or a wider type than the Rust side accepts. Typos
silently round-trip and fail at IPC parse with a `logger.warn`. There
is no integration test that round-trips every TS param name through
`parse_crumbs_param`.

**Representative files:**

- `src/modules/Crumbs/repositories/crumbsBridge.ts:63,98`
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamThrottled.ts:16`
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts:5`
- `src-tauri/src/commands/crumbs.rs:641`

**Needed:** Define a `CrumbsParamName` discriminated union literal type
listing the 20 valid param names; tighten the bridge / use-case
signatures. Add a contract test: import every literal and call
`set_crumbs_param` against the Rust handler in a Tauri-mocked
environment. Same approach for `OnsetAlgorithm`.

**Verified 2026-04-28:** Confirmed at `crumbsBridge.ts:63`
`setCrumbsParam(..., param: string, value: number)`. Rust
`parse_crumbs_param` (`src-tauri/src/commands/crumbs.rs:641-665`)
matches exactly 20 names: `masterGain`, `attack`, `hold`, `decay`,
`sustain`, `release`, `filterCutoff`, `filterResonance`,
`filterType`, `loopMode`, `loopStart`, `loopEnd`, `loopCrossfade`,
`playbackMode`, `rootNote`, `tune`, `pan`, `stackCount`,
`detuneSpread`, `stackSpread`. Anything else returns
`Err("Unknown crumbs parameter: …")` which the front-end logs at
`logger.warn` and silently swallows.

**Live drift evidence:** `CrumbsPanel.tsx:317-319` does:

```ts
for (const [key, value] of Object.entries(updates)) {
    handleParamChange(key, value);
}
```

Where `updates: Partial<EnvelopeParams>` has keys `attack | hold |
decay | sustain | release` — those happen to round-trip safely
today (Rust has them all). But there is **no compile-time guarantee**
that an `EnvelopeParams` rename doesn't drop a name silently. See
new issue **#34** for the deeper version of this.

**More drift:** `crumbsParamBridge.spec.ts:36-37` literally tests
`setCrumbsParamImmediate('inst-1', 'gain', 0.5)` — the param name
`'gain'` is NOT in `parse_crumbs_param`. The mocked test passes
because the bridge is faked, but the test documents an incorrect
contract. See new issue **#38**.

**Severity:** **P1** — silent drift across IPC. AGENTS.md
"TypeScript — soundness" forbids exactly this kind of stringly-typed
boundary.

### 6. Optimistic store writes never reconcile with backend

**Problem:** Every parameter handler writes to the store, then
fire-and-forget IPC. If the IPC fails (queue full, instance gone,
parse error), the store keeps the new value. The 30 Hz poll only
reads metering and position, not parameters. Once UI and engine
diverge, they never re-converge.

**Representative files:**

- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:111-345`
  (every handler)
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamThrottled.ts:11-13`

**Needed:** Either (a) a "param settled" event from the Rust side
that confirms the value applied (best); (b) a periodic state pull
that overwrites the store with the engine's current params; or (c)
make the IPC failure user-visible (toast + revert). Document the
choice in a spec.

**Verified 2026-04-28:** `setCrumbsParamThrottled.ts:11-13`
swallows IPC failures via `.catch((error) => logger.warn(...))`.
The store has already been written before the IPC is even
scheduled. There is no return path from `setCrumbsParamThrottled`
that could surface a failure — it returns `void`. Combined with
issue #5 (string param names that may not exist on the Rust side),
**any** typo in a UI handler key is a silent UI/engine drift.

**Deepening — concrete repro path:**

1. User drags the master gain knob from 80% to 200%.
2. `onGainChange(2)` → `setMasterGain(deviceId, 2)` → store stores
   `masterGain: 2`. UI renders "200%".
3. `handleParamChange('masterGain', 2)` →
   `setCrumbsParamThrottled` schedules an rAF.
4. rAF fires → `setCrumbsParam(..., 'masterGain', 2)` → IPC.
5. Rust `parse_crumbs_param` accepts the name; the param-queue is
   bounded; if it's full (audio engine under contention), the IPC
   resolves OK from Tauri's perspective but the param never lands.
   The engine continues at the old value.
6. UI shows "200%" forever; audio is at 80%.

There is no "queue full" feedback path. Polling reads metering and
position only (`positionTracking.ts:60-70`).

**Severity:** **P1.** This is a correctness bug, not a UX nit.
Compounded by gain (potential ear damage) and tune (semitone-scale
pitch drift) being among the most user-visible knobs.

### 7. Pad triggering has no `mouseUp/pointerUp/touchEnd` and uses constant velocity

**Problem:** `PadGrid.tsx:99-102` only handles `onMouseDown`. There is
no note-off; samples with a non-zero release stay held until choke or
`allSoundOff`. Velocity is a constant `100` regardless of pointer
pressure or vertical position within the pad.

**Representative files:**

- `src/modules/Crumbs/presentations/components/PadGrid.tsx:99-102`
- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:194`

**Needed:** Add `onPointerUp`/`onPointerLeave`/`onPointerCancel`
handlers that call `triggerPadOff`. Map `PointerEvent.pressure` (or
the y-position within the pad) to MIDI velocity. Add keyboard support
(`onKeyDown` Space/Enter for trigger). Add tests for the held-note
lifecycle.

**Verified 2026-04-28:** `PadGrid.tsx:99-102` only handles
`onMouseDown`. `triggerPadOff` is exported and tested via
`triggerPad.spec.ts:38-40`, but **no production caller invokes it**:

```text
$ grep -rn "triggerPadOff" src/modules/Crumbs/ src/modules/Workspace/
... only test files and the export itself
```

`CrumbsPanel.tsx:194` literally `triggerPadOn(deviceId, index, 100)`
with the constant `100`. `PadGrid.tsx:2` claims the grid is
"velocity-sensitive" but no velocity input is plumbed.

**Deepening — what the Rust DSP receives:** `crumbsNoteOn` forwards
to Tauri `crumbs_note_on` which the audio thread translates to a
`Voice::start(...)`. Without a matching `note_off`, voices
configured with `oneShot: false` stay in their sustain phase until
either (a) the choke group steals them, (b) `crumbsAllSoundOff`
is called, (c) a polyphony cap evicts them. None of those paths are
wired into the UI either. A user who sets `oneShot: false` on a
sustain-style sample (e.g. an organ) will hear an infinite drone
after the click.

**Severity:** **P1.** Headline interaction broken. Confirms the
audit's own ranking.

### 8. Slice marker drags don't reach the engine

**Problem:** `debouncedUpdateMarkerPosition` writes only to
`sliceStore`. The engine has no concept of the user-dragged marker
— playback continues to use the original auto-detected positions.

**Representative files:**

- `src/modules/Crumbs/useCases/updateSliceMarker/debouncedUpdateMarkerPosition.ts`
- `src/modules/Crumbs/repositories/crumbsBridge.ts` (no
  `set_slice_marker` IPC entry)

**Needed:** Add a Tauri command `set_slice_marker(instanceId, id,
framePosition)` (or batch `set_slice_markers`) and call it from the
debounced update. Add a test asserting that the store and the bridge
both receive the new position. Decide whether marker IDs are stable
across re-detection (they currently are not — issue #24).

**Verified 2026-04-28:**
`debouncedUpdateMarkerPosition.ts:5-19`:

```ts
pendingUpdates.set(
    key,
    setTimeout(() => {
        pendingUpdates.delete(key);
        updateMarkerPosition(instanceId, id, framePosition);
    }, 50)
);
```

`updateMarkerPosition` writes the `sliceStore` only
(`sliceStore.ts:94-111`). No bridge call exists for slice markers —
`crumbsBridge.ts` has no `setSliceMarker`/`updateSliceMarker`
exported. The Rust `parse_crumbs_param` does not include a slice
position either. A user-dragged marker is purely a UI ghost.

**Deepening — what currently plays:** the engine still uses the
positions from `detectAndSetSlices` (which DOES call
`detect_onsets` IPC and gets positions from Rust). After dragging,
slice triggering still uses the original onset frames. Worse: the
"active slice index" (`setActiveSlice` / `sliceStore.ts:113-127`)
is also UI-only — there is no IPC to tell the engine "play slice
N". So slice mode itself is largely theatrical: the auto-detected
positions are there, but neither the dragging nor the selection
reaches playback.

**Severity:** **P1** — the entire Slice mode is non-functional from
the user's perspective once they start interacting with it.

### 9. `SliceOverlay` drag uses stale `containerRect` and lacks pointer capture

**Problem:** `SliceOverlay.tsx:50` reads `getBoundingClientRect` once
at `pointerdown`. Mid-drag resize, scroll, or DPR change yields wrong
deltas. No `setPointerCapture` — pointer can escape and the
document-level listeners stay attached.

**Representative files:**

- `src/modules/Crumbs/presentations/components/SliceOverlay.tsx:33-66`

**Needed:** Use `setPointerCapture(e.pointerId)` and recompute the
rect each move (or attach a `ResizeObserver` to the container). Drop
the `document`-level listeners in favour of element-level pointer
events with capture.

**Verified 2026-04-28:** `SliceOverlay.tsx:50` reads
`containerRect = container.getBoundingClientRect()` once at
`pointerdown` and references it inside the `onMove` closure
(`:54`). No `setPointerCapture(e.pointerId)` call exists anywhere
in the file.

**Bigger problem found:** the parent passes `width={600}` as a
prop (`CrumbsPanel.tsx:267`) but the markers compute `x` via
`(framePosition / totalFrames) * width` using the prop, while the
**drag delta** uses the live `containerRect.width` (probably equal
to the canvas's CSS width, not 600). So even ignoring the resize
problem, the **paint coordinates** and the **drag coordinates** use
different scales. New issue **#33** captures this.

**Severity:** **P2** for the original (rect staleness); **P1** for
the new geometry mismatch (#33).

### 10. `positionTracking.ts` overlapping IPC and dead browser poll

**Problem:** `setInterval(33ms)` fires `async () => await
getCrumbsPosition(...)` without an in-flight guard
(`positionTracking.ts:60-70`). On a slow IPC, two requests overlap
and may resolve out of order — `lastPolledFrame`/`prevPolledFrame`
update non-monotonically. The interpolator can compute negative
deltas. Additionally, in browser mode `startPolling` early-returns
without setting `pollTimer` (`:54-56`); subscribers' rAFs are never
started either, so listeners are added to a Set that nothing iterates.

**Representative files:**

- `src/modules/Crumbs/useCases/positionTracking.ts:45-89,107-122`

**Needed:** Replace `setInterval` with self-rescheduling
`setTimeout` after the IPC resolves. Add an `inFlight` guard so a
pending poll skips a tick instead of stacking. In browser mode,
either short-circuit the listener (return a no-op unsubscribe) or
emit zero-position synthetic ticks via rAF only.

**Verified 2026-04-28:** `positionTracking.ts:60-70`:

```ts
session.pollTimer = setInterval(() => {
    void (async () => {
        try {
            session.prevPolledFrame = session.lastPolledFrame;
            session.lastPolledFrame = await getCrumbsPosition(instanceId);
            session.pollTimestamp = performance.now();
        } catch (error) { ... }
    })();
}, POLL_INTERVAL_MS);
```

No in-flight guard. If two ticks await IPC concurrently and resolve
out of order, `lastPolledFrame` is overwritten by the **older**
result (the second IPC's `await` resumes after the first's
`session.lastPolledFrame =` assignment), causing the interpolator to
draw the cursor backwards.

**Deepening — the dead browser branch:**
`startPolling` line 54-56 short-circuits in non-Tauri *before*
setting `session.pollTimer` or `session.rafId`. But
`subscribeToPosition` line 109 unconditionally adds the listener
to `session.listeners` and only calls `startPolling` when `size ===
1`. On the browser build:

1. `WaveformDisplay` mounts, calls `subscribeToPosition`, listener
   is added.
2. `startPolling` early-returns (no Tauri).
3. `pollTimer` and `rafId` stay `null`. The rAF loop never starts.
4. The listener is in the Set, never invoked.
5. On unmount, the cleanup runs `session.listeners.delete(listener)`
   and (if size 0) `stopPolling` → both branches no-op (timer/raf
   already null).

So in the browser the position cursor just never moves. Not strictly
a leak, but the cursor in `WaveformDisplay` cannot animate even if
audio were somehow playing — and worse, `WaveformDisplay` sets
`cursor.style.display = playbackFrame > 0 ? 'block' : 'none'`,
keeping the cursor permanently hidden because the listener is never
called even with `playbackFrame === 0`.

**Severity:** **P1** — overlapping IPC produces wrong-direction
cursor; browser mode is silently broken (consistent with the
"Tauri-only" reality, but no UI feedback either).

### 11. Optimistic gain/filter math has no clamp on the backend round-trip

**Problem:** UI sends arbitrary doubles (`masterGain` 0..2, `tune`
±24 semitones). The Rust side's `CrumbsParam::MasterGain` (likely)
clamps internally; the store keeps the raw user value. After many
edits, the UI says "200%" but the engine is at 100% — same root cause
as #6, but specifically gain is a foot-gun for ear damage.

**Representative files:**

- `src/modules/Crumbs/presentations/components/CrumbsControls.tsx:200-209`
- `src/modules/Crumbs/stores/crumbsStore.ts:200-210`

**Needed:** Either clamp at the use-case layer to match the Rust
clamps, or expose the clamp range from Rust (Tauri specta) and apply
it both places.

**Verified 2026-04-28:** `CrumbsControls.tsx:200-209`:

```ts
<Knob value={masterGain} onChange={onGainChange} label="Gain"
  min={0} max={2} step={0.01} defaultValue={0.8}
  readout={`${Math.round(masterGain * 100)}%`} />
```

`max={2}` (200%). `setMasterGain` in the store accepts the raw
value, no clamp. The tune knob (`:210-219`) is `min={-24} max={24}`
(±24 semitones). Without engine-side reflection, any clamping in
Rust is invisible to the UI. **Severity: P2** — subset of #6.

### 12. `handleCrumbsFileDrop` browser path resolution is structurally broken

**Problem:** `('path' in file)` is not how Tauri v2 surfaces paths;
the fallback `file.webkitRelativePath || file.name` is just a basename
that the Rust decoder cannot open. The `if (!isTauri()) { warn;
return }` covers the browser case (correctly), but the rest of the
function has dead `'path' in file` logic.

**Representative files:**

- `src/modules/Crumbs/useCases/handleFileDrop.ts:38-77`

**Needed:** Use Tauri v2's `onDragDropEvent` (file paths are emitted
on a dedicated event channel, not via `File.path`). Either route
file-drop through that event, or accept only the sample-browser path
and remove drag-drop. Document in a spec which interaction is
supported.

**Verified 2026-04-28:** `handleFileDrop.ts:52-66`. The browser
short-circuit at line 52 is correctly placed. Lines 61-66
(`'path' in file`) are dead in Tauri v2 — `File` from
`event.dataTransfer.files` does not carry `.path`; Tauri v2 emits
paths on the `onDragDrop` event channel. The fallback at line 66
(`file.webkitRelativePath || file.name`) feeds a basename to the
Rust decoder which then fails to open the file. The whole
`if (filePath) { … }` block at lines 69-77 is unreachable in
practice except via the dead branch. **Severity: P2** — broken
end-to-end for file-drop in Tauri.

### 13. AGENTS.md function-signature violations across the module

**Problem:** Multiple module-level functions take >1 positional arg.

**Representative files:**

- `src/modules/Crumbs/repositories/crumbsBridge.ts:29,36,43,49,56,63,70,77,95,105,111,124,130,139,151`
- `src/modules/Crumbs/stores/crumbsStore.ts:90,102,119,131,143,158,179,200,212,224,236,248,260,272`
- `src/modules/Crumbs/stores/padStore.ts:32,44,60,78,82,102,120`
- `src/modules/Crumbs/stores/sliceStore.ts:26,38,54,77,94,113`
- `src/modules/Crumbs/useCases/loadSample.ts:13`
- `src/modules/Crumbs/useCases/setCrumbsMode.ts:13`
- `src/modules/Crumbs/useCases/handleFileDrop.ts:38`
- `src/modules/Crumbs/useCases/triggerPad/triggerPadOn.ts:6`
- `src/modules/Crumbs/useCases/triggerPad/triggerPadOff.ts:6`
- `src/modules/Crumbs/useCases/recording/armCrumbsRecording.ts:3`
- `src/modules/Crumbs/useCases/crumbsLifecycle/initCrumbsEngine.ts:6`
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts:5`
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamThrottled.ts:16`
- `src/modules/Crumbs/useCases/updateSliceMarker/debouncedUpdateMarkerPosition.ts:5`
- `src/modules/Crumbs/useCases/updateSliceMarker/detectAndSetSlices.ts:9`

**Needed:** Refactor each to a single object param named
`<FunctionName>Input`. AGENTS.md "Functions with more than one
parameter take a single object param".

**Verified 2026-04-28:** Spot-checked five sites. All match the
positional-args pattern. Sample violations:

- `crumbsBridge.armRecording(instanceId, threshold, targetPad,
  maxDurationSecs)` (`crumbsBridge.ts:139-149`) — 4 positional args.
- `setCrumbsParam(instanceId, param, value)` — 3 positional args.
- `assignSampleToPad(instanceId, index, sampleId, name)` — 4
  positional args.

**Severity: P3** — large refactor surface, no behavioural bug, but
violates AGENTS.md uniformly. Best done as a single mechanical
pass.

### 14. Non-null assertions used as soundness escape hatches

**Problem:** Several `!` assertions in places where AGENTS.md asks
the type to be fixed.

**Representative files:**

- `src/modules/Crumbs/models/CrumbsTypes.ts:165` `PAD_COLORS[index %
  PAD_COLORS.length]!`
- `src/modules/Crumbs/models/CrumbsTypes.ts:215` `names[note % 12]!`
- `src/modules/Crumbs/stores/padStore.ts:70` `pads[index]!`
- `src/modules/Crumbs/stores/padStore.ts:111` `channelStrips[index]!`
- `src/modules/Crumbs/stores/padStore.ts:142-144` `movedPad!`,
  `movedStrip!`
- `src/modules/Crumbs/presentations/components/PadGrid.tsx:165-166`
  `peaks[i*2]!`, `peaks[i*2+1]!`
- `src/modules/Crumbs/presentations/components/WaveformDisplay.tsx:71-72`
  same

**Needed:** Replace with explicit defaults (`?? 0`), narrow types
(tuple types for fixed-length arrays), or destructure-with-check.

**Verified 2026-04-28:** All cited sites confirmed. Most are
"safe in practice" (the bounds are real), but every `!` is an
AGENTS.md violation under "TypeScript — soundness". `padStore.ts:70`
in particular is suspect:

```ts
if (!inst || !inst.pads[index]) {
    return s;
}
const pads = [...inst.pads];
pads[index] = { ...pads[index]!, ...updates };
```

The `!` after the `pads[index]` check is redundant — TS narrows
across the boundary if you bind to a local variable instead of
re-reading the index. Fix: bind the existing pad before constructing
the spread.

**Severity: P3.**

### 15. Pure pass-through use cases add no value

**Problem:** Same shape as the AudioAnalysis audit's `audioAi/*.ts`
issue: thin re-exporters that satisfy "use cases wrap repositories"
cosmetically.

**Representative files:**

- `src/modules/Crumbs/useCases/recording/armCrumbsRecording.ts`
  (3-line forward to `armRecording`)
- `src/modules/Crumbs/useCases/recording/stopCrumbsRecording.ts`
  (3-line forward to `stopRecording`)
- `src/modules/Crumbs/useCases/triggerPad/allSoundOff.ts` (8-line
  try/catch wrapper around `crumbsAllSoundOff`)
- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts`
  (5-line forward, **and unused** — see issue #20)

**Needed:** Either inline at call sites or absorb a real
responsibility into each (validation, store mutation, error mapping).

**Verified 2026-04-28:** All four use cases match the description.
`armCrumbsRecording.ts` and `stopCrumbsRecording.ts` are 3-line
forwards. `allSoundOff.ts` adds a `try/catch` + `logger.warn` but
otherwise no-op. `setCrumbsParamImmediate.ts` is unused in
production (also captured in #20). **Severity: P3.**

### 16. `WaveformDisplay` does not handle resize and forces layout per frame

**Problem:** Canvas draw effect lists `[peaks, color, backgroundColor,
height]`; no `ResizeObserver`. `getBoundingClientRect` is called
per-frame in the cursor callback, forcing a layout flush at 60 Hz.

**Representative files:**

- `src/modules/Crumbs/presentations/components/WaveformDisplay.tsx:35-99`

**Needed:** Use `ResizeObserver` to re-render on layout change. Cache
the canvas client width on mount/resize and reuse in the cursor
callback. Drop `getBoundingClientRect` from the per-frame path.

**Verified 2026-04-28:** `WaveformDisplay.tsx:35-83` (draw effect)
deps are `[peaks, color, backgroundColor, height]` — no canvas
size observation. `WaveformDisplay.tsx:94`
`const rect = canvas.getBoundingClientRect()` runs **inside the
position-subscribe callback**, which fires at 60Hz via the rAF in
`positionTracking.ts`. Each call forces a layout flush. With the
panel layout being a 3-column grid plus tile cards, the layout cost
is non-trivial.

**Deepening:** also note that the cursor `useEffect` re-runs when
`onPositionSubscribe` changes — `subscribeToPosition` is module-
level (stable), but the parent passes it through as a prop without
any guarantee of stability. React Compiler memoises closures, but
not the prop *spread*. Today this is fine because the import is
referentially stable; tomorrow if the parent ever wraps it, this
breaks. **Severity: P2** — visible glitch + perf cost.

### 17. `PadGrid.flashTimers` keyed by index, not pad id

**Problem:** Pad reorder (`reorderPad`) shuffles the index → pad
mapping, but in-flight flash timers stay keyed by index. After a
reorder, a flash from the previous trigger lands on the wrong pad.

**Representative files:**

- `src/modules/Crumbs/presentations/components/PadGrid.tsx:32,42-64`

**Needed:** Key timers by `pad.id` (stable across reorder). Pass `id`
through `handleTrigger` instead of `index`.

### 18. `positionTracking.ts` rAF loop dies silently if a listener throws

**Problem:** `for (const listener of session.listeners)` runs inside
`tick`. A listener throwing (e.g. WaveformDisplay setState after
unmount) propagates out of `tick`; `requestAnimationFrame(tick)` is
never re-scheduled. The cursor freezes for the rest of the session.

**Representative files:**

- `src/modules/Crumbs/useCases/positionTracking.ts:73-88`

**Needed:** Wrap the listener call in `try/catch` with `logger.warn`.
Always reschedule the rAF.

**Verified 2026-04-28:** `positionTracking.ts:73-88`. The `tick`
function:

```ts
function tick(): void {
    const now = performance.now();
    ...
    for (const listener of session.listeners) {
        listener(session.interpolatedFrame);
    }
    session.rafId = requestAnimationFrame(tick);
}
```

If a listener throws, the loop unwinds before `requestAnimationFrame
(tick)` runs. Real-world repro: `WaveformDisplay`'s position
listener does DOM mutation (`cursor.style.left = ...`); if the
component unmounts mid-tick AND the cleanup hasn't yet removed the
listener (sequencing window of <1 frame), the listener could
attempt to mutate a `cursorRef.current` that's been GC'd. Not
trivially reproducible but also not impossible. **Severity: P2.**

### 19. Module-level `Map` state is not HMR-safe

**Problem:** `positionTracking.ts:24` and
`debouncedUpdateMarkerPosition.ts:3` hold `Map`s at module scope.
HMR retains the module instance but re-mounts components; pending
debounces and polling sessions can become orphans. No teardown hook
covers the cross-cutting concern.

**Representative files:**

- `src/modules/Crumbs/useCases/positionTracking.ts:24`
- `src/modules/Crumbs/useCases/updateSliceMarker/debouncedUpdateMarkerPosition.ts:3`

**Needed:** Either move the maps into a store (HMR-aware via the
infra `createStore`), or expose a `__resetForHmr` / `dispose` symbol
the dev environment can call. Cross-reference: the AudioAnalysis
audit raises the same pattern (issue #25 there).

**Verified 2026-04-28:** Three module-level mutable maps confirmed:

1. `positionTracking.ts:24` — `sessions = new Map(...)`.
2. `debouncedUpdateMarkerPosition.ts:3` — `pendingUpdates`.
3. `setCrumbsParamThrottled.ts:8` (via `createRafBatcher`'s
   internal `Map`) — captured in new Open Issue #37.

**Severity: P3** — not actively broken, but an HMR foot-gun and
contributes to the "module singletons survive teardown" risk.

### 20. `setCrumbsParamImmediate` is dead code

**Problem:** Only the test imports it; production code uses the
throttled variant exclusively.

**Representative files:**

- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts`
- `src/modules/Crumbs/useCases/crumbsParamBridge/__tests__/setCrumbsParamImmediate.spec.ts`

**Needed:** Either find a use case that needs immediate flush (e.g.
`note-on` velocity that should bypass batching) or delete.

**Verified 2026-04-28:** `grep -rn setCrumbsParamImmediate
src/modules/Crumbs/` shows references in only:

- `useCases/crumbsParamBridge/setCrumbsParamImmediate.ts` (the
  declaration)
- `useCases/crumbsParamBridge/__tests__/setCrumbsParamImmediate.spec.ts`
  (placeholder export-only — to be deleted under #36)
- `useCases/__tests__/crumbsParamBridge.spec.ts` (the consolidated
  test).

**No production caller.** Recommend delete; it can be added back
when a real "bypass throttle" use case appears (e.g. note-on
velocity expression). **Severity: P3.**

### 21. `armCrumbsRecording` and `triggerPadOn` accept unbounded numbers

**Problem:** `velocity: number` (Rust expects `u8`); `threshold:
number` (linear amplitude, no range check); `targetPad: number` (no
bounds check against `pads.length`); `maxDurationSecs: number` (no
positive-finite check).

**Representative files:**

- `src/modules/Crumbs/useCases/triggerPad/triggerPadOn.ts:6`
- `src/modules/Crumbs/useCases/recording/armCrumbsRecording.ts:3`
- `src/modules/Crumbs/repositories/crumbsBridge.ts:49,139`

**Needed:** Validate at the use-case layer (clamp velocity to 0..127
u8, threshold to 0..1, targetPad to 0..15, maxDurationSecs > 0).
Reject with a typed error or clamp with a `logger.warn`.

### 22. `crumbsParamBridge` cache key collision

**Problem:** `${instanceId}_${param}` collides if `instanceId`
contains `_`.

**Representative files:**

- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamThrottled.ts:17`

**Needed:** Use a tuple key (the rAF batcher likely supports
non-string keys, or use ` ` separator). Document the constraint.

### 23. `loadSampleFromPath` test fixture types are invalid

**Problem:** `__tests__/loadSample.spec.ts:30` passes `sampleId: 's1'`
where the type is `number`. Test passes only because vitest's
`mockResolvedValue` widens via `any` and the assertion uses
`expect.objectContaining`.

**Representative files:**

- `src/modules/Crumbs/useCases/__tests__/loadSample.spec.ts:30`

**Needed:** Use a typed factory that returns a real
`CrumbsLoadResult` with `sampleId: 1`.

### 24. `detectAndSetSlices` overwrites manual markers

**Problem:** Calling auto-detect after a user added markers via
`addMarker` replaces the entire list (`setMarkers(...)` overwrites).

**Representative files:**

- `src/modules/Crumbs/useCases/updateSliceMarker/detectAndSetSlices.ts:24`
- `src/modules/Crumbs/stores/sliceStore.ts:38`

**Needed:** Decide UX — replace, merge, or prompt. If replace,
disable the button or warn while the user has unsaved manual markers.
If merge, dedupe by frame proximity.

### 25. Loading the finest mipmap level for every sample wastes IPC

**Problem:** `loadSampleFromPath` always asks for `level: 0`. For
long samples the payload is large; the canvas bin width is unknown at
fetch time anyway.

**Representative files:**

- `src/modules/Crumbs/useCases/loadSample.ts:37`

**Needed:** Compute the desired level from the canvas width (or
fetch a coarse level first and refine on resize). Backend already
exposes mipmap levels — front-end uses a static 0.

### 26. `setCrumbsMode` log message typo

**Problem:** "Failed to crumbs mode:" should be "Failed to set
crumbs mode:".

**Representative files:**

- `src/modules/Crumbs/useCases/setCrumbsMode.ts:18`

**Needed:** Fix the string. Also unify log prefixes across the module
(`[Crumbs] ...`).

### 27. `setLoading(false)` duplicated; replace with `finally`

**Problem:** `loadSample.ts:43,45` — same call in try and catch
branches.

**Representative files:**

- `src/modules/Crumbs/useCases/loadSample.ts:13-48`

**Needed:** Single `finally { setLoading(instanceId, false); }`.

### 28. No accessibility on PadGrid / SliceOverlay

**Problem:** Pads lack `aria-pressed`, `aria-label` for assistive
tech beyond the visible name. Drag-and-drop has no keyboard
alternative. Slice markers are not focusable.

**Representative files:**

- `src/modules/Crumbs/presentations/components/PadGrid.tsx:90-144`
- `src/modules/Crumbs/presentations/components/SliceOverlay.tsx:73-100`

**Needed:** Add `aria-pressed={isSelected}`, descriptive
`aria-label`, keyboard trigger (`onKeyDown` Space/Enter), and
keyboard reorder semantics. Markers should be focusable with
`tabIndex={0}` and arrow-key adjustment.

### 29. `categoryToMode` lives in a use-case file but is a pure helper

**Problem:** A switch-case pure function with no side effects, in a
use-case file.

**Representative files:**

- `src/modules/Crumbs/useCases/handleFileDrop.ts:24-36`

**Needed:** Move to `services/categorySuggestion.ts` (and add a
`services/` folder per AGENTS.md).

### 30. Fixed `instanceId` separators / no escape across multiple maps

**Problem:** `setCrumbsParamThrottled` uses `_`,
`debouncedUpdateMarkerPosition` uses `:`. Different separators across
the module — neither escapes.

**Representative files:**

- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamThrottled.ts:17`
- `src/modules/Crumbs/useCases/updateSliceMarker/debouncedUpdateMarkerPosition.ts:6`

**Needed:** Standardise on a tuple key (`Map<[string, string], T>`)
or a typed brand. Document.

### 31. `createCrumbsInstance` failure leaves stores in an inconsistent state

**Problem:** Stores are populated in `initCrumbsEngine`
(`ensureInstance`, `ensurePadInstance`, `ensureSliceInstance`) before
the bridge call. If the bridge throws, stores think the instance
exists. Subsequent param sets are silent no-ops on the backend.

**Representative files:**

- `src/modules/Crumbs/useCases/crumbsLifecycle/initCrumbsEngine.ts:6-11`
- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:82-84`

**Needed:** Add a per-instance `isReady: boolean` flag in the store,
flip true only after the bridge resolves; gate UI on it. On
rejection, run the teardown path to clear stores. Add a test for the
failure case.

### 32. `presentations/views/index.ts` is a one-line indirection

**Problem:** Exists as a single re-export of `CrumbsPanel`. With a
proper module root `index.ts` (issue #1), this can collapse.

**Representative files:**

- `src/modules/Crumbs/presentations/views/index.ts`

**Needed:** Either remove (and update `AppShell` to import from the
new root `index.ts`) or keep as the views barrel and have the root
re-export from it. Pick one.

### 33. `SliceOverlay` width hard-coded to 600 over a fluid waveform canvas

**Problem:** `CrumbsPanel.tsx:267` renders
`<SliceOverlay ... width={600} height={140} />`. Inside
`SliceOverlay.tsx:71`, marker x positions are computed as
`(marker.framePosition / totalFrames) * width` — i.e. against the
hard-coded 600. The sibling `WaveformDisplay`
(`WaveformDisplay.tsx:103`) uses `className="w-full"` on the
canvas, so its actual rendered pixel width is whatever the parent's
`min-w-0` flex / grid resolves to, which is **not** 600px in the
default panel layout.

Worse, the drag math at `SliceOverlay.tsx:54` divides `dx` by
`containerRect.width` — the **live** container width — when
converting screen-pixel deltas to frame deltas. So:

- **Paint:** uses the prop `width` (600) to position markers.
- **Drag:** uses `containerRect.width` (the actual rendered width)
  to compute frame deltas.

The two scales disagree. Markers do not align with the underlying
waveform peaks, and dragging produces frame deltas at a different
rate than the visual translation.

**Representative files:**

- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:263-272`
- `src/modules/Crumbs/presentations/components/SliceOverlay.tsx:54,71`

**Needed:** Drop the `width` prop entirely and have `SliceOverlay`
read its own `containerRect.width` (via `ResizeObserver`-driven
state) for both paint and drag. Or pass the canvas's measured CSS
pixel width down from `WaveformDisplay`. Wire the overlay's container
to the same dimensions as the canvas.

**Severity:** **P1** alongside #8 — even if the engine accepted the
dragged frame, the visual position is wrong before the drag begins.

### 34. Envelope keys forwarded as IPC param names without validation

**Problem:** `CrumbsPanel.tsx:315-320`:

```ts
onEnvelopeChange={(updates) => {
    updateEnvelope(deviceId, updates);
    for (const [key, value] of Object.entries(updates)) {
        handleParamChange(key, value);
    }
}}
```

`Object.entries(updates).map(([k]) => k)` is `string` — there is no
type-level guarantee that `key` is one of the names that
`parse_crumbs_param` accepts. Today the `EnvelopeParams` keys
(`attack | hold | decay | sustain | release`) round-trip safely,
but a future field on `EnvelopeParams` (say `releaseCurve`) would
silently fail at runtime via `logger.warn` with no test coverage
forcing the round-trip.

This is the loudest example of the more general issue #5, but
worth calling out separately because the `Object.entries` pattern
specifically erases the literal-type information that would
otherwise force the discriminated-union match.

**Representative files:**

- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:315-320`

**Needed:** Iterate explicitly over a typed list of keys
(`(['attack', 'hold', 'decay', 'sustain', 'release'] as const).forEach
(...)`) or call `setCrumbsParamThrottled` with a literal
discriminator-typed signature that won't accept arbitrary strings.

**Severity:** **P2** — bug-prone, not currently wrong.

### 35. `category` cast is unchecked Rust-side widening

**Problem:** `loadSample.ts:28`:

```ts
category: result.category as SampleMeta['category'],
```

`CrumbsLoadResult.category` is `string`
(`models/CrumbsTypes.ts:72`). The Rust side returns one of
`'percussive' | 'tonal' | 'loop' | 'unknown'` per `classify_sample`
(`src-tauri/src/commands/crumbs.rs:667-685`). The cast trusts that
silently. Any future Rust addition (e.g. `'noise'`) would slip
through and be rendered into `SampleMeta`, eventually feeding
`categoryToMode` (`handleFileDrop.ts:24`) which would default to
`'quick'` via the `default` branch — silent acceptance, no warning.

AGENTS.md "TypeScript — soundness" forbids `as` to silence the
compiler when the value isn't validated.

**Representative files:**

- `src/modules/Crumbs/useCases/loadSample.ts:28`
- `src/modules/Crumbs/models/CrumbsTypes.ts:64-73` (the type with
  `category: string` while `SampleMeta.category` is the narrow union)

**Needed:** Either tighten `CrumbsLoadResult.category` to
`SampleCategory` and let the IPC parser validate, or guard with a
runtime check that coerces unknown values to `'unknown'` before
populating `SampleMeta`.

**Severity:** **P2.**

### 36. Duplicate placeholder spec files shadow consolidated specs

**Problem:** Three placeholder export-only specs exist alongside a
real, behaviour-asserting spec:

- `triggerPad/__tests__/triggerPadOn.spec.ts` (placeholder)
- `triggerPad/__tests__/triggerPadOff.spec.ts` (placeholder)
- `triggerPad/__tests__/allSoundOff.spec.ts` (placeholder)

vs.

- `triggerPad/__tests__/triggerPad.spec.ts` (consolidates
  `triggerPadOn` and `triggerPadOff`, asserts bridge delegation
  with `vi.mock`).

Both run on `pnpm test`, the placeholder versions add zero
verification value, and they confuse the "what tests cover X"
read.

A similar duplicate pair exists in `crumbsParamBridge/__tests__/`:

- `setCrumbsParamImmediate.spec.ts` (placeholder)
- `setCrumbsParamThrottled.spec.ts` (placeholder)

vs.

- `useCases/__tests__/crumbsParamBridge.spec.ts` (real, mocks the
  bridge, asserts forwarding).

**Representative files:**

- `src/modules/Crumbs/useCases/triggerPad/__tests__/triggerPadOn.spec.ts`
- `src/modules/Crumbs/useCases/triggerPad/__tests__/triggerPadOff.spec.ts`
- `src/modules/Crumbs/useCases/triggerPad/__tests__/allSoundOff.spec.ts`
- `src/modules/Crumbs/useCases/crumbsParamBridge/__tests__/setCrumbsParamImmediate.spec.ts`
- `src/modules/Crumbs/useCases/crumbsParamBridge/__tests__/setCrumbsParamThrottled.spec.ts`

**Needed:** Delete all five placeholder files. Promote the
consolidated specs as the source of truth, or split into per-file
specs that actually exercise behaviour.

**Severity:** **P2** — test hygiene; resolves part of issue #3.

### 37. `paramBatcher` is a module-level singleton with no flush-on-teardown

**Problem:** `setCrumbsParamThrottled.ts:8`:

```ts
const paramBatcher = createRafBatcher<CrumbsBatchEntry>();
```

This is a single batcher for **every** Crumbs instance ever
created — keyed by `${instanceId}_${param}`. There is no
disposal hook; `teardownCrumbsEngine.ts:6-11` calls
`removeInstance` / `destroyCrumbsInstance` but never
`paramBatcher.cancel(...)` for any pending entries belonging to
the destroyed instance.

**Repro:** the user drags a knob; `setCrumbsParamThrottled` fills
the batcher; the user immediately switches device or unmounts the
panel; the rAF flushes after teardown; `setCrumbsParam` is called
on a destroyed instance and the Rust side returns
`Err("Instance not found: ...")`; we log a warn. Visible in dev
console; harmless to audio but a clean teardown should not be
firing IPC at a destroyed instance.

Worse: the batcher's `Map` retains the per-key entries until they
flush. For long sessions with many transient devices, this is a
slow leak (cancelled rAFs would leave the entries in the Map only
between schedule and flush, so it's small, but the Map itself is
never reset — even if `cancelAll` were available, there's no hook
that calls it).

**Representative files:**

- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamThrottled.ts:8`
- `src/modules/Crumbs/useCases/crumbsLifecycle/teardownCrumbsEngine.ts:6-11`

**Needed:** Either move the batcher into a per-instance store
disposed on teardown, or expose a `disposeInstanceBatch(instanceId)`
helper that cancels all keys prefixed with that instance and call
it from `teardownCrumbsEngine`.

**Severity:** **P2** — small, real, visible in dev.

### 38. Test documents an invalid Rust param name

**Problem:** `useCases/__tests__/crumbsParamBridge.spec.ts:36-37`
calls `setCrumbsParamImmediate('inst-1', 'gain', 0.5)`. The Rust
side's `parse_crumbs_param`
(`src-tauri/src/commands/crumbs.rs:643`) accepts `"masterGain"`,
not `"gain"`. The mocked test passes (the bridge is faked), but
the test "documents" a contract that does not exist on the
backend.

**Representative files:**

- `src/modules/Crumbs/useCases/__tests__/crumbsParamBridge.spec.ts:36,42`

**Needed:** Use a real param name (`'masterGain'`) so the test
reflects actual contract. Better: parametrise the test over the
literal-union of valid names (after issue #5 lands).

**Severity:** **P3** — but useful as a tripwire.

### 39. `MiniWaveform` and `WaveformDisplay` non-null asserts on peaks

**Problem:** `PadGrid.tsx:165-166`:

```ts
const min = peaks[i * 2]!;
const max = peaks[i * 2 + 1]!;
```

`peaks: number[]`. `numBins = Math.floor(peaks.length / 2)`, so
`i < numBins` implies `i * 2 + 1 < peaks.length` and the indexing
is safe — but the `!` is still an AGENTS.md violation. Same at
`WaveformDisplay.tsx:71-72`.

These are not lazy escapes (the bounds are real); they're places
where TypeScript's `noUncheckedIndexedAccess` makes the type
`number | undefined`. The fix is a typed pair-wise iterator or a
helper that yields `[min, max]` tuples, eliminating the `!`.

**Representative files:**

- `src/modules/Crumbs/presentations/components/PadGrid.tsx:165-166`
- `src/modules/Crumbs/presentations/components/WaveformDisplay.tsx:71-72`

**Needed:** Replace with a typed `for (const [min, max] of
pairs(peaks))` helper. Fold into the issue #14 sweep.

**Severity:** **P3** — soundness drift, no behaviour bug.

### 40. `reorderPad` does not validate `channelStrips.length`

**Problem:** `padStore.ts:120-151` validates `fromIndex`/`toIndex`
against `inst.pads.length` (`:129-134`) but then mutates *both*
`pads` and `channelStrips` arrays. If `pads` and `channelStrips`
ever drift to different lengths (currently they're seeded together
in `defaultPadState`), the splice on `channelStrips` could fail
silently — `splice` on an out-of-range index returns `[]`, and
`movedStrip!` would throw at runtime via the non-null assertion.

The `defaultPadState` factory ensures equal length today, but
nothing enforces this invariant — and `updatePad` /
`updateChannelStrip` operate on each independently. A single
errant code path that adds to `pads` without `channelStrips` would
make `reorderPad` time-bomb on the first reorder.

**Representative files:**

- `src/modules/Crumbs/stores/padStore.ts:120-151`

**Needed:** Either model the pads and strips as a single tuple
(`PadEntry = { config: PadConfig; strip: PadChannelStrip }`), or
validate `channelStrips.length === pads.length` invariant on every
mutator. The first option is the cleaner refactor.

**Severity:** **P3** — latent invariant violation.

### 41. No web-build degradation story; UI is fully wired without audio

**Problem:** Every IPC entry on `crumbsBridge.ts` checks
`isTauri()` and either throws (data-returning) or silently
returns (void). The UI components do not know whether IPC is
available — they wire handlers, write stores, render knobs.
Specifically:

- `setCrumbsParamThrottled` schedules an rAF, which calls
  `setCrumbsParam` which silently no-ops in browser
  (`crumbsBridge.ts:64-66`).
- `triggerPadOn` likewise silently no-ops via `crumbsNoteOn`.
- `subscribeToPosition` adds listeners that are never invoked.
- `handleCrumbsFileDrop` short-circuits with a `logger.warn`
  (good), but the user sees no UI feedback.
- The "Ready" status LED shows even when the engine is not
  reachable.

The whole module behaves as a UI mockup in browser builds: knobs
turn, pads flash, but nothing happens. There is no surfaced
"Audio engine unavailable" state, no banner, no disabled controls.

This is partially intentional ("Sourdaw is a desktop app") but it
makes E2E / Playwright runs against the browser build deceptive —
the UI looks healthy.

**Representative files:**

- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:243-247`
  (status LED shows "Ready" unconditionally)
- `src/modules/Crumbs/repositories/crumbsBridge.ts` (every void
  bridge silently returns)

**Needed:** Pick a story:

1. **Hide the panel** in browser mode (early-return at the
   `CrumbsPanel` top with a "desktop only" placeholder). Or,
2. **Disable controls and surface "Audio unavailable" state** in
   the existing layout, gated on a `isTauri()` boolean read once.

Either way, document the choice in a spec.

**Severity:** **P2** — affects E2E / web-build user experience.

---

## Open questions

- [ ] Is the `set_slice_marker` IPC entry intentionally missing —
      slice marker dragging is "design TODO" — or is it a regression?
      (Affects whether issue #8 is a P1 bug or an "in-progress"
      feature.)
- [ ] What is the intended source of truth for sample rate at engine
      init? Should `Crumbs` query `AudioEngine` for the host rate, or
      should the Rust side accept a "use device default" sentinel?
      (Affects #4.)
- [ ] Is `triggerPadOff` intentionally not wired (samples are all
      one-shot today) or an oversight? (Affects #7.)
- [ ] Should `referenceMixComparison`-style "param settled" events
      flow back through the Tauri event bus, or should the front-end
      poll a snapshot? (Affects #6.)
- [ ] Is `setCrumbsParamImmediate` reserved for future use (e.g.
      MIDI-driven note expression bypass) or should it be deleted?
      (Affects #20.)

---

## Risks

- **Silent UI/engine drift.** Issues #6, #11, #31, #49 / Open Issue
  #6, #37: any IPC failure (queue full, instance gone, parse error)
  leaves the UI showing values the engine never received. Compounded
  by gain controls that can be set to 200% in the UI while the
  engine clamps to 100% — the user can't tell. Verified
  2026-04-28: zero feedback paths from IPC failure to UI.
- **Pad triggering is broken for non-one-shot samples.** Issue #7
  / Open Issue #7: the documented "velocity-sensitive" pad grid
  neither sends note-off nor varies velocity. Held notes, sustained
  samples, and any DAW-standard pad workflow are unsupported.
- **Slice mode is theatre.** Issue #8 / Open Issues #8, #33:
  dragging markers updates the UI but not the audio. The overlay
  width also disagrees with the canvas width, so even paint
  positions are off. Users will trust visual feedback that doesn't
  reflect playback.
- **Position tracking can DoS the backend on slow IPC.** Issue #10
  / Open Issue #10: `setInterval` with no in-flight guard stacks
  IPC calls under load; out-of-order resume causes non-monotonic
  frame updates → backwards cursor scrub.
- **Test suite cannot detect regressions.** Issues #2, #3, #36,
  #37, #50 / Open Issues #2, #3, #36: 14 placeholder specs (the
  audit's headline "fifteen" is off by one — see Findings note),
  a misdirected mock in `CrumbsPanel.spec.tsx`, AND duplicate
  placeholder shells that shadow consolidated specs. AGENTS.md's
  "Force Empirical Proof" rule is unfulfillable in this state.
- **AGENTS.md drift normalises.** Issues #1, #13, #14, #15 / Open
  Issues #1, #13, #14, #15: missing root barrel, positional args,
  `!` escapes, and pass-through use cases form a pattern that
  downstream modules will copy.
- **Sample-rate skew biases ALL playback, not just analysis.**
  Issue #4 / Open Issue #4: pitch detection, loop-point detection,
  and BPM estimation depend on the host rate AND every Voice's
  resampling phase increment. On a 48 kHz interface every note
  plays back at a wrong pitch (~145 cents sharp). The audit's
  original framing emphasised analysis bias; the playback bias is
  worse and visible to every user.
- **Web-build deceives E2E and reviewers.** New Open Issue #41:
  the panel renders healthy in browser mode while no audio path
  exists. Playwright runs against the browser build will see
  green knobs, working drags, "Ready" status — and zero of it
  reaches a real audio engine.
- **Module-level singletons leak across instance lifecycles.**
  New Open Issue #37 + Issue #19 / Open Issue #19: `paramBatcher`,
  `pendingUpdates` (debounce timers), `sessions` (polling) all
  live at module scope and survive the lifecycle of any single
  Crumbs instance. Combined with HMR they are slow leaks; combined
  with rapid device-switch they fire IPC at destroyed instances.

---

## Suggested approaches

Re-ordered 2026-04-28 to reflect the verified severity:

- **Land Open Issue #1 first** — add a root `index.ts` and switch
  the AppShell import. Mechanical; unblocks the contract. ~10 min.
- **Then Open Issues #2 + #3 + #36** — fix `CrumbsPanel.spec.tsx`
  to mock `useStoreSelector`, delete the five duplicate placeholder
  specs (#36), convert the remaining 9 placeholder specs to
  behaviour specs in a single sweep. Once tests are non-vacuous,
  the rest of the work can be driven test-first.
- **Open Issue #4 next** — sample rate plumbing. The fix is
  one-line in the panel, but it requires deciding the source of
  truth: read `audioContext.sampleRate` from `AudioEngine` (the
  AudioEngine module already has this) or query the Rust side for
  the host rate. Add a test asserting the supplied rate is
  forwarded.
- **Open Issue #7** (pad note-off + velocity) — add
  `onPointerUp`/`onPointerLeave`/`onPointerCancel` handlers that
  call `triggerPadOff`. Map `PointerEvent.pressure` (or pad-relative
  click-y-position) to MIDI velocity. Add keyboard support
  (`onKeyDown` Space/Enter for trigger).
- **Open Issues #8 + #33 together** — add a `set_slice_marker` IPC
  on the Rust side (single Tauri command), plumb through the
  bridge, call from the debounced update. While there: drop the
  `width={600}` prop from `SliceOverlay` and have it measure its
  own container.
- **Open Issue #5 (and #34)** — define `CrumbsParamName` as a
  literal-union of the 20 valid Rust names. Tighten
  `setCrumbsParam`, `setCrumbsParamThrottled`, the use-case helpers.
  The `Object.entries(updates)` loops in `CrumbsPanel` need to
  iterate over typed keys (`(['attack', 'hold', 'decay', 'sustain',
  'release'] as const).forEach(...)`).
- **Open Issue #6** — pick one: (a) "param settled" event from Rust
  (best, requires Tauri event channel), (b) periodic param snapshot
  poll, (c) toast + UI revert on IPC failure. Document in a spec
  before implementing.
- **Open Issues #10, #18, #19** — rewrite `positionTracking.ts`
  around a self-rescheduling timer with an in-flight guard, rAF
  that catches listener errors, and an HMR-safe state location.
- **Open Issue #37** — add a `paramBatcher.cancelAll(instanceId)`
  call from `teardownCrumbsEngine`. Trivial after #5 lands.
- **Open Issue #41** — gate `CrumbsPanel` on `isTauri()` with a
  "desktop only" placeholder. Zero risk; clarifies E2E.
- **Open Issues #13, #14, #15, #21, #39, #40** are an "AGENTS.md
  compliance" sweep — do as a single commit after the user-visible
  fixes.
- **#16, #17, #28, #29** are component polish — pick up after the
  state-machine fixes land.

---

## Recommendation

Updated 2026-04-28 after the adversarial pass:

Start with **Open Issue #1 (add root `index.ts`, fix the AppShell
deep import)**. It's mechanical, removes the AGENTS.md violation,
and makes the public contract for this module explicit.

Immediately after, do **Open Issue #2 (fix `CrumbsPanel.spec.tsx`
mock target)** and **Open Issues #3 + #36 (delete the five duplicate
placeholder specs, then replace the remaining 9 with behaviour
tests)** — the biggest leverage move in the audit. Without real
test coverage, every other fix is an unverified claim; AGENTS.md
"Force Empirical Proof" cannot be honoured. Tackle the placeholder
specs in priority order: the param bridge, position tracking, the
lifecycle pair, then the rest. Aim for one assertion per behaviour
the production code commits to.

Then tackle **Open Issue #4 (sample rate)** because it is the most
quietly-wrong runtime bug — every non-44.1 kHz interface plays back
sharper than intended. One-line fix once the source-of-truth is
decided. The original audit's "do #7 first" framing under-weighted
this: the sample-rate skew affects every note from every device,
while #7 affects only non-oneshot samples (currently rare in
practice given hard-coded `oneShot: true` in `createDefaultPad`).

Then tackle **Open Issue #7 (pad note-off + velocity)** because it
is the most user-visible breakage — a sampler that doesn't release
held notes is not a sampler — and **Open Issues #8 + #33 (slice
mode wiring + width mismatch)** as a paired follow-up. The two slice
issues are now confirmed: dragging doesn't reach the engine AND the
overlay paints at a different width than the canvas it sits over.

After those land, split between:

- **Correctness pass:** Open Issues #5, #6, #10, #11, #34, #37,
  #41 — string-typed params, optimistic store drift, position
  tracking races, web-build degradation.
- **Architecture pass:** Open Issues #13, #14, #15, #19, #20, #29,
  #32, #39, #40 — AGENTS.md compliance, dead code, structural
  cleanup.

The two passes are independent and can run in parallel.

---

## Resolved

_No issues resolved yet._
