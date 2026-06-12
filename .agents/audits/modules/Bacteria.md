# Bacteria module audit

## Scope

This audit covers `src/modules/Bacteria/` in full — the patch model, factory
presets, store, parameter bridge use cases (DI-injected), and the entire
presentation layer (one master view + nine custom editors + their tests). It
explicitly excludes the WASM `BacteriaNode` AudioWorkletNode wrapper
(`#/modules/AudioEngine/engine/BacteriaNode.ts`), the SAB telemetry allocator,
the rust-side processor, and the `Workspace` / `Project` /
`AudioEngine` consumers — except where they are imported from this module.

It is an adversarial review: contract holes, type-soundness escapes, broken
controlled-component handshakes, multi-instance state races, dead-wired UI,
performance hazards (allocations, fan-out re-renders), accessibility gaps,
and AGENTS.md violations.

Related spec: none on disk.

---

## Goal

A creative multi-effects framework whose UI, store, and engine bridge agree
on a single source of truth for every patch parameter:

- Every editor in the **Lab** view (waveshaper, Bezier LFO, step sequencer,
  spectral bin) writes back to the patch and survives a panel close.
- The **modulation dock** can actually add and remove `BacteriaModAssignment`
  entries; sources animate from real engine telemetry.
- The **spectrum analyser** displays live FFT data, not `Math.random()`.
- The Bacteria panel re-renders only when its own instance changes — not
  when an unrelated Bacteria device's meters tick.
- The parameter bridge is reentrant across multiple simultaneous Bacteria
  instances; an `inputGain` change on instance A does not flush instance B.
- `loadBacteriaPatchWithAudio` covers every audio-relevant field of
  `BacteriaPatch` — anything missing (`lfo1Sync`, `lfo2Sync`,
  `modAssignments`, `snapshots`, etc.) is either an explicit non-audio
  metadata field or written to the engine.
- AGENTS.md hard rules: no `useMemo`/`useCallback`/`React.memo`, no
  `forwardRef`, no `as never` / `as any` / `as unknown as` escapes to
  silence the type-checker, no namespace imports, prefer object params for
  multi-arg functions, no `&&` rendering, audio-thread code is non-blocking
  / non-allocating (Rust side).
- Tests assert real contracts (rendered UI, store mutation effects, engine
  push payloads), not "module loads" / "container has a `<canvas>`".
- Module barrel discipline: the public surface is whatever
  `Workspace`/`AudioEngine`/`Project` actually need; nothing else leaks.

---

## Relevant code paths

