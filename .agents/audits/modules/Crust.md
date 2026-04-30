# Crust module audit

## Scope

Adversarial review of `src/modules/Crust/` in full — every file under
`models/`, `stores/`, `useCases/`, and `presentations/`. Tests included.
Excludes the upstream callers (`Workspace/AppShell`, `Project/projectPersistence`)
except where they are directly imported from this module, and excludes
the audio-engine processor (`crust` worklet/Rust DSP) which lives in
`AudioEngine`.

It is an adversarial review: contracts, race conditions, type soundness,
DSP/UX hazards, AGENTS.md violations, and lazy tests.

Related spec: none on disk.

---

## Goal

Crust is the Sourdaw "loudness desk" plugin — a limiter / saturator with
streaming-target presets, multi-band routing, true-peak metering, LUFS,
and a 5-level UI. A correctness-first surface looks like:

- The module is a **DDD-compliant** unit: a single root `index.ts`
  exposes a curated cross-module surface; no external file deep-imports
  into `presentations/`, `stores/`, or `useCases/`.
- The patch model and the `CRUST_PARAMS` descriptor list agree: every
  serialised key has a matching descriptor entry (or a documented reason
  not to), and the bridge encoder enumerates every key the patch carries.
- Param mutations from the UI flow `setCrustParamWithAudio → state +
  rAF-batched audio engine update`. Patch loads flow `loadCrustPatchWithAudio
  → state + immediate audio engine pushes` for every key in the patch.
- Tests assert behaviour (real flush calls, real encoded values, real
  patch round-trips), not "is defined / is a function".
- Presentation: `CrustPanel` is the only view; child components are
  pure render with explicit prop types and aria semantics for meters,
  sliders, and curve canvases. No stale closures in rAF loops.
- AGENTS.md hard rules: no `any`, no `as never`, no `as unknown as`,
  no `useMemo`/`useCallback`/`React.memo`, no `forwardRef`,
  no namespace imports, no cross-module deep imports, no `&&` in JSX,
  one-function-per-file under `useCases/`, multi-arg functions take a
  single object param.

---

## Relevant code paths

- `src/modules/Crust/models/CrustPatch.ts`
- `src/modules/Crust/stores/crustStore.ts`
- `src/modules/Crust/stores/index.ts`
- `src/modules/Crust/useCases/crustPresets.ts`
- `src/modules/Crust/useCases/crustParamBridge/helpers.ts`
- `src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts`
- `src/modules/Crust/useCases/crustParamBridge/setCrustParamWithAudio.ts`
- `src/modules/Crust/useCases/__tests__/crustParamBridge.spec.ts`
- `src/modules/Crust/useCases/__tests__/crustPresets.spec.ts`
- `src/modules/Crust/useCases/crustParamBridge/__tests__/helpers.spec.ts`
- `src/modules/Crust/useCases/crustParamBridge/__tests__/loadCrustPatchWithAudio.spec.ts`
- `src/modules/Crust/useCases/crustParamBridge/__tests__/setCrustParamWithAudio.spec.ts`
- `src/modules/Crust/presentations/views/CrustPanel.tsx`
- `src/modules/Crust/presentations/views/index.ts`
- `src/modules/Crust/presentations/views/__tests__/CrustPanel.spec.tsx`
- `src/modules/Crust/presentations/components/CrustControlZone.tsx`
- `src/modules/Crust/presentations/components/CrustGainStrip.tsx`
- `src/modules/Crust/presentations/components/CrustMeteringStrip.tsx`
- `src/modules/Crust/presentations/components/CrustSatCurve.tsx`
- `src/modules/Crust/presentations/components/CrustWaveformDisplay.tsx`
- `src/modules/Crust/presentations/components/__tests__/*.spec.tsx`

External call sites (referenced for context only):

- `src/modules/Workspace/presentations/views/AppShell.tsx:22,547`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:4`

---

## Current behavior

**Module shape.** The directory contains four sub-folders (`models/`,
`stores/`, `useCases/`, `presentations/`). There is **no root
`index.ts`**: external callers reach in via
`#/modules/Crust/presentations/views` and `#/modules/Crust/stores`
directly. A `stores/index.ts` and a `presentations/views/index.ts` exist
as sub-barrels that those callers use. There are no `events/` and no
`handlers/` — the plugin is driven by direct function calls from
the panel, not via the AppAction command bus. There are no
`useCases/get<Module>Handlers.ts` either.

**Model.** `CrustPatch.ts:30-76` defines the patch with 30 fields across
five UI levels (PLAY/SHAPE/BUILD/ROUTE/LAB) plus three UI fields
(`uiLevel`, `scrollSpeed`, `streamingPreset`). `DEFAULT_CRUST_PATCH`
mirrors the type. A separate `CRUST_PARAMS` array
(`CrustPatch.ts:125-139`) describes 13 of those fields as numeric
descriptors for an audio-engine `DeviceParameter` registry — the other
17 patch fields (`name`, `style`, `algorithm`, `attackAuto`,
`releaseAuto`, `satEnabled`, `satAlgorithm`, `unityGain`, `multiBand`,
`crossover1`, `crossover2`, `scHpfEnabled`, `stereoMode`,
`outputBitDepth`, `abSlot`, `uiLevel`, `streamingPreset`) have no
descriptor entry.

**Store.** `crustStore.ts` holds `{ patch, ...meters }` in a single
`createStore<CrustState>`. Five mutators (`setCrustParam`, `setCrustUiLevel`,
`loadCrustPatch`, `updateCrustMeters`, `resetCrustMeters`) all begin with
`if (!state) return` (or `if (state)`); they silently no-op if the store
is null. `setCrustParam` is generic over `keyof CrustPatch`.

**Presets.** `crustPresets.ts` defines a `CRUST_PRESETS` array of eight
factory presets, each as `{ id, name, category, patch: {...DEFAULT, ...overrides} }`.
There is no user-preset mechanism, no I/O to `repositories/`, no preset
import/export.

**Param bridge.** `crustParamBridge/helpers.ts` builds a
`createFlushHandlers({ updateDeviceParam, persistDeviceParam })` factory
which returns `{ flushParam, pushParamImmediately }`. Both functions
forward to the same two side-effects: an `updateDeviceParam` call into
`AudioEngine` and a `persistDeviceParam` call into `Arrangement/stores`.
A module-level `paramBatcher = createRafBatcher<CrustBatchEntry>()`
coalesces drag-rate writes per `${deviceId}:${key}`.

The `encodeCrustValue(key, value)` function maps values to numbers:
`number → number`, `boolean → 0|1`, and seven enum keys to numeric
indices via separate `_INDEX` lookup tables (`STYLE_INDEX`,
`ALGORITHM_INDEX`, etc.). Strings that are not enums return `null`.

`setCrustParamWithAudio` calls `setCrustParam` (state), encodes, finds
the device ref, and schedules a batched flush. `loadCrustPatchWithAudio`
calls `loadCrustPatch` (state), then iterates 29 of the 30 patch keys
and pushes each one immediately (no batching) via
`pushCrustParamImmediately`. Two patch keys are skipped:
`outputBitDepth` (well, present at line 41) and `streamingPreset` —
actually checking `loadCrustPatchWithAudio.ts:14-44`, the keys list omits
`name`, `uiLevel`, and `streamingPreset` entirely. (`outputBitDepth` is
included at line 41.)

**Presentation.** `CrustPanel.tsx` (402 lines) renders the full plugin
faceplate: header (preset menu, streaming target menu, ceiling readout,
LED), main (left gain strip, centre waveform + control zone, right
metering strip), footer (ceiling input, true-peak chip, oversampling
chips, A=B/Delta/Reset chips). All UI mutations route through
`setCrustParamWithAudio` (via a `handleSetParam` closure) except the
`Reset TP` button which mutates `crustStore` directly and `setCrustUiLevel`
/`resetCrustMeters` which call store mutators directly.

`CrustControlZone.tsx` (575 lines) switches sub-panel content on
`patch.uiLevel`. Level 1 is three style tiles (TRANSPARENT / PUNCHY /
LOUD); Level 2 adds the 8-algorithm pills + Lookahead/Attack/Release
knobs + channel-link sliders; Level 3 adds the saturation card; Level 4
adds multi-band/stereo/sidechain HPF/dither; Level 5 adds a loudness
stats grid.

