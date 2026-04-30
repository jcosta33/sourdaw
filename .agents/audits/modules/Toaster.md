# Toaster module audit

## Scope

This audit covers `src/modules/Toaster/` in full — all use cases, repositories,
stores, models, presentations, and their tests. The "Toaster" module despite
its name is **not** a notification/toast system: it is a circuit-faithful
16-pad drum machine (TR-808/909/CR-78 emulation) with a Bjorklund Euclidean
generator, step sequencer, pattern morph, sound locks, 16-levels mode, and a
`toaster` device that bridges to a Rust WASM voice engine.

Excluded: the upstream `AudioEngine` worklet (the `toasterControls`
abstraction), `Arrangement.getAllTracks` callers, the Rust `daw-toaster`
crate, and the `eventBus` contract — except where directly imported.

It is an adversarial review: bugs, races, leaks, contract violations,
type-soundness escapes, React anti-patterns, accessibility, and testing gaps.

Related spec: none on disk.

---

## Goal

A correctness-first drum-machine surface that:

- Owns its instance state per `deviceId` and never leaks timers, listeners,
  or rAF handles between instances.
- Schedules step playback with audio-clock-corrected timeouts that survive
  device unmount, BPM changes, and pattern reloads without drift, double-fire,
  or stale-closure references.
- Routes UI changes to both the JS store and the WASM worklet through a
  single bridge that never deadlocks, never drops the latest value, and
  never updates the worklet without updating the store (or vice versa).
- Uses canonical AGENTS.md rules: contract boundaries, one-function-per-file
  in `useCases/`, no cross-module deep imports, `type` over `interface`,
  no `as any` / `as unknown as`, no `useMemo`/`useCallback`/`React.memo`,
  no rendering with `&&`, single-object-param signatures.
- Renders an interactive UI that is keyboard- and screen-reader-reachable:
  pads have accessible labels, step grid has roles, sliders have valid
  ranges, and live updates surface to assistive tech.
- Has tests that exercise actual contracts — pattern advancement, swing
  math, choke groups, sound-lock restoration, Euclidean rhythms, mute/solo,
  morph end-points — not "called fn, returned undefined".

---

## Relevant code paths

- `src/modules/Toaster/index.ts` (root barrel — verify presence)
- `src/modules/Toaster/events/index.ts`
- `src/modules/Toaster/models/ToasterKit.ts`
- `src/modules/Toaster/models/GrooveTemplates.ts`
- `src/modules/Toaster/stores/index.ts`
- `src/modules/Toaster/stores/toasterStore.ts`
- `src/modules/Toaster/repositories/toasterPresets.ts`
- `src/modules/Toaster/useCases/index.ts`
- `src/modules/Toaster/useCases/triggerPad.ts`
- `src/modules/Toaster/useCases/sequencerPlayback.ts`
- `src/modules/Toaster/useCases/loadToasterKit.ts`
- `src/modules/Toaster/useCases/applyEuclidean.ts`
- `src/modules/Toaster/useCases/euclidean.ts`
- `src/modules/Toaster/useCases/exportPatternToTimeline.ts`
- `src/modules/Toaster/useCases/noteRepeat.ts`
- `src/modules/Toaster/useCases/patternMorph.ts`
- `src/modules/Toaster/useCases/sixteenLevels.ts`
- `src/modules/Toaster/useCases/createDrumTrackStack.ts`
- `src/modules/Toaster/useCases/toasterQueries.ts`
- `src/modules/Toaster/useCases/toasterSubscriber.ts`
- `src/modules/Toaster/useCases/setMorphPosition/{setMorphPosition,setMorphTarget,toggleMorph}.ts`
- `src/modules/Toaster/useCases/soundLocks/{getSoundLock,setSoundLock}.ts`
- `src/modules/Toaster/useCases/toasterParamBridge/*.ts`
- `src/modules/Toaster/presentations/views/ToasterPanel.tsx`
- `src/modules/Toaster/presentations/components/{PadGrid,PadMixer,StepSequencer}.tsx`

---

## Current behavior

**State.** `toasterStore` is a single `Store<Record<deviceId, ToasterState>>`
(`stores/toasterStore.ts:41`). All mutators (`selectPad`, `updatePad`,
`loadKit`, `updateKit`, `toggleStep`, `setStepVelocity`) are
read-modify-write spreads over `toasterStore.value`. There is no transactional
guarantee between concurrent writers; the last spread wins.

**Sequencer playback.** `sequencerPlayback.ts:31-46` keeps a
`Map<deviceId, SequencerState>` of `{ running, fillActive, playCount,
nextTickTime, timeoutId }`. `tick()` reads `toasterStore.value` each step,
optionally morphs the pattern, fires `triggerToasterPad`, optionally
schedules retriggers and microtiming offsets, then chains the next tick via
`setTimeout(getAudioTime() correction)`.

**Note repeat.** `noteRepeat.ts:20` uses a single module-level
`activeSession` — only one note-repeat session can exist across all devices.

**16-levels.** `sixteenLevels.ts:16` uses a single module-level
`activeSession` — only one 16-levels mode at a time, across all devices.

**Param bridge.** `toasterParamBridge/setToasterPadParam.ts:8-9` keeps two
module-level maps (`padPending`, `padLatest`) keyed by
`${deviceId}_${padIndex}_${key}`. A `requestAnimationFrame` callback flushes
the latest value to the worklet. Kit-level params
(`setToasterKitParam`) write synchronously to the worklet on every call (no
rAF coalesce).

**Device caching.** `getFirstToasterDeviceId.ts:11-14` caches the result of
`tracks.find(...)` against the identity of `getAllTracks()`. The cache
returns the first toaster device ever seen on a given snapshot, regardless
of which `deviceId` was requested.

**WASM bridge.** `loadToasterKit.ts` and `toasterSubscriber.ts` ship every
kit param into the WASM engine via duplicated 35-line set-param sequences.
The two implementations do not call a shared helper.

**Tests.** Most files have at least one spec. Sequencer playback tests
(via `sequencerPlayback.spec.ts`) and the param-bridge specs exist; UI
specs are present for `PadGrid`, `PadMixer`, `StepSequencer`, and
`ToasterPanel`.

---

## Findings

1. **Per-device isolation is partial.** `noteRepeat.activeSession` and
   `sixteenLevels.activeSession` are global module bindings. Two open
   Toaster panels (or a future multi-instrument workflow) cannot use these
   features independently — one will silently steal the other's session.
   Conversely, `sequencerPlayback` correctly keys by `deviceId` and
   `setToasterPadParam` correctly keys cache entries by deviceId, so the
   isolation story is inconsistent between modules of the same package.

2. **The sequencer publishes UI state on the audio-priority path.**
   `sequencerPlayback.tick` ends with
   `toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state,
   currentStep, isPlaying: true }})` (`:186`). Every step (~10 ms at 150 BPM
   16ths) triggers a full store snapshot and a React re-render of every
   subscriber. With 16 pads × 16 steps the ToasterPanel re-renders 4–6 times
   per beat. There is no throttling and no per-field selector. This is also
   the same store that owns the entire kit; an unrelated knob change re-runs
   the same diff.

3. **Race: store mutation under setTimeout chain has no read-after-write
   protection.** `sequencerPlayback.tick:99` reads `toasterStore.value`
   freshly each tick — but the `playCount` is held on the local
   `seqState`, not on the store. If `loadToasterKitPreset` or any other
   write to `toasterStore` arrives between `tick` reading and the next
   tick's read, the pattern reference can change underneath. The morphed
   pattern path (`pattern = morphPatterns(...)`) builds an entirely new
   object every step (`patternMorph.ts:24-74`); on the morph path, the
   sequencer also allocates fresh arrays per step.

