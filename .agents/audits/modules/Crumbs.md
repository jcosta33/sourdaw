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

3. **Placeholder export-only tests.** Fifteen files in
   `useCases/**/__tests__/` and `useCases/__tests__/` perform no
   behaviour assertions — they assert the export exists with a
   permissive `typeof === 'function' || 'object'`. Listed at the end
   of issue #3 below. AGENTS.md "TypeScript — soundness — Tests:
   assert the actual contract (values, shape, or error text)" is
   ignored systematically across the module.

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

1. **Missing root `index.ts` and external deep-import** (issue #1, #35)
   — AGENTS.md contract violation in `AppShell.tsx`. Mechanical fix.
2. **Test coverage is theatrical** (issues #2, #3, #36, #37, #50, #57)
   — fifteen placeholder specs and a misdirected mock in
   `CrumbsPanel.spec.tsx`. Regression-detection capacity is near zero.
3. **Pad triggering is missing note-off and uses constant velocity**
   (issues #7, #15, #16) — the headline interaction is broken for
   non-oneshot samples.
4. **Slice marker drags do not propagate to the engine** (issue #8) —
   visible UI / silent audio: the drag does nothing audible.
5. **Sample rate hard-coded** (issue #4) — affects pitch and timing
   accuracy on every non-44.1 kHz interface.
6. **String-typed parameter names cross the IPC boundary unchecked**
   (issues #5, #37, #38) — TS-Rust drift is only caught at runtime
   with a `logger.warn`.
7. **Optimistic store writes never reconcile** (issue #6, #49) —
   silent state divergence on any IPC failure.
8. **`positionTracking.ts` racing IPC + dead poll on browser**
   (issues #10, #11, #25, #55) — a per-instance `setInterval`
   without in-flight guard, a Set iterator that can throw the rAF
   loop dead.
9. **Slice overlay drag UX bugs** (issues #9, #28) — stale
   `containerRect`, no `setPointerCapture`.
10. **`WaveformDisplay` ignores resize and forces layout flush per
    frame** (issues #29, #30) — visual glitch + 5 ms reflow at 60 Hz.

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

### 3. Fifteen placeholder export-only spec files

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

### 4. Sample rate hard-coded to 44100 in panel

**Problem:** `CrumbsPanel.tsx:82` `initCrumbsEngine(deviceId, 44100)`.
A 48 kHz interface lies to the Rust sampler; pitch tracking and
loop-point timing become biased.

**Representative files:**

- `src/modules/Crumbs/presentations/views/CrumbsPanel.tsx:82`

**Needed:** Read `audioContext.sampleRate` (via AudioEngine) or query
the Rust side for the host rate. Pass the actual rate. Add a test
that verifies `initCrumbsEngine` forwards the supplied rate.

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
across re-detection (they currently are not — issue #34).

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

### 16. `WaveformDisplay` does not handle resize and forces layout per frame

**Problem:** Canvas draw effect lists `[peaks, color, backgroundColor,
height]`; no `ResizeObserver`. `getBoundingClientRect` is called
per-frame in the cursor callback, forcing a layout flush at 60 Hz.

**Representative files:**

- `src/modules/Crumbs/presentations/components/WaveformDisplay.tsx:35-99`

**Needed:** Use `ResizeObserver` to re-render on layout change. Cache
the canvas client width on mount/resize and reuse in the cursor
callback. Drop `getBoundingClientRect` from the per-frame path.

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

### 20. `setCrumbsParamImmediate` is dead code

**Problem:** Only the test imports it; production code uses the
throttled variant exclusively.

**Representative files:**

- `src/modules/Crumbs/useCases/crumbsParamBridge/setCrumbsParamImmediate.ts`
- `src/modules/Crumbs/useCases/crumbsParamBridge/__tests__/setCrumbsParamImmediate.spec.ts`

**Needed:** Either find a use case that needs immediate flush (e.g.
`note-on` velocity that should bypass batching) or delete.

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

- **Silent UI/engine drift.** Issues #6, #11, #31, #49: any IPC
  failure (queue full, instance gone, parse error) leaves the UI
  showing values the engine never received. Compounded by gain
  controls that can be set to 200% in the UI while the engine clamps
  to 100% — the user can't tell.
- **Pad triggering is broken for non-one-shot samples.** Issue #7:
  the documented "velocity-sensitive" pad grid neither sends note-off
  nor varies velocity. Held notes, sustained samples, and any DAW-
  standard pad workflow are unsupported.
- **Slice editing is theatre.** Issue #8: dragging markers updates the
  UI but not the audio. Users will trust visual feedback that doesn't
  reflect playback.
- **Position tracking can DoS the backend on slow IPC.** Issue #10:
  `setInterval` with no in-flight guard stacks IPC calls under load.
- **Test suite cannot detect regressions.** Issues #2, #3, #36, #37,
  #50: 15 placeholder specs and a misdirected mock — a refactor that
  silently breaks the panel will not fail any test. AGENTS.md's
  "Force Empirical Proof" rule is unfulfillable in this state.
- **AGENTS.md drift normalises.** Issues #1, #13, #14, #15: missing
  root barrel, positional args, `!` escapes, and pass-through use
  cases form a pattern that downstream modules will copy.
- **Sample-rate skew biases analysis.** Issue #4: pitch detection,
  loop-point detection, and BPM estimation all depend on the host
  rate; lying to the Rust side affects every detected metric the UI
  surfaces.

---

## Suggested approaches

- **Land #1 first** — add a root `index.ts` and switch the AppShell
  import. Mechanical; unblocks the contract.
- **Then #2 + #3** — fix `CrumbsPanel.spec.tsx` to mock
  `useStoreSelector`, then convert the 15 placeholder specs to
  behaviour specs in a single sweep. Once tests are non-vacuous, the
  rest of the work (especially #6, #7, #8) can be driven test-first.
- **#7 next** (pad note-off + velocity) — most user-visible, small
  scope. Add `onPointerUp` and a velocity computation, then map
  `PointerEvent.pressure`/click-y-position.
- **#8 + a `set_slice_marker` IPC** — small Rust addition, then plumb
  through the bridge and the debounced update.
- **#4** is a one-line change once the host rate plumbing is decided.
- **#5, #13, #14, #15, #21** are an "AGENTS.md compliance" sweep —
  do as a single commit after the user-visible fixes.
- **#10, #18, #19** rewrite `positionTracking.ts` around a
  self-rescheduling timer with an in-flight guard, rAF that swallows
  listener errors, and an HMR-safe state location.
- **#16, #17, #28, #29** are component polish — pick up after the
  state-machine fixes land.

---

## Recommendation

Start with **issue #1 (add root `index.ts`, fix the AppShell deep
import)**. It's mechanical, removes the AGENTS.md violation, and
makes the public contract for this module explicit.

Immediately after, do **#2 (fix `CrumbsPanel.spec.tsx` mock target)**
and **#3 (replace the 15 placeholder specs with behaviour tests)** —
this is the biggest leverage move in the audit. Without real test
coverage, every other fix is an unverified claim; AGENTS.md "Force
Empirical Proof" cannot be honoured. Tackle the placeholder specs in
priority order: the param bridge, position tracking, the lifecycle
pair, then the rest. Aim for one assertion per behaviour the
production code commits to.

Then tackle **#7 (pad note-off + velocity)** because it is the most
user-visible breakage — a sampler that doesn't release held notes is
not a sampler.

After those three land, the next session can split between the
"correctness pass" (#4, #5, #6, #8, #10, #11, #21, #31, #38) and the
"architecture / cleanup pass" (#13, #14, #15, #19, #20, #29, #32).
They are mostly independent.

---

## Resolved

_No issues resolved yet._