`CrustGainStrip.tsx` is a vertical pointer-capture slider (0–18 dB)
with Ctrl/Cmd fine mode and Arrow Up/Down keyboard support.

`CrustMeteringStrip.tsx` is a fixed-160px right-side panel with
output/GR meters, integrated LUFS, ST/MOM, LRA, TP-max with reset button.

`CrustSatCurve.tsx` is an 80×80 canvas drawing the saturation transfer
function via a `useEffect` keyed on `[algorithm, drive]`.

`CrustWaveformDisplay.tsx` is a scrolling rAF-driven canvas with four
ring buffers (`createCompactFloatBuffer({ length: 200 })`) for
input/output/GR/LUFS, a peak-label trail, and Delta-listen mode.

**Tests.** Eleven spec files. Five of them are "is defined" smoke
tests imported via `import * as subject` (forbidden namespace import
form). The remaining six render or call-behaviour-test the unit, but
shallow assertions dominate (e.g. `expect(buttons.length).toBeGreaterThanOrEqual(0)`).

---

## Findings

1. **No root `index.ts` for the Crust module.** External callers in
   `Workspace/AppShell` and `Project/projectPersistence` import directly
   from `#/modules/Crust/presentations/views` and `#/modules/Crust/stores`.
   AGENTS.md "Contract Boundaries: Cross-module imports MUST only target
   the destination module's root `index.ts`". The module has no public
   surface declaration. Every other plugin module in this repo
   (`Bacteria`, `Fermenter`, `Gluten`, `Grinder`, `Levain`, `Toaster`,
   `Crumbs`, `Proof`) follows the same broken pattern, but Crust is in
   scope here. The fix is mechanical: add `src/modules/Crust/index.ts`
   exporting the four cross-module symbols (`CrustPanel`, `crustStore`,
   `defaultCrustState`, plus `CRUST_PRESETS` if other modules need it),
   then migrate the two consumers to import from `#/modules/Crust`.

2. **`models/` is exposed across module internals via deep paths.**
   Internal files import the model with relative paths
   (`'../models/CrustPatch'`) — that part is correct. But the model
   `CrustPatch` type is also referenced externally _through the
   presentations layer_: `CrustPanel` takes the deviceId externally,
   but the `setCrustParamWithAudio<Key extends keyof CrustPatch>`
   generic and the `loadCrustPatchWithAudio(deviceId, patch: CrustPatch)`
   signature use a model type that is not in the public surface.
   Today no caller outside the module references `CrustPatch` because
   the presets are also internal — but the moment a caller wants to
   build a custom patch (a plausible feature), AGENTS.md "Model isolation:
   Models are strictly private … must never be exported" forces them
   to duplicate the type. There is no plan documented for that.

3. **`encodeCrustValue` and `loadCrustPatchWithAudio` disagree about the
   patch surface.** `loadCrustPatchWithAudio.ts:14-44` enumerates 29
   keys but skips `name`, `uiLevel`, and `streamingPreset`. Two of those
   skips are correct (UI-only fields), but `streamingPreset` is omitted
   silently — the field _does_ have an encoder branch (`SCROLL_SPEED_INDEX`?
   no — there is no `STREAMING_PRESET_INDEX`, so `encodeCrustValue('streamingPreset', 'spotify')`
   returns `null`). Loading a preset with `streamingPreset: 'spotify'`
   updates the store but does NOT push anything to the audio engine for
   that key — which is fine **only if** the audio engine doesn't care
   about it. There is no comment or test asserting that contract.
   Conversely, `encodeCrustValue` _does_ have a `scrollSpeed` branch
   (`SCROLL_SPEED_INDEX`) and `loadCrustPatchWithAudio` _does_ push
   `scrollSpeed` — but `scrollSpeed` is a UI-only field (it controls
   the waveform display tick rate, not audio). Pushing it to the audio
   engine via `updateDeviceParam` is dead traffic at best; at worst it
   pollutes the parameter automation surface.

4. **`encodeCrustValue` returns `null` silently for unknown string
   keys.** `helpers.ts:99-145`: a typo or future enum addition that
   slips past the switch lands as a silent no-op in
   `setCrustParamWithAudio` (the device update is skipped) and a silent
   no-op in `loadCrustPatchWithAudio` (the loop checks `!== null` and
   moves on). The store is still mutated — so the UI shows the new
   value but the audio engine never hears it. There is no `logger.warn`
   on the unknown-key path. With AGENTS.md "TypeScript — soundness", the
   `key: string` parameter is a stand-in for what should be a
   discriminated union over `keyof CrustPatch`.

5. **`encodeCrustValue` uses `as keyof typeof STYLE_INDEX` to escape
   string narrowing.** `helpers.ts:113,117,121,125,129,133,137,141`: each
   enum branch casts the runtime string with `as keyof typeof`. AGENTS.md
   "no `as` to silence the compiler instead of fixing the value or the
   type". The fix is to switch on a known set (`if (value in STYLE_INDEX)`)
   or to type the function signature as `<Key extends keyof CrustPatch>(key: Key, value: CrustPatch[Key])`
   and exhaustively narrow.

6. **Test mock uses `as never` to satisfy a type signature it doesn't
   match.** `crustParamBridge.spec.ts:19`:
   `actual.createFindDeviceRef(mockGetAllTracks as never)`. The mock
   returns `Array<{ id: string; devices: Array<{ id: string }> }>`
   instead of the production `Track[]`. AGENTS.md and user memory both
   forbid `as never`. The fix is to type the mock as a real (partial)
   `Track[]` factory.

7. **`setCrustParamWithAudio` schedules a flush even when the encoded
   value is null after the store has been updated.** Looking at it
   again: `setCrustParamWithAudio.ts:6-25` calls `setCrustParam(key, value)`
   _first_, then encodes, then early-returns if the encoded value is
   null. So a typo on a string-enum (e.g. `setCrustParamWithAudio(id,
   'algorithm', 'wrong-value' as CrustAlgorithm)` from a future call
   site) updates the store with the wrong string, returns silently, and
   the engine and store are now out of sync. Combined with #4, this is
   a silent-divergence path between UI and audio.

8. **`setCrustParam` and friends silently no-op when the store is null.**
   `crustStore.ts:45-78`: every mutator opens with `if (!state) return`
   (or `if (state) { … }`). The store is initialised at module load
   with `defaultCrustState`, so `state` is never actually null in
   practice — meaning the guard is dead defensive code that hides bugs
   if `crustStore.set(null as never)` ever happens. User memory
   explicitly forbids defensive branches and `as never` escapes for
   that reason. The store contract should be "non-nullable initial
   value, guaranteed", not "maybe nullable, silently swallowed".

9. **Two `analyzeMix`-style name collisions across UI levels.** Less
   severe than the AudioAnalysis case, but the patch carries _both_
   `style` (Level 1, three values: transparent/punchy/loud) and
   `algorithm` (Level 2, eight values: transparent/punchy/dynamic/...).
   They share the names `transparent` and `punchy`, but mean different
   things (Level 1 is a meta-preset; Level 2 is the engine algorithm
   choice). The patch keeps both fields independent — flipping Level 1
   does not write Level 2, and vice versa. The audio engine receives
   _both_ values via `updateDeviceParam`. With the UI never showing
   them simultaneously, the contract on the engine side is undocumented:
   does it use `style` when `uiLevel === 1` and `algorithm` otherwise?
   Both? Whichever was written last? `loadCrustPatchWithAudio` pushes
   both, so on patch load the engine sees both at once. There is no
   test for this.

10. **Direct store mutation outside the store module from `CrustPanel`.**
    `CrustPanel.tsx:326-331`: the TP-reset button reaches into
    `crustStore.value` directly and calls `crustStore.set({ ...current, truepeakMax: -100, truepeakExceeded: false })`.
    `crustStore.ts` already exports a `resetCrustMeters` mutator
    (line 74-79) that the panel uses for the footer Reset chip
    (`CrustPanel.tsx:395`), but the inline reset duplicates the logic.
    Worse, the store mutator pattern reset _all_ meters; the inline
    reset clears only TP. They are different operations but the
    interface to the store doesn't reflect that. Add a `resetCrustTruepeak()`
    mutator and have the panel call it.