4. **Race: `startSequencer` does not zero `nextTickTime` before running
   `tick()`.** `sequencerPlayback.startSequencer:206` sets
   `seqState.nextTickTime = getAudioTime()`. But if `stopSequencer` was
   never called in this device session and the previous `seqState.timeoutId`
   is still alive, the `running = true` flip lets the old timeout finish
   and call into the new `tick(deviceId, 0, …)` with stale `playCount`
   (zeroed) and a now-doubled tick rate. `stopSequencer` is called at the
   top of `startSequencer` to mitigate, but the cleanup happens on the
   same microtask — any in-flight `setTimeout(fire, totalDelayMs)` from
   the previous session **is not cleared**: those one-shot retrigger and
   microtiming timers leak past stop and fire late hits.

5. **Leak: retrigger/microtiming `setTimeout(fire, totalDelayMs)` calls
   are never tracked.** `sequencerPlayback.ts:169-181` schedules per-step
   side timers but stores none of the IDs. On `stopSequencer` they fire
   anyway. On hot-reload or device unmount, they outlive the panel's
   useEffect and call back into a possibly-disposed `triggerToasterPad`
   path. Also fires "ghost" hits after a stop until they expire (~300 ms
   at 16ths/120 BPM).

6. **Leak: rAF handles in `setToasterPadParam` are never cancelled on
   unmount.** `toasterParamBridge/setToasterPadParam.ts:46`
   `requestAnimationFrame(...)` IDs go into `padPending` keyed by
   `${deviceId}_${padIndex}_${key}`. They are cleared only on flush; if the
   ToasterPanel unmounts (or the device is removed via
   `unregisterToasterDevice`) while frames are pending, the rAF callback
   later tries `getTrackStrip(ref.trackId)` against a possibly-removed
   strip — `flushPadParam` no-ops on `!strip`, but
   `padLatest`/`padPending` entries persist forever. There is no
   counterpart `unregisterToasterDevice` cleanup that walks these maps.

7. **`getFirstToasterDeviceId` cache returns the wrong device.** The
   cache (`getFirstToasterDeviceId.ts:11-32`) is keyed only on
   `tracks` identity — it ignores the requested device entirely (the
   function takes no argument). It returns the first toaster device on
   the snapshot. Callers in `sequencerPlayback.tick:120`,
   `sixteenLevels.trigger16Level:42`, and the playback retrigger loop
   pass _no_ `deviceId` and just consume "the first toaster" — meaning a
   project with two Toaster instances will route all sound-lock /
   16-levels writes to whichever instance is first in track order. This
   is the same bug as #1 phrased structurally.

8. **`setToasterKitParam` does NOT coalesce, but `setToasterPadParam`
   does.** Pad params (`setToasterPadParam.ts:43-48`) defer to rAF; kit
   params (`setToasterKitParam.ts:38-43`) write directly. Dragging the
   master-gain knob will hit the worklet at full pointer-event rate
   (60–120 Hz). Inconsistent contract; on a Bluetooth/touchscreen device
   this is a worklet message storm.

9. **String-keyed cache is unbounded.** `setToasterPadParam.ts:8-9`
   `padPending`/`padLatest` are `Map`s keyed by `${deviceId}_${padIndex}_${key}`.
   Entries are deleted on flush, but if `findDeviceRef(deviceId)`
   ever returns null (`:36`), the function returns _before_ scheduling the
   rAF — but the `padLatest.set(...)` at `:42` already happened. The
   entry never flushes and never clears. Long sessions with intermittently
   missing track strips leak entries.

10. **`updatePad`/`updateKit`/`loadKit` in `toasterStore` use
    `defaultToasterState` as fallback for unknown deviceIds, then write
    that synthesized state back.** `toasterStore.ts:60-64,68-75,78-81,
    84-97`. Calling any of these for a `deviceId` that does not exist
    in `instances` _creates_ it with default content — a silent
    auto-registration. Combined with `unregisterToasterDevice`'s
    delete, this means a stale rAF flush after device removal that goes
    through `setToasterPadParam` → `updatePad` will resurrect the device
    record with default content (because `setToasterPadParam` calls
    `updatePad` _before_ checking if `findDeviceRef` returns null). See
    #9 — the rAF leak is one path; the resurrection is another.

11. **`toggleStep`/`setStepVelocity` lookup pattern is by
    `pattern.tracks.find(t => t.padIndex === padIndex)`.** Multiple
    tracks with the same `padIndex` are not handled — only the first wins.
    There is no validation in `createDefaultPattern` that
    `padIndex` is unique. This is a latent bug if pattern editing ever
    grows duplicate tracks.

12. **`patternMorph.lerpStep` makes step activation stochastic.**
    `patternMorph.ts:10` `active: Math.random() < ...`. A morph at
    `t = 0.5` re-rolls activation **every time the function is called**.
    Since `tick()` calls `morphPatterns` once per step (`:113`), the
    morphed pattern is _re-randomized_ at every step — different steps
    of the same beat sample different probabilities, giving an unstable,
    flickering pattern. This is not how morph is described in the
    docstring ("interpolate between two patterns") and is not how
    swarm/morph features in DAWs work (they re-roll _per pass_, not
    _per step_).

13. **Morph also burns the active-step contract.** Even with the
    early-returns at `clamped === 0/1`, when the morph is active mid-way
    `morphPatterns` returns a fresh `Pattern` with `id:
    'morph-${a.id}-${b.id}'`. That id is _used_ by the `tick()` consumer
    (`pattern.tracks` etc.), but no consumer of the store sees the morphed
    pattern — the UI's step grid still shows the source pattern. The
    user is being shown one pattern and hearing another.

14. **`tick()` calls `setPadEngineImmediate` per step and resets it on
    sound-lock fire.** `sequencerPlayback.ts:138` sets the engine to the
    locked engine, schedules `fire()` at `totalDelayMs` (potentially
    swing+microtiming up to ~50 ms in the future), and inside `fire`
    immediately resets to the default engine after `triggerToasterPad`.
    But the engine swap is "immediate" (bypasses rAF) while the trigger
    is in the future — there is a window where the engine is locked,
    the trigger has not fired, and any _other_ pad on the same engine
    slot or a parallel `triggerToasterPad` for the same pad will hear
    the locked engine. Worse, when two soundlocked steps fire close in
    time the second `setPadEngineImmediate` overwrites the first lock
    before the first `fire()` runs — the first hit plays through the
    second hit's engine.

15. **`triggerToasterPad` does no readiness check.** `triggerPad.ts:12`
    `if (dn?.toasterControls)` — but `loadToasterKit` and
    `toasterSubscriber` both check `data.toasterControls?.ready !==
    undefined` (`loadToasterKit.ts:66`, `toasterSubscriber.ts:43-45`).
    Calling `noteOn` on a non-ready WASM may crash or no-op silently,
    depending on the worklet implementation. Inconsistent readiness
    checks across the module.

16. **`getToasterControls()` finds _any_ toaster strip** —
    `loadToasterKit.ts:51-68` walks all tracks, finds the first track
    that has _any_ device of `type === 'toaster'`, returns its first
    ready toasterControls. Two Toaster instances → both get hydrated
    from the first strip's controls. This is the same multi-instance
    failure mode as #1 and #7.

17. **`createDrumTrackStack` constructs a deviceId with `crypto.randomUUID().slice(0, 8)`.**
    `createDrumTrackStack.ts:31`. Eight hex chars is a 32-bit space
    (~4.3 billion). Birthday collision becomes non-trivial after ~65,000
    devices in a project — well above realistic — but the slice is
    pure cosmetic. Nothing in the audit hinges on it; flagged so that
    nobody _adds_ a "deviceId is unique forever" assumption to a
    callsite.

