# Gluten module audit

## Scope

This audit covers `src/modules/Gluten/` in full — all stores, models, use
cases, presentations, and their tests. It explicitly excludes the
upstream Rust/WASM `daw-gluten` engine, the `GlutenNode`-side worklet
plumbing in `AudioEngine/engine/GlutenNode.ts`, and the cross-module
descriptor registration in `wasmDeviceRegistry.ts` — those are noted
where they directly bear on what this module must guarantee.

It is an adversarial review: contract violations, type-soundness escapes,
React/store anti-patterns, audio-control sequencing hazards, accessibility
gaps, and DSP UI honesty (transfer-curve drawing, interactive drag
contracts, meter scales).

Related spec: none on disk.

---

## Goal

A correctness-first compressor surface for the DAW:

- A single source of truth (`glutenStore`) keyed by `deviceId`, mutated
  only through documented mutators that produce minimal diffs and avoid
  re-rendering every panel on every meter tick.
- A param bridge (`useCases/glutenParamBridge/*`) that rAF-debounces user
  drags into a single per-key flush per frame, never silently drops
  encoded values, and validates the patch contract end-to-end.
- A presentation layer that draws the actual DSP behaviour: the static
  curve matches the underlying Rust `daw-gluten` knee/ratio math, the
  dragging surface honours the props it advertises, and meters honour
  ARIA contracts.
- A patch model that is a discriminated union by topology (FET/Opto/
  Diode/VCA fields are mutually exclusive in real hardware) — not a flat
  bag with optional fields and zero validation.
- Tests that exercise the actual production import paths, assert
  behaviour (rAF coalescing, payload encoding, transfer-curve numerics),
  and never collapse to "renders without crashing".
- AGENTS.md hard rules: no `any`/`as never`/`as unknown as`, no `useMemo`/
  `useCallback`/`React.memo`, no namespace imports, no cross-module
  imports of internals; presentation imports go through the destination
  module's root `index.ts`; one function per `useCases/` file.

---

## Relevant code paths