11. **`CrustPanel` has nullable defaults that mask a missing-store bug.**
    `CrustPanel.tsx:72,76-85`: `useStore(crustStore, defaultCrustState)`
    returns `defaultCrustState` if the store is null. Then the body
    re-applies `state?.patch ?? defaultCrustState.patch`, `state?.grDb
    ?? 0`, etc. The optional-chain + `??` ladder is dead code — `state`
    is guaranteed non-null by the `useStore` second-arg fallback. The
    repeated `?? -100`, `?? -60`, `?? 0` defaults also disagree with
    the constants in `crustStore.ts:24-34` (e.g. the panel falls back
    to `inputDb: -60`, but the store's initial state uses `-100`). If
    the underlying store ever returns a partial state, the UI shows
    different numbers from the engine.

12. **`CrustPanel.spec.tsx` calls the panel without the required
    prop.** `CrustPanel.spec.tsx:16,21,26,31`: `<CrustPanel />` is
    rendered four times without the mandatory `deviceId: string` prop.
    TypeScript should be flagging this. Either the spec is being
    compiled with relaxed typing for tests, or `CrustPanel`'s signature
    has been weakened somewhere. The render won't crash because no
    `setParam` flows through `deviceId`, but it means the spec only
    exercises the empty-store branch. Adding `deviceId="test"` and
    verifying real state flow would catch real regressions.

13. **`CrustPanel.spec.tsx` is four near-identical "should render" assertions.**
    Lines 15-34: four `it(...)` blocks each do
    `render(<CrustPanel />); expect(document.body).toBeTruthy()`. The
    fourth at least runs `screen.queryAllByRole('button')`. None of
    them assert that an interaction (preset menu open, knob change,
    chip click) actually calls into `setCrustParamWithAudio` or
    `loadCrustPatchWithAudio`. AGENTS.md "Tests: Do not stop at 'defined' /
    'truthy'".

14. **Component-level specs are smoke tests with no behaviour.**
    `CrustGainStrip.spec.tsx`, `CrustControlZone.spec.tsx`,
    `CrustMeteringStrip.spec.tsx`, `CrustSatCurve.spec.tsx`,
    `CrustWaveformDisplay.spec.tsx` each render once and assert that
    "/gain/" or "/output/" is in the document or that a `<canvas>`
    element exists. There is zero coverage of:
    - Pointer-drag behaviour on `CrustGainStrip` (the entire feature).
    - Keyboard ArrowUp/ArrowDown clamping to 0–18.
    - The Ctrl/Cmd fine-mode 0.1× sensitivity multiplier.
    - The TP-reset button calling `onResetTp`.
    - Level transitions in `CrustControlZone` (L1 → L2 → … → L5).
    - The `CrustWaveformDisplay` rAF loop draining on unmount.

15. **`useCases/crustParamBridge/__tests__/{helpers,loadCrustPatchWithAudio,setCrustParamWithAudio}.spec.ts`
    are pure existence checks with namespace imports.** Three files,
    each `import * as subject from '../...'` (AGENTS.md: "Never use
    namespace imports") and only assert that the function is defined
    and that `typeof` is `function | object`. They cover nothing.
    They appear to be auto-generated stubs. Either delete them or
    replace with real behaviour tests.

16. **`crustParamBridge.spec.ts` swaps in a fake `paramBatcher` that
    flushes synchronously.** Lines 20-27: the spec replaces
    `paramBatcher` with `{ schedule: (key, value, flush) => flush(key, value) }`.
    This means the test exercises the immediate-flush code path, NOT
    the rAF-batched coalescing path that production uses. The
    rAF-batching contract — multiple writes within one frame collapse
    into one flush — is therefore unverified. Add a test that uses
    `vi.useFakeTimers()` or the real `paramBatcher` driven by `vi.advanceTimersByTime`.

17. **`paramBatcher` is module-singleton state shared across all
    `CrustPanel` instances.** `helpers.ts:15`: a single
    `createRafBatcher` instance keyed by `${deviceId}:${key}`. With
    multiple Crust devices in the same session, two panels writing to
    different deviceIds both flush against the same batcher. That is
    intentional (the keys are unique) — but the batcher also survives
    HMR if the module reload skips re-initialisation, leaking pending
    rAF callbacks. There is no `cancelAll()` call on hot-reload nor on
    the panel unmounting. (Compare to `Workspace`'s rAF management which
    explicitly cancels on cleanup.)

18. **Patch loads push 29 params with no batching, on the main thread.**
    `loadCrustPatchWithAudio.ts:46-51`: a `for...of` loop synchronously
    calls `pushCrustParamImmediately` 29 times. Each call dispatches
    `updateDeviceParam(...)` (postMessage to the audio worklet) and
    `persistDeviceParam(...)` (likely a state write). On preset load
    that's 58 cross-thread/state-write side-effects in a synchronous
    loop. For the audio worklet specifically, the contract typically
    expects coalesced writes; flooding 29 messages back-to-back is
    wasteful. A single `loadDevicePatch(deviceId, patchObj)` would be
    cleaner — but at minimum, sending them through the same rAF batcher
    would coalesce.

19. **`loadCrustPatchWithAudio` doesn't call `cancelAll` on the
    batcher first.** If a user is dragging a knob (a write is pending
    in the batcher) and then loads a preset, the pending write fires
    _after_ the preset loads — it overwrites the new patch value
    silently. A patch load should cancel any pending entries in the
    batcher for that deviceId.

20. **`CrustControlZone` has tight coupling to the Setter signature.**
    `CrustControlZone.tsx:25`: `type Setter = (key: keyof CrustPatch, value: number | boolean | string) => void`.
    The panel passes `handleSetParam` whose generic signature is
    `<TKey>(key: TKey, value: CrustPatch[TKey])`. The widening to
    `number | boolean | string` is a type-inference loss: a caller
    inside `CrustControlZone` could pass `setParam('algorithm', 7)`
    (number) without TypeScript complaining. Since the encoder later
    silently returns `null` for unknown values (#4), this becomes a
    silent runtime no-op. AGENTS.md "TypeScript — soundness". Make the
    Setter generic too.

21. **`CrustControlZone.Knob` `Auto` semantics are fragile.**
    `CrustControlZone.tsx:240-265`: the Attack/Release knobs both
    treat `value === 0` as "auto". The onChange writes
    `setParam('attackAuto', v === 0)` and `setParam('attack', v)` in
    that order. A dragger that crosses 0 toggles `attackAuto` on and
    off rapidly while also writing a 0 value. The rAF batcher
    coalesces writes per key, so `attackAuto` will see only the last
    boolean per frame — but two writes per frame still hit the store.
    More problematic: there's no UI indication that the user is in
    "auto" mode versus actually-zero-attack mode (the readout shows
    "Auto" in `fmtKnob` but the knob position is identical).

22. **`CrustControlZone` re-derives the algorithm description on
    every render.** Line 222-224: `ALGORITHMS.find((a) => a.id === patch.algorithm)?.desc ?? ''`.
    React Compiler memoises this so it's not a perf bug per se. Just
    noting because the same pattern recurs in the streaming preset
    lookup at `CrustPanel.tsx:88` and the LUFS-target lookup at
    `CrustPanel.tsx:43-49`. Acceptable, but there's no test asserting
    each lookup returns the right entry for known IDs.

23. **`CrustWaveformDisplay` rAF tick counter never resets and grows
    unbounded.** Line 74,97,119: `tickRef.current++` and the modulo
    test against `frameSkip` (1, 2, or 4). Number precision in JS holds
    safely up to `2**53`, so realistically this is fine forever, but
    the modulo behaviour with negative integers shifts unexpectedly if
    the counter ever overflowed. Defensive but harmless.

24. **`CrustWaveformDisplay` uses `useEffect` with empty deps and
    reads live values via a ref.** Line 64-66, 270:
    `latestRef.current = { grDb, … }` is reassigned on every render to
    feed the rAF loop. The `useEffect(..., [])` hook starts the rAF
    once and never re-subscribes. This is the conventional escape from
    stale-closure bugs in rAF loops. The risk: the `canvas` element is
    captured in the effect's closure; if React unmounts and remounts
    the component (e.g. uiLevel transition causes the parent to remount),
    a stale `canvasRef.current` could be drawn into until the new
    effect attaches. The `cancelAnimationFrame` in cleanup is correct,
    but the `if (!canvas) return` guard at line 84 means a remount with
    a missing ref silently disables the display until the next remount.

25. **`CrustWaveformDisplay` `frameSkip === 1` (fast scroll) draws
    every frame including the layer 5 LUFS curve and 6 floating
    labels.** Line 109-118: the rAF callback runs at 60 fps regardless,
    but rendering only proceeds when `tick % frameSkip === 0`. At fast
    scroll that's every frame. The full layered draw — five fills, a
    stroke, and N text fills — at 60 fps with a 420×160 canvas is
    measurable. No `requestIdleCallback` fallback, no visibility check
    (the rAF keeps running with the panel in a hidden tab — the
    browser throttles `requestAnimationFrame` to ~1 Hz on hidden tabs,
    but the ring buffers still fill and the closure still holds onto
    the canvas).

26. **`CrustSatCurve` lacks high-DPI handling.** `CrustSatCurve.tsx:118-119`
    sets `width={80} height={80}` on the canvas with no `devicePixelRatio`
    scaling. On a 2× display the curve renders blurry. The drawing is
    re-run on `[algorithm, drive]` change but never on container resize
    — fixed-size 80×80, so resize is moot. Cosmetic, but visible.

27. **`CrustSatCurve` switch is non-exhaustive.** Lines 60-86: the
    `switch (algo)` has cases for `'hard'`, `'tape'`, `'tube'`, `'fold'`,
    `'soft'` — covers all five `CrustSatAlgorithm` values. But there's
    no `default` clause, so TypeScript will flag any future addition
    via the unused-`outSig` path. Acceptable today; document with a
    `default: never` exhaustiveness check.

28. **`CrustSatCurve.tape` formula has a sign asymmetry that doesn't
    match the JSDoc.** Line 65: `Math.tanh(inSig * 0.8) * 1.1 * (inSig
    < 0 ? 0.9 : 1.0)` — the `0.9` factor on the negative half-cycle
    creates a 1 dB asymmetry. Tape saturation is normally even-symmetric
    (or has a 2nd-harmonic emphasis on positive); this looks wrong.
    No test covers the curve shape.

29. **`CrustGainStrip` does not throttle pointer-move writes.**
    Lines 32-41: every pointermove fires `onChange(clampedValue)` which
    calls `setCrustParamWithAudio` which writes the store and schedules
    a rAF. The rAF batcher coalesces audio writes per frame, but the
    store write itself is unthrottled — at 240 Hz pointer rate that's
    240 store updates per second. Each store update triggers a
    re-render of every component that subscribes to `crustStore`
    (the panel, the meter strip, the waveform display, the control
    zone). React's batching helps, but a knob tweak shouldn't trigger
    a meter-strip re-render at all.

30. **`CrustGainStrip` aria-valuenow rounds to 0.1 dB but
    aria-valuetext is the raw `value.toFixed(1)`.** Line 100-101: this
    is internally consistent. But the keyboard step (0.1 / 1.0) yields
    fractional values like `0.30000000000000004` after multiple
    accumulations; `toFixed(1)` masks the float drift visually but
    `aria-valuenow={Math.round(value * 10) / 10}` will sometimes be
    `0.3` and sometimes `0.30000000000000004` rounded back to `0.3`.
    Cosmetic.

31. **`CrustMeteringStrip.MeterBar` for the "right" channel is faked
    at `outNorm * 0.97`.** Line 147: `<MeterBar value={outNorm * 0.97} … />`.
    There is no real per-channel meter in the meter state — `outputDb`
    is a single value. The 0.97 multiplier is a UX hack to "look like
    stereo". This is misleading: the user thinks they're seeing a
    real L/R balance reading. Either drop it (use `<MeterBar value={outNorm} />`
    twice with the label) or extend the meter state to carry
    `outputDbL` / `outputDbR` (and `inputDbL` / `inputDbR`) and update
    the worklet to publish them.

32. **`CrustMeteringStrip` `onResetTp` does not actually reset the
    audio engine's TP latch.** The reset button calls
    `onResetTp` which (per `CrustPanel.tsx:326-331`) only clears the
    UI store value. The audio engine's TP latch — if it has one — is
    not signalled. Next analysis frame from the worklet will re-publish
    the current TP value, defeating the reset. Cross-reference with the
    Crust worklet contract; this is a finding either way.

33. **`CrustPanel`'s footer `Reset` chip resets _all_ meters
    including the integrated LUFS, ST, MOM, TP, and GR.**
    `CrustPanel.tsx:395`: `onClick={() => resetCrustMeters()}`. There
    is no confirmation, no announcement, and the integrated LUFS
    statistic is the most expensive value (it accumulates over the
    entire playback session). A misclick wipes the session loudness
    measurement with no undo. Add a confirmation modal or a longer-press
    interaction.

34. **`CrustPanel` has no error boundary.** A render error in
    `CrustControlZone` (e.g. unknown algorithm, division-by-zero in
    the saturation curve canvas, `canvas.getContext('2d')` returning
    null) crashes the entire panel. AGENTS.md "Behavioral Invariants:
    Implement error boundaries, fallback UIs, and graceful degradation".
    Compare to other plugin panels in the app.

35. **No `useCases/index.ts` aggregating the bridge entry points.**
    `CrustPanel` imports two specific files via deep paths
    (`../../useCases/crustParamBridge/loadCrustPatchWithAudio`,
    `../../useCases/crustParamBridge/setCrustParamWithAudio`). The
    "one function per file" rule is honoured, but the panel ends up
    importing helpers from three different locations
    (`./crustParamBridge/loadCrustPatchWithAudio`,
    `./crustParamBridge/setCrustParamWithAudio`, `./crustPresets`).
    A `useCases/index.ts` exporting them would simplify intra-module
    imports — but per AGENTS.md "Same module — relative imports", that
    barrel must NOT be imported by intra-module files (the rule is
    that the root index is for external consumers; relative imports
    inside the module bypass it). So this finding is just noting the
    asymmetry: the module has no `useCases/index.ts` because there are
    no external consumers of the use cases — but if `CrustPanel`
    were ever extracted to another module, the import surface would
    need redesign.

36. **`crustPresets.ts` has hardcoded constants for the streaming
    targets that duplicate `CrustPanel.STREAMING_PRESETS`.**
    `CrustPanel.tsx:25-36` and `crustPresets.ts:33,49` both encode
    `streamingPreset: 'spotify' | 'ebu_r128' | …`. The set in
    `STREAMING_PRESETS` (10 entries with full LUFS targets and TP
    ceilings) is in `CrustPanel`. The factory presets reference
    `streamingPreset: 'spotify'` and `streamingPreset: 'ebu_r128'` as
    strings. There is no shared source of truth: a typo in a future
    factory preset (`'spotyfi'`) would silently fall through to "Custom"
    in the UI lookup at `CrustPanel.tsx:88` (`STREAMING_PRESETS.find
    (...) ` returns undefined; the body uses `'Custom'` fallback).
    Move the streaming preset table to `models/` or `useCases/` and
    derive both consumers from it.

37. **`outputBitDepth: 32` is exposed but is meaningless after
    dither.** `CrustPatch.ts:66` has `outputBitDepth: 16 | 24 | 32`,
    and the dither chip row at `CrustControlZone.tsx:464-475` lets the
    user pick `16`/`24`/`32`-bit. Dither at 32-bit is a no-op (32-bit
    float doesn't quantise). The UI offers it as a valid choice. Either
    grey it out when dither is enabled, or document that 32-bit means
    "no dither", or constrain `outputBitDepth` to `16 | 24` when
    `dither !== 'off'`.

38. **`CrustPanel` preset menu uses `preset.patch.name === patch.name`
    for the active state.** `CrustPanel.tsx:150,157`. If two presets
    happen to have the same `name`, both highlight as active. A new
    user-supplied preset that copies a factory name silently confuses
    the UI. Use `preset.id` as the active key.

39. **`CrustPanel` streaming menu writes ceiling _to the patch_ but
    not back to the preset.** Lines 207-213: selecting a streaming
    target sets `streamingPreset` and `ceiling`. The patch is now in a
    state that doesn't match any factory preset (the preset's ceiling
    might differ). The preset menu still shows the previously-selected
    factory preset as "active" (#38). UX: the user has no signal that
    they're now on a custom blend.

40. **`CrustControlZone.SectionLabel` is a typed-as-string-only
    component.** Line 40: `{ children: string }`. JSX with a
    `{`children`}` value of `<>{...}</>` would not compile, but the
    types-as-documentation here are a gotcha for future authors. Trivial.

41. **`CrustControlZone.Knob` and `CrustControlZone.SliderRow`
    are inline functions defined inside the module file.** Lines 60-95,
    97-124. They are stable references because they are top-level
    consts, not closures over render scope. Fine.

42. **`CrustWaveformDisplay` `peakLabels` ring is a `useRef<PeakLabel[]>`
    that grows in place with no max-length enforcement.** Line 76-78,
    236-256. The cap at 4 is enforced at push time
    (`peakLabels.current.length < 4`), and culling at `age >= 180 ||
    x <= 0` runs every frame. So the array stays bounded — good. But
    the implementation mutates the array in place (`labels.length =
    liveCount`), which is correct but unusual. No test covers the
    label trail behaviour.

43. **No accessibility live regions for meter changes.** The metering
    strip has aria-labels on values (`aria-label="Integrated LUFS:
    -12.0"`) but those don't fire a screen-reader announcement on
    change because they're not in an `aria-live` region. The TP-clip
    LED toggle (Crust's most safety-critical signal) is a colour
    change with no assertive announcement. AGENTS.md doesn't cover this
    explicitly, but UX for an A11y-conscious DAW would.

44. **Test file `__tests__/CrustGainStrip.spec.tsx` doesn't unmount.**
    Line 6-12: the test renders but never calls `cleanup()` or destroys
    the instance. Vitest + Testing Library auto-cleans between tests,
    so this is fine — but the test asserts only `getByText(/gain/i)`,
    which matches any of "Gain", "gain", "Push" with "gain" anywhere.
    The label is actually "Gain"; the assertion is too loose to catch a
    "GAIN" → "PUSH" rename regression.

45. **`crustPresets.spec.ts` does not assert that preset patches are
    actually loadable.** Lines 5-23: the spec asserts that ids are
    unique and that every preset has a name/id/category. It does not
    call `loadCrustPatchWithAudio(deviceId, preset.patch)` for any
    preset, so a preset with a malformed `algorithm` enum or a
    `streamingPreset` that doesn't match the UI lookup would slip
    through.

46. **`crustParamBridge.spec.ts` doesn't verify _which_ deviceId, key,
    or value reaches `updateDeviceParam`.** Lines 46-67: the three test
    cases assert that `mockUpdateDeviceParam.not.toHaveBeenCalled()` for
    missing devices, and "doesn't throw" for valid devices. None
    assert `mockUpdateDeviceParam.toHaveBeenCalledWith('t1', 'd1',
    'gain', 0)`. The actual flush behaviour — the entire point of the
    bridge — is unverified.

47. **`encodeCrustValue` returns `0` for an _unknown_ enum value, not
    null.** Lines 113, 117, 121, 125, 129, 133, 141: `STYLE_INDEX[value
    as keyof typeof STYLE_INDEX] ?? 0`. So a typo silently maps to
    `transparent`, `transparent`, `soft`, `wideband`, `stereo`, `off`,
    `'a'` (the first enum entry). Combined with #4 and #7, a malformed
    enum string (a) updates the store with the bad string, (b) encodes
    to enum-0, (c) sends enum-0 to the audio engine, (d) shows the
    bad string in the UI (the chip-active check uses `===` against the
    bad string, so no chip lights up). Worse than silent no-op:
    silent wrong-write.

48. **No persistence audit for `streamingPreset` and `scrollSpeed`.**
    `CrustPatch.ts:75` adds `streamingPreset` to the patch shape, and
    line 74 adds `scrollSpeed`. Both are persisted to the project (via
    `loadCrustPatchWithAudio` / project save). No test asserts they
    survive a `crustStore.set(state) → crustStore.value` round-trip with
    the right defaults. The `defaultCrustState` includes them
    (`crustStore.ts:36-39`), so today this works — but a refactor that
    changes patch shape could lose them.

---

## Priorities

1. **No root `index.ts` for the module + cross-module deep imports**
   (issue #1) — primary AGENTS.md "Contract Boundaries" violation.
   Mechanical to fix; unblocks the next set of architectural cleanups.
2. **Silent type/encoder divergence between UI, store, and audio engine**
   (issues #4, #5, #7, #20, #47) — silent wrong-write paths between
   the UI and the audio engine. The user sees one thing, the engine
   plays another.
3. **Tests are mostly smoke checks; production behaviour unverified**
   (issues #13, #14, #15, #16, #45, #46) — every regression in this
   module's behaviour will ship green. The bridge's coalescing
   contract, the panel's interaction wiring, and the preset round-trip
   are entirely unverified.
4. **`as never` and `as keyof typeof` escapes** (issues #5, #6) —
   AGENTS.md / user-memory hard rule violations.
5. **Patch-load → batched-write race** (issue #19) — loading a preset
   while a knob drag is pending lets the dragged value silently
   overwrite the loaded preset value.
6. **Faked-stereo metering** (issue #31) — visible UX dishonesty in a
   loudness-desk plugin.
7. **`CrustPanel.spec.tsx` calls panel without required `deviceId`
   prop** (issue #12) — the spec compiles, suggesting type weakening
   somewhere; needs investigation.

---

## Open issues

### 1. No root `index.ts` for the Crust module

**Problem:** AGENTS.md "Contract Boundaries: Cross-module imports MUST
only target the destination module's root `index.ts`". The Crust module
has no `src/modules/Crust/index.ts`. Two external callers (`Workspace/AppShell`
and `Project/projectPersistence`) deep-import via
`#/modules/Crust/presentations/views` and `#/modules/Crust/stores`
respectively. The module has no public surface declaration.

**Representative files:**

- `src/modules/Crust/` (no `index.ts`)
- `src/modules/Workspace/presentations/views/AppShell.tsx:22`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:4`

**Needed:** Create `src/modules/Crust/index.ts` exporting (at minimum)
`CrustPanel`, `crustStore`, `defaultCrustState`. Migrate the two
external imports to `from '#/modules/Crust'`. Audit other plugin modules
for the same omission as a follow-up.

### 2. Silent enum-typo → wrong-write to audio engine

**Problem:** `encodeCrustValue` returns `0` (the first enum value) when
the input string is not a known enum member. The store mutator
`setCrustParam(key, value)` runs first and writes the bad string. The
batcher then sends enum-0 to the audio engine. UI shows the bad string
(no chip is highlighted because `===` checks fail), engine plays
`transparent` (or `soft`, `wideband`, etc.). Three layers diverge.

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/helpers.ts:99-145`
- `src/modules/Crust/useCases/crustParamBridge/setCrustParamWithAudio.ts:6-25`

**Needed:** Either narrow the encoder input to a typed `CrustPatch[Key]`
and exhaustively switch on `key` (compile-time guaranteed coverage),
or guard with `if (!(value in STYLE_INDEX)) { logger.warn(...); return null; }`
and abort the store write too. Add a test with a fabricated bad value
and assert that no store write happens.

### 3. `as never` in test mock

**Problem:** `crustParamBridge.spec.ts:19` uses `mockGetAllTracks as never`
to satisfy the `GetAllTracksFn` parameter type. AGENTS.md /
user-memory: "no `as never` escapes". The mock returns a different
shape from `Track[]`.

**Representative files:**

- `src/modules/Crust/useCases/__tests__/crustParamBridge.spec.ts:6,19`

**Needed:** Type the mock factory with a real (partial) `Track` shape:
`vi.fn((): Track[] => [])`. If `Track` is over-broad for tests, define
a minimal-fixture helper in `#/utils` and use it.

### 4. Setter widening loses TypeScript safety in `CrustControlZone`

**Problem:** `type Setter = (key: keyof CrustPatch, value: number |
boolean | string) => void`. Per-key narrowing (e.g. `'ceiling'`
expects `number`, `'algorithm'` expects `CrustAlgorithm`) is lost.
Combined with #2, a typo'd enum string compiles fine and silently
mis-writes.

**Representative files:**

- `src/modules/Crust/presentations/components/CrustControlZone.tsx:25`
- `src/modules/Crust/presentations/views/CrustPanel.tsx:92-94`

**Needed:** Define `Setter` as a generic:
`type Setter = <Key extends keyof CrustPatch>(key: Key, value: CrustPatch[Key]) => void`.
This will surface every loose call site. Fix them.

### 5. `CrustPanel.spec.tsx` calls the panel without required `deviceId`

**Problem:** `<CrustPanel />` (no prop) compiles and runs in the spec.
The component declares `({ deviceId }: { deviceId: string })`. Either
TypeScript's `react-test` config relaxes `strict`, or there's a
`tsconfig.test.json` that skips prop checks, or some `// @ts-expect-error`
trick is masking it.

**Representative files:**

- `src/modules/Crust/presentations/views/__tests__/CrustPanel.spec.tsx:16,21,26,31`
- `src/modules/Crust/presentations/views/CrustPanel.tsx:69`

**Needed:** Investigate why this compiles. Add `deviceId="test"` and
also write at least one spec that asserts `setCrustParamWithAudio` is
called with the expected (deviceId, key, value) tuple when a chip is
clicked.

### 6. Preset load fights pending drag-batched writes

**Problem:** A user is dragging the gain knob (a write is pending in
the rAF batcher) and clicks a factory preset. `loadCrustPatchWithAudio`
runs immediately, pushing 29 params. The dragged write fires _after_
on its rAF, overwriting the preset's gain value silently.

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts:46-51`
- `src/modules/Crust/useCases/crustParamBridge/helpers.ts:15`

**Needed:** Call `paramBatcher.cancelAll()` (or per-deviceId cancel) at
the top of `loadCrustPatchWithAudio`. Add a test that simulates a
pending knob write being preempted by a preset load.

### 7. `loadCrustPatchWithAudio` synchronous 29-call burst

**Problem:** A preset load issues 29 `updateDeviceParam` calls and 29
`persistDeviceParam` calls back-to-back on the main thread. Each
`updateDeviceParam` is a postMessage to the audio worklet. There is no
batch / single-message mode for "load patch".

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts:14-51`

**Needed:** Either route through the rAF batcher (one flush per key
per frame, but 29 keys still means 29 messages — minimal saving), or
add a `loadDevicePatch(deviceId, encodedPatchObject)` repository
method that sends a single message. The latter is the right fix.

### 8. Faked stereo metering

**Problem:** `CrustMeteringStrip` renders the right-channel meter as
`outNorm * 0.97` because the meter state has only one `outputDb`
field. The user sees "L" and "R" labels and a visibly-different bar,
implying real stereo metering. There is no.

**Representative files:**

- `src/modules/Crust/presentations/components/CrustMeteringStrip.tsx:147`
- `src/modules/Crust/stores/crustStore.ts:8-18`

**Needed:** Either (a) extend `CrustMeterState` to carry per-channel
values (`inputDbL/R`, `outputDbL/R`) and update the worklet to publish
them, or (b) drop the L/R labels and render a single mono meter with
"Out" label.

### 9. Patch / encoder coverage divergence

**Problem:** `loadCrustPatchWithAudio` enumerates 29 of 30 patch keys.
It pushes `scrollSpeed` (UI-only, not used by the audio engine) and
omits `streamingPreset` (which has no encoder branch). There is no
single source of truth for "which patch keys are audio-engine params".

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts:14-44`
- `src/modules/Crust/useCases/crustParamBridge/helpers.ts:99-145`
- `src/modules/Crust/models/CrustPatch.ts:30-76,125-139`

**Needed:** Add a typed `AUDIO_PARAM_KEYS: readonly (keyof CrustPatch)[]`
constant in `models/`. Use it in `loadCrustPatchWithAudio` and in any
future serialiser. Drop `scrollSpeed` from the load list (it's UI-only).
Decide whether `streamingPreset` should hit the engine — if no, drop;
if yes, add `STREAMING_PRESET_INDEX`.

### 10. Tests are smoke-only

**Problem:** Eleven spec files, of which:

- 5 use `import * as subject` namespace imports (forbidden) and assert
  only "is defined".
- 4 component specs assert only "renders" / "/word/i is in document".
- `CrustPanel.spec.tsx` runs four near-identical "should render" cases
  with `expect(document.body).toBeTruthy()`.
- `crustParamBridge.spec.ts` swaps a synchronous fake batcher (so it
  doesn't test the rAF-coalescing contract) and never asserts the
  arguments passed to `updateDeviceParam`.

The bridge's coalescing, the panel's chip→handler→bridge wiring, the
saturation curve, the gain-strip pointer and keyboard interactions, the
waveform display's ring buffer, and the preset round-trip are all
uncovered.

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/__tests__/helpers.spec.ts`
- `src/modules/Crust/useCases/crustParamBridge/__tests__/loadCrustPatchWithAudio.spec.ts`
- `src/modules/Crust/useCases/crustParamBridge/__tests__/setCrustParamWithAudio.spec.ts`
- `src/modules/Crust/useCases/__tests__/crustParamBridge.spec.ts`
- `src/modules/Crust/presentations/views/__tests__/CrustPanel.spec.tsx`
- `src/modules/Crust/presentations/components/__tests__/CrustGainStrip.spec.tsx`
- `src/modules/Crust/presentations/components/__tests__/CrustControlZone.spec.tsx`
- `src/modules/Crust/presentations/components/__tests__/CrustMeteringStrip.spec.tsx`
- `src/modules/Crust/presentations/components/__tests__/CrustSatCurve.spec.tsx`
- `src/modules/Crust/presentations/components/__tests__/CrustWaveformDisplay.spec.tsx`

**Needed:** Replace namespace-import smoke tests. Write behavioural
specs:

- bridge: rAF coalescing under fake timers, with `vi.useFakeTimers()`,
  asserting one flush after multiple writes within a frame; argument
  shape matches; cancel-on-load works.
- panel: clicking the algorithm chip calls `setCrustParamWithAudio`
  with `(deviceId, 'algorithm', 'punchy')`; selecting a streaming
  preset writes both `streamingPreset` and `ceiling`.
- gain strip: pointer-drag updates value clamped to 0–18; arrow key
  steps by 0.1; shift+arrow steps by 1; ctrl/cmd modifies the drag
  scale by 0.1×.
- preset round-trip: every preset, when loaded, encodes every key
  through `encodeCrustValue` without returning `null`.

### 11. `as keyof typeof` escapes in encoder

**Problem:** Eight call sites in `encodeCrustValue` use
`STYLE_INDEX[value as keyof typeof STYLE_INDEX] ?? 0`. The cast
silences a `value: string` mismatch. AGENTS.md TypeScript-soundness:
"`as` to silence the compiler instead of fixing the value or the type"
is forbidden.

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/helpers.ts:113,117,121,125,129,133,137,141`

**Needed:** Replace with `value in STYLE_INDEX` runtime guard, or
(better) make the function generic over `Key extends keyof CrustPatch`
and switch on `key` with each branch typed against `CrustPatch[Key]`.

### 12. Inline TP-reset in `CrustPanel` duplicates store mutator

**Problem:** `CrustPanel.tsx:326-331` mutates `crustStore` directly to
clear TP, while the footer reset uses the public `resetCrustMeters()`.
There is no `resetCrustTruepeak()` mutator; the TP-only reset bypasses
the store API and reaches into `.value`.

**Representative files:**

- `src/modules/Crust/presentations/views/CrustPanel.tsx:326-331,395`
- `src/modules/Crust/stores/crustStore.ts:74-79`

**Needed:** Add `resetCrustTruepeak()` to `crustStore.ts` (clears
`truepeakMax: -100, truepeakExceeded: false`). Have `CrustPanel` call
it. Leave `resetCrustMeters` for the footer Reset chip.

### 13. Footer "Reset" wipes integrated LUFS without confirmation

**Problem:** `CrustPanel.tsx:395`: a single click on the Reset chip
calls `resetCrustMeters()`, which clears the integrated LUFS — the
most expensive accumulated statistic in the plugin — with no
confirmation, no announcement, no undo.

**Representative files:**

- `src/modules/Crust/presentations/views/CrustPanel.tsx:395`
- `src/modules/Crust/stores/crustStore.ts:74-79`

**Needed:** Add a confirmation modal or a long-press interaction
before `resetCrustMeters` runs. Or split into `resetTransientMeters()`
(clears short-term, momentary, peaks) and `resetIntegratedLufs()`
behind separate buttons.

### 14. Preset menu uses `name` for active-state matching

**Problem:** `CrustPanel.tsx:150,157` uses `preset.patch.name === patch.name`
to decide which preset is active. Two presets with the same name
(plausible if a user renames or duplicates) both highlight.

**Representative files:**

- `src/modules/Crust/presentations/views/CrustPanel.tsx:150,157`

**Needed:** Use `preset.id`. Also: track the active preset ID
explicitly in patch state (e.g. `activePresetId: string | null`) and
clear it when any param diverges from the preset's value, so the UI
can clearly mark "modified from preset".

### 15. Streaming-preset selection silently divorces patch from factory preset

**Problem:** `CrustPanel.tsx:207-213`: selecting a streaming target
overwrites `ceiling` (and `streamingPreset`). The current factory
preset selection is unaffected, so the UI keeps highlighting the old
preset even though the patch values have diverged.

**Representative files:**

- `src/modules/Crust/presentations/views/CrustPanel.tsx:207-213,150`

**Needed:** When any patch field is changed manually, clear the
"active preset" indicator (per #14) so the user sees they're on a
custom blend.

### 16. Dither × 32-bit output is meaningless

**Problem:** `outputBitDepth: 32` is selectable while `dither !==
'off'`, but 32-bit float output doesn't quantise.

**Representative files:**

- `src/modules/Crust/models/CrustPatch.ts:66`
- `src/modules/Crust/presentations/components/CrustControlZone.tsx:464-475`

**Needed:** Either constrain `outputBitDepth` to `16 | 24` when dither
is on (a discriminated union: `{ dither: 'off' } | { dither: …; outputBitDepth: 16 | 24 }`),
or grey out the 32-bit chip when dither is enabled.

### 17. `crustStore` mutators silently no-op on null state

**Problem:** Five store mutators all guard with `if (!state) return`.
`createStore<CrustState>({ initialData: defaultCrustState })`
guarantees a non-null initial value, so the guards are dead defensive
code. Per user memory: "no fallback hacks; defensive branches mask
contract violations".

**Representative files:**

- `src/modules/Crust/stores/crustStore.ts:45-79`

**Needed:** Remove the null guards. If the store contract permits
null, narrow `crustStore.value` at the type level (it's already
non-null per `createStore`'s implementation).

### 18. `CrustPanel`'s nullable defaults disagree with the store's
initial values

**Problem:** `CrustPanel.tsx:76-85` falls back to `inputDb: -60`,
`outputDb: -60`, while `crustStore.ts:25-26` initialises both to
`-100`. Different magic numbers in different places.

**Representative files:**

- `src/modules/Crust/presentations/views/CrustPanel.tsx:76-85`
- `src/modules/Crust/stores/crustStore.ts:25-34`

**Needed:** Drop the defaults in the panel — `useStore(crustStore,
defaultCrustState)` already returns a non-null state. Use
`state.inputDb` directly.

### 19. `paramBatcher` has no HMR / panel-unmount cleanup

**Problem:** `helpers.ts:15`: a single module-level `paramBatcher`
holds rAF callbacks. On hot reload or panel unmount, pending entries
are not cancelled. With Vite HMR replacing the module, the old
batcher's pending rAFs still fire (or fire against a stale
`updateDeviceParam` reference).

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/helpers.ts:15,33,38`

**Needed:** Call `paramBatcher.cancelAll()` on `import.meta.hot.dispose`
(if HMR is enabled) and on `CrustPanel`'s unmount effect (per active
deviceId). The unmount path is more important than HMR.

### 20. `CrustWaveformDisplay` has no error boundary on canvas context loss

**Problem:** `CrustWaveformDisplay.tsx:87-89`: if `canvas.getContext('2d')`
returns null at mount, the effect silently disables the display. There
is no fallback UI, no logger.error.

**Representative files:**

- `src/modules/Crust/presentations/components/CrustWaveformDisplay.tsx:82-91`
- `src/modules/Crust/presentations/components/CrustSatCurve.tsx:103-112`

**Needed:** Render a fallback "graphics unavailable" message (or call
`logger.warn` and let the parent decide). Consider an error boundary
around the panel.

### 21. `paramBatcher` inverts the rAF-batcher contract under test

**Problem:** `crustParamBridge.spec.ts:20-27` mocks `paramBatcher` with
`{ schedule: (k, v, flush) => flush(k, v) }`, which fires the flush
synchronously. The actual rAF coalescing — multiple writes in one
frame collapse into one flush — is never exercised under test. So a
regression where `createRafBatcher` ships per-write flushes (defeating
the optimisation) wouldn't fail any spec in this module.

**Representative files:**

- `src/modules/Crust/useCases/__tests__/crustParamBridge.spec.ts:20-27`

**Needed:** Use the real `paramBatcher` with `vi.useFakeTimers()` and
`requestAnimationFrame` polyfilled to advance on `vi.advanceTimersByTime`.
Assert that two `setCrustParamWithAudio` calls within one frame
produce exactly one `updateDeviceParam` call.

### 22. `crustParamBridge.spec.ts` doesn't assert call arguments

**Problem:** Three test cases assert "not called" or "doesn't throw".
None assert `mockUpdateDeviceParam.toHaveBeenCalledWith(trackId,
deviceId, key, value)`. The bridge could send the wrong key, the wrong
value, or to the wrong track and the spec would still pass.

**Representative files:**

- `src/modules/Crust/useCases/__tests__/crustParamBridge.spec.ts:46-67`

**Needed:** Add positive-path tests with full `toHaveBeenCalledWith`
assertions for at least one numeric param, one boolean, one
string-enum.

### 23. `tape` saturation curve is asymmetric

**Problem:** `CrustSatCurve.tsx:65`:
`Math.tanh(inSig * 0.8) * 1.1 * (inSig < 0 ? 0.9 : 1.0)` — the negative
half-cycle is attenuated by 0.9. There is no test or documentation
that this is intentional. A 1 dB asymmetry on tape is unusual and
audible.

**Representative files:**

- `src/modules/Crust/presentations/components/CrustSatCurve.tsx:65`

**Needed:** Confirm the formula matches the audio-engine's tape
saturation. If not, fix the canvas to match the engine. Either way,
add a test that rasterises the curve and asserts symmetry / asymmetry
matches the contract.

### 24. `CrustPanel` has no error boundary

**Problem:** A render error anywhere in the panel (canvas-null,
unknown algorithm, `useStore` returning a malformed state) crashes the
whole panel.

**Representative files:**

- `src/modules/Crust/presentations/views/CrustPanel.tsx`

**Needed:** Wrap the panel body in a `<DawErrorBoundary>` (or
equivalent) that renders a fallback "Crust unavailable — see console
for details" message. Cross-reference how other plugin panels handle
this.

### 25. UI-only `scrollSpeed` is sent to the audio engine

**Problem:** `loadCrustPatchWithAudio.ts:43`:
`['scrollSpeed', patch.scrollSpeed]`. `scrollSpeed` is consumed by
`CrustWaveformDisplay` only — the audio engine has no use for it.
Sending it via `updateDeviceParam` pollutes the param surface and may
trigger automation code paths that don't apply.

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/loadCrustPatchWithAudio.ts:43`

**Needed:** Remove the entry. Add `AUDIO_PARAM_KEYS` (per #9) and
derive both `loadCrustPatchWithAudio`'s loop and any future serialiser
from it.

### 26. `streamingPreset` lookup table is duplicated between
`CrustPanel` and `crustPresets`

**Problem:** `CrustPanel.tsx:25-36` defines a 10-row `STREAMING_PRESETS`
table with `{id, label, lufsTarget, tpCeiling, group}`. Factory presets
in `crustPresets.ts:36,52` reference `streamingPreset: 'spotify'` and
`streamingPreset: 'ebu_r128'` as bare strings. There is no shared
source of truth — a typo in either file silently falls through.

**Representative files:**

- `src/modules/Crust/presentations/views/CrustPanel.tsx:25-36`
- `src/modules/Crust/useCases/crustPresets.ts:36,52`
- `src/modules/Crust/models/CrustPatch.ts:18-28`

**Needed:** Move `STREAMING_PRESETS` to `models/CrustPatch.ts` (or
`models/CrustStreamingTargets.ts`). Type the IDs as a literal union.
Have both `CrustPanel` and `crustPresets` import the same list. Audit
for typos in the bare strings.

### 27. Namespace imports in test files

**Problem:** Three spec files use `import * as subject from '../...'`.
AGENTS.md "Imports: Never use namespace imports". The tests are
trivial smoke tests anyway (#10).

**Representative files:**

- `src/modules/Crust/useCases/crustParamBridge/__tests__/helpers.spec.ts:3`
- `src/modules/Crust/useCases/crustParamBridge/__tests__/loadCrustPatchWithAudio.spec.ts:3`
- `src/modules/Crust/useCases/crustParamBridge/__tests__/setCrustParamWithAudio.spec.ts:3`

**Needed:** Replace each with named imports from the file under test,
and replace the "is defined" assertions with real behaviour
assertions (or delete the file if `crustParamBridge.spec.ts` already
covers the surface).

### 28. `CrustControlZone.Knob` Auto-mode is ambiguous to the user

**Problem:** Attack/Release knobs use `value === 0` to mean "auto".
The visual state of the knob at value 0 is identical for "Auto" and
"actually 0 ms". The text below shows "Auto", but a screen-reader
user has no signal because the `RotaryKnob` aria-value is just `0`.

**Representative files:**

- `src/modules/Crust/presentations/components/CrustControlZone.tsx:240-265`

**Needed:** Either show a distinct LED / colour ring on the knob when
`attackAuto === true`, or split the control into a separate `Auto`
toggle + `Attack` knob (the latter disabled when Auto is on).

### 29. `outputDb` is not stored as a per-channel pair

**Problem:** Same root cause as #8: the meter state has only single
`inputDb` and `outputDb` values. A loudness-desk plugin that doesn't
expose per-channel values is incomplete — phase issues, side imbalance,
mono-fold problems are invisible.

**Representative files:**

- `src/modules/Crust/stores/crustStore.ts:8-18`

**Needed:** Extend `CrustMeterState` to include
`{inputDbL, inputDbR, outputDbL, outputDbR, correlation}`. Update the
worklet to publish them. Update `CrustMeteringStrip` to render them.

### 30. `Knob` change handler in Attack/Release fires two store
writes per drag tick

**Problem:** `CrustControlZone.tsx:241-264`: each knob drag tick calls
`setParam('attackAuto', v === 0)` _and_ `setParam('attack', v)`. Two
store writes per pointer-move event. The second is in the rAF batcher;
the first is also in the batcher (different key, so different entry).
At drag rate that's two store updates per frame and two rAFs.

**Representative files:**

- `src/modules/Crust/presentations/components/CrustControlZone.tsx:241-264`

**Needed:** Compute `attackAuto` once when the user toggles 0 vs >0
(e.g. on pointer-up, or when crossing the 0 boundary). Or accept the
double-write and document it.

---

## Open questions

- [ ] Why does `CrustPanel.spec.tsx` compile without the required
      `deviceId` prop? Is there a `tsconfig.test.json` weakening
      strictness?
- [ ] Is `streamingPreset` consumed by the audio engine, or is it
      purely UI metadata? (Affects #9 / #25.)
- [ ] Does the audio engine's TP-latch need a "reset" message, or is
      the worklet stateless WRT TP? (#32 / above)
- [ ] Is the Crust worklet's parameter for `scrollSpeed` defined,
      ignored, or asserted-against? (#25)
- [ ] Are the `style` (Level 1) and `algorithm` (Level 2) parameters
      both consumed by the engine, or does the engine pick one based on
      a precedence rule? (#9 in findings)
- [ ] Is there a project-wide convention for plugin module barrels?
      Other plugin modules (`Bacteria`, `Fermenter`, etc.) appear to
      have the same missing-`index.ts` pattern — should this be a
      cross-module audit follow-up?

---

## Risks

- **Silent UI ↔ engine divergence.** A typo or out-of-spec value in
  any string-enum patch field updates the store but encodes to enum-0.
  The user sees one thing in the UI and hears another. No spec covers
  this; no log fires.
- **Preset load races with knob drag.** Loading a preset while a
  pending rAF write exists results in the dragged value clobbering the
  preset value. The user sees the preset selected but hears the old
  drag value on whichever knob was active.
- **Faked stereo metering misleads users.** A loudness-desk plugin
  that pretends to show L/R when only mono data is available will
  cost trust the moment a user notices.
- **Accumulated LUFS wiped by single click.** The "Reset" chip clears
  integrated LUFS — a session-long accumulation — with no
  confirmation.
- **Architectural drift.** No root `index.ts` means external callers
  reach into internals. The next refactor (renaming, moving files)
  breaks two unrelated modules silently. AGENTS.md violation as a
  pattern across plugin modules.
- **Tests are theatrical.** The spec suite passes regardless of bridge
  correctness, encoder coverage, or panel wiring. A regression that
  ships green to production is plausible.
- **HMR / unmount leaks.** The module-level `paramBatcher` retains
  pending rAFs across hot reloads and panel teardown.

---

## Suggested approaches

- **Architecture pass first.** Add `src/modules/Crust/index.ts`,
  migrate the two external imports, and re-run `pnpm deps:validate`.
  Mechanical, unblocks the next layer.
- **Type the encoder properly** (issues #2, #4, #11, #20). Make
  `encodeCrustValue` generic over `Key extends keyof CrustPatch` and
  exhaustively switch on `key`. Make `Setter` generic too. Run
  `pnpm typecheck` to surface every loose call site, fix them.
- **Behaviour-test the bridge** (issues #10, #21, #22). Use real
  `paramBatcher` under fake timers; assert coalescing, cancellation,
  argument shape. Add preset round-trip tests. Land before any DSP
  fixes so you can refactor without fear.
- **Source-of-truth refactor** (issues #9, #25, #26). Move
  `STREAMING_PRESETS` and `AUDIO_PARAM_KEYS` to `models/`. Have both
  `crustPresets.ts` and `CrustPanel.tsx` derive from it.
- **Real stereo metering** (issues #8, #29). Extend
  `CrustMeterState`; coordinate with the audio worklet; update the
  meter strip.
- **Preset-load batcher cleanup** (issue #19, #6). Cancel-then-load.
  One-line fix.
- **Reset-chip safety** (issue #13). Add confirmation or split into
  transient vs. integrated reset.
- **Deferred / lower-priority:** error boundary (#24), panel-unmount
  cleanup (#19), TP-only reset mutator (#12), dither/bit-depth
  constraint (#16).

---

## Recommendation

Start with **issue #1 (no root `index.ts`)** because it is mechanical,
unblocks the architecture layer, and forces a rename audit that will
surface the other plugin modules with the same problem.

Immediately after, tackle **issue #2 (silent enum-typo wrong-write)**
and **issue #11 (`as keyof typeof` escapes)** together — they share a
fix (generic-typed encoder). This is the highest-value correctness
work because every chip click in the UI flows through this path.

Then **issue #10 (smoke-only tests)** — write the behaviour suite
that the next round of DSP fixes (the saturation curve asymmetry, the
faked stereo, the reset-LUFS UX) can build on. Without it, every fix
ships green regardless.

Architecture, type-soundness, and tests in that order. The DSP / UX
issues (#8, #13, #14, #15, #16, #23, #28, #33) are independent and
can be picked up by a follow-up session once the foundation is solid.

---

## Resolved

_No issues resolved yet._