18. **`createDrumTrackStack` never deletes children on undo.** It dispatches
    `setTrackStoreState(...)` and `addDeviceToStrip(...)` but emits one
    `track.added` event for the parent — the 16 children are added
    through the same `setTrackStoreState` write. There is no bridge
    event that downstream subscribers (e.g. CRDT, undo, persistence)
    can use to know the children belong to the kit. If the user
    deletes the parent track, the 16 child tracks may be orphaned.
    Cross-reference: `Arrangement` audit.

19. **`exportPatternToTimeline` indexes child tracks by position in
    the filtered list.** `exportPatternToTimeline.ts:31`:
    `childTracks[track.padIndex]` — but `childTracks` is filtered by
    `track.parentId === parent.id` and the order is whatever
    `getAllTracks()` returns. If the user reorders the tracks under
    the toaster parent, `padIndex` 0 may not be the kick anymore. The
    function silently writes notes to the wrong child track.

20. **`exportPatternToTimeline` ignores microtiming, retriggers,
    swing, and sound locks.** Step `velocity` and `active` are the only
    fields read (`:60-68`). For a feature called "export pattern to
    timeline," the resulting MIDI does not represent what the
    sequencer plays. No comment, no UX warning. This is an exporter
    that drops every interesting feature of the sequencer.

21. **`exportPatternToTimeline` `clipLength = pattern.bars * 4`
    assumes 4 beats per bar.** No reference to project time signature
    (the Toaster pattern records `stepsPerBar` but not the meter). At
    3/4 the clip will be one bar over.

22. **`euclidean()` `Bjorklund` loop is O(n²) and may not converge for
    pathological inputs.** `euclidean.ts:27-60`: the
    `groups.findIndex(...)` scan compares full group arrays per
    iteration; the loop terminates only via the `splitPos <= 0 ||
    splitPos >= groups.length` guard. For exotic inputs (`euclidean(0,
    n)`, `euclidean(n, n)`) the early-return paths cover them, but
    nothing prevents an iteration cap. Adding a max-iteration safety net
    plus tests against known patterns (e.g. `euclidean(3, 8)` should
    produce `[T,F,F,T,F,F,T,F]`) would harden it.

23. **`applyEuclideanToTrack` overwrites velocity and other step
    fields from the existing steps with `...step`** (`applyEuclidean.ts:32`)
    but the `active` flag is the only field changed. If the user has
    already set per-step probability/microtiming and reapplies a
    Euclidean rhythm at a different `hits` count, the now-active steps
    keep _whatever_ probability/microtiming was previously on those
    indices — which were probably from the previous (different)
    rhythm. The function should reset those fields when activating a
    step (or document the policy).

24. **`getToasterPresets` re-exports the static array via a
    function returning the same reference.** `toasterQueries.ts:22-24`.
    Mutating the returned array would mutate `_TOASTER_PRESETS`.
    Either freeze (`as const` / `Object.freeze`) or return a shallow
    copy.

25. **`useCases/index.ts` re-exports `DEFAULT_PAD_NAMES` from
    `toasterQueries.ts`, which itself shadows the model's
    `DEFAULT_PAD_NAMES`.** `toasterQueries.ts:3-20` defines a local
    `DEFAULT_PAD_NAMES` constant that duplicates the one in
    `models/ToasterKit.ts:133-150`. They differ in `as const`-ness:
    queries' is `as const`, models' is not. They must be kept in sync
    by hand.

26. **`useCases/index.ts` re-exports `TOASTER_PRESETS`** — but
    `repositories/toasterPresets.ts` exports `type ToasterKitPreset`,
    used by `getToasterPresets`. The `ToasterKitPreset` type leaks via
    the function's return type. AGENTS.md "Use-case types stay private"
    says don't `export type` from `useCases/`; the type leaks via
    `ReturnType<typeof getToasterPresets>` instead, which is allowed.
    OK structurally — but `TOASTER_PRESETS` is itself a re-export
    of a `repositories/` value; convention says `useCases/` orchestrates
    `repositories/`, not re-exports them as constants.

27. **`createDrumTrackStack` mutates returned objects (`parent.collapsed
    = false; parent.devices = [...]; child.devices = []; child.outputId
    = ...`).** `createDrumTrackStack.ts:30-52`. The `createTrack` helper
    returns a fresh object that is then mutated post-creation. If
    `createTrack` ever returns a frozen or shared reference, this breaks
    silently. Spreading into `setTrackStoreState({ tracks: [...,
    parent, ...children] })` then commits the mutated objects. Cleaner
    to pass the desired fields to `createTrack`.

28. **Subscriber duplicates the WASM-hydration code in
    `loadToasterKitPreset`.** `loadToasterKit.ts:76-120` and
    `toasterSubscriber.ts:50-82` ship the same kit-level + per-pad
    parameter list to the worklet. Two copies of "the params we send"
    have to drift in lockstep when a new param is added. There is no
    single helper.

29. **`sequencerPlayback` stores nothing in `playCount` after `stop()`
    that would let "Resume" continue from where the user paused.**
    `stopSequencer:221` zeros `playCount` and `currentStep`. If a "pause
    + resume" feature is desired (and the UI button is currently
    "Stop"), the design choice is fine; if it ever changes, the
    architecture forces a state-rewrite.

30. **`ToasterPanel` couples deeply across modules.** `ToasterPanel.tsx`
    imports from:
    - `#/modules/Arrangement/stores` (`trackStore`, `defaultTrackState`)
    - `#/modules/Arrangement/useCases` (`getAllTracks`)
    - `#/modules/Transport/stores` (`transportStore`)
      AGENTS.md says cross-module imports must target `#/modules/<X>`
      (the root barrel), not deep `stores/` paths. `Arrangement/stores`
      is presumably an exposed sub-barrel; `Transport/stores` is too.
      Verify these are sanctioned exports — if not, this is a contract
      violation.

31. **`ToasterPanel` reads `transportStore.value` directly in an event
    handler** (`:371`) without subscribing. If transport tempo changes
    during playback, the sequencer's BPM is fixed at start (passed by
    value to `startSequencer`). The user changes tempo from 120 to 140,
    but the sequencer keeps stepping at 120 until they stop and start
    again. Transport coupling gap.

32. **`ToasterPanel` derives `selectedPad` with a non-null assertion
    fallback chain** — `kit.pads[selectedPadIndex] ?? kit.pads[0]!`
    (`:130`). If `kit.pads` is empty (`createDefaultKit` always returns
    16, but a corrupt persisted kit might not) this throws. AGENTS.md
    soundness says "no `!` to silence the compiler"; here it silences
    a real runtime case.

33. **`PadGrid` flash effect timer cleanup is half-correct.**
    `PadGrid.tsx:36-42` cleans up flash timers on unmount but not when
    the `pads` array changes such that an existing pad's `id` is no
    longer in the list. Flash timers may set state on an unmounted
    component if `setFlashingPads` is called before the timer is
    cleared by an unmount that hasn't run yet.

34. **`PadMixer` registers `pointermove`/`pointerup` on `document` but
    does not capture or stopPropagation.** `PadMixer.tsx:22-36`. If the
    user drags a fader and the mouse leaves the window mid-drag, the
    `pointerup` handler may not fire (depending on browser); the
    listener stays attached until the next pointerup elsewhere.
    Standard fix: also listen to `pointercancel` and `blur`. Also,
    `setVol` is computed against the rect captured at pointerdown; if
    the panel resizes mid-drag the math is stale.

35. **`PadMixer` mute/solo buttons have no aria-pressed and no
    `aria-label`.** Just an "M" / "S" letter (`PadMixer.tsx:79-90`).
    Screen readers announce only "M button". Same for the volume
    fader (`<div>` with `cursor-ns-resize` and `onPointerDown` —
    not a focusable element, no `role="slider"`, no
    `aria-valuenow`/`aria-valuemin`/`aria-valuemax`). Keyboard users
    cannot adjust volume at all.