- `src/modules/Gluten/models/GlutenPatch.ts`
- `src/modules/Gluten/stores/glutenStore.ts`
- `src/modules/Gluten/stores/index.ts`
- `src/modules/Gluten/events/index.ts` (placeholder)
- `src/modules/Gluten/useCases/index.ts` (placeholder)
- `src/modules/Gluten/useCases/glutenPresets.ts`
- `src/modules/Gluten/useCases/glutenParamBridge/helpers.ts`
- `src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts`
- `src/modules/Gluten/useCases/glutenParamBridge/setGlutenParamWithAudio.ts`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx`
- `src/modules/Gluten/presentations/views/index.ts`
- `src/modules/Gluten/presentations/components/GlutenCurve.tsx`
- `src/modules/Gluten/presentations/components/GrHistory.tsx`
- `src/modules/Gluten/presentations/components/GrMeter.tsx`
- `src/modules/Gluten/**/__tests__/*`

External touch points (out of scope but referenced):

- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:14,319` (calls
  `updateGlutenMeters`)
- `src/modules/Workspace/presentations/views/AppShell.tsx:24,469` (calls
  `<GlutenPanel deviceId={glutenDeviceId} />` from
  `#/modules/Gluten/presentations/views`)
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:6`
  (reaches into `#/modules/Gluten/stores`)

---

## Current behavior

**Store.** `glutenStore` is a `createStore<Record<string, GlutenState>>`
keyed by `deviceId`. The state object packs both the `patch`
(parameters) and meter telemetry (`grDb`, `inputDb`, `outputDb`,
`crest`, `phaseCorr`, `latency`) into a single value. Every mutator
clones the entire instances map, every patch mutator clones the
top-level map and the per-device state and the per-device patch
(`stores/glutenStore.ts:39-85`).

`updateGlutenMeters` is invoked from the audio worklet meter callback
(`AudioEngine/engine/wasmDeviceRegistry.ts:319`) — at the worklet's
internal cadence (typically ~60 Hz once the panel UI is open). Each call
rebuilds the top-level instances map, the per-device state, and writes
to the store, which fans out to every `useStore(glutenStore, …)`
subscriber.

**Patch model.** `GlutenPatch` is a flat type with 43 fields, including
mutually exclusive topology-specific blocks (FET-only `inputGain`,
`outputGain`, `xfmrDrive`, `allButtons`, `jfetK3`, `xfmrK2`; Opto-only
`limitMode`; Diode-only `recovery`; VCA-only `vcaType`, `vcaCharacter`,
`feedForward`). All fields live side-by-side; the type does not
discriminate on `topology`. Two registries describe the parameter
surface in different shapes:

- `GLUTEN_PARAMS` (`models/GlutenPatch.ts:137-221`) — table for UI
  binding (id/label/min/max/default/unit/scaling). Not used by anything
  in the Gluten module today.
- `GlutenPanel` (`presentations/views/GlutenPanel.tsx:642-1014`) —
  hardcoded `<Knob>` rows that re-state min/max/default/step inline.

These two are not enforced to agree.

**Param bridge.** `setGlutenParamWithAudio` writes to the store
synchronously and then schedules a rAF-debounced flush (one frame per
key) through a shared `RafBatcher` to (a) `updateDeviceParam` (the
AudioEngine use case that pokes the worklet) and (b)
`persistDeviceParam` (the Arrangement store that records the value for
project save). `loadGlutenPatchWithAudio` writes the full patch to the
store and then immediately flushes 43 params via `pushParamImmediately`
(no batching, no rAF — direct writes for every key in the patch).

`encodeGlutenValue` maps strings (`topology`, `style`, `detection`,
`stereoMode`) to fixed integer indices. `vcaType`, `oversampling`,
`thrust`, `recovery` flow through the bridge as raw numbers.
`GlutenPatch.lookahead` and `range` are direct numbers. Booleans
become 0/1.

**Presentation.** `GlutenPanel` is a 1136-line component that subscribes
to the **entire** instances map (`useStore(glutenStore,
defaultGlutenInstances)`) and pulls its slice with
`allInstances[deviceId] ?? getGlutenState(deviceId)`. It re-derives
filtered presets, topology metadata, accent colours, and dozens of
callbacks on every render.

`GlutenCurve` draws the static transfer curve with a soft-knee formula
(`computeOutput`, `presentations/components/GlutenCurve.tsx:22-35`) and
an "operating point" overlay at the live `inputDb`. It claims to be
draggable (`onThresholdChange`, `onRatioChange` props) but only
threshold dragging is wired; ratio dragging is dead.

`GrMeter` and `GrHistory` are canvas components that re-allocate the
DPR-scaled backing store on every render, mutate ref-stored peak-hold
state from inside `useEffect`, and rely on a circular buffer
(`HISTORY_LENGTH = 256`) keyed by an unbounded `posRef.current++`.

**Tests.** Every public file has at least one spec. Most assert
"renders without crashing" / "exports the function". Several use
`as never` to satisfy types in mock fixtures. None exercise the
transfer-curve numerics, the rAF coalescing under multiple updates, or
the `loadGlutenPatchWithAudio` 43-param fan-out.

---

## Findings

1. **No module root `index.ts`.** AGENTS.md: "Cross-module imports MUST
   only target the destination module's root `index.ts`". The Gluten
   module has no `src/modules/Gluten/index.ts`. External callers reach
   into private subpaths (`#/modules/Gluten/stores`,
   `#/modules/Gluten/presentations/views`) by necessity. There is no
   curated public surface; every consumer can import any internal file.
   Run: `find /Users/josecosta/dev/webdaw/src/modules/Gluten -maxdepth 1
-type f` returns nothing.

2. **External callers reach into `stores/` and `presentations/views/`
   directly.** Three sites do this:
    - `Workspace/presentations/views/AppShell.tsx:24` →
      `#/modules/Gluten/presentations/views` (the `views/index.ts`
      barrel is _not_ the module's root `index.ts`).
    - `AudioEngine/engine/wasmDeviceRegistry.ts:14` →
      `#/modules/Gluten/stores`.
    - `Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:6`
      → `#/modules/Gluten/stores`.

   None of these go through a Gluten root barrel because there isn't
   one. The Bacteria/Grinder/Proof modules in the same registry follow
   the same pattern, so this is a project-wide drift, but Gluten
   inherits the violation.

3. **`useCases/index.ts` exports nothing.** The file contains only the
   comment `// no public use cases`. Yet `setGlutenParamWithAudio`,
   `loadGlutenPatchWithAudio`, and `GLUTEN_PRESETS` are obviously
   cross-module-relevant: they are imported from `presentations/views/`
   inside the module via deep relative paths. AGENTS.md says use cases
   are the canonical cross-module surface for runtime values. Either
   these belong in the barrel and `presentations/views/GlutenPanel.tsx`
   should import them from `index.ts`, or they should be moved to
   `presentations/hooks/` (which is module-private). As-is the file
   either misrepresents its purpose or the use cases are misfiled.

4. **`glutenStore` packs UI state, patch state, and meter telemetry into
   one value.** Every meter tick (`updateGlutenMeters`) clones the
   top-level instances map and the per-device state. Every panel that
   subscribes via `useStore(glutenStore, …)` re-renders on every meter
   tick — not just the meters, the entire `GlutenPanel` (which reads
   `state.patch` and re-derives every knob's bound state). This is the
   well-known "store-your-RAF" anti-pattern: 60 Hz meter updates wake
   the entire 1136-line tree, even though only `GrMeter`, `GrHistory`,
   and the metric strip actually need them. Representative path:
   `stores/glutenStore.ts:70-85` → `presentations/views/GlutenPanel.tsx:316`.

5. **`useStore(glutenStore, defaultGlutenInstances)` subscribes to
   _all_ Gluten instances.** `GlutenPanel.tsx:316`. If two panels are
   open (deviceId A and B), each subscribes to the full instances map;
   meter updates for A re-render B. The selector should be `state =>
state[deviceId]`, not the whole bag. The fallback object
   `defaultGlutenInstances` is module-scoped (not per-call) — that part
   is correct — but the selector breadth is the issue.

6. **`GlutenPanel` lacks the `deviceId` default in its test render.**
   `presentations/views/__tests__/GlutenPanel.spec.tsx:16` calls
   `<GlutenPanel />` with no `deviceId` prop. The component requires
   `{ deviceId: string }` (`GlutenPanel.tsx:315`). The test passes only
   because (a) the `useStore` mock returns the empty default and
   `getGlutenState(undefined as string)` happens to return defaults,
   and (b) `getGlutenState(undefined as string)` is silently coerced
   when `instances[undefined]` evaluates. TypeScript would have
   complained — the test renders `<GlutenPanel />` with no prop. This
   spec compiles only because vitest runs it through vite (no strict
   build). The four "tests" are all functionally identical and assert
   `document.body` truthiness — they exercise no real behaviour. Lazy
   testing per AGENTS.md "tests assert the actual contract".

7. **`createCompactFloatBuffer` test override pattern in
   `GrHistory`.** `presentations/components/GrHistory.tsx:24` uses
   `useRef<Float32Array>(createCompactFloatBuffer({ length: 256 }))` —
   but `useRef`'s initialiser fires on _every_ render, not just the
   first. The result is recomputed on every render and discarded — the
   ref keeps the first allocation, but the function is called
   needlessly each pass. This is a documented React footgun. Use
   `useRef<Float32Array | null>(null)` and lazy-init in `useEffect`,
   or move the buffer outside the component.

8. **`GrHistory.posRef.current++` overflows.**
   `GrHistory.tsx:30`. `posRef` is incremented every render; with a
   60 Hz update cadence over a 4-hour session that is
   ~864 000 ticks — well within `Number.MAX_SAFE_INTEGER` so not a
   bug today. The compounding `(pos - HISTORY_LENGTH + i +
HISTORY_LENGTH * 2) % HISTORY_LENGTH` index expression at line 84/98
   is harder to follow than `(pos + i) % HISTORY_LENGTH`, given that
   `pos` is monotonically growing — there is no negative-pos case to
   defend against.

9. **`GlutenCurve.onRatioChange` is dead.**
   `presentations/components/GlutenCurve.tsx:14,224-264`. The component
   advertises `onRatioChange` in props, accepts it, and does nothing
   with it. `handlePointerDown` always sets `isDragging.current =
'threshold'` regardless of where the pointer landed; there is no
   detection of ratio-handle vs threshold-handle hit zones. This is
   half-implemented: either the prop should be removed or a hit-test
   implemented (the visual offers no ratio handle either).

10. **`GlutenCurve` pointer drag math is wrong on resize / DPR.**
    `presentations/components/GlutenCurve.tsx:248-253`. The handler
    reads `event.clientY - rect.top` against the canvas's CSS height
    (`height` prop), with a hard-coded `pad = 10` baked into a
    `plotH = height - 20` calculation. But the canvas backing store is
    scaled by `dpr` inside `useEffect`. The CSS dimensions stay at
    `width`/`height`, so the math _happens_ to work — until the
    canvas is wrapped in `overflow-x-auto` and inside a flex parent
    that lets it size differently from the prop (it is —
    `GlutenPanel.tsx:533-548`). When the parent shrinks the canvas to
    fit, `rect.top`/`rect.height` reflect the rendered size but the
    handler still divides by `height - 20`, producing a wrong dB
    value. Drag silently miscalibrates.

11. **`GlutenCurve` cursor reset bug.**
    `GlutenCurve.tsx:264`. `handlePointerUp` sets
    `canvas.style.cursor = 'grab'` unconditionally — even when
    `onThresholdChange` is undefined and the cursor was never `grab`
    (`render` only sets `cursor: 'grab'` when `onThresholdChange` is
    defined, line 272). After any pointerdown/up cycle on a
    non-interactive canvas, the cursor flips to `grab`. Cosmetic but
    wrong.

12. **`GlutenCurve.computeOutput` does not match Rust DSP.** The TS
    soft-knee formula at line 22-35 is the textbook quadratic knee.
    But the Rust `daw-gluten` engine includes per-topology curve
    differences (FET hyperbolic, Opto's program-dependent attack
    "softening" the effective ratio at low GR, Diode bridge's
    asymmetric distortion, VCA `vcaCharacter` adding analogue droop)
    plus `range` (caps GR) and `mix` (parallel blend). The drawn
    curve is the same shape regardless of topology, ignores `range`,
    and ignores `mix`. The user sees a "preview" that diverges from
    what they hear — particularly in Opto/Diode modes where the
    knee is fundamentally non-quadratic.

13. **`loadGlutenPatchWithAudio` flushes 43 params synchronously per
    preset click.** `useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts:14-65`.
    Every preset apply (or programmatic patch load) walks an inline
    43-entry tuple list and calls `pushParamImmediately` for each —
    each call does two things: `updateDeviceParam` (postMessage to
    the worklet) and `persistDeviceParam` (mutates `trackStore`,
    triggering re-renders). 43 store mutations + 43 postMessage calls
    in a tight synchronous loop, on the main thread, every preset
    apply. AGENTS.md "audio-thread code: no allocation, no mutex
    locks, no blocking" doesn't apply here (this is the UI thread)
    but the cascading store updates from `persistDeviceParam` will
    each notify Arrangement subscribers. There is also no atomic
    "patch loaded" notion — the worklet sees partial states between
    the 43 messages.

14. **`loadGlutenPatchWithAudio` parameter list is hand-maintained.**
    The 43-entry tuple at line 14-58 duplicates the keys of
    `GlutenPatch`. If a new field is added to the patch, the
    developer has to remember to also add it here, _and_ to extend
    `encodeGlutenValue`, _and_ to extend `GLUTEN_PARAMS`. There is
    no compile-time check that the lists agree. A `keyof GlutenPatch`
    iteration with a typed encoder map would catch drift.

15. **`encodeGlutenValue` returns `null` for unhandled keys but
    `loadGlutenPatchWithAudio` swallows the null silently.**
    `loadGlutenPatchWithAudio.ts:60-65`: `if (encodedValue !== null)
{ pushParamImmediately(...) }`. There is no log, no telemetry, no
    error. If a future patch field falls outside `number | boolean |
known string`, the engine never sees it but the store does — silent
    desync.

16. **`encodeGlutenValue` casts via `value as keyof typeof
TOPOLOGY_INDEX`.** `useCases/glutenParamBridge/helpers.ts:82,86,90,94`.
    The function takes `value: unknown`, narrows to `string`, then
    casts the string to the lookup-table key type and falls back to
    `?? 0`. If the value is e.g. `"unknown-topology"`, `TOPOLOGY_INDEX[
"unknown-topology" as keyof …]` returns `undefined`, the `?? 0`
    silently rewrites it to `vca`. AGENTS.md "TypeScript — soundness"
    forbids `as` to silence type errors; the correct shape is
    `value in TOPOLOGY_INDEX` narrowing or a `safeGet` helper that
    returns `null` for unknown keys. Today, a typo'd preset string
    silently lands as VCA.

17. **`encodeGlutenValue` returns `null` for `vcaType` /
    `oversampling` strings.** Both are typed as `number` in
    `GlutenPatch`, but `oversampling` is described in the comment
    as `1, 2, or 4` while `GLUTEN_PARAMS` defaults it to 2 with `min:
1, max: 4, step: 1` — meaning the panel knob lets the user pick 3,
    which is invalid. There is no clamp. `vcaType: 0/1/2` is similarly
    free-form. Either type as a literal union (`1 | 2 | 4`,
    `0 | 1 | 2`) and validate, or document the contract — currently
    invalid values flow straight to the worklet.

18. **`GlutenPatch` type uses optional/loose unions instead of a
    discriminated union by topology.** `models/GlutenPatch.ts:9-76`.
    `topology: 'vca' | 'opto' | 'fet' | 'diode'` exists but the
    type does not gate the FET/Opto/Diode/VCA-specific fields on it.
    The default patch has `recovery: 3` and `vcaType: 1` and
    `xfmrDrive: 1.2` and `limitMode: false` simultaneously — but a
    real device has only one set active. Saved projects carry all
    four sets; switching topology silently changes the audible
    parameters from values the user never set. A discriminated union
    (`{ topology: 'fet'; fet: {...} } | { topology: 'opto'; opto:
{...} } | …`) makes mode-switching explicit and prevents mixed-mode
    states.

19. **No `oversampling` toggle wired in `GlutenPanel`.** The patch
    model has `oversampling`, the bridge encodes it, but the panel
    knob at `GlutenPanel.tsx:868-877` exposes it as a min=1, max=4,
    step=1 knob — letting the user pick 3 (invalid). There is also
    no `vcaType` toggle that names the choices (Ideal / THAT 2181 /
    DBX 202 per the comment at `models/GlutenPatch.ts:65`); the user
    sees a knob with values 0/1/2 and no labels (`GlutenPanel.tsx:1086`).

20. **`scEqFreq`, `scEqGain`, `scEqQ`, `scEqEnabled` are unreachable
    in the panel for non-FET topologies.** The Detector section
    (`GlutenPanel.tsx:809-960`) shows `scEqFreq/Gain/Q` knobs
    unconditionally, but `scEqEnabled` is the gate. The toggle chip
    is rendered (line 897-902), so this is fine — but `scEqQ` has
    no unit, no label suffix, no value preview ("Q"). The knob shows
    a bare number; the user can't tell what scale they're looking
    at.

21. **`STYLE_PATCHES` mutates topology when style changes.**
    `GlutenPanel.tsx:98-143,202-208,347-349`. Picking a style chip
    overrides `topology` (Glue→VCA, Punch→FET, Smooth→Opto,
    Pump→VCA), so a user mid-tweaking on Diode who clicks "Glue"
    loses the topology selection. There is no warning, no confirmation,
    no "this will change topology" hint. Style is presented as a
    quick-feel selector but it actually replaces ~10 fields plus
    topology.

22. **`buildStylePatch` discards user-set values across the whole
    patch.** `GlutenPanel.tsx:202-208`. Spreading `STYLE_PATCHES[style]`
    over the current patch overwrites `threshold`, `ratio`, `attack`,
    `release`, `autoRelease`, `knee`, `range`, `mix`, plus `topology`
    and `style` itself. If the user has dialled in a custom threshold
    on the current topology, picking a style nukes it without prompt.

23. **`applyPreset` does not preserve the patch `name`.**
    `GlutenPanel.tsx:343-345`. The preset patch is loaded as-is —
    including `preset.patch.name = preset.name` set at construction
    time (`useCases/glutenPresets.ts:42`). Selecting a preset
    overwrites the displayed patch name. Subsequent parameter tweaks
    don't mark the patch as "modified" — the panel keeps showing the
    original preset name. UX-wise, this is misleading: there is no
    "Custom" or "Modified" indicator.

24. **`applyStyle` is called via a chip click and rewrites the patch
    silently.** Same pattern as #21 — clicking a style is a destructive
    operation with no undo. Combined with #4 (every render reads from
    a constantly-updating store), an accidental click loses state.

25. **`GlutenPanel` "Knob" component reads `value` and writes via
    `setGlutenParamWithAudio`.** `presentations/views/GlutenPanel.tsx:274-311`.
    The `RotaryKnob` reports incremental changes; each change calls
    `setGlutenParamWithAudio`, which writes to the store synchronously
    and rAF-batches the engine flush. Good. But `setGlutenParamWithAudio`
    accepts `value: GlutenPatch[Key]` typed as the field's value type;
    the `Knob` component types `onChange` as `(nextValue: number)` and
    casts via `nextValue as GlutenPatch[typeof param]` (line 298). For
    non-numeric fields (booleans, topology strings, style strings)
    this cast is a lie. AGENTS.md forbids `as` to silence the
    compiler. Today, no `Knob` is wired to a non-numeric field, but
    the type isn't enforced.

26. **`GlutenPanel` constructs `CATEGORIES = ['all', ...new
Set(GLUTEN_PRESETS.map(...))]` at module scope.**
    `GlutenPanel.tsx:147`. This is fine but iterates `GLUTEN_PRESETS`
    on module load. If presets ever come from a user-loaded source
    (per the AGENTS.md DDD goal of preset libraries), this fails.

27. **`describePreset` formats topology label + ratio + threshold but
    omits attack/release.** `GlutenPanel.tsx:197-200`. The 16 presets
    differ on attack/release/autoRelease/knee/range — but the preset
    list shows only ratio and threshold. Two presets with different
    attack times look identical in the picker.

28. **`filteredPresets` recomputes on every render.**
    `GlutenPanel.tsx:325-330`. The React Compiler will memoise this,
    so it's not a perf issue per AGENTS.md, but the search/filter
    state lives in `useState` and `GLUTEN_PRESETS` is module-scoped —
    the filter doesn't depend on the meter ticks. Combined with #4
    (whole-tree re-render on meters), this filter runs 60×/sec
    needlessly. The Compiler can't help if the props the parent
    passes change every tick.

29. **`GrMeter.peakHoldRef.current += 0.1` ramp is render-tied.**
    `presentations/components/GrMeter.tsx:88`. The "peak hold falls
    by 0.1 dB per render" only works if the component renders at a
    consistent rate. At 60 Hz that is +6 dB/sec; at 30 Hz it's +3
    dB/sec; at 1 Hz (no meter updates because no GR) the peak hold
    is frozen forever. Worse: the peak hold _only updates when
    `grDb` updates_, because nothing else triggers a re-render. If
    the audio stops (no meter tick), the peak hold sticks. Should be
    decoupled via a timestamp comparison.

30. **`GrMeter.peakTimerRef.current = 90` "≈1.5 sec at 60fps" is
    the same render-tied pitfall.** `GrMeter.tsx:84`. If the panel
    is unmounted-and-remounted, the peak timer reverts to 0. Cosmetic
    but the comment claims a real-time guarantee that is not honoured.

31. **`GrMeter` ARIA contract is half-correct.**
    `GrMeter.tsx:131`. The wrapper div has `role="meter"`,
    `aria-valuemin={-30}`, `aria-valuemax={0}`, `aria-valuenow={grDb}`.
    OK. But the canvas inside has `aria-hidden="true"` (correct, the
    canvas is decorative). However, `aria-valuetext` is missing —
    a screen reader announces "minus 4 point 2 minimum minus 30
    maximum 0" instead of "4.2 dB of gain reduction". Also: "Gain
    reduction meter" is the only label; if the user has multiple
    Gluten instances, AT users hear no instance disambiguation.

32. **`GrHistory` ARIA is decorative-only.**
    `presentations/components/GrHistory.tsx:130-138`. The canvas has
    `role="img"` and an `aria-label`. There is no live region — the
    history scrolls but AT users get one announcement at mount. This
    is acceptable for decorative meters but should be documented; if
    the design wants AT users to hear current GR, it needs an
    `aria-live="polite"` text node updated at a throttled cadence.

33. **`GlutenCurve` is `role="img"` but interactive.**
    `presentations/components/GlutenCurve.tsx:267-280`. The canvas is
    `role="img"` with `aria-label="Gluten compressor transfer curve"`,
    but it has `onPointerDown/Move/Up` handlers that drive `threshold`.
    This is a contract violation: an `img` is by ARIA spec
    non-interactive. Should be `role="slider"` with
    `aria-valuemin/max/now` reflecting the threshold (or a wrapper
    button + an off-screen `<input type="range">` for AT users).
    Currently no AT user can change the threshold via the curve.

34. **`GlutenCurve` keyboard support: zero.** No keyboard handlers,
    no `tabIndex`. The curve is mouse/pointer-only. If threshold
    is the headline interactive control on the curve, and the curve
    has no keyboard fallback, the panel is keyboard-incomplete. The
    `RotaryKnob` knobs are presumably keyboard-accessible (out of
    scope), so threshold _can_ be changed elsewhere — but the
    curve's claim to be interactive is an AT-blind path.

35. **`GlutenCurve` does not draw a `range` cap.** The Rust engine
    uses `range` (dB) to cap maximum GR; the curve does not draw
    the asymptote. The user sees a curve that descends without
    limit, but the actual GR is clamped. Visual lie at high
    threshold/ratio.

36. **`GlutenCurve` does not respect `mix`.** Same omission. With
    `mix < 1` the audible behaviour is parallel-compressed (the
    curve approaches unity at low mix). The curve always shows the
    100%-wet response. Visual lie when the user dials mix.

37. **Test mocks: `glutenParamBridge.spec.ts` mocks the full
    schedule path.** `useCases/__tests__/glutenParamBridge.spec.ts:25-32`.
    The `createRafBatcher` mock makes `schedule` synchronously call
    `flush`. This means the test never validates that
    `setGlutenParamWithAudio` actually defers the flush — it merely
    proves the encoder is called. The "rAF coalescing per key" claim
    in the comments is unverified by any test.

38. **Test stubs use `as never`.**
    `useCases/glutenParamBridge/__tests__/helpers.spec.ts:9,11,17`.
    `{ id: 't1', devices: [{ id: 'd1' }, { id: 'd2' }] } as never`.
    AGENTS.md and the user's memory file forbid `as never` /
    `as unknown` / `as any` to silence types. Use a typed
    `Partial<Track>` factory.

39. **`loadGlutenPatchWithAudio.spec.ts` and
    `setGlutenParamWithAudio.spec.ts` are smoke-only.** Each is 11
    lines, asserting the function exists. No behavioural coverage.
    `useCases/glutenParamBridge/__tests__/loadGlutenPatchWithAudio.spec.ts:6-10`.

40. **`GlutenPanel.spec.tsx` is four near-identical "renders without
    crashing" tests.** `presentations/views/__tests__/GlutenPanel.spec.tsx:15-35`.
    The "should have interactive elements" assertion accepts
    `>= 0` buttons — i.e. unconditionally true. None of the four
    exercises preset selection, knob change, or topology switch.
    The "should render without crashing" pattern is exactly what
    AGENTS.md and the user memory ban as lazy assertions.

41. **`GlutenCurve.spec.tsx`, `GrMeter.spec.tsx`, `GrHistory.spec.tsx`
    only assert canvas presence and dimensions.** None tests the
    transfer-curve numerics, peak-hold decay, or scrolling behaviour.
    `presentations/components/__tests__/GlutenCurve.spec.tsx:11-27`
    is two tests, both asserting `canvas` exists and has nonzero
    dimensions.

42. **`bridgeDeps`, `flushParam`, `pushParamImmediately`,
    `findDeviceRefGluten` are module-scoped singletons created at
    import time.** `useCases/glutenParamBridge/helpers.ts:38-40`.
    HMR will recreate these and lose any in-flight rAF entries; the
    first render after HMR sees a fresh batcher with no pending
    flushes (correct) but `findDeviceRefGluten` closes over
    `getAllTracks` which closes over `trackStore.value` — that part
    is fine because `getAllTracks` reads `.value` per-call. No
    actual bug, but the comment "§33.2 — Shared rAF-batch primitive"
    suggests this was reviewed; the race-on-HMR concern is not
    documented.

43. **`paramBatcher` is module-scoped, shared across all Gluten
    devices.** `helpers.ts:17`. The composite key is
    `${deviceId}:${key}` so collisions across instances are
    avoided. Fine. But `cancelAll` is never called on module
    teardown / panel unmount — pending flushes can fire after the
    `GlutenNode` is destroyed. The `updateDeviceParam` use case
    presumably no-ops on unknown deviceId; if it doesn't, this is a
    "post-destroy parameter write" hazard. Worth confirming with
    the AudioEngine audit.

44. **AGENTS.md function-signature rule violated.**
    `useCases/glutenParamBridge/helpers.ts:25,30`,
    `glutenParamBridge/setGlutenParamWithAudio.ts:6-10`,
    `glutenParamBridge/loadGlutenPatchWithAudio.ts:6`,
    `stores/glutenStore.ts:39,49,55,70`. Multiple functions take
    positional parameters (e.g. `setGlutenParam(deviceId, key,
value)`, `pushParamImmediately(ref, key, value)`). AGENTS.md:
    "Functions with more than one parameter take a single object
    param. For module-level functions, the input type is named
    `FunctionNameInput` …".

45. **`useStore` default value is reused across all panels.**
    `GlutenPanel.tsx:313`: `const defaultGlutenInstances:
Record<string, GlutenState> = {}`. Module-scoped, mutable.
    Strictly speaking it is never mutated by `useStore`, but the
    type is mutable and a future refactor that does `mutate(default)`
    would corrupt every panel. Should be `Object.freeze({})` or a
    `as const` empty object factory.

46. **`getGlutenState` has a hidden default-clone branch that is
    different from the store-write branch.** `stores/glutenStore.ts:36`.
    The function returns a fresh defaults object every call when
    the device is unknown — but the store-mutator helpers
    (`setGlutenParam`, `setGlutenUiLevel`, `loadGlutenPatch`,
    `updateGlutenMeters`) also synthesise default state at lines
    45, 51, 57, 72 and write it. Three subtly different "create
    default state" code paths, each spreading
    `{ ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } }`.
    Collapse to one helper.

47. **`updateGlutenMeters` allows partial updates that bypass
    invariants.** `stores/glutenStore.ts:70-85`. `crest`, `phaseCorr`,
    `latency` are all `?` — when omitted, prior values persist.
    But `inputDb`, `outputDb`, `grDb` are required even though
    nothing forces a meaningful default. If the worklet sends a
    half-populated message (which the descriptor builder does not,
    today), the store can hold mixed-stale values. Tighter
    contract: full struct or none.

48. **`GlutenState.uiLevel` is `1 | 2 | 3 | 4 | 5` but never
    consumed.** `stores/glutenStore.ts:17`. `setGlutenUiLevel`
    exists, has a test, but no presentation file reads `uiLevel`.
    Dead surface. Either drive panel disclosure from `uiLevel` (the
    panel currently shows everything regardless) or remove it.

49. **`GlutenPatch.style` is `'glue' | 'punch' | 'smooth' | 'pump'`
    but presets force-name them.** `useCases/glutenPresets.ts:13-31`
    `inferStyle` defaults to `'glue'` for unspecified topology.
    Some presets explicitly override (`pump-edm` sets `style:
'pump'`); most don't. `master-loud` is set as `topology: 'vca'`
    with no `style`, so it gets `inferStyle({ topology: 'vca' })`
    → `'glue'`. But the user sees the preset name "Loud Master"
    and the style chip "Glue" — does the user understand the
    relationship? The data is consistent; the UX is confusing.

50. **`GLUTEN_PRESETS.preset()` strips the `name` from overrides.**
    `useCases/glutenPresets.ts:33-45`. The `preset()` helper
    spreads `overrides` onto `DEFAULT_PATCH` and then sets
    `name: name`. If a preset's overrides include `name`, the
    helper's `name: name` clobbers it. Safe today (no preset has
    `name` in overrides), but a footgun.

51. **`GlutenPanel` button-as-Stack pattern bypasses standard ARIA.**
    `GlutenPanel.tsx:466-499`. Topology cards are
    `<Stack as="button" align="start" gap={2} …>`. They render as
    `<button>` but have no accessible name beyond their inner text;
    the active state is encoded only via colour and a "Live" LED.
    AT users get the button's text content ("VCA Bus duty Live")
    which is OK but verbose; an `aria-pressed={active}` would be
    cleaner. Same pattern at the style chips (`DawPluginChip`) —
    out of scope for this audit, but worth confirming downstream.

52. **`GrMeter`, `GrHistory`, `GlutenCurve` re-set canvas dimensions
    in `useEffect` without DPR-change detection.**
    `GrMeter.tsx:39-42`, `GrHistory.tsx:41-44`, `GlutenCurve.tsx:64-67`.
    All three set `canvas.width = width * dpr` etc. in the effect
    that depends on the data props. If the user moves the window
    between displays with different DPRs, the canvas is not
    re-rendered until the next prop change. Cosmetic — DPR usually
    doesn't change mid-session — but the contract is loose.

53. **`GrMeter` displays GR rounded to one decimal but the
    `aria-valuenow` is the raw float.** `GrMeter.tsx:121,131`.
    Visual shows `-4.2`, AT announces `-4.234567…`. Use
    `Math.round(grDb * 10) / 10` for both, or carry the raw to AT.

54. **`GlutenPanel` has no error boundary.** If the WASM worklet
    panics (`onMeterData` throws, or the worklet sends a malformed
    message), `updateGlutenMeters` would propagate the error up
    through the `wasmDeviceRegistry.glutenDescriptor` callback. The
    panel itself has no `<ErrorBoundary>`. The
    `wasmDeviceRegistry.ts:347` `.catch(error)` catches load
    failures, but the per-meter callback at line 318 has no try/catch
    around the store write. A bad meter packet could blow up the
    entire UI tree.

55. **`GlutenPanel` lacks `bypass` exposure.** The patch model has
    `gainMatchBypass` (which is _not_ "bypass the device", it's
    "skip auto gain match") but no top-level `bypass` field. The
    `GlutenNode` exposes `setBypass` (`wasmDeviceRegistry.ts:343`)
    but the Gluten module never invokes it. Compressors typically
    have a bypass toggle in the UI for A/B comparison; this one
    has none. Either the Arrangement layer handles bypass globally
    (out of scope), or it's missing.

56. **`GlutenPanel` does not surface `latency`, `crest`, or
    `phaseCorr` semantics.** They appear as numbers in the metric
    strip (`GlutenPanel.tsx:431-456`) without context: "64 smp" of
    latency at 48 kHz is 1.33 ms — but the user sees raw samples.
    "Phase 0.99" is meaningless without a legend. The label "Stereo
    correlation" helps but the value range (-1..+1) is not
    indicated.

57. **`phaseCorr > 0.99 ? 'Mono'` heuristic.**
    `GlutenPanel.tsx:336-341`. A correlation of 0.99 is _not_ mono
    — it is "highly correlated". True mono is exactly 1.0 (or
    indistinguishable in practice). Same with `< -0.99` → "OOP" —
    correct in vibes, wrong in spec. Document or tighten thresholds.

58. **`GlutenPanel` uses inline string concatenation for class names
    and inline styles.** `GlutenPanel.tsx:470-475`. Conditional
    `className` via template literals instead of `clsx`/`twMerge` or
    component variants. Mostly cosmetic but increases the chance of
    duplicate Tailwind classes (e.g. `border-white/18` overriding
    `border-white/12`).

59. **`Knob` component re-creates `onChange` arrow per render.**
    `GlutenPanel.tsx:298`. The React Compiler should memoise this,
    so AGENTS.md compliance is preserved, but each `setGlutenParamWithAudio`
    closure captures a fresh `param` per render. Fine, just noting
    that the rationale for the Compiler-only-memoisation rule
    relies on the Compiler being aware of this idiom.

60. **`presentations/views/index.ts` is the only barrel exposed
    cross-module for views.** The barrel exports just `GlutenPanel`.
    AGENTS.md "Index exports — external consumers only" — fine.
    But there is no module root `index.ts` to point external
    consumers at, so they reach into `presentations/views`
    directly. Cosmetic — the project pattern allows it — but per
    AGENTS.md, the destination should be the module root.

61. **`GlutenPatch` `range`, `lookahead`, `oversampling`,
    `vcaType`, `recovery`, `thrust` lack validation.** All numeric
    fields with documented domains (`range: 0–60 dB`,
    `lookahead: 0–20 ms`, `oversampling: 1, 2, or 4`, etc.) accept
    any number from the bridge. A misencoded `oversampling: 3.7`
    or `recovery: 99` flows straight to the Rust worklet, which
    presumably clamps but the patch persists the bad value. No
    Zod / runtime validator.

---

## Priorities

1. **Store-shape + subscription-breadth perf hazard** (issues #4, #5,
   #28) — meter ticks re-render the entire 1136-line
   `GlutenPanel` and every other open Gluten panel; this is the most
   user-visible perf risk.
2. **Patch model is not discriminated by topology** (issue #18) — the
   root cause of the style/topology UX confusion (#21–#24) and the
   curve-doesn't-match-DSP visual lie (#12, #35, #36).
3. **`GlutenCurve` is interactive but mis-typed for ARIA, dead-prop'd,
   and DPR-fragile** (issues #9, #10, #11, #33, #34) — drag math
   silently miscalibrates and AT users have no path.
4. **`loadGlutenPatchWithAudio` is hand-maintained, non-atomic, and
   silent on encoder failures** (issues #13, #14, #15) — a 43-message
   burst with partial-state visibility plus drift between the patch
   model and the encoder list.
5. **Tests are smoke-only across the module** (issues #6, #37, #39,
   #40, #41) — no behavioural coverage of rAF coalescing, transfer
   curve, peak hold, or preset application; lazy assertions per
   AGENTS.md.
6. **No module root `index.ts` and external callers reach into
   `stores/` and `presentations/views/`** (issues #1, #2) —
   architectural drift; consumers cannot be moved off subpath imports
   without a curated barrel.
7. **AGENTS.md `as never` / function-signature violations** (issues
   #16, #25, #38, #44) — small mechanical refactors but they are
   currently silencing real type-safety concerns.

---

## Open issues

### 1. No module root `index.ts`; external callers reach into private subpaths

**Problem:** AGENTS.md "Cross-module imports MUST only target the
destination module's root `index.ts`". The Gluten module has no
`src/modules/Gluten/index.ts`; external callers import
`#/modules/Gluten/stores`, `#/modules/Gluten/presentations/views`
directly. Three callers do this; none can be moved without a curated
barrel because none exists.

**Representative files:**

- `src/modules/Gluten/` (no root `index.ts`)
- `src/modules/Workspace/presentations/views/AppShell.tsx:24`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:14`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:6`

**Needed:** Create `src/modules/Gluten/index.ts` that re-exports
exactly the runtime surface external modules need (`glutenStore`,
`updateGlutenMeters`, `GlutenPanel`, possibly `setGlutenParamWithAudio`
/ `loadGlutenPatchWithAudio` if Workspace ever needs them).
Migrate the three callers to import from the root barrel. Confirm
`pnpm deps:validate` passes after.

### 2. `useCases/index.ts` is a no-op stub while real use cases are buried in `glutenParamBridge/`

**Problem:** `useCases/index.ts` contains only `// no public use
cases` despite `setGlutenParamWithAudio` and `loadGlutenPatchWithAudio`
being the obvious cross-module surface. They are imported by
`presentations/views/GlutenPanel.tsx` via deep relative paths,
violating "use cases are the canonical cross-module surface for
runtime values".

**Representative files:**

- `src/modules/Gluten/useCases/index.ts:1`
- `src/modules/Gluten/useCases/glutenParamBridge/setGlutenParamWithAudio.ts`
- `src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:21-23`

**Needed:** Either flatten `glutenParamBridge/setGlutenParamWithAudio.ts`
to `useCases/setGlutenParamWithAudio.ts` (one function per file —
already true) and re-export from `useCases/index.ts`, or document why
the bridge is private (in which case it's misnamed — bridges in this
codebase are use cases). Wire `presentations/views/GlutenPanel.tsx`
to import from `../../useCases` (relative-to-self) instead of three
deep paths.

### 3. `glutenStore` packs patch + meter telemetry; meter ticks re-render the whole panel

**Problem:** Every meter callback (~60 Hz when active) clones the
top-level instances map and the per-device state. `GlutenPanel`
subscribes to the entire instances map via `useStore(glutenStore,
defaultGlutenInstances)` and re-derives every knob's bound state on
every render. Two open panels each re-render on the other's meter
updates.

**Representative files:**

- `src/modules/Gluten/stores/glutenStore.ts:70-85`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:316-322`

**Needed:** Split `glutenStore` into a patch store (mutated on user
input, low frequency) and a per-device meter store (mutated on every
worklet callback, high frequency). `GlutenPanel` subscribes to its
deviceId's patch slice only; meter components (`GrMeter`, `GrHistory`,
metric strip) subscribe to the meter slice only. Or use a selector
overload on `useStore` that scopes the subscription to a deviceId. Add
a perf test that asserts knob-bearing render counts under sustained
meter updates.

### 4. `GlutenPatch` is a flat type; topology-specific fields coexist

**Problem:** `models/GlutenPatch.ts:9-76` lists `inputGain`,
`outputGain`, `xfmrDrive`, `allButtons`, `jfetK3`, `xfmrK2`
(FET-only); `limitMode` (Opto-only); `recovery` (Diode-only);
`vcaType`, `vcaCharacter`, `feedForward` (VCA-only) all as required
fields. The default patch sets all of them simultaneously. Switching
topology silently changes audible behaviour because the previously
hidden fields are still in the patch.

**Representative files:**

- `src/modules/Gluten/models/GlutenPatch.ts:9-76,78-123`

**Needed:** Convert to a discriminated union:
`type GlutenPatch = GlutenCommon & ({ topology: 'fet'; fet:
FetParams } | { topology: 'opto'; opto: OptoParams } | …)`.
Switching topology now requires constructing a default for the new
variant (explicit, visible to the user). Migrate the bridge encoder,
the panel switches, and saved-project reads. Add a migration helper
for existing projects.

### 5. `GlutenCurve.onRatioChange` is dead and threshold drag is DPR-fragile

**Problem:** The component advertises `onRatioChange` but only handles
threshold drags. `handlePointerDown` always sets
`isDragging.current = 'threshold'` regardless of pointer location.
The threshold-drag math divides `event.clientY - rect.top - 10` by
`height - 20`, which is correct only when the canvas's CSS height
exactly equals the `height` prop — but the canvas is wrapped in
`overflow-x-auto` and inside a flex parent that can rescale it. Drag
silently miscalibrates.

**Representative files:**

- `src/modules/Gluten/presentations/components/GlutenCurve.tsx:14,224-264`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:533-548`

**Needed:** Remove `onRatioChange` (dead) or implement a hit-test for
ratio handle. Replace `height - 20` math with `rect.height`-relative
math so the drag honours the rendered size. Add a test that drives
synthetic pointer events through a resized canvas and asserts the
emitted threshold value matches the click position.

### 6. `GlutenCurve` ARIA: interactive canvas typed as `role="img"`

**Problem:** The canvas has `role="img"` but accepts pointer drags
that change a parameter. AT users have no path to threshold via the
curve. There is also no keyboard handling.

**Representative files:**

- `src/modules/Gluten/presentations/components/GlutenCurve.tsx:267-280`

**Needed:** Either type as `role="slider"` with `aria-valuemin/max/now`
and add `onKeyDown` handlers for arrow keys (mapping to ±0.5 dB), or
keep `role="img"` and remove the pointer handlers, leaving only the
`RotaryKnob` for threshold input. Document the choice.

### 7. `GlutenCurve.computeOutput` does not match Rust DSP

**Problem:** The drawn curve is a single textbook quadratic-knee
function. The Rust `daw-gluten` engine has per-topology curve
differences (FET hyperbolic, Opto program-dependent ratio softening,
Diode asymmetric distortion, VCA `vcaCharacter` droop) plus `range`
(GR cap) and `mix` (parallel blend). The user sees a curve that
diverges from what they hear, especially in Opto/Diode modes and at
non-100% mix.

**Representative files:**

- `src/modules/Gluten/presentations/components/GlutenCurve.tsx:22-35,127-162`

**Needed:** Either call the Rust DSP through a worker for the curve
samples (canonical), or duplicate the per-topology / range / mix math
in TS and add a parity test that samples the Rust output at fixed
inputs and asserts the TS curve matches within a tolerance. Pick one;
document the chosen path.

### 8. `loadGlutenPatchWithAudio` flushes 43 params synchronously, hand-maintained

**Problem:** The function inlines a 43-entry tuple of every
`GlutenPatch` key, calls `pushParamImmediately` for each
(synchronous `updateDeviceParam` + `persistDeviceParam`), and is
hand-maintained: a new field requires editing this list, plus
`encodeGlutenValue`, plus `GLUTEN_PARAMS`, with no compile-time check.
The 43 messages reach the worklet at intermediate states; there is no
"patch boundary" semantic.

**Representative files:**

- `src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts:14-65`

**Needed:** Iterate `Object.keys(patch) as Array<keyof GlutenPatch>`
or define a typed `GlutenParamEncoder` map keyed by `keyof
GlutenPatch` so the compiler enforces coverage. Send a single
"loadPatch" message to the worklet (if the protocol supports it) so
the patch transition is atomic. Until then, log a warning when
`encodeGlutenValue` returns null instead of swallowing.

### 9. `encodeGlutenValue` silently maps unknown strings to `0`

**Problem:** `useCases/glutenParamBridge/helpers.ts:82,86,90,94`
casts `value as keyof typeof TOPOLOGY_INDEX` and falls back to `?? 0`.
A typo'd or future-added string silently lands as `vca` (or `glue`,
`rms`, `stereo`). AGENTS.md "TypeScript — soundness" forbids `as` to
silence type errors. The user memory file forbids `as never` /
`as unknown` escapes for the same reason.

**Representative files:**

- `src/modules/Gluten/useCases/glutenParamBridge/helpers.ts:81-95`

**Needed:** Replace `as keyof …` with `value in TOPOLOGY_INDEX`
narrowing. Return `null` for unknown values (already the contract for
unhandled types). Log via `logger.warn` so unknown values surface.
Add a test that asserts `encodeGlutenValue('topology', 'bogus')`
returns `null`, not `0`.

### 10. Tests are smoke-only across the module

**Problem:** Tests assert "renders without crashing", "function is
defined", or "preset list is non-empty" — none exercises the actual
contracts:

- `GlutenPanel.spec.tsx`: four near-identical "renders without
  crashing" tests, none drives a knob change or preset click. Renders
  `<GlutenPanel />` with no `deviceId` prop — the production type
  requires it.
- `loadGlutenPatchWithAudio.spec.ts` and
  `setGlutenParamWithAudio.spec.ts` are 11-line smoke files asserting
  the function exists.
- `GlutenCurve.spec.tsx`, `GrMeter.spec.tsx`, `GrHistory.spec.tsx`
  assert canvas presence and dimensions; none tests the curve
  numerics, peak-hold decay, or scrolling.
- `glutenParamBridge.spec.ts` mocks `createRafBatcher` to call
  `flush` synchronously, defeating the rAF coalescing claim.

**Representative files:**

- `src/modules/Gluten/presentations/views/__tests__/GlutenPanel.spec.tsx:15-35`
- `src/modules/Gluten/useCases/glutenParamBridge/__tests__/loadGlutenPatchWithAudio.spec.ts`
- `src/modules/Gluten/useCases/glutenParamBridge/__tests__/setGlutenParamWithAudio.spec.ts`
- `src/modules/Gluten/presentations/components/__tests__/GlutenCurve.spec.tsx`
- `src/modules/Gluten/presentations/components/__tests__/GrMeter.spec.tsx`
- `src/modules/Gluten/presentations/components/__tests__/GrHistory.spec.tsx`
- `src/modules/Gluten/useCases/__tests__/glutenParamBridge.spec.ts:25-32`

**Needed:**

- For the bridge: replace the synchronous-flush mock with a fake
  `requestAnimationFrame` and assert that two `setGlutenParamWithAudio`
  calls in the same frame produce one `updateDeviceParam` flush with
  the latest value.
- For `GlutenCurve`: assert `computeOutput` numerics across the knee
  for known threshold/ratio/knee triples; assert pointer drag at the
  centre of the canvas yields a threshold of `(DB_MIN + DB_MAX) / 2`.
- For `GrMeter`: drive a sequence of `grDb` props and assert the
  peak-hold decay produces the expected positions over N frames.
- For `GlutenPanel`: render with a real `deviceId`, click a preset
  chip, assert the patch in the store updated, click a knob, assert
  the bridge was called.

### 11. Style/topology selection silently overwrites user state

**Problem:** Clicking a style chip (`GlutenPanel.tsx:514-527`) or a
preset (line 405) calls `applyPreset(buildStylePatch(...))` /
`applyPreset(preset.patch)`, which spreads ~10 fields plus `topology`
over the current patch. A user mid-tweaking on Diode who clicks
"Glue" loses the topology selection without warning. There is no
"modified" indicator; the displayed name remains the preset's even
after the user has tweaked.

**Representative files:**

- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:98-143,202-208,343-349`

**Needed:** Either (a) confirm before applying a preset/style that
changes topology, with a single-button "Apply", or (b) treat style
chips as pure macros that do not change topology. Add a "modified"
suffix to the displayed name when the patch differs from the loaded
preset (track `loadedPresetId` in state).

### 12. `GlutenPanel` lacks bypass exposure

**Problem:** The `GlutenNode.controller` exposes `setBypass`
(`wasmDeviceRegistry.ts:343`) but no UI surfaces it. Compressors are
the canonical "A/B with the dry signal" device; this one has none.

**Representative files:**

- `src/modules/Gluten/presentations/views/GlutenPanel.tsx` (no bypass
  toggle)
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:343`

**Needed:** Add a top-level bypass toggle (a chip near the topology
metric strip). Either dispatch through the `Arrangement` device-bypass
path (if one exists for all devices) or add a `setGlutenBypass` use
case that calls the controller directly. Document which one.

### 13. AGENTS.md function-signature rule violated across the module

**Problem:** Multiple module-level functions take positional args.
AGENTS.md mandates a single object parameter for >1 args.

**Representative files:**

- `src/modules/Gluten/stores/glutenStore.ts:39,49,55,70`
  (`setGlutenParam`, `setGlutenUiLevel`, `loadGlutenPatch`,
  `updateGlutenMeters`)
- `src/modules/Gluten/useCases/glutenParamBridge/helpers.ts:25,30`
  (`flushParam`, `pushParamImmediately`)
- `src/modules/Gluten/useCases/glutenParamBridge/setGlutenParamWithAudio.ts:6-10`
- `src/modules/Gluten/useCases/glutenParamBridge/loadGlutenPatchWithAudio.ts:6`

**Needed:** Refactor each to a single `<FunctionName>Input` object
parameter. Mechanical sweep; care with cross-module callers
(`wasmDeviceRegistry.ts:319` calls `updateGlutenMeters(deviceId,
{...})` already, so that one is fine; the others are intra-module).

### 14. `as never` casts in test fixtures

**Problem:** `useCases/glutenParamBridge/__tests__/helpers.spec.ts:9,11,17`
uses `{ id: 't1', devices: [...] } as never`. AGENTS.md and the user
memory both ban `as never` / `as unknown` / `as any` as
escape-hatches that hide real type problems.

**Representative files:**

- `src/modules/Gluten/useCases/glutenParamBridge/__tests__/helpers.spec.ts:9,11,17`

**Needed:** Build a typed `Partial<Track>` factory or pass full
`Track` fixtures. The shape is small (`{ id, devices: [{ id }] }`) —
`Track` is exported from `Arrangement/stores`, so a typed minimal
fixture is feasible.

### 15. `Knob` component casts non-numeric values via `as
GlutenPatch[typeof param]`

**Problem:** `presentations/views/GlutenPanel.tsx:298`. The `RotaryKnob`
emits `(nextValue: number)`, the panel casts it to
`GlutenPatch[typeof param]`. For non-numeric fields (booleans,
topology strings) this cast is a lie. Today, no `Knob` is wired to a
non-numeric field — but the cast suppresses the type system's ability
to catch the regression.

**Representative files:**

- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:274-311`

**Needed:** Constrain `Knob` to numeric fields:
`param: NumericKeyOf<GlutenPatch>`. Drop the cast. Add separate
chip/toggle components for boolean and string-discriminated fields
(already done for some, e.g. detection mode).

### 16. `oversampling`, `vcaType`, `recovery` are unbounded `number` in the patch

**Problem:** `models/GlutenPatch.ts:40,65,113,115` types them as
`number` with documented domains (`1, 2, or 4`; `0/1/2`; `1–5`). The
panel knobs (e.g. oversampling at `min:1, max:4, step:1`) let the
user pick `3`. The bridge passes the raw value to the worklet without
clamping. No runtime validation.

**Representative files:**

- `src/modules/Gluten/models/GlutenPatch.ts:40,65,67,113,115`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:868-877,1086-1095`

**Needed:** Tighten the type to a literal union (`oversampling: 1 | 2
| 4`, `vcaType: 0 | 1 | 2`, `recovery: 1 | 2 | 3 | 4 | 5`). Replace
the panel knob with a chip selector. Add a runtime guard in
`encodeGlutenValue` that returns `null` for out-of-domain values.

### 17. `GLUTEN_PARAMS` registry is unused

**Problem:** `models/GlutenPatch.ts:137-221` defines a
`GLUTEN_PARAMS` table (id/label/min/max/default/unit/scaling) for UI
binding. Nothing in the Gluten module reads it. The `GlutenPanel`
duplicates min/max/default/step inline in 30+ `<Knob>` rows. Drift
between `GLUTEN_PARAMS` and `GlutenPanel` is unchecked.

**Representative files:**

- `src/modules/Gluten/models/GlutenPatch.ts:137-221`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:642-1014`

**Needed:** Either (a) drive the panel knobs from `GLUTEN_PARAMS` so
the registry becomes the single source of truth, or (b) delete the
unused registry. If (a), add a test that asserts every key in
`GlutenPatch` has a corresponding entry in `GLUTEN_PARAMS`.

### 18. `getGlutenState` and store mutators each synthesise default state

**Problem:** Three+ code paths construct
`{ ...DEFAULT_GLUTEN_STATE, patch: { ...DEFAULT_PATCH } }`:
`getGlutenState`, `setGlutenParam`, `setGlutenUiLevel`,
`loadGlutenPatch`, `updateGlutenMeters`. Adding a new state field
requires updating all five.

**Representative files:**

- `src/modules/Gluten/stores/glutenStore.ts:36,45,51,57,72`

**Needed:** Extract `function getOrCreateState(deviceId: string):
GlutenState`. All mutators call it, then merge their delta. Reduces
five spread sites to one.

### 19. `GlutenState.uiLevel` is a dead surface

**Problem:** `stores/glutenStore.ts:17` and `setGlutenUiLevel` exist
and are tested, but no presentation file reads `uiLevel`. The panel
shows everything regardless. Either implement progressive disclosure
keyed on `uiLevel` or remove the field.

**Representative files:**

- `src/modules/Gluten/stores/glutenStore.ts:17,49-53`
- `src/modules/Gluten/stores/__tests__/glutenStore.spec.ts:33-36`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx` (no use
  of `uiLevel`)

**Needed:** Decide. If progressive disclosure is in the design,
gate `Detector`, `Stage two`, and FET-/Opto-/Diode-/VCA-specific
sections on `uiLevel >= N`. If not, delete `uiLevel`,
`setGlutenUiLevel`, and the test.

### 20. Meter components have render-rate-tied peak-hold logic

**Problem:** `GrMeter.peakTimerRef.current = 90` and `+= 0.1` per
render assume 60 Hz. If the meter callback rate drops or the panel
loses focus, the peak hold sticks. No timestamp-based decay.

**Representative files:**

- `src/modules/Gluten/presentations/components/GrMeter.tsx:84-90`

**Needed:** Track `peakHoldUntil = performance.now() + 1500` and
decay by elapsed-time-since-last-render, not by a count. Add a test
that drives a `grDb` sequence with mocked timestamps and asserts the
peak hold falls at the documented rate.

### 21. `GlutenCurve` does not draw `range` cap or `mix` blend

**Problem:** The curve always shows the 100%-wet response with no
GR ceiling. The Rust engine clamps GR to `range` (default 15 dB) and
blends parallel-dry at `mix < 1`. The user sees a curve that diverges
from audible behaviour.

**Representative files:**

- `src/modules/Gluten/presentations/components/GlutenCurve.tsx:127-162`

**Needed:** Add a horizontal asymptote at `threshold + range` (or
the pre-makeup equivalent). Blend the curve toward unity when
`mix < 1` (`outDb = mix * compressedOut + (1 - mix) * inputDb`).
Take both as props; the panel already has the values.

### 22. `paramBatcher` has no panel-unmount cleanup

**Problem:** `useCases/glutenParamBridge/helpers.ts:17`. The shared
`RafBatcher` accumulates entries across panel mounts. If the panel
unmounts mid-flush, the rAF still fires and `updateDeviceParam` runs
on a possibly-destroyed device. There is no `cancelAll` call on
panel unmount. No `useEffect` cleanup wires it.

**Representative files:**

- `src/modules/Gluten/useCases/glutenParamBridge/helpers.ts:17`
- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:315`

**Needed:** Either (a) `paramBatcher.cancelAll()` on panel unmount via
a `useEffect` cleanup (but that affects other panels — wrong), or
(b) make `cancel(compositeKey)` deviceId-scoped and call it for the
unmounted deviceId, or (c) confirm `updateDeviceParam` is no-op on
unknown deviceId and document. Pick one.

### 23. ARIA gaps in meters and curve

**Problem:** `GrMeter` lacks `aria-valuetext`; the canvas inside is
`aria-hidden` (correct) but the displayed precision differs from
`aria-valuenow`. `GrHistory` has no live region. `GlutenCurve` is
`role="img"` with pointer interactivity (already covered in #6). No
instance disambiguation when multiple Gluten panels are open.

**Representative files:**

- `src/modules/Gluten/presentations/components/GrMeter.tsx:131`
- `src/modules/Gluten/presentations/components/GrHistory.tsx:130-138`
- `src/modules/Gluten/presentations/components/GlutenCurve.tsx:267-280`

**Needed:** Add `aria-valuetext={formatValue(grDb, 'dB')}` to
`GrMeter`. Document the AT story for `GrHistory` (decorative only,
or add a polite-live numeric readout). For `GlutenCurve`, see #6.
Pass a `label` prop (defaulting to "Gluten compressor") that lets the
panel disambiguate ("Gluten on Drum Bus").

### 24. `GlutenPanel` lacks an error boundary and "modified" indicator

**Problem:** A bad meter packet from the worklet would propagate
through `updateGlutenMeters` and bubble into React. The panel has no
`<ErrorBoundary>`. Separately, after a preset is loaded, the panel
shows the preset name even after the user has tweaked the patch — no
"modified" / "custom" indicator.

**Representative files:**

- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:315-1136`

**Needed:** Wrap `GlutenPanel` in an error boundary that logs and
shows a "Plugin error — reload the device" affordance. Track
`loadedPresetPatch` in state; mark "modified" when the current patch
diverges. Surface the indicator next to the patch name in the header.

### 25. No discriminated state for "preset selected" vs "patch modified"

**Problem:** `GlutenPanel.tsx:396` derives "active" preset by
matching `preset.patch.name === patch.name`. After any tweak the name
remains the preset's, so the active highlight is wrong. The user
cannot tell whether the displayed patch is the loaded preset.

**Representative files:**

- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:396-407`

**Needed:** Track the loaded preset id in `GlutenState` (e.g.
`loadedPresetId: string | null` set on `loadGlutenPatch`, cleared
on any `setGlutenParam`). Drive the active highlight off this id, not
the name. Show "Modified" suffix when the patch differs from the
loaded preset.

### 26. `phaseCorr` "Mono" / "OOP" thresholds are `> 0.99` / `< -0.99`

**Problem:** `GlutenPanel.tsx:336-341`. A correlation of 0.99 is not
mono — it is highly correlated. Same for -0.99 / OOP.

**Representative files:**

- `src/modules/Gluten/presentations/views/GlutenPanel.tsx:336-341`

**Needed:** Either tighten thresholds (`>= 0.999` for "Mono") or
rename to "Near mono" / "Near OOP". Document the user-facing
contract.

---

## Open questions

- [ ] Does the `GlutenNode` (in `AudioEngine/engine/`) accept a single
      "loadPatch" message, or only per-key `setParam`? (Affects
      whether `loadGlutenPatchWithAudio` can be made atomic per #8.)
- [ ] Is there a global "device bypass" pattern in `Arrangement` that
      Gluten should hook into instead of adding its own (#12)?
- [ ] Is the `uiLevel` field part of an unfinished progressive-
      disclosure design (#19)?
- [ ] Is there an Arrangement-side preset library that should subsume
      `GLUTEN_PRESETS`, or are per-module preset lists by design?
- [ ] Does `updateDeviceParam` (the AudioEngine use case) silently
      no-op on unknown deviceId? Affects #22 severity.
- [ ] Is the lack of a module root `index.ts` a project-wide pattern
      (Bacteria, Grinder, Proof appear to follow the same shape) or a
      one-off drift? Should be addressed module-by-module or in a
      sweep?

---

## Risks

- **Perf hazard at 60 Hz.** Issue #3: meter callbacks re-render the
  full `GlutenPanel` and any other open Gluten panels. With two
  panels open and a busy mix bus, the React tree wakes 120 times per
  second for cosmetic meter updates. Combined with the React
  Compiler's aggressive memoisation, this is partially mitigated, but
  every `useStore` subscriber reads the entire instances object and
  the Compiler cannot statically know which devicesIds matter.
- **DSP credibility hit.** Issue #7: the curve drawn does not match
  the audible compression. Particularly bad in Opto/Diode modes where
  the textbook quadratic knee is wrong. Users will A/B against pro
  plugins (FabFilter Pro-C2, Slate VBC) and notice.
- **Topology mode-switch corruption.** Issue #4: switching topology
  preserves the previous topology's hidden parameters, so a user who
  dialled in `inputGain: 12` on FET, switched to VCA, and switched
  back, finds their FET settings still active — confusing but at
  least non-destructive. Worse: saved projects carry all four
  topologies' parameters; a project saved under `topology: 'fet'`
  with stale Opto / Diode / VCA defaults silently re-uses those
  defaults if the user switches.
- **Drag miscalibration.** Issue #5: under the current flex layout
  (`overflow-x-auto` parent), the curve canvas can be sized smaller
  than its `width` prop. The drag math doesn't honour this — clicks
  in the lower half of the visible canvas land at wrong dB values.
- **Tests don't catch regressions.** Issue #10: the rAF coalescing
  semantics are the entire point of the bridge, and no test verifies
  it. A future refactor that drops coalescing ships green.
- **Architectural drift.** Issues #1, #2, #13, #14: AGENTS.md
  violations have accumulated. No module root, deep cross-module
  imports, positional args, `as never` in tests. The pattern
  spreads across sister modules (Bacteria, Grinder, Proof) — a sweep
  is needed.
- **No bypass UI.** Issue #12: A/B with dry is not possible from the
  panel. Combined with the curve mismatch (#7) the user has no easy
  path to verify the plugin is actually doing what they think it is.

---

## Suggested approaches

- **Land the test-coverage pass first** (issue #10). The rAF
  coalescing test is mechanical; the curve-numerics test is a
  drop-in. With tests in place the DSP and store-shape changes are
  drivable test-first.
- **Split the store** (issue #3) before any other perf work. Patch
  store + meter store, keyed by deviceId. Subscribe each panel to
  its own slice. Re-measure.
- **Discriminate the patch by topology** (issue #4). Touches the
  bridge encoder, the panel switches, and saved-project migrations.
  Big refactor but addresses #11 (style/topology overwrite),
  #16 (oversampling/vcaType/recovery domains) and #25
  (preset-modified state) at the same time.
- **Drive panel knobs from `GLUTEN_PARAMS`** (issue #17). Use
  `GLUTEN_PARAMS.find(p => p.id === 'threshold')` (with a typed
  helper) so min/max/default/step come from one place. Or delete
  `GLUTEN_PARAMS`. Pick.
- **Make `GlutenCurve` honour topology + range + mix** (issues #7,
  #21). Either call into the worklet for samples, or mirror the
  per-topology DSP in TS with a parity test against fixed-input
  samples.
- **Add module root `index.ts`** (issue #1). Trivial mechanical fix.
  Migrate the three external callers in the same commit and run
  `pnpm deps:validate`.
- **Add bypass + modified indicator** (issues #12, #25). Two small
  UI additions; the data plumbing exists.
- **AGENTS.md compliance sweep** (issues #13, #14, #15). Mechanical;
  one commit.

---

## Recommendation

Start with **issue #1 (module root `index.ts`) + issue #10 (real
behavioural tests for the bridge)**. The first is mechanical and
unblocks future architectural work; the second gives you the test
harness needed to drive #3 (store split) and #7 (curve-DSP parity)
test-first.

After those two land, tackle **issue #3 (store split)** because that
is the highest-impact correctness/perf improvement and the one most
visible to users (smoother panel during playback, no cross-instance
re-render fan-out).

Then **issue #4 (discriminate the patch by topology)**, because that
is the root cause of the style/topology overwrite UX (#11), the
oversampling/vcaType domain bugs (#16), and the unmodifiable-preset-
indicator UX (#25). It is a bigger refactor but unlocks the rest.

The remaining issues split into two follow-up passes:

- **Correctness pass:** #7 (curve matches DSP), #20 (peak hold
  decoupled from render rate), #21 (curve range/mix), #5 (drag math),
  #8 (atomic patch load), #9 (encoder strict).
- **Architecture pass:** #2 (use cases barrel), #12 (bypass UI),
  #13–#15 (signature / cast cleanup), #17 (GLUTEN_PARAMS), #18
  (default-state factory), #19 (uiLevel decision), #22 (batcher
  cleanup), #23 (ARIA), #24 (error boundary), #26 (phaseCorr labels).

---

## Resolved

_No issues resolved yet._