- `src/modules/Bacteria/` (no root `index.ts` — see issue #15)
- `src/modules/Bacteria/models/BacteriaPatch.ts`
- `src/modules/Bacteria/stores/bacteriaStore.ts`
- `src/modules/Bacteria/stores/index.ts`
- `src/modules/Bacteria/events/index.ts` (`// no public events`)
- `src/modules/Bacteria/useCases/index.ts` (`// no public use cases`)
- `src/modules/Bacteria/useCases/bacteriaPresets.ts`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/bacteriaParamBridgeDependencies.ts`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/helpers.ts`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaParamWithAudio.ts`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx` (1873 LoC)
- `src/modules/Bacteria/presentations/views/index.ts`
- `src/modules/Bacteria/presentations/components/BandStrip.tsx`
- `src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx`
- `src/modules/Bacteria/presentations/components/CrossoverDisplay.tsx`
- `src/modules/Bacteria/presentations/components/ModulationDock.tsx`
- `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx`
- `src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx`
- `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx`
- `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx`
- `src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx`
- `src/modules/Bacteria/presentations/components/XYMorphPad.tsx`
- All `__tests__/` siblings (15 specs total; see issue #14)

---

## Current behavior

**Patch model.** `BacteriaPatch` is a wide flat record (50+ globals + 6 bands
× ~50 fields). `DEFAULT_PATCH` always allocates 6 fully-populated bands even
when `bandCount` is 1. `BACTERIA_PARAMS` is a parallel data structure with
range/step/scaling metadata but is referenced **nowhere** in the codebase
(`grep` returns zero hits outside the file itself).

**Store.** `bacteriaStore` is keyed by `deviceId`. Six write helpers
(`setBacteriaParam`, `setBacteriaBandParam`, `setBacteriaUiLevel`,
`setBacteriaActiveBand`, `setBacteriaActiveModule`, `loadBacteriaPatch`) plus
a meter writer (`updateBacteriaMeters`) all do the same dance: read
`bacteriaStore.value ?? {}`, fall back to `{ ...DEFAULT_BACTERIA_STATE,
patch: { ...DEFAULT_PATCH } }`, then write a new top-level object. Every
call clones every other instance shallowly.

**Bridge.** The three `…WithAudio` use cases are wrapped in
`inject(bacteriaParamBridgeDependencies)(...)`. They share a **module-level
singleton** `paramBatcher` via `helpers.ts:14`, keyed by composite strings
like `${deviceId}:${key}` or `${deviceId}:band${bandIndex}_${key}`.
`loadBacteriaPatchWithAudio` bypasses the batcher and calls
`updateDeviceParam` synchronously for every parameter in a hand-coded
parallel list of 36 globals + 53 per-band fields × bandCount.

**View.** `BacteriaPanel` (1873 LoC) is a single file containing the
entire 5-level progressive-disclosure UI (Play / Shape / Build / Route /
Lab) plus nested helpers, the preset rail, and a `K` rotary-knob wrapper
sprinkled across the file. It subscribes to `bacteriaStore` via
`useStore(bacteriaStore, {})` — that is, the **entire `Record<deviceId,
BacteriaState>`**.

**Components.** Eight custom canvas/SVG editors (waveshaper, Bezier LFO,
step sequencer, spectral bin, spectrum analyser, crossover display,
node graph, XY morph pad) plus a band strip and a modulation dock.

**Tests.** Every component has a "renders" smoke spec; the use-case bridge
specs are "module loads" smoke tests. `BacteriaPanel.spec.tsx` renders
`<BacteriaPanel />` (no `deviceId`) — the type system is silently bypassed
because the test mocks `useStore` to return the default value.

---

## Findings

1. **Half the Lab view is dead UI.** `BacteriaPanel.tsx:756, 766, 782, 793`
   wires every Lab editor with `[]` as the data prop and `() => {}` as the
   change callback. Drawing a custom transfer curve, an LFO shape, a step
   pattern, or a spectral bin profile produces no observable effect. The
   editors maintain local `useState` (e.g. `WaveshaperEditor.tsx:68`) so
   the user *sees* their input but it is discarded the moment the panel
   unmounts and never reaches the patch. Same UX failure for `ModulationDock`
   (`:1500-1502`): `modValues={[]}`, `onAssignmentAdd={() => {}}`,
   `onAssignmentRemove={() => {}}`. Drag-and-drop assignment is purely
   theatrical.

2. **`SpectrumAnalyzer` is `Math.random()`.** `SpectrumAnalyzer.tsx:127-133`
   falls into the simulated-spectrum branch unconditionally because
   `BacteriaPanel` never passes `fftData`. `grep` confirms zero `fftData=`
   call sites in the module. Three SpectrumAnalyzers are mounted in
   PlayHero / ShapeHero / BuildHero (lines 430, 580, 655) — three random
   noise generators, branded as "the analyzer and split map stay visible
   so the patch never feels like a blind box." The blindness is structural.

3. **Multi-instance store fan-out re-renders.**
   `BacteriaPanel.tsx:1770` calls `useStore(bacteriaStore, {})` —
   subscribing to the **whole** `Record<deviceId, BacteriaState>`. With
   two Bacteria devices open in the project, every meter tick on instance
   B (60 Hz, via `updateBacteriaMeters`) re-renders instance A's panel
   end-to-end. Even single-instance, every band-meter tick re-renders the
   1873-line tree. There is no per-deviceId selector primitive in use.

4. **Module-level `paramBatcher` is a shared singleton across all Bacteria
   instances.** `helpers.ts:14` exports a single `RafBatcher` instance.
   `setBacteriaParamWithAudio` schedules with composite key
   `${deviceId}:${key}`, so two instances do not collide on the same key —
   but they share the **same in-flight rAF queue**, the same map size, and
   the same teardown surface. There is no `cancelAll` per-deviceId path,
   so a Bacteria device's batched writes survive the device's destruction
   and post to a `trackId/deviceId` tuple that no longer exists. The
   `findDeviceRef` lookup at flush time will return `null` and the write
   will silently no-op (acceptable), but the rAF still ran.

5. **`loadBacteriaPatchWithAudio` quietly drops `lfo1Sync` and
   `lfo2Sync`.** `loadBacteriaPatchWithAudio.ts:60-65` enumerates LFO
   parameters but omits both sync flags, even though they are persisted on
   `BacteriaPatch` and the encoder handles `boolean → 0|1`. Loading a
   tempo-synced LFO patch will set `bacteriaStore` correctly but **leave
   the engine in whatever sync state the previous patch left it**. Same
   structural risk: any new field added to `BacteriaPatch` requires a
   manual edit to two parallel string lists; nothing enforces coverage.

6. **`setBacteriaBandParamWithAudio` writes engine params for out-of-range
   bands.** `setBacteriaBandParamWithAudio.ts:26` calls
   `setBacteriaBandParam` which short-circuits on `bandIndex >=
bands.length` — but the function then continues to encode the value and
   schedule a flush with `band${bandIndex}_${key}`. The store is
   protected; the engine is not. `BacteriaPanel.tsx:808` derives
   `state.activeBand` from the store but `state.activeBand` is not
   clamped when `bandCount` shrinks (only `BuildDeck`'s explicit
   `setBacteriaActiveBand` call at `:1459` clamps, and only when the user
   explicitly clicks a band-count chip). Decreasing bandCount through any
   other code path (project load, preset switch) leaves `activeBand`
   pointing past the end.

7. **`as never` escape used 38 times in `BacteriaPanel.tsx`.**
   `BacteriaPanel.tsx:177, 457, 607, 635, 682, 708, 875, 886, 898, 912,
923, 937, 951, 991, 1002, 1013, 1025, 1037, 1062, 1073, 1084, 1095,
1120, 1131, 1142, 1153, 1186, 1197, 1209, 1221, 1232, 1264, 1275,
1300, 1311, 1336, 1347, 1371, 1382` — `setBandParam as never` and
   `freq as never`. AGENTS.md "TypeScript — soundness" forbids
   `as never`/`as unknown`/`as any` to silence the type-checker. The root
   cause is the `K` component's untyped `onChangeFn` signature:
   `(key: string, value: number) => void` is too loose to satisfy the
   per-key generic of `setBacteriaBandParamWithAudio`. The fix is to
   parameterise `K` over the key set or to drop the dual-purpose
   `onChangeFn` and split into `KGlobal` / `KBand`.

8. **`as keyof BacteriaPatch` casts ignore the band/global split.**
   `BacteriaPanel.tsx:177, 457, 607, 682` cast a string `k` to
   `keyof BacteriaPatch`. When the user is in `renderShapeControls` and
   the fallback path fires (`onChangeFn` undefined), a key like `'drive'`
   gets cast to `keyof BacteriaPatch` and routed to `setGlobalParam`,
   which calls `setBacteriaParamWithAudio` — which silently writes
   `bacteriaStore[deviceId].patch.drive = value` (creating a new field on
   the patch) and pushes `drive` (no `band${i}_` prefix) to the engine.
   The fallback should never fire in current call sites because
   `onChangeFn` is supplied for band knobs, but the type system does not
   prevent a future maintainer from forgetting it.

9. **`BACTERIA_PARAMS` is dead.**
   `models/BacteriaPatch.ts:356-671` defines a 300-line table with
   `min`/`max`/`default`/`unit`/`step`/`scaling` metadata for every
   parameter. `grep -r BACTERIA_PARAMS src/` returns zero references
   outside the model file. Meanwhile `BacteriaPanel.tsx` re-hardcodes
   every range and default in 38 inline `<K min={…} max={…} step={…}
def={…} unit="…" />` calls — and they don't match: e.g. `K` for
   `drive` declares `min=0 max=100 step=1 def=25 unit='%'`, the table
   says the same, but **`BACTERIA_PARAMS.crossoverFreq{1..5}` declares
   `step=1`** while the dragged `xToFreq` in `CrossoverDisplay.tsx:48`
   uses `Math.round(10 ** log)` (no quantisation toward `step`). Drift
   risk is unbounded.

10. **`bandCount` is encoded but the store never re-fits the bands.**
    `setBacteriaParamWithAudio` accepts `bandCount` (a `number`), pushes
    it to the engine, and writes the new value to the store. The
    `bands[]` array is **never resized** — it stays at 6 (the default).
    UI rendering correctly slices to `bandCount`, but
    `loadBacteriaPatchWithAudio` always pushes 6 bands' worth of params
    (`patch.bands.entries()` iterates 6, regardless of `bandCount`). Two
    consequences: (a) the engine receives `band5_*` writes for inactive
    bands on every load — wasted post-message bandwidth, (b) preset
    `Multiband Mangle` (`bacteriaPresets.ts:187`) declares `bandCount: 4`
    but supplies 6 bands; the trailing `DEFAULT_BAND` copies still get
    written into the engine.

11. **`updateBacteriaMeters` writes a brand-new top-level object every
    frame for every instance.** `bacteriaStore.ts:95-114` shallow-clones
    `instances`, replaces one entry, and writes back. At 60 Hz × N
    Bacteria devices, that's N×60 top-level object identities per second
    — `useStore` notifies every subscriber (BacteriaPanel and
    `resetModuleStoresToDefault`). Combined with finding #3, this is the
    main perf hazard.

12. **`WaveshaperEditor` redraws every render (no dep array).**
    `WaveshaperEditor.tsx:164-166` calls `useEffect(() => { drawCurve();
})` with **no dep array** — it runs after every render of the parent.
    The other editors (`BezierLfoEditor`, `SpectralBinEditor`,
    `StepSequencerEditor`) explicitly fixed this with
    `[points, …]` and an `eslint-disable react-hooks/exhaustive-deps`
    comment (per `// §150.2` markers). WaveshaperEditor is the holdout.

13. **Controlled-component handshake is broken across all four "draw"
    editors.** `WaveshaperEditor`, `BezierLfoEditor`,
    `SpectralBinEditor`, `StepSequencerEditor` all initialise local
    `useState` from a prop **once** (at first render) and never sync
    afterwards. Example: `BezierLfoEditor.tsx:43`
    `useState<LfoPoint[]>(initialPoints.length > 0 ? initialPoints :
DEFAULT_POINTS)`. If a parent ever supplies non-empty points, then
    later changes them (e.g. preset load), the editor displays stale
    state. Combined with finding #1 (callbacks are no-ops), this is
    masked today, but if anyone wires the persistence path the editors
    will not honour patch changes.

14. **All test specs are "renders" smoke tests.** Every spec under
    `presentations/components/__tests__/` is 11–22 LoC and asserts only
    that a `<canvas>` or `<svg>` exists, or that the component's title
    text renders. None exercises the pointer-drag math, the snap-to-grid
    behaviour, the bin-paintbrush falloff, the bezier evaluation, the
    crossover handle drag, or the morph-pad coordinate mapping. The
    `bacteriaParamBridge` specs (`__tests__/bacteriaParamBridge.spec.ts`
    + the four files under `bacteriaParamBridge/__tests__/`) explicitly
    state in the leading comment that "the original test attempted to
    introspect DI metadata… [it] is unreliable. The functional behavior
    is covered by integration tests elsewhere." There are no such
    integration tests in this repo. The bridges have **zero** behavioural
    test coverage. `helpers.spec.ts:8-9, 13-15` even asserts `t === 'function'
|| t === 'object'` — a non-assertion that never fails.

15. **No root `index.ts` for the module — three external import paths.**
    The module is consumed via `#/modules/Bacteria/stores`,
    `#/modules/Bacteria/presentations/views`, but never `#/modules/Bacteria`
    (no root barrel). AGENTS.md says the module's root `index.ts` is
    "the sole cross-module public surface" — Bacteria has no such
    surface. External consumers reach in through subpaths
    (`#/modules/Bacteria/stores` for `bacteriaStore` /
    `updateBacteriaMeters` from both `Project` and `AudioEngine`;
    `#/modules/Bacteria/presentations/views` for `BacteriaPanel` from
    `Workspace`). This is a deliberate-looking violation: AGENTS.md
    "Index exports — external consumers only" implies a root `index.ts`
    *must* exist when external imports do. The folder also has empty
    `events/index.ts` ("`// no public events`") and `useCases/index.ts`
    ("`// no public use cases`") — one consistent step away from
    convention.

16. **`BacteriaPanel.tsx` is 1873 LoC, untestable as a single file.**
    Five hero views, five deck views, a preset rail, an
    889-LoC-long `renderShapeControls` function (`:799-1442`), nine
    inline-defined module sub-components (`K`, `SectionHeader`,
    `BChip`, `MetricCell`, `BandMeters`, `PresetRail`, `PlayHero`,
    `PlayDeck`, `ShapeHero`, `BuildHero`, `RouteHero`, `LabHero`,
    `BuildDeck`, `RouteDeck`, `LabDeck`). At minimum the per-level
    hero/deck pairs should live in `presentations/components/` so the
    `BacteriaPanel.spec.tsx` can mount them in isolation; instead the
    spec mocks `useStore`, renders the whole tree, and asserts
    `document.body.toBeTruthy()`.

17. **`BacteriaPanel.spec.tsx` is type-unsound.**
    `BacteriaPanel.spec.tsx:16, 21, 26, 31` calls `<BacteriaPanel />`
    without the required `deviceId: string` prop. The mock of `useStore`
    at `:6-8` returns the default value, so `state` is the empty object
    and rendering happens to succeed because the component falls back to
    `getBacteriaState(deviceId)` — but `getBacteriaState(undefined as
unknown as string)` then writes to
    `bacteriaStore.value?.[undefined as keyof typeof instances]` which
    yields `undefined`. The test passes by accident. TypeScript
    *should* be flagging the missing prop; either the test file is
    excluded from typecheck or the project relies on
    `JSX.IntrinsicAttributes` permissiveness. Either way the spec does
    not assert behaviour.

18. **No accessibility for the Lab editors or the morph pad.** The
    `<canvas>` elements in `WaveshaperEditor`, `BezierLfoEditor`,
    `SpectralBinEditor`, `StepSequencerEditor`, `SpectrumAnalyzer` have
    no `role`, no `aria-label`, no `aria-valuenow`/`aria-valuemin` for
    keyboard parameter access. `XYMorphPad` is a draggable
    crosshair with no keyboard alternative — pointer-only. The preset
    list buttons (`BacteriaPanel.tsx:351`) are styled as `<button>`s
    via `as="button"` on `Stack`; that depends on the `Stack` adapter
    actually emitting `role="button"`. Should be verified, but at the
    BacteriaPanel layer there is no focus management, no
    `aria-live` for the meter readouts, and no `aria-pressed` on the
    chip-style toggles (`BChip`).

19. **`xToFreq` returns `Math.round(10 ** log)`.**
    `CrossoverDisplay.tsx:48` snaps every dragged crossover to the
    nearest 1 Hz, but at 20 kHz the log-x mapping covers 4 px / Hz, so
    the user can drag by less than 1 Hz at the high end and feel
    "stuck". Conversely at 20 Hz, 1 Hz of resolution is wasteful. Should
    be cents-quantised or scale-aware.

20. **`setPointerCapture` on `e.target` is fragile.**
    `XYMorphPad.tsx:27`, `CrossoverDisplay.tsx:66`,
    `WaveshaperEditor.tsx:184`, `BezierLfoEditor.tsx:178`,
    `SpectralBinEditor.tsx:135`, `StepSequencerEditor.tsx:117` — all
    set capture on `e.target` rather than `e.currentTarget`. If the user
    presses on a child element (e.g. a label inside the editor), the
    capture binds to that child, which may be re-rendered or
    un-mounted while the gesture is in flight. The handle/handler
    lookup will then drop pointer events. Standard fix is
    `e.currentTarget.setPointerCapture(e.pointerId)`.

21. **`CrossoverDisplay` reads `containerRef.current?.clientWidth`
    in render.** `CrossoverDisplay.tsx:123, 139, 168` measure the
    container width inside the JSX render to position grid lines,
    band regions, and handles — but on first render `containerRef.current`
    is `null` so they fall back to `800`. After the first commit the
    component does not re-render until pointer events fire, so the
    layout based on `800` persists until something forces a re-render.
    A `ResizeObserver` (or fixed `width` prop like the canvas
    components) is needed.

22. **`NodeGraphEditor` advertises `onRoutingChange` but never invokes
    it.** `NodeGraphEditor.tsx:34` declares the prop optional;
    `:147-258` ignores it entirely. The Route view at
    `BacteriaPanel.tsx:728-741` does not pass it. The graph is
    read-only by accident, not by design — the prop name implies
    interactivity that does not exist. Either drop the prop or wire
    node clicks to it.

23. **`buildNodes` allocates a fresh nodes/connections graph on every
    render.** `NodeGraphEditor.tsx:155` calls `buildNodes(...)` in the
    component body. The Route hero unmounts on level switch but the
    function rebuilds N nodes + M connections on every parent
    re-render. Also: `getNode = (id) => nodes.find(...)` (`:158`) does an
    O(N) scan for every connection (`:177`) — at 6 bands + crossover +
    sum + I/O, ~10 nodes and ~14 connections, this is small but is the
    pattern.

24. **`SpectrumAnalyzer` shares a module-level `_barDataScratch` across
    all instances.** `SpectrumAnalyzer.tsx:31` says the comment claims
    safety because draw is synchronous "and only one instance paints at
    a time on the main thread". Three SpectrumAnalyzer instances are
    mounted simultaneously (PlayHero, ShapeHero, BuildHero); each runs
    `draw()` from `useEffect` after its own dep changes. The buffer is
    sequentially overwritten — fine at the moment, but the heatmap
    snapshot at `:144` (`slot.set(barData)`) happens immediately after
    the buffer is populated, so this is currently correct. The hazard is
    a future maintainer who adds an `await` inside `draw`. Worth a
    comment that this is **only** safe under the assumption of
    same-tick synchronous use.

25. **Heatmap ring buffer never trims `rows[]`.**
    `SpectrumAnalyzer.tsx:139-143` allocates `rows[nextHead]` on first
    use, then reuses. But `rows` is a sparse array indexed by
    `nextHead = (head + 1) % HEATMAP_TRAIL`. If the analyser only ever
    fills 60 rows of the 120-row capacity (because it draws from a
    `maxTrail = 60` window — `:91`), the ring still wraps to 120
    entries and allocates 120 `Float32Array(NUM_BARS)` over the
    instance's lifetime. Set `HEATMAP_TRAIL` to `maxTrail` or accept
    the 120-entry pool but document it.

26. **Preset bands always carry six full `BacteriaBand` records.**
    `bacteriaPresets.ts:25-29` and every other preset declares
    `bandCount: 1` (or 2/3/4) but supplies six `band({...})`/`...DEFAULT_BAND`
    entries. Reasonable for shape-stability but combined with finding
    #10 (`loadBacteriaPatchWithAudio` always iterates all six),
    each preset switch posts ~250 messages to the worklet
    (≈ 36 globals + 6 × ~50 band fields), most of which are duplicates
    of the previous patch. There is no diffing.

27. **`encodePatchValue` returns `null` for unknown string keys, the
    bridge silently drops them.** `helpers.ts:60-94` returns `null` for
    any string value not in the five enum maps. That is the right
    safety, but `setBacteriaParamWithAudio` then `return`s with no
    diagnostic (`setBacteriaParamWithAudio.ts:28`). Adding a new string
    field to `BacteriaPatch` (e.g. a future `lfo1ShapeName: string`)
    silently writes to the store and never reaches the engine. A
    `logger.warn` or a typed exhaustiveness check is needed.

28. **`BacteriaState.activeModule` is a free string, not a union.**
    `bacteriaStore.ts:23` types `activeModule: string`. `BacteriaPanel`
    matches against literal strings (`'distortion'`, `'filter'`, …).
    A typo in `setBacteriaActiveModule(deviceId, 'distorsion')` would
    silently land in the catch-all `getModuleMeta` fallback (returning
    EFFECT_MODULES[0]). Should be `BacteriaModuleId =
'distortion' | 'filter' | …`.

29. **Multi-arg helper signatures violate AGENTS.md.**
    AGENTS.md "Function Signatures" mandates a single object parameter
    for functions with more than one arg. Several local functions take
    positional args:
    - `bacteriaStore.ts:45` `setBacteriaParam(deviceId, key, value)` (3 args)
    - `bacteriaStore.ts:55` `setBacteriaBandParam(deviceId, bandIndex, key, value)` (4 args)
    - `bacteriaStore.ts:71, 77, 83, 89, 95` (similar)
    - `helpers.ts:53` `createFlushParam(updateDeviceParamFn, persistDeviceParamFn)` (2 args)
    - `loadBacteriaPatchWithAudio.ts:11-13` `createPushParamImmediately(...)` (2 args)
    - `loadBacteriaPatchWithAudio.ts:15` `pushParamImmediately(ref, key, value)` (3 args)
    - `BacteriaPanel.tsx:142` `setGlobalParam(deviceId, key, value)` (3 args)
    - `BacteriaPanel.tsx:1737` `renderHero(deviceId, state)`, `:1753` `renderDeck(deviceId, state)` (2 args)
    - `CrossoverDisplay.tsx:37, 43` `freqToX(freq, width)`, `xToFreq(x, width)` (2 args each)
    - `NodeGraphEditor.tsx:57` `buildNodes(bandCount, bands, width, height)` (4 args)
    - `WaveshaperEditor.tsx:35, 47, 54` `evalBezier(seg, t)`, `toCanvas(p, w, h)`, `fromCanvas(cx, cy, w, h)`
    
    Strict adherence may not be appropriate for two-scalar geometric
    helpers (`freqToX`), but the bridge / store helpers should comply.

30. **`BacteriaModSourceType` declares `'macro'` but the dock spreads
    macros across four discrete IDs.** `BacteriaPatch.ts:28` types
    `BacteriaModSourceType = 'lfo' | 'envelope-follower' | 'step-seq' |
'lorenz' | 'macro'`. `ModulationDock.tsx:25-28` lists `macro1` …
    `macro4` as separate `MOD_SOURCES` entries — eight macros exist on
    the patch but only four are exposed, and they don't match the
    `'macro'` type. `BacteriaModAssignment.sourceId: string` is a free
    string (`BacteriaPatch.ts:117`), so the contract is unenforced.
    Decide: either eight macro source ids (`macro1`…`macro8`) or a
    single `macro` source with an index, and union-type the `sourceId`.

31. **`countEnabledEffects` is duplicated logic with `EFFECT_KEYS`.**
    `BacteriaPanel.tsx:102-117` lists 10 enable booleans; `BandStrip.tsx:18-28`
    lists 9 indicators (forgets `modulationEnabled`); `NodeGraphEditor.tsx:46-55`
    lists 8 keys (forgets `modulationEnabled`, `phaserEnabled`). Three
    parallel lists of "what counts as an enabled effect", drifting.

32. **`BezierLfoEditor` `DEFAULT_POINTS` includes out-of-bounds control
    handles.** `BezierLfoEditor.tsx:31-32`
    `cp2: { x: 1.05, y: 0.5 }` and `cp1: { x: -0.05, y: 0.5 }` —
    intentional for the cubic to flow naturally past the endpoint, but
    `fromCanvas` (`:51-54`) clamps to `[0, 1]` and the snap-to-grid
    (`:196-203`) only checks `< 0.02` proximity, so the user can never
    drag a control point back to `1.05` after it's clipped. The default
    shape becomes unattainable.

33. **`StepSequencerEditor` allocates `Array(32)` but draws only
    `numSteps`.** `StepSequencerEditor.tsx:26-27`
    `useState<number[]>(initialSteps.length >= numSteps ? initialSteps :
Array.from({ length: 32 }, () => 0))`. If the parent passes
    `numSteps=8` and an empty `steps` array, the state holds 32 zeros
    but only 8 are displayed. The trailing 24 are emitted via
    `onStepsChange(steps)` on pointer-up. Combined with finding #1
    (callback is `() => {}`), no-one notices, but the function is
    silently truthful: it advertises an 8-step sequence and emits 32
    values.

34. **`SpectralBinEditor` "brush" assumes a fixed three-bin window.**
    `SpectralBinEditor.tsx:122-128` only paints offsets `[-1, 0, +1]`
    with a hard-coded 0.3 falloff. No prop for brush size; not adaptive
    to `numBins`. At 64 bins the brush spans 4.7% of the spectrum; at
    128 bins it's 2.3%. Either parametrise or document the assumption.

35. **`BezierLfoEditor.handlePointerUp` does not reset capture.**
    `BezierLfoEditor.tsx:212-217`. Same for `WaveshaperEditor.tsx:212-217`,
    `SpectralBinEditor.tsx:146-151`, `StepSequencerEditor.tsx:128-133`,
    `XYMorphPad.tsx:38-40`. `setPointerCapture` is auto-released by
    the browser on pointerup, so this is technically fine — but the
    pattern leaks if `pointercancel` ever fires (e.g. context menu) and
    the editor is mid-drag. None of these handle `pointercancel`.

36. **The `K` component is defined as a const arrow inside the
    module.** `BacteriaPanel.tsx:150-192`. It's rendered ~80 times. Not
    inherently bad, but: the inline `(onChangeFn ?? ((key, value) =>
setGlobalParam(deviceId, key as keyof BacteriaPatch, value as
never)))` allocates a fresh `((key, value) => …)` arrow on every
    render of every K — nullish-coalesce only short-circuits the lhs,
    not the rhs. With React Compiler this *might* be elided, but the
    rhs reads `deviceId` from closure at every call. Lift the fallback
    to a named, deviceId-aware helper.

37. **`patch.modAssignments` and `patch.snapshots` are not pushed to
    the engine.** `loadBacteriaPatchWithAudio.ts:36-74` never enumerates
    them; `setBacteriaParamWithAudio` cannot encode an array (it returns
    `null`). The two arrays are pure UI state that nevertheless live in
    the persisted patch (`Project` round-trips them via the store). The
    XY morph pad and modulation dock both depend on them. Because of
    finding #1 they are also write-only from the UI side. The data
    flow is: stored on disk → loaded into store → rendered → never
    written back. Confirm this is the design or wire the missing path.

38. **`NodeGraphEditor` builds the graph from `bandCount`, ignoring
    `globalRouting`.** `NodeGraphEditor.tsx:57-145`. The graph always
    draws a serial input → crossover → bands → sum → output. The
    `globalRouting` prop is rendered as a corner label (`:249-258`) but
    does not affect topology. For `parallel`, the bands should
    *bypass* the crossover; for `mid-side`, the diagram should show
    the M/S split. The label-only rendering misleads.

39. **`getPresetCategories()` runs on every render.**
    `BacteriaPanel.tsx:119-122, 283`. Iterates `BACTERIA_PRESETS` (15
    entries) and builds a `Set` to dedupe categories. Cheap, but the
    `BACTERIA_PRESETS` array is a `readonly` constant — categories
    should be a sibling const computed once at module load.

40. **DI bridge file structure violates "one function per file" only
    cosmetically — but flips the convention.** AGENTS.md
    "**One Function Per File:** Every `useCase` and `repository` file
    must export exactly ONE function." `helpers.ts` exports
    `createFlushParam`, `encodePatchValue`, `paramBatcher`, plus four
    enum-like constants and re-exports from `#/utils/createFindDeviceRef`.
    It's not a useCase by name (it's a helper), but the file lives
    under `useCases/bacteriaParamBridge/`. Either move to a per-module
    `services/` folder or split.

41. **`encodePatchValue`'s switch-by-key pattern is brittle.**
    `helpers.ts:73-91` hard-codes five string-typed keys
    (`distortionMode`, `filterMode`, `grainWindow`, `crossoverMode`,
    `globalRouting | routingMode`). Any new string-enum field on the
    patch requires editing this file *and* extending the index map.
    Add a single `STRING_ENUM_MAPS: Partial<Record<keyof BacteriaPatch,
Record<string, number>>>` and look up by key.

42. **Race between meter writes and store writes.** `updateBacteriaMeters`
    runs at 60 Hz from a `requestAnimationFrame` loop in
    `BacteriaNode.onMeterData`. `setBacteriaParam` runs from
    `bacteriaParamBatcher` (also rAF). Both go through
    `bacteriaStore.set(...)`. If a meter tick and a param flush land in
    the same task, the second writer's `instances = bacteriaStore.value
?? {}` reads the first writer's intermediate state — fine for
    sequential JS, but every clone of `instances` reuses the **other
    instances' references**. Two simultaneous Bacteria instances
    interleaving meter and param writes is read-modify-write on a
    shared object map — not racy in JS but allocates 60 × N cloned
    top-level maps per second. See finding #11.

---

## Priorities

1. **Half the Lab and Modulation UI is dead** (issue #1) — every
   custom editor and the modulation dock are wired with `[]` /
   `() => {}`. This is the biggest user-facing failure: drawing a
   shaper curve, a custom LFO, a step pattern, or a bin profile has
   zero effect. Fix the persistence path or remove the editors.
2. **The spectrum analyser is `Math.random()`** (issue #2) — branded
   as a "live read" but disconnected. Wire to the BacteriaNode SAB
   FFT data or label as a placeholder.
3. **`BacteriaPanel` subscribes to all instances + meter writes
   trigger full re-renders** (issues #3, #11) — perf hazard scaling
   with `N_devices × 60 Hz`.
4. **`loadBacteriaPatchWithAudio` drops `lfo1Sync`/`lfo2Sync`** (issue
   #5) — silent correctness bug; preset switches leave the engine in
   stale sync state.
5. **`setBacteriaBandParamWithAudio` writes engine params for
   out-of-range bands** (issue #6) — combined with `activeBand` not
   being clamped on `bandCount` decrease, the engine receives
   `band5_drive` for a 1-band patch.
6. **38 `as never` escapes in `BacteriaPanel.tsx`** (issue #7) —
   AGENTS.md violation; symptomatic of the `K` component's loose
   `onChangeFn` signature.
7. **Test specs assert nothing meaningful** (issue #14) — every spec
   in this module is "renders" or "module loads". DSP behaviour,
   pointer math, and engine push payloads are uncovered.
8. **`BACTERIA_PARAMS` table is dead** (issue #9) — 300 lines of
   metadata duplicated inline with no enforcement of consistency.
9. **No root `index.ts` for the module** (issue #15) — three external
   import paths reaching subfolders; AGENTS.md convention not
   followed.
10. **`BacteriaPanel.tsx` is 1873 LoC** (issue #16) — testability /
    maintainability drag, hard to reason about under change.

---

## Open issues

### 1. Lab editors and ModulationDock are wired with empty data and no-op callbacks

**Problem:** Four custom drawing editors and the drag-and-drop
modulation dock are mounted with `[]` data props and `() => {}` change
handlers. User input is held in component-local `useState`, never
returned to the patch, and discarded on unmount. The UX advertises a
deep editing surface that does not exist.

**Representative files:**

- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:756` (WaveshaperEditor)
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:766` (BezierLfoEditor)
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:782` (StepSequencerEditor)
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:793` (SpectralBinEditor)
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:1499-1502` (ModulationDock)

**Needed:** Either (a) extend `BacteriaPatch` with the missing fields
(`waveshaperSegments: BezierSegment[]`, `lfoCurves: LfoPoint[]`,
`stepSeq: number[]`, `spectralBins: number[]`, full
`modAssignments` write path), persist them, and update the engine
encoder, or (b) remove the editors from the Lab tab until they have a
backing store. The current state of "looks editable but isn't" is
worse than either alternative.

### 2. SpectrumAnalyzer renders `Math.random()`

**Problem:** `SpectrumAnalyzer` advertises a "live read" but
`BacteriaPanel` never wires `fftData`. The component falls into the
simulated-spectrum branch unconditionally.

**Representative files:**

- `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx:127-133`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:430,580,655` (three mount points, no fftData)

**Needed:** Plumb FFT data from `BacteriaNode`'s SAB telemetry (an FFT
slice next to the band-level slots) into `bacteriaStore.fftData[]`,
read it in `BacteriaPanel`, pass it to all three `SpectrumAnalyzer`
instances. Until that lands, the random-data branch should be removed
(empty bars + a "no signal" label) so users do not see fake activity.

### 3. `useStore(bacteriaStore, {})` subscribes to every instance's whole state

**Problem:** `BacteriaPanel.tsx:1770` subscribes to the entire
`Record<deviceId, BacteriaState>`. With N Bacteria devices in the
project, every device's 60 Hz meter tick re-renders every other open
panel.

**Representative files:**

- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:1770`
- `src/modules/Bacteria/stores/bacteriaStore.ts:95-114` (meter write writes new top-level object)

**Needed:** Add a per-deviceId selector primitive (e.g.
`useStoreSelector(bacteriaStore, (m) => m[deviceId])`) backed by
`useSyncExternalStoreWithSelector`, or split meter state into a
separate store keyed differently. Verify with a parent re-render
counter: a meter write on device B should not re-render device A's
panel.

### 4. `loadBacteriaPatchWithAudio` silently omits `lfo1Sync` / `lfo2Sync`

**Problem:** The hand-coded `globalParams` list misses two
boolean fields that exist on `BacteriaPatch` and are reachable via
the encoder. Loading a sync-on patch leaves the engine in whatever
state the previous patch left.

**Representative files:**

- `src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts:60-65`
- `src/modules/Bacteria/models/BacteriaPatch.ts:181-186` (lfo1Sync / lfo2Sync defined)

**Needed:** Replace the parallel string list with a typed iteration
over `BacteriaPatch` keys (e.g. via `(Object.keys(patch) as Array<keyof
BacteriaPatch>)`) with a known exclusion set (`bands`, `name`,
`modAssignments`, `snapshots`). Add a type-level test that the
exclusion set covers all non-audio fields.

### 5. `setBacteriaBandParamWithAudio` writes engine params for out-of-range bands

**Problem:** When `bandIndex >= bands.length`, the store mutation
short-circuits but the engine flush continues. Combined with
`activeBand` not being clamped when `bandCount` decreases (issue #5b),
the engine can receive writes for non-existent bands.

**Representative files:**

- `src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts:26-41`
- `src/modules/Bacteria/stores/bacteriaStore.ts:55-69` (silent return)
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:1459` (only place that clamps activeBand)

**Needed:** Either (a) move the band-bounds check into
`setBacteriaBandParamWithAudio` and return early before the encode +
schedule, or (b) clamp `activeBand` inside `setBacteriaParam` when
`bandCount` decreases, and clamp it inside `loadBacteriaPatch`
(`bacteriaStore.ts:89`). Both fixes together cover preset-load and
direct-edit paths.

### 6. 38 `as never` casts in `BacteriaPanel.tsx`

**Problem:** AGENTS.md "TypeScript — soundness" forbids `as never`,
`as any`, `as unknown as` to silence the type-checker. Every band
knob in `renderShapeControls` uses `setBandParam as never` because
`K`'s `onChangeFn?: (key: string, value: number) => void` cannot
satisfy `setBacteriaBandParamWithAudio`'s key-generic.

**Representative files:**

- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:177` (global fallback)
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:875-1382` (37 `setBandParam as never` instances)
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:457,607,682` (`freq as never`)

**Needed:** Either parameterise `K` over a key set
(`<TKey extends string>`), or split into `KGlobal<K extends keyof
BacteriaPatch>` and `KBand<K extends keyof BacteriaPatch['bands'][0]>`
with typed `onChange` props. Run `pnpm typecheck` after to confirm
all sites compile without escapes.

### 7. `BacteriaPanel.tsx` is 1873 lines

**Problem:** A single file containing five hero views, five deck
views, an 889-LoC `renderShapeControls`, eleven inline-defined
sub-components, and the preset rail. Untestable in isolation; the
`BacteriaPanel.spec.tsx` punts to `document.body.toBeTruthy()`.

**Representative files:**

- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx` (whole file)
- `src/modules/Bacteria/presentations/views/__tests__/BacteriaPanel.spec.tsx` (4 tests, all `expect(document.body).toBeTruthy()`)

**Needed:** Split into one file per hero/deck pair under
`presentations/components/levels/PlayLevel.tsx`,
`ShapeLevel.tsx`, `BuildLevel.tsx`, `RouteLevel.tsx`, `LabLevel.tsx`,
plus shared atoms (`K.tsx`, `BChip.tsx`, `BandMeters.tsx`,
`PresetRail.tsx`, `MetricCell.tsx`, `SectionHeader.tsx`). Each gets
its own real spec.

### 8. `BACTERIA_PARAMS` is dead

**Problem:** A 300-line metadata table on `BacteriaPatch.ts:356-671`
is referenced nowhere outside its own file. `BacteriaPanel` hard-codes
the same ranges/steps inline 38 times. Any drift between the two is
silent.

**Representative files:**

- `src/modules/Bacteria/models/BacteriaPatch.ts:356-671`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx` (every `<K min=… max=… step=… def=… unit="…" />`)

**Needed:** Either (a) consume the table — `K` looks up
`BACTERIA_PARAMS.find((p) => p.id === k)` and reads `min/max/step/def/unit`
— or (b) delete the table. Option (a) reduces the per-knob clutter
in `BacteriaPanel`; option (b) is honest about where the truth lives.
Pick one.

### 9. Test specs do not assert behaviour

**Problem:** Every component spec is 11–22 LoC asserting only that a
`<canvas>` / `<svg>` exists or a label renders. The `bacteriaParamBridge`
specs explicitly waive coverage with a comment about "integration tests
elsewhere"; no such tests exist.

**Representative files:**

- `src/modules/Bacteria/presentations/components/__tests__/*.spec.tsx` (10 files)
- `src/modules/Bacteria/presentations/views/__tests__/BacteriaPanel.spec.tsx`
- `src/modules/Bacteria/useCases/__tests__/bacteriaParamBridge.spec.ts:1-9` (waive coverage)
- `src/modules/Bacteria/useCases/bacteriaParamBridge/__tests__/{loadBacteriaPatchWithAudio,setBacteriaParamWithAudio,setBacteriaBandParamWithAudio}.spec.ts` (each: "should load the module")
- `src/modules/Bacteria/useCases/bacteriaParamBridge/__tests__/helpers.spec.ts:8-9,13-15` (`t === 'function' || t === 'object'` non-assertion)

**Needed:** For the bridge specs: stub
`bacteriaParamBridgeDependencies` (use the `inject` reset path), call
the function, assert the encoded value posted to `updateDeviceParam`
and `persistDeviceParam`. For component specs: assert the rendered
DOM matches the input — e.g. CrossoverDisplay shows two bands of the
right colour, drag a handle 10 px and assert `onCrossoverChange` is
called with the expected frequency. For BacteriaPanel: split first
(issue #7), then test each level component with a real
`bacteriaStore` instance.

### 10. No root `index.ts` for the module

**Problem:** External consumers reach in via subpaths
(`#/modules/Bacteria/stores`, `#/modules/Bacteria/presentations/views`)
because the module has no root barrel. AGENTS.md treats the root
`index.ts` as the sole cross-module public surface; the convention
is silently broken.

**Representative files:**

- `src/modules/Bacteria/` (no `index.ts`)
- `src/modules/Workspace/presentations/views/AppShell.tsx:19`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:12`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:3`

**Needed:** Add `src/modules/Bacteria/index.ts` re-exporting
`bacteriaStore`, `updateBacteriaMeters` from `./stores`, and
`BacteriaPanel` from `./presentations/views`. Update the three external
import sites. Verify with `pnpm deps:validate`.

### 11. Module-level `paramBatcher` shared across all instances

**Problem:** `helpers.ts:14` is one `RafBatcher` for all Bacteria
devices. There is no way to tear down a single instance's pending
flushes when a Bacteria device is removed; stale rAFs run, perform
`findDeviceRef` lookups that return null, and silently drop. Also
combined with finding #4: the module-level singleton survives HMR
unless the page reloads.

**Representative files:**

- `src/modules/Bacteria/useCases/bacteriaParamBridge/helpers.ts:11-14`
- `src/utils/DOM/createRafBatcher.ts:46-96`

**Needed:** Either (a) instantiate a `paramBatcher` per Bacteria device
inside `setBacteriaParamWithAudio`'s closure (requires changing
`inject` factory to be deviceId-scoped), or (b) keep the singleton but
add a `cancel(deviceId)` helper that drops all entries with key prefix
`${deviceId}:`. Wire to the device's `destroy()` path in
`wasmDeviceRegistry.ts`.

### 12. Multi-instance store writes clone the whole `instances` map

**Problem:** Every `setBacteriaParam` / `setBacteriaBandParam` /
`updateBacteriaMeters` call does `bacteriaStore.set({ ...instances,
[deviceId]: ... })`. At 60 Hz × N instances, that's N×60 fresh
top-level maps per second.

**Representative files:**

- `src/modules/Bacteria/stores/bacteriaStore.ts:45-114`

**Needed:** Replace the flat `Record<deviceId, BacteriaState>` with
per-instance sub-stores keyed in a `Map<deviceId, Store<BacteriaState>>`
(or use `useSyncExternalStoreWithSelector` from React, scoped to
`m[deviceId]`). Either way, mutations on instance A should not
notify subscribers of instance B.

### 13. `WaveshaperEditor` redraws on every render (no dep array)

**Problem:** `useEffect(() => { drawCurve(); })` with no dep array.
Sister editors fixed this with explicit deps + `eslint-disable`.

**Representative files:**

- `src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx:164-166`

**Needed:** `useEffect(() => { drawCurve(); }, [segments, width,
height])` (with the same eslint-disable for the
exhaustive-deps lint as the sibling editors use). Or extract `drawCurve`
to a pure function and pass deps to a stable wrapper.

### 14. Controlled-component handshake broken in four "draw" editors

**Problem:** `WaveshaperEditor`, `BezierLfoEditor`, `SpectralBinEditor`,
`StepSequencerEditor` initialise `useState` from a prop **once** and
never re-sync. If the parent ever changes the prop after mount (e.g.
preset load), the editor displays stale state.

**Representative files:**

- `src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx:68-70`
- `src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx:43`
- `src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx:27-29`
- `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx:25-27`

**Needed:** Either (a) make the editors fully controlled (no local
state; the parent owns it), or (b) sync local state to props with a
`useEffect` that resets on prop identity change. Choice depends on
the persistence path landing (issue #1) — once `BacteriaPatch` carries
the data, fully controlled is the right answer.

### 15. `setBacteriaBandParamWithAudio` schedules engine writes for non-existent bands

(See also issue #5.)

**Problem:** `setBacteriaBandParam` returns early on out-of-range
`bandIndex`; `setBacteriaBandParamWithAudio` does not, and the engine
receives `band5_drive=…` for 1-band patches.

**Representative files:**

- `src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts:20-41`

**Needed:** Add a bounds check at the top of the use case — read
`getBacteriaState(deviceId).patch.bandCount` (or accept `bandCount` as
a parameter) and early-return when `bandIndex >= bandCount`.

### 16. `BacteriaState.activeModule: string` is unconstrained

**Problem:** `bacteriaStore.ts:23` types `activeModule: string`. A
typo silently lands in the catch-all `EFFECT_MODULES[0]` fallback.

**Representative files:**

- `src/modules/Bacteria/stores/bacteriaStore.ts:23`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:44-54,133-140`

**Needed:** Define `type BacteriaModuleId = 'distortion' | 'filter' |
'chorus' | 'phaser' | 'granular' | 'spectral' | 'freqShift' | 'lofi' |
'convolution'` and use it on `activeModule` and the `EFFECT_MODULES`
const. Same shape for `BacteriaUiLevel` (already typed).

### 17. `BacteriaModSourceType` ↔ `MOD_SOURCES` mismatch

**Problem:** `BacteriaPatch.ts:28` declares a single `'macro'` source
type but `ModulationDock.tsx:25-28` exposes four discrete `macro1`…
`macro4` ids; `BacteriaPatch` carries eight macros (`macro1`..`macro8`).
`BacteriaModAssignment.sourceId: string` is a free string, so nothing
type-checks the contract.

**Representative files:**

- `src/modules/Bacteria/models/BacteriaPatch.ts:28,116-121`
- `src/modules/Bacteria/presentations/components/ModulationDock.tsx:19-29`

**Needed:** Decide either (a) eight discrete macro source ids in
`BacteriaModSourceType` (`macro1` … `macro8`) and expose all eight in
the dock, or (b) one `'macro'` source with a `macroIndex: 1..8` field
on the assignment. Type the `sourceId` field accordingly.

### 18. `xToFreq` snaps every drag to nearest 1 Hz

**Problem:** `Math.round(10 ** log)` quantises crossover handles to
1 Hz everywhere on the log axis; at 20 Hz this is wasteful, at
20 kHz it is below the visual feedback threshold. Users will feel the
high end as "stuck".

**Representative files:**

- `src/modules/Bacteria/presentations/components/CrossoverDisplay.tsx:43-48`

**Needed:** Snap to a fixed cents grid (e.g. 5 cents) or to the
nearest 0.1% of the dragged x position. Verify by dragging at 50 Hz
and 15 kHz — expected: smooth motion at both.

### 19. `setPointerCapture` on `e.target` is fragile

**Problem:** Six pointer-driven editors capture on `e.target`, which
may be a child element that re-renders or unmounts mid-gesture. Use
`e.currentTarget` (the canvas/div with the handler).

**Representative files:**

- `src/modules/Bacteria/presentations/components/XYMorphPad.tsx:27`
- `src/modules/Bacteria/presentations/components/CrossoverDisplay.tsx:66`
- `src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx:184`
- `src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx:178`
- `src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx:135`
- `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx:117`

**Needed:** Replace `e.target` with `e.currentTarget` everywhere.
Add a `pointercancel` handler to all six that releases capture and
calls the same logic as pointerup.

### 20. `CrossoverDisplay` uses `containerRef.current?.clientWidth ?? 800` in render

**Problem:** Falls back to 800 px on first render (ref is null);
no `ResizeObserver` to update when container size changes. Layout
"sticks" at 800 until something forces a re-render.

**Representative files:**

- `src/modules/Bacteria/presentations/components/CrossoverDisplay.tsx:123,139,168`

**Needed:** Either (a) take `width` as a prop like the canvas
components, or (b) attach a `ResizeObserver` and store the width in
component state. (a) is simpler and matches sibling components
(`SpectrumAnalyzer`, `NodeGraphEditor`).

### 21. `NodeGraphEditor.onRoutingChange` advertised but never invoked

**Problem:** Optional prop suggests interactivity that does not
exist; the component is read-only.

**Representative files:**

- `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx:34,147-258`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:728-741`

**Needed:** Either wire the band nodes' `onClick` to call
`onRoutingChange` (cycling through routing modes) or drop the prop.
Also pass through `onBandSelect` for parity with `CrossoverDisplay`.

### 22. `NodeGraphEditor` topology ignores `globalRouting`

**Problem:** The graph always renders serial input → crossover →
bands → sum → output regardless of `globalRouting`. The mode is
written as a corner label, which misleads.

**Representative files:**

- `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx:57-145`

**Needed:** Branch `buildNodes` on `globalRouting`: for `'parallel'`,
draw input→bands without a crossover node; for `'mid-side'`, draw the
M/S split before the bands. Add tests for each topology.

### 23. Three drifted "list of effect enable booleans"

**Problem:** `BacteriaPanel.tsx` lists 10 enables; `BandStrip.tsx`
lists 9 (forgets `modulationEnabled`); `NodeGraphEditor.tsx` lists 8
(forgets `modulationEnabled`, `phaserEnabled`). Three parallel,
drifting lists.

**Representative files:**

- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:102-117`
- `src/modules/Bacteria/presentations/components/BandStrip.tsx:18-28`
- `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx:46-55`

**Needed:** Define one `BAND_EFFECT_KEYS` const in
`models/BacteriaPatch.ts` (or a sibling) with a literal-typed key
list and metadata (`label`, `color`). Re-use it in all three call
sites.

### 24. `loadBacteriaPatchWithAudio` always pushes 6 bands of params

**Problem:** Iterates `patch.bands.entries()` (always 6) regardless
of `bandCount`, posting `band5_*` writes for inactive bands. Combined
with no diff against the previous patch, every preset switch posts
~250 messages.

**Representative files:**

- `src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts:83-147`
- `src/modules/Bacteria/useCases/bacteriaPresets.ts:21-240` (every preset declares 6 bands)

**Needed:** Slice to `patch.bands.slice(0, patch.bandCount)`. Also
diff against the current store state — only post params that differ.
For preset switches the diff is small (most fields match
`DEFAULT_BAND`).

### 25. `encodePatchValue` silently drops unknown string values

**Problem:** Returns `null` for any string value not in the five enum
maps; the bridge `return`s with no log. New string fields silently
fail to reach the engine.

**Representative files:**

- `src/modules/Bacteria/useCases/bacteriaParamBridge/helpers.ts:60-94`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaParamWithAudio.ts:27-30`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio.ts:29-32`

**Needed:** Either log a warning (via `appLogger`) on the `null` path,
or — better — replace the string-key dispatch with a typed lookup:
`STRING_ENUM_MAPS: Partial<Record<keyof BacteriaPatch | keyof
BacteriaBand, Record<string, number>>>`. Exhaustiveness then
guards new fields.

### 26. Function signatures take positional args (AGENTS.md violation)

**Problem:** AGENTS.md requires single-object params for functions
with more than one argument. Several local functions take positional
args.

**Representative files:**

- `src/modules/Bacteria/stores/bacteriaStore.ts:45,55,71,77,83,89,95`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/helpers.ts:53`
- `src/modules/Bacteria/useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio.ts:11,15`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx:142,1737,1753`
- `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx:57`

**Needed:** Refactor each to take a single object param named
`<FunctionName>Input`. Likely cosmetic in this batch (no public API
change), but keeps drift at zero.

### 27. `BezierLfoEditor` `DEFAULT_POINTS` includes unreachable control handles

**Problem:** Default control points at `x: -0.05` and `x: 1.05` for
the cubic basis to flow naturally past the endpoint, but `fromCanvas`
clamps to `[0, 1]`. Once the user touches the curve, those handles
collapse to the edge and cannot be re-positioned.

**Representative files:**

- `src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx:31-32,51-54`

**Needed:** Either widen the clamp range to e.g. `[-0.2, 1.2]` for
control handles only (anchor positions stay clamped to `[0, 1]`), or
choose a default shape whose control handles fit inside the canvas.

### 28. `StepSequencerEditor` allocates 32 steps but renders `numSteps`

**Problem:** State is always 32 entries even when `numSteps=8`. The
overflow gets emitted via `onStepsChange`. The pattern is "lazy" —
the editor returns 32 values when only 8 were requested.

**Representative files:**

- `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx:25-27,131`

**Needed:** Allocate `Array.from({ length: numSteps }, () => 0)` —
match the prop. Sync state to `numSteps` changes via `useEffect`.

### 29. No accessibility for canvas/SVG editors and the morph pad

**Problem:** Five canvas editors and one SVG node graph have no
`role`, no `aria-label`, no keyboard alternative. The XY morph pad
is pointer-only. The chip-style toggles (`BChip`) have no
`aria-pressed`.

**Representative files:**

- `src/modules/Bacteria/presentations/components/WaveshaperEditor.tsx:221-228`
- `src/modules/Bacteria/presentations/components/BezierLfoEditor.tsx:222-229`
- `src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx:155-163`
- `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx:138-145`
- `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx:198`
- `src/modules/Bacteria/presentations/components/XYMorphPad.tsx:55-67`
- `src/modules/Bacteria/presentations/components/NodeGraphEditor.tsx:160-260`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx` (every `<BChip>` rendering — no `aria-pressed`)

**Needed:** Add `role="img"` + `aria-label` to canvases used as
visualisations; for editable canvases, expose a parallel keyboard
control (e.g. Tab through control points, arrow keys to move). Add
`aria-pressed={active}` to `BChip` (it already accepts a generic
`...props`). Verify against the project's existing component
conventions in `#/components/daw/`.

### 30. `BACTERIA_PARAMS` table is unused

**Problem:** 300 lines of metadata referenced nowhere; `BacteriaPanel`
hard-codes ranges/defaults inline 38 times. Drift is unchecked.

**Representative files:**

- `src/modules/Bacteria/models/BacteriaPatch.ts:344-671`
- `src/modules/Bacteria/presentations/views/BacteriaPanel.tsx` (every `<K>` invocation)

**Needed:** See issue #8 — pick consume-or-delete. If consuming, also
add a runtime check that `DEFAULT_PATCH[id]` matches `default` for
every entry.

### 31. `BacteriaPanel.spec.tsx` renders `<BacteriaPanel />` without `deviceId`

**Problem:** TypeScript should reject the omission; the spec passes
because `useStore` is mocked. The test exercises nothing but a render
that happens not to crash.

**Representative files:**

- `src/modules/Bacteria/presentations/views/__tests__/BacteriaPanel.spec.tsx:16,21,26,31`

**Needed:** Pass an explicit `deviceId="test-device"` and seed
`bacteriaStore.set({ 'test-device': DEFAULT_BACTERIA_STATE })` in
`beforeEach`. Replace each `expect(document.body).toBeTruthy()` with
an actual assertion (e.g. preset rail shows 15 entries; clicking
`Build` chip writes `uiLevel: 3` to the store).

### 32. Empty `events/` and `useCases/` `index.ts`

**Problem:** Both root-level barrels declare emptiness in a comment
("`// no public events`", "`// no public use cases`") but the files
exist. Combined with no module root `index.ts` (issue #10), the
module's public-API discipline is incoherent: external use cases are
imported directly (`#/modules/Bacteria/useCases/bacteriaParamBridge/setBacteriaParamWithAudio.ts`)
from inside the module (the panel does this — fine, AGENTS.md
allows relative imports inside the same module) but no other module
imports them.

**Representative files:**

- `src/modules/Bacteria/events/index.ts:1`
- `src/modules/Bacteria/useCases/index.ts:1`

**Needed:** Either flesh out the barrels with what an external module
*could* need (the `…WithAudio` family, if any project-export path
should call them outside Bacteria), or delete them. The panel already
imports the use cases via relative paths, so the public surface is
genuinely just `bacteriaStore` + `BacteriaPanel`.

---

## Open questions

- [ ] Are the Lab editors and ModulationDock placeholder (waiting on
      the engine surface to grow) or stubbed (cut from scope)? Affects
      whether issue #1 is "wire the editors" or "remove them".
- [ ] Is `SpectrumAnalyzer.fftData` meant to be SAB-fed (like the
      band-level meters) or post-message? `BacteriaNode` does not
      currently expose an FFT slice. Affects issue #2 sizing.
- [ ] Does the project really expect users to run multiple Bacteria
      instances simultaneously? If yes, issues #3, #4, #11, #12 all
      escalate; if not, the per-instance fan-out is acceptable.
- [ ] Should `bandCount` decrease nullify the truncated band's effect
      flags, or preserve them in case the user re-grows? Affects
      issue #24's diff strategy.
- [ ] Is the XY morph pad's bilinear interpolation actually wired to
      mutate other parameters via `morphX`/`morphY`? The patch stores
      both and `snapshots[]` is on disk, but no use case reads them.
- [ ] Is `notifyUser` aria-live in this app? Cross-reference with the
      `Notification` module audit (same question as in
      `AudioAnalysis.md`).

---

## Risks

- **User-facing trust gap.** Issues #1, #2, #21, #22 advertise
  capabilities that do not exist (drawable curves, live spectrum,
  interactive routing graph). A user who saves a patch with a
  hand-drawn LFO will discover on reload that the curve is gone — the
  failure mode is "your work disappeared", which is the worst possible
  UX class.
- **Silent correctness drift.** Issues #4 (lfo*Sync), #15 (out-of-range
  band writes), #24 (extra band writes), #25 (unknown string keys
  silently dropped) all share the failure mode: "everything looks
  fine until you discover the engine state diverges from the patch."
  Tests cannot catch this because tests assert nothing meaningful
  (issue #9).
- **Scaling cost.** Issues #3, #11, #12 are linear in the number of
  Bacteria instances. The current N=1 behaviour masks them; opening
  a second Bacteria device will compound them.
- **AGENTS.md drift.** Issues #6 (38 `as never`), #7 (1873-LoC
  monolith), #10 (no root `index.ts`), #26 (positional args), #29
  (a11y) accumulate small violations in a module that is otherwise
  one of the more recently written. Other modules will reference
  these patterns as precedent.
- **Refactor blast radius.** A future engine-side rename (e.g.
  `chorusFeedback` → `chorusRegen`) requires editing four parallel
  string lists: the patch type, the encoder maps, the
  `loadBacteriaPatchWithAudio` global/band lists, and every
  hard-coded `<K k="chorusFeedback" />`. Issue #8 (consume
  `BACTERIA_PARAMS`) and #25 (typed encoder) collapse this to one
  source of truth.

---

## Suggested approaches

- **Decide on the Lab/Modulation surface first** (issue #1). The
  patch type is the single biggest decision: do we extend it
  (`waveshaperSegments`, `lfoCurves`, `stepSeq`, `spectralBins`,
  `modAssignments` write path) or shrink the UI? Everything
  downstream (issues #5, #14, #24, #25) depends on which way this
  goes.
- **Land the test fixes second** (issue #9). Write real specs for
  the bridge use cases first — they are the most concentrated
  source of correctness risk and the easiest to test in isolation.
  Use them to drive the fixes for #4, #5, #15.
- **Split `BacteriaPanel` and consume `BACTERIA_PARAMS`** (issues
  #7, #8). Once `K` reads its range/step from the param table, the
  per-knob inline configuration shrinks dramatically and the file
  splits naturally along level boundaries.
- **Replace the encoder dispatch with a typed map** (issue #25).
  `STRING_ENUM_MAPS: Partial<Record<keyof BacteriaPatch, Record<string,
number>>>`. Drives out the silent-drop branch and gives the
  encoder a single place to grow when new enum fields appear.
- **Per-instance store + selector subscription** (issues #3, #12).
  Either nest stores or use `useSyncExternalStoreWithSelector`. Verify
  with a render-counter test in `BacteriaPanel.spec.tsx` (after issue
  #7's split).
- **Add module root `index.ts`** (issue #10). Mechanical; do
  alongside the split.

---

## Recommendation

Start with **issue #9 (real bridge tests)**. Before touching anything,
write specs that assert: `setBacteriaParamWithAudio('d1', 'mix', 0.5)`
posts to `updateDeviceParam` with `('track-1', 'd1', 'mix', 0.5)`;
`setBacteriaBandParamWithAudio('d1', 0, 'drive', 50)` posts as
`band0_drive=50`; `loadBacteriaPatchWithAudio('d1', presetX)` posts
exactly N (not 6 × bands) per-band messages. These specs are independent
of every UI question and will catch the regressions for #4, #5, #15,
#24, #25 as they land.

Then tackle **issue #1 (Lab and Modulation persistence)** because it
is the largest user-facing failure and dictates the patch-type
decisions for everything else. Whatever direction that takes (extend
the patch or trim the UI) sets up the work on #2, #14, #21, #22.

The architecture cleanups (#7, #8, #10, #26) and a11y (#29) can
follow as a coordinated sweep once the data model stabilises.

---

## Resolved

_No issues resolved yet._