36. **`PadGrid` pads are `<button>`s — but they fire on `onMouseDown`
    rather than `onClick`** (`PadGrid.tsx:67-72`). `onClick` would fire
    on `Enter`/`Space` keypress; `onMouseDown` does not. Keyboard users
    can navigate to a pad and press Enter, which calls `onSelectPad`
    only — they cannot trigger the pad. The UI is partially keyboard-
    navigable but functionally crippled for AT.

37. **`StepSequencer` step grid uses `<div>` cells with
    `onPointerDown`** (`StepSequencer.tsx:88-99`). No `role`, no
    keyboard handlers, no focus management. A 256-cell grid cannot be
    used by keyboard or screen-reader users at all. Per the goal of
    AGENTS.md that the entire app stays accessible, this is a
    significant gap.

38. **`StepSequencer` velocity drag uses `setPointerCapture` and
    Alt-modifier — but the modifier hint is invisible.** `:32`. New
    users have no way to discover that Alt-drag changes velocity; no
    tooltip, no UI hint, no documentation in the panel.

39. **Step-current rendering uses ternary not `&&`** — OK, but the
    wider `ToasterPanel` passes `activePattern ? <StepSequencer /> :
    null` (`ToasterPanel.tsx:343`) which is fine. Spot-check passes.

40. **`useCases/index.ts` exports only three names.** Most use cases
    (`triggerToasterPad`, `applyEuclideanToTrack`,
    `exportPatternToTimeline`, `loadToasterKitPreset`,
    `startSequencer`/`stopSequencer`, `setToasterPadParam`,
    `setToasterKitParam`, `setMorphPosition` etc.) are imported by
    `presentations/views/ToasterPanel.tsx` via deep relative paths
    (`../../useCases/...`). That is correct per AGENTS.md (intra-module
    code uses relative imports, not the barrel) — but it means any
    _other_ module that wants to dispatch a Toaster operation
    (`Command`, `AiRuntime`) cannot, because the barrel does not
    re-export them. There is also no `handlers/` directory — the
    Toaster module dispatches no `AppAction`. If any cross-module
    consumer wants Toaster behaviour, they must import from a deep
    path (forbidden) or a handler must be added.

41. **`events/index.ts` is empty (`// no public events`).** Adding a
    track via `createDrumTrackStack` emits `track.added` but the parent
    track receiving the device is the only emission. There is no
    `toaster.kit.loaded` / `toaster.pad.triggered` / `toaster.pattern.
    exported` event for collaboration / persistence to subscribe to.
    This may be intentional, but cross-module consumers (CRDT, AI) have
    no signal of activity.

42. **No root `index.ts` at `src/modules/Toaster/`.** The file listing
    shows `events/`, `models/`, `presentations/`, `repositories/`,
    `stores/`, `useCases/` — no top-level `index.ts`. Other modules
    (e.g. `AudioAnalysis`) have one. If consumers do
    `import { … } from '#/modules/Toaster'`, the import resolves
    only via tsconfig paths or a barrel. Verify whether one exists at
    a different layer or whether cross-module consumers reach internals
    directly.

43. **`toasterStore.ts` mutator API is inconsistent — most fns take
    `(deviceId, …)`, but there's no `unregisterToasterDevice` for
    sequencer state.** Calling `unregisterToasterDevice(deviceId)`
    deletes the store entry but does NOT call `stopSequencer(deviceId)`.
    The sequencer keeps ticking against a deviceId whose store entry
    is gone. `tick()` checks `state` and returns if missing
    (`:99-102`), so the loop becomes a 10ms "no-op self-reschedule"
    that never naturally terminates — until a future `startSequencer`
    or process exit. Resource leak.

44. **`setToasterKitParam`/`setToasterPadParam` cast `value as
    number` but the `KIT_PARAM_MAP` accepts `ToasterKit[Key]`** —
    `setToasterKitParam.ts:42`: `value as number`. The `Key extends
    keyof typeof KIT_PARAM_MAP` constraint includes only numeric kit
    fields (`swing`, `masterGain`, …) so the cast is benign — but
    it is still a type assertion to silence the compiler. AGENTS.md
    forbids `as` to silence types when the type can be made to fit
    (`value: number` directly, restrict the map's value type).

45. **Tests do not cover the leak/race issues.**
    - `sequencerPlayback.spec.ts` does not assert that pending
      retrigger timers are cleaned up by `stopSequencer`.
    - `noteRepeat.spec.ts` does not test concurrent sessions.
    - `setToasterPadParam.spec.ts` does not test rAF cleanup on
      unmount or the "device removed but rAF still pending" path.
    - `createDrumTrackStack.spec.ts` does not test that orphaning
      happens on parent-track delete.
      Cross-reference issues #4, #5, #6, #10, #43.

46. **`Pattern.activePatternId` is keyed on string id but
    `createDefaultPattern` always uses `'A1'`.** `ToasterKit.ts:209`.
    There is no API to switch patterns (no `setActivePatternId`
    use case; only `morph` machinery). The model carries multi-pattern
    capability that the use cases don't expose. Either exercise it or
    drop the array.

47. **`triggerToasterPad` accepts a `velocity` default of `100`** but
    `triggerPad.spec.ts` and the rest of the module use 0–127 MIDI
    velocity convention (`step.velocity * 127`, etc.). `100` is mid-
    velocity; the default semantics are fine. Just inconsistent with
    `vel = Math.round(step.velocity * 127)` which produces values up
    to 127. No bug, flagged for naming clarity (a `MIDI_VELOCITY_MAX
    = 127` constant would self-document).

48. **`sixteenLevels.trigger16Level` writes the parameter every time
    via the rAF-coalesced `setToasterPadParam`** (`:52, :58, :67`)
    then immediately calls `triggerToasterPad` — but the param flush
    is rAF-deferred while the trigger is synchronous. The first hit
    in 16-levels mode plays with the previous parameter value; only
    subsequent hits use the new one. Worse, if the user fires multiple
    grid cells in one rAF, only the latest param value reaches the
    worklet — the in-between hits are wrong on _both_ axes.

49. **`setPadEngineImmediate` skips the store update.** The doc
    comment notes this explicitly. But the store still holds the
    pad's `engineType` and the UI shows that (`PadGrid` rendering
    uses `pad.engineType`). After a sound-lock fires, the worklet's
    engine has been swapped and back-swapped; the displayed engine
    name may flicker if any UI subscribes to a worklet readback.
    This _doesn't_ flicker today only because nothing reads back —
    but it cements a UI-vs-engine divergence that a future "show
    real engine" feature can't bridge.

50. **`noteRepeat.startNoteRepeat` always triggers immediately, then
    schedules the next at `+intervalSec`.** OK. But the
    `nextTriggerTime` recursion (`:58`) increments by `intervalSec`
    even if `getAudioTime()` has drifted — the catch-up clamp
    `Math.max(1, …)` (`:60`) means after a long stall (browser tab
    suspended), the function "fires once" and re-arms at +1 ms,
    burning CPU until it catches up. A clamp on _maximum_ delay
    should bound this; a `if (now - nextTriggerTime > intervalSec * 4)
    nextTriggerTime = now` would fix it.

51. **`patternMorph` morph id is string-concatenated and not pinned
    to a stable patten lookup.** `patternMorph.ts:68`: `id:
    'morph-${a.id}-${b.id}'`. If the user names a real pattern
    `'morph-A1-A2'`, `state.kit.patterns.find(...)` could collide.
    Unlikely, but no validation prevents it.

52. **`useCases/index.ts` does not export the param bridge, morph
    setters, or sound-lock helpers**, yet `ToasterPanel.tsx` imports
    them via deep relative paths. AGENTS.md "Index exports — external
    consumers only": OK so long as no _other_ module needs them —
    but if a future Command handler dispatches `setMorphPosition`
    (likely use case) it has to either import deep (forbidden) or
    grow the barrel. The current barrel design deliberately
    suppresses the surface area that Command would need.

---

## Priorities

1. **Sequencer leaks and per-step UI state writes** (issues #2, #4, #5,
   #43) — every active sequencer leaks retrigger timers on stop, never
   stops cleanly across `unregisterToasterDevice`, and re-renders the
   whole panel 4–6× per beat. Highest user-visible impact.
2. **Multi-instance correctness** (issues #1, #7, #16) —
   `noteRepeat` + `sixteenLevels` + `getFirstToasterDeviceId` + the
   "find any toaster" bridge mean two Toaster instances cannot coexist.
   This is a structural ceiling.
3. **Morph randomness re-rolls per step** (issue #12) — the documented
   "interpolate between two patterns" behaviour does not match the
   stochastic re-roll-per-tick implementation. Audible chaos.
4. **Sound-lock race with future `fire()`** (issue #14) — overlapping
   sound-locked steps cross-talk; engine swap is immediate, trigger is
   deferred.
5. **rAF + store-resurrection leak in param bridge** (issues #6, #9,
   #10) — long sessions accumulate stale entries; `unregisterToasterDevice`
   doesn't clean them.
6. **Accessibility gaps** (issues #35, #36, #37) — `PadMixer` faders
   are not `role="slider"`, pads don't fire on Enter/Space, the step
   grid is unusable by keyboard or AT.
7. **`exportPatternToTimeline` writes wrong data** (issues #19, #20,
   #21) — child indexing by filtered position, drops microtiming /
   retriggers / swing / sound-locks, ignores time signature.
8. **WASM-bridge param-list duplication** (issue #28) and missing
   shared helper.

---

## Open issues

### 1. Per-device session isolation is partial

**Problem:** `noteRepeat.activeSession` and
`sixteenLevels.activeSession` are module-level globals. Two open
Toaster panels share a single session — one will silently steal the
other's state. `getFirstToasterDeviceId()` ignores any deviceId
argument and returns the first toaster device ever seen. Multi-instance
correctness is structurally absent.

**Representative files:**

- `src/modules/Toaster/useCases/noteRepeat.ts:20`
- `src/modules/Toaster/useCases/sixteenLevels.ts:16`
- `src/modules/Toaster/useCases/toasterParamBridge/getFirstToasterDeviceId.ts:11-32`
- `src/modules/Toaster/useCases/loadToasterKit.ts:51-68` (`getToasterControls` returns first ready)

**Needed:** Key `noteRepeat` and `sixteenLevels` sessions by
`deviceId` in a `Map<string, Session>` (mirror the
`sequencerPlayback` pattern). Make `getFirstToasterDeviceId` either
take a deviceId and return whether _that_ device exists, or rename to
`getDeviceTrackId(deviceId)` and have it scope properly. Audit all
callers that assume "the first toaster" semantics.

### 2. Sequencer publishes UI state every tick

**Problem:** `sequencerPlayback.tick:186` writes the entire
toaster store on every step. With a typical 16-step pattern at 120 BPM
that is ~8 store writes per beat × N pads × full-panel React render.
The morph path additionally allocates fresh `Pattern`, `Track[]`,
`Step[]` per call.

**Representative files:**

- `src/modules/Toaster/useCases/sequencerPlayback.ts:99-116,186`
- `src/modules/Toaster/useCases/patternMorph.ts:24-74`

**Needed:** Move `currentStep` to a separate, narrowly-scoped store
(`toasterPlayheadStore` keyed by deviceId) so that
the StepSequencer can subscribe to it without re-rendering the kit
section. Keep `isPlaying` on the main store (it changes infrequently).
Skip the per-step `morphPatterns` allocation: precompute the morphed
pattern once on `setMorphPosition` and cache.

### 3. Sequencer leaks retrigger / swing setTimeouts past stop

**Problem:** `tick()` schedules at most one tracked timeout
(`seqState.timeoutId` for the next step) but additionally fires
`setTimeout(fire, totalDelayMs)` for each step's microtiming offset
and `setTimeout(... retrigVel ...)` for each retrigger. None of these
are tracked. `stopSequencer` clears only the next-tick timeout.
On stop, in-flight one-shots fire late hits ("ghost" notes) up to ~50
ms (microtiming) or ~300 ms (16th retriggers) after the user pressed
Stop.

**Representative files:**

- `src/modules/Toaster/useCases/sequencerPlayback.ts:160-183,210-222`

**Needed:** Track all scheduled IDs in
`seqState.pendingTimeouts: Set<ReturnType<typeof setTimeout>>` (or
similar). On `stopSequencer`, iterate-clear-and-clear-the-set. Add a
test that asserts no `triggerToasterPad` calls happen after `stop()`
returns.

### 4. `sequencerPlayback` does not clean up across `unregisterToasterDevice`

**Problem:** `unregisterToasterDevice(deviceId)` deletes the store
entry but does not call `stopSequencer(deviceId)`. The sequencer
state map keeps the entry, the next-tick timeout fires, `tick()` reads
`toasterStore.value?.[deviceId]` (undefined), returns — but the
chain never naturally terminates because `tick` only re-arms via
`seqState.running` (still `true`) and the next-tick callback never
runs again because `tick` returns _before_ scheduling.

Wait — re-reading: `tick` checks `if (!state) return;` (`:101`), which
short-circuits before the re-schedule. So the chain _does_ die. But
`seqState` lingers in the `sequencerStates` Map forever, with
`running: true` and a stale closed-over deviceId. Memory leak.

**Representative files:**

- `src/modules/Toaster/stores/toasterStore.ts:49-56`
- `src/modules/Toaster/useCases/sequencerPlayback.ts:31-46,93-102,210-222`

**Needed:** `unregisterToasterDevice` calls `stopSequencer(deviceId)`
and `stopNoteRepeat()`/`exit16Levels()` if the session matches. Or
expose a `disposeToasterDevice(deviceId)` orchestrator that runs all
three. Drop the stale `sequencerStates` entry.

### 5. rAF param-bridge leaks pending entries on missing track strip

**Problem:** `setToasterPadParam` writes `padLatest.set(cacheKey, …)`
_before_ checking `findDeviceRef(deviceId)`. If the device was
removed mid-flight, the function returns at `:38`, leaving a stale
`padLatest` entry that never flushes. Repeated calls with a missing
device ref accumulate forever. Worse, `setToasterPadParam` calls
`updatePad` (at `:33`) which uses `defaultToasterState` as fallback —
a deviceId that was deleted gets _resurrected_ in the store with
default content.

**Representative files:**

- `src/modules/Toaster/useCases/toasterParamBridge/setToasterPadParam.ts:31-49`
- `src/modules/Toaster/stores/toasterStore.ts:60-75`

**Needed:** Reorder: check `findDeviceRef` first; only then
`updatePad`/`padLatest.set`. In `unregisterToasterDevice`, walk the
`padPending`/`padLatest` maps and `cancelAnimationFrame` + delete
entries with a matching `deviceId` prefix.
`updatePad`/`updateKit`/`loadKit` should refuse to auto-create entries
for unknown deviceIds (return early instead of writing default state).

### 6. Pattern morph re-rolls activation every tick

**Problem:** `patternMorph.lerpStep` returns
`active: Math.random() < (a.active ? 1 - t : 0) + (b.active ? t : 0)`.
Called once per step from `tick()`, this means each step of the
morphed pattern samples its own random — at `t = 0.5`, the pattern
flickers between A and B at every step, giving an unstable feel.
The intent (per the docstring "interpolate between two patterns") is
clearly to compute the morphed pattern _once_ per pass.

**Representative files:**

- `src/modules/Toaster/useCases/patternMorph.ts:8-18,24-74`
- `src/modules/Toaster/useCases/sequencerPlayback.ts:108-115`

**Needed:** Compute the morphed pattern once on `setMorphPosition`
or once per loop pass; cache on the seq state. Better: make morph
deterministic — at `t < 0.5`, take A; at `t >= 0.5`, take B; or use a
seeded RNG keyed on (step index, pass count) so the same morph at the
same playhead always produces the same pattern.

### 7. UI shows source pattern; sequencer plays morphed

**Problem:** `tick()` builds a morphed pattern internally
(`:108-115`) and triggers from it, but the UI subscribes to
`state.kit.patterns` and renders the source `activePattern`. The user
sees one grid and hears another.

**Representative files:**

- `src/modules/Toaster/useCases/sequencerPlayback.ts:108-115`
- `src/modules/Toaster/presentations/views/ToasterPanel.tsx:131,343-354`

**Needed:** Either render the morphed pattern in the UI (compute it
at the panel level using the same `morphPatterns` helper) or make
the morph a "preview" that is committed to a real pattern on
`setMorphPosition` confirm. The current divergence is misleading.

### 8. Sound-lock engine swap races overlapping fires

**Problem:** `tick()` calls `setPadEngineImmediate(...)` synchronously
at the start of the step (`:138`) and schedules the actual trigger at
`+totalDelayMs` via `setTimeout(fire, …)` (`:169`). When two
sound-locked steps fire close in time on the same pad (e.g. via
microtiming or retrigger), the second's engine swap overwrites the
first lock _before_ the first `fire()` runs — the first hit plays
through the second hit's engine. After all `fire()`s complete, only
the last `fire()` resets to default; intermediate steps observe the
"current" engine instead of their locked one.

**Representative files:**

- `src/modules/Toaster/useCases/sequencerPlayback.ts:135-167`

**Needed:** Pass the locked engine to `triggerToasterPad` (the
worklet should accept a per-trigger engine override) and skip the
swap+restore entirely. Or queue swaps with `(engineIdx, fireAt)`
pairs so the swap happens at-fire-time rather than at-schedule-time.

### 9. `setToasterKitParam` does not coalesce; `setToasterPadParam` does

**Problem:** Pad param writes go through a rAF coalesce; kit param
writes are direct. Dragging the master-gain knob (a kit param) hits
the worklet at full pointer-event rate. Inconsistent contract; on
high-DPI / high-sample-rate worklets this is a message-bus storm.

**Representative files:**

- `src/modules/Toaster/useCases/toasterParamBridge/setToasterKitParam.ts:38-43`
- `src/modules/Toaster/useCases/toasterParamBridge/setToasterPadParam.ts:43-48`

**Needed:** Apply the same rAF-coalesce pattern to
`setToasterKitParam`. Extract a shared
`coalesceParamWrite(cacheKey, write)` helper.

### 10. `getFirstToasterDeviceId` returns the wrong device

**Problem:** Function is parameterless and caches the first toaster
device on the snapshot. Three callers in `sequencerPlayback.tick`,
`sixteenLevels.trigger16Level`, and the playback retrigger loop pass
no deviceId — they consume "the first toaster". Two Toaster instances
→ all sound-lock and 16-levels writes go to instance #1.

**Representative files:**

- `src/modules/Toaster/useCases/toasterParamBridge/getFirstToasterDeviceId.ts:11-32`
- `src/modules/Toaster/useCases/sequencerPlayback.ts:120,138,148`
- `src/modules/Toaster/useCases/sixteenLevels.ts:42`

**Needed:** Pass `deviceId` explicitly through the sequencer / 16-levels
session rather than rediscovering "the first toaster". Either delete
`getFirstToasterDeviceId` or rename + scope it.

### 11. `sequencerPlayback` retrigger / swing timers leak past stop

**Problem:** Per-step `setTimeout(fire, …)` and retrigger
`setTimeout(... retrigVel ...)` IDs are not tracked. `stopSequencer`
clears only the next-tick timeout. Result: ghost hits after stop,
plus possible `triggerToasterPad` calls into a torn-down strip.

**Representative files:**

- `src/modules/Toaster/useCases/sequencerPlayback.ts:160-183,210-222`

**Needed:** As in issue #3, track all scheduled IDs and clear on
stop. Add a regression test.

### 12. `exportPatternToTimeline` indexes child tracks by position

**Problem:** `childTracks[track.padIndex]` (`exportPatternToTimeline.ts:31`).
If the user reorders the kit's child tracks (drag-and-drop
in the arrangement view), `padIndex 0` may not correspond to the
kick child track anymore. Notes go to the wrong tracks; no error.

**Representative files:**

- `src/modules/Toaster/useCases/exportPatternToTimeline.ts:24-35`

**Needed:** Map child tracks by an explicit `padIndex` field on the
track (set when `createDrumTrackStack` builds them) rather than by
their position in the filtered list. Or store the pad-track mapping
on the `Toaster` device's parameterValues / metadata.

### 13. `exportPatternToTimeline` drops every interesting feature

**Problem:** Reads only `step.active` and `step.velocity`. Ignores
`microTiming`, `retriggerCount`, `swing`, `paramLocks`, `soundLock`,
`probability`, and per-track `stepsOverride`. The feature is named
"export pattern to timeline" but the resulting MIDI does not
represent what the sequencer plays. Also assumes 4 beats per bar
regardless of project meter.

**Representative files:**

- `src/modules/Toaster/useCases/exportPatternToTimeline.ts:30-70`

**Needed:** Either (a) ship full fidelity — encode microtiming as
sub-beat note offsets, retriggers as additional notes, swing as
shifted positions, sound-locks as a bouncing-around the timeline
matter (or refuse to encode them and show a UX warning) — or (b)
narrow the feature name and clearly document the lossy export.
Read the project time signature from `Transport`/`Arrangement`
rather than hard-coding 4.

### 14. `PadMixer` volume fader is not a slider

**Problem:** A `<div>` with `cursor-ns-resize` and a pointer handler.
No `role="slider"`, no
`aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-valuetext`,
no keyboard arrow handlers, no focus ring. AT users cannot adjust
volume.

**Representative files:**

- `src/modules/Toaster/presentations/components/PadMixer.tsx:20-60`

**Needed:** Replace the `<div>` with a `<button role="slider">` (or
use the existing `RotaryKnob` / a real `<input type="range">`),
wire `onKeyDown` for arrow keys (`±0.05`), and expose
`aria-valuenow`/`min`/`max`/`text`.

### 15. `PadGrid` pads do not trigger on keyboard activation

**Problem:** Pads are `<button>`s, but the trigger handler is on
`onMouseDown` (`PadGrid.tsx:67`). Pressing Enter or Space focuses /
clicks the button, calling only `onSelectPad`. The pad never plays.

**Representative files:**

- `src/modules/Toaster/presentations/components/PadGrid.tsx:67-72`

**Needed:** Add an `onClick` (or `onKeyDown` for Enter/Space) that
calls `onTriggerPad` and `triggerFlash`. Or wire pointerdown via
PointerEvents and listen for `pointerType === 'mouse'`/`touch`/`pen`
explicitly while keeping keyboard activation wired through `onClick`.

### 16. `StepSequencer` step grid has no roles, no keyboard, no focus

**Problem:** 256 `<div>` cells with `onPointerDown`. No `role`, no
`tabIndex`, no `onKeyDown`. Keyboard / AT users cannot toggle steps
or set velocity.

**Representative files:**

- `src/modules/Toaster/presentations/components/StepSequencer.tsx:88-99`

**Needed:** Convert each cell to a `<button>` (or
`role="checkbox" aria-checked={step.active}`) with an aria-label
("Pad {pad.name} step {stepIndex + 1}, {step.active ? 'on' : 'off'},
velocity {Math.round(step.velocity * 100)}%"). Wire arrow-key nav
across the grid, Space to toggle, Shift-arrows for velocity.

### 17. Accessibility — controls have no labels

**Problem:** Mute/solo `M`/`S` buttons in PadMixer have no
`aria-label`/`aria-pressed`. The pan-knob `<div>` is non-interactive
to AT.

**Representative files:**

- `src/modules/Toaster/presentations/components/PadMixer.tsx:78-90`

**Needed:** `aria-label="Mute {pad.name}" aria-pressed={pad.muted}`
and same for solo. Pan needs to become a real interactive control
with role="slider".

### 18. WASM kit-hydration logic duplicated

**Problem:** `loadToasterKit.ts:76-120` and
`toasterSubscriber.ts:50-82` both ship the kit's parameters to the
worklet via the same long set-param sequence. Two copies will drift
when a new param is added.

**Representative files:**

- `src/modules/Toaster/useCases/loadToasterKit.ts:70-121`
- `src/modules/Toaster/useCases/toasterSubscriber.ts:17-87`

**Needed:** Extract a `hydrateToasterControls(controls, kit)` helper
in `services/` (this module has no `services/` yet — add it). Call
from both sites.

### 19. `morphPatterns` is non-deterministic and re-rolled per step

**Problem:** `lerpStep.active = Math.random() < …`. Called every step
from `tick()`. The morphed pattern is unstable.

**Representative files:**

- `src/modules/Toaster/useCases/patternMorph.ts:8-18`
- `src/modules/Toaster/useCases/sequencerPlayback.ts:108-115`

**Needed:** Compute the morphed pattern once per loop pass (or
once on `setMorphPosition`) and reuse. Replace the
random-active formula with a deterministic threshold. See #6 / #7.

### 20. Sound-lock engine swap races overlapping fires

**Problem:** Engine swap is synchronous; trigger is deferred. Two
overlapping sound-locked steps cross-talk on the engine slot.

**Representative files:**

- `src/modules/Toaster/useCases/sequencerPlayback.ts:135-167`

**Needed:** Make the worklet accept a per-trigger engine override
and pass the locked engine in `triggerToasterPad` rather than
swapping the pad's persistent engine slot. See #8.

### 21. `unregisterToasterDevice` does not stop sequencer / sessions

**Problem:** Removing a Toaster device leaves
`sequencerStates[deviceId]`, `noteRepeat.activeSession`, and
`sixteenLevels.activeSession` (if matching) in place.

**Representative files:**

- `src/modules/Toaster/stores/toasterStore.ts:49-56`
- `src/modules/Toaster/useCases/sequencerPlayback.ts:31-46`
- `src/modules/Toaster/useCases/noteRepeat.ts:20`
- `src/modules/Toaster/useCases/sixteenLevels.ts:16`

**Needed:** Add `disposeToasterDevice(deviceId)` orchestrator that
calls `stopSequencer`, optionally clears note-repeat / 16-levels
sessions, walks `padPending`/`padLatest` and cancels the rAF, then
calls `unregisterToasterDevice`. Wire the panel's
useEffect cleanup to it.

### 22. `setToasterPadParam` resurrects deleted devices

**Problem:** `setToasterPadParam` calls `updatePad(deviceId, …)`
before checking `findDeviceRef`. `updatePad` falls back to
`defaultToasterState` if the device entry is missing — silently
recreating it.

**Representative files:**

- `src/modules/Toaster/useCases/toasterParamBridge/setToasterPadParam.ts:31-39`
- `src/modules/Toaster/stores/toasterStore.ts:66-75`

**Needed:** `updatePad` / `updateKit` / `loadKit` return early if
`instances[deviceId]` is missing, instead of synthesizing from
default state. The caller can choose to seed via `selectPad` /
explicit register before mutating.

### 23. `getToasterPresets` returns a mutable reference

**Problem:** Callers can mutate the array; mutating shared module
state breaks any other consumer.

**Representative files:**

- `src/modules/Toaster/useCases/toasterQueries.ts:22-24`
- `src/modules/Toaster/repositories/toasterPresets.ts:25`

**Needed:** Either freeze on definition (`as const`/`Object.freeze`)
or return `[..._TOASTER_PRESETS]`.

### 24. Type assertion escape in `setToasterKitParam`

**Problem:** `value as number` (`:42`) silences a generic-narrowing
mismatch. AGENTS.md "TypeScript — soundness" forbids `as` to silence
the compiler when the type can be made to fit.

**Representative files:**

- `src/modules/Toaster/useCases/toasterParamBridge/setToasterKitParam.ts:21-44`

**Needed:** Constrain `KIT_PARAM_MAP`'s value type to `number` and
have the function take `value: number`. The mapping
key→numeric-keyof guarantees compatibility without an assertion.

### 25. `ToasterPanel` reads transport tempo only at start

**Problem:** `startSequencer(deviceId, transportStore.value?.tempo
?? 120)` — tempo is captured by value. Live tempo changes during
playback do not propagate.

**Representative files:**

- `src/modules/Toaster/presentations/views/ToasterPanel.tsx:371`
- `src/modules/Toaster/useCases/sequencerPlayback.ts:201-208`

**Needed:** Either read tempo inside `tick()` from
`transportStore.value` each step, or subscribe and re-arm the
schedule when tempo changes. The latter is correct DAW behaviour.

### 26. `ToasterPanel` reaches into `Arrangement/stores` and `Transport/stores`

**Problem:** `import { defaultTrackState, trackStore } from
'#/modules/Arrangement/stores'` and `import { transportStore } from
'#/modules/Transport/stores'`. AGENTS.md "Cross-module imports MUST
only target the destination module's root **`index.ts`**". Verify
those modules expose these via their root barrel; if not, this is a
contract violation.

**Representative files:**

- `src/modules/Toaster/presentations/views/ToasterPanel.tsx:11,13`

**Needed:** Either import via `#/modules/Arrangement` (root barrel)
and confirm those names are re-exported there, or accept the
internals as part of the public surface (and document in those
modules' barrels). If they are private, route Toaster's needs through
a public selector / hook the host module exposes.

### 27. Pads do not trigger on keyboard activation

(Restated as a separate issue from #15 to keep accessibility cleanly
scoped.) See issue #15.

### 28. `noteRepeat` `nextTriggerTime` does not bound long-stall catch-up

**Problem:** After a tab-suspend, `nextTriggerTime` lags wall clock
by minutes. The recursion fires once, computes
`Math.max(1, (nextTriggerTime - now) * 1000)` (negative → 1 ms),
re-arms at +1 ms, and burns CPU until it catches up.

**Representative files:**

- `src/modules/Toaster/useCases/noteRepeat.ts:55-63`

**Needed:** Clamp catch-up: `if (now - nextTriggerTime > intervalSec
* 4) nextTriggerTime = now + intervalSec`. Or use
`requestAnimationFrame`-based scheduling, which the browser
naturally pauses.

### 29. `applyEuclideanToTrack` keeps stale per-step fields

**Problem:** Reapplying a Euclidean rhythm at different `hits`
preserves `velocity`, `probability`, `microTiming`, etc. from the
old (different) rhythm — newly-active steps inherit irrelevant
values.

**Representative files:**

- `src/modules/Toaster/useCases/applyEuclidean.ts:32-35`

**Needed:** Decide a policy. Either reset all step fields when
activating a step (clean-slate), or document that the user is
preserving prior shaping.

### 30. `createDrumTrackStack` mutates returned `Track` objects in place

**Problem:** Mutates fields on the result of `createTrack()`. If
that helper ever returns frozen / shared references, this breaks
silently.

**Representative files:**

- `src/modules/Toaster/useCases/createDrumTrackStack.ts:30-52`

**Needed:** Pass desired fields via the `createTrack` input, or
call a typed `updateTrack` use case that returns a new object.
Don't post-mutate.

### 31. No root `index.ts` and no `handlers/`

**Problem:** No top-level barrel at `src/modules/Toaster/`. No
`handlers/` directory. Cross-module dispatch via `Command`/AppAction
is impossible — the only way another module can trigger Toaster
behaviour is through deep imports (forbidden) or a future
`getToasterHandlers()`.

**Representative files:**

- `src/modules/Toaster/` (missing `index.ts`)
- (no `src/modules/Toaster/handlers/`)

**Needed:** Add `index.ts` re-exporting only what _other_ modules
need (`createDrumTrackStack`, `initToasterSubscribers`,
`getToasterPresets`, view `ToasterPanel`, … ). If the pattern is
"all Toaster operations are user-driven from the panel and never
dispatched from elsewhere", document that. Otherwise add
`handlers/` and a `getToasterHandlers()` fn.

### 32. Tests do not cover races and leaks

**Problem:** Sequencer leak (issue #3, #11), unregister leak
(issue #4, #21), rAF leak (issue #5), morph stochasticity (issue #6),
keyboard accessibility (issue #15, #16), exporter (issue #12, #13)
— none of these have tests.

**Representative files:**

- `src/modules/Toaster/useCases/__tests__/sequencerPlayback.spec.ts`
- `src/modules/Toaster/useCases/__tests__/noteRepeat.spec.ts`
- `src/modules/Toaster/useCases/__tests__/setMorphPosition.spec.ts`
- `src/modules/Toaster/useCases/__tests__/patternMorph.spec.ts`
- `src/modules/Toaster/useCases/__tests__/exportPatternToTimeline.spec.ts`
- `src/modules/Toaster/useCases/toasterParamBridge/__tests__/setToasterPadParam.spec.ts`
- `src/modules/Toaster/presentations/components/__tests__/StepSequencer.spec.tsx`

**Needed:** A regression test per fix:
no `triggerToasterPad` fires after `stopSequencer`; rAF is
cancelled on `unregisterToasterDevice`; morph at fixed position
yields deterministic patterns; exporter encodes microtiming;
StepSequencer cell can be activated by keyboard.

---

## Open questions

- [ ] Is the Toaster intended to support multiple instances per
      project? If yes, issues #1, #7, #10, #16 are blockers; if no,
      explicitly limit creation to one and document.
- [ ] Are `Arrangement/stores` and `Transport/stores` re-exported
      from those modules' root `index.ts`? (Issue #26.) If yes, fine;
      if no, the panel violates the contract.
- [ ] What is the design intent for pattern morph — preview vs commit?
      (Issues #6, #7.) UX answer determines whether the morph is a
      live re-roll, a frozen interpolation, or a "commit to A or B"
      crossfade.
- [ ] Should `exportPatternToTimeline` be lossy or full-fidelity?
      (Issue #13.)
- [ ] Does the WASM worklet support per-trigger engine override?
      (Issue #8 / #20.) If not, this needs a Rust-side change.
- [ ] What is the planned cross-module API surface? (Issue #31.)
      If `Command` ever needs to dispatch toaster operations, the
      barrel and `handlers/` need to come into existence.

---

## Risks

- **Multi-instance correctness ceiling.** As long as `noteRepeat`,
  `sixteenLevels`, and `getFirstToasterDeviceId` are global, two
  Toaster instances will silently corrupt each other. A user with two
  drum kits in one project is in undefined-behaviour territory.
- **Audible artefacts on stop.** Untracked retrigger / microtiming
  setTimeouts (issue #3, #11) fire after the user clicks Stop. The
  user hears "ghost" hits up to ~300 ms past the stop button.
- **Memory leak on repeated kit creation/deletion.** Issue #4, #5,
  #21 mean that each create/delete cycle of a Toaster track stack
  leaves orphaned sequencer state, rAF closures, and resurrected
  store entries. Long sessions accumulate this; an enterprising user
  can OOM a tab.
- **Misleading playback.** Morph (issues #6, #7) shows pattern A in
  the UI while playing a randomised mash of A and B. Sound-lock
  (issue #8) cross-talks under retrigger / microtiming. Auto-fix and
  similar features that depend on "what the sequencer is doing right
  now" cannot trust the store.
- **Inaccessible UI.** The PadGrid is keyboard-navigable but does not
  trigger pads on key press; PadMixer faders are not sliders;
  StepSequencer cells are inert `<div>`s. The only path to use
  Toaster as a screen-reader user is roughly "no path".
- **Architectural drift.** Missing root barrel / handlers (issue #31),
  deep cross-module imports (#26), `as number` assertions (#24),
  and `value as number` are small but normalise the violations
  across the rest of the codebase if not pushed back on.
- **Lossy exporter.** Issue #12, #13: a feature that drops
  microtiming, retriggers, swing, sound-locks, and probability while
  named "export pattern to timeline" sets a misleading expectation
  for the user and any AI agent that exports MIDI for further
  processing.

---

## Suggested approaches

- **Land the cleanup orchestrator first** (issues #4, #5, #21, #22):
  one `disposeToasterDevice(deviceId)` use case wires
  `stopSequencer` / `stopNoteRepeat` / `exit16Levels` / rAF cancel /
  store delete. Side effect: lifts the sequencer-stop bug to
  surface for issue #3, #11.
- **Pull the playhead state out of the kit store** (issue #2): a
  separate `toasterPlayheadStore` keyed by deviceId. The step grid
  subscribes to that; the kit panel subscribes to the kit store.
  Re-render cost drops from "every step" to "knob-change frequency".
- **Make morph deterministic + cached** (issues #6, #7, #19): one
  derived pattern, recomputed on `setMorphPosition`, cached on the
  state. UI and sequencer read the same value.
- **Multi-instance fix** (issues #1, #7, #10, #16): scope every
  session by deviceId. Drop `getFirstToasterDeviceId` or rename
  + scope. `getToasterControls` takes a deviceId.
- **Accessibility pass** (issues #14, #15, #16, #17): proper
  `role="slider"` on faders, `<button>` cells in the step grid with
  arrow-key navigation, keyboard-trigger on pads.
- **Exporter rewrite** (issues #12, #13): map child tracks by an
  explicit `padIndex` field; encode microtiming as note offset, swing
  via the same offset, retriggers as additional notes (or refuse and
  warn).
- **WASM-bridge param-list helper** (issue #18) and a single
  rAF-coalesce primitive (#9) for both pad and kit params.
- **AGENTS.md sweep** (issues #24, #26, #31): root barrel + handlers
  + tighten cross-module imports + remove `as number`.

---

## Recommendation

Start with **issue #4 + #21 (cleanup orchestrator)** because it is
the smallest fix that unlocks regression tests for all the leak
classes (#3, #5, #11, #22). Land it as one PR with a regression spec
that asserts "no `triggerToasterPad` after `unregisterToasterDevice`"
and "no `padLatest` entries after device removal".

Next, **issue #2 + #6 + #7 (playhead store + deterministic morph)**.
This is one logical change — the playhead store carries the
"current step" and the "live morphed pattern", and the sequencer
writes to it instead of the kit store. UI re-renders drop dramatically
and the morph divergence between UI and sound disappears.

After that, the **multi-instance + accessibility passes** (issues
#1, #7, #10, #16 / #14, #15, #16, #17) are independent and can land
in either order.

---

## Resolved

_No issues resolved yet._
