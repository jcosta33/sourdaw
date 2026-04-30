# Scoring module audit

## Scope

This audit covers `src/modules/Scoring/` in full — the tuner UI plugin, its
two write-side use cases, the `scoringStore` (keyed by `deviceId`), the
shared `models/ScoringState.ts`, and the panel + canvas presentations.
It explicitly excludes the upstream `AudioEngine/engine/ScoringNode.ts`
worklet that feeds telemetry, except where this module's contract with it
is observable (`updateTunerTelemetry` shape, `ScoringNode` field names).

Adversarial review: bugs, races, contract drift, dead/duplicated types,
React anti-patterns, accessibility, testing gaps.

Related spec: none on disk.

---

## Goal

A correctness-first instrument tuner module:

- One canonical `TunerState` type and `DEFAULT_TUNER_STATE` constant — not
  two parallel definitions in `models/` and `stores/` that can drift.
- Telemetry pushed from the audio thread is the only writer of pitch
  fields; user actions (`setDisplayMode`, `setA4Reference`) are the only
  writers of preference fields. Their interleaving must not corrupt the
  per-device record.
- Cross-module surface respects the AGENTS.md module boundary: a single
  root `index.ts` exposes only what other modules legitimately need
  (`updateTunerTelemetry` for AudioEngine telemetry push,
  `ScoringPanel` view, `scoringStore` for project reset). Today there is
  no root `index.ts` and external modules deep-import.
- Panel renders are React Compiler–friendly: no `useMemo` /
  `useCallback` / `React.memo`, no `forwardRef`, no `&&` rendering, no
  `any` casts, and `useStore` subscriptions are scoped narrowly enough
  that an unrelated device's telemetry update does not re-render the
  whole tree.
- Tests assert real shape (full `TunerState`), not stubs that omit
  fields the production code reads.

---

## Relevant code paths

- `src/modules/Scoring/events/index.ts` (placeholder — "no public events")
- `src/modules/Scoring/models/ScoringState.ts` (duplicate of stores type)
- `src/modules/Scoring/stores/index.ts` (barrel; only re-exports
  `scoringStore` + `updateTunerTelemetry`)
- `src/modules/Scoring/stores/scoringStore.ts`
- `src/modules/Scoring/useCases/index.ts` (placeholder — "no public use cases")
- `src/modules/Scoring/useCases/setA4Reference.ts`
- `src/modules/Scoring/useCases/setDisplayMode.ts`
- `src/modules/Scoring/useCases/__tests__/setA4Reference.spec.ts`
- `src/modules/Scoring/useCases/__tests__/setDisplayMode.spec.ts`
- `src/modules/Scoring/presentations/views/ScoringPanel.tsx`
- `src/modules/Scoring/presentations/views/index.ts`
- `src/modules/Scoring/presentations/views/__tests__/ScoringPanel.spec.tsx`

External call sites observed:

- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:21,562` —
  imports `updateTunerTelemetry` from `#/modules/Scoring/stores`.
- `src/modules/Workspace/presentations/views/AppShell.tsx:63` —
  imports `ScoringPanel` from `#/modules/Scoring/presentations/views`.
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:14`
  imports `scoringStore` from `#/modules/Scoring/stores`.

---

## Current behavior

**State.** `scoringStore` is a `Store<Record<string, TunerState>>`
keyed by device id (`stores/scoringStore.ts:42-44`). `getScoringState`
returns the current value or a fresh shallow copy of
`DEFAULT_TUNER_STATE` (`:46-48`). `updateTunerTelemetry` merges a
`Partial<TunerState>` into one device's slot, then writes the entire
`Record` back via `scoringStore.set(...)` (`:55-59`). This runs on
**every audio worklet telemetry tick** for every active scoring device.

**Use cases.** `setA4Reference` and `setDisplayMode` each take
`(deviceId, value)`, look up the existing slot via `getScoringState`,
and write a new full record back (`useCases/setA4Reference.ts:3-7`,
`useCases/setDisplayMode.ts:4-8`).

**Models duplicate.** `models/ScoringState.ts` exports a
`TunerState`, `DisplayMode`, and `DEFAULT_TUNER_STATE` that are
**byte-identical** to the ones in `stores/scoringStore.ts`. The store
file does not import from `models/`; it defines its own copies.
`useCases/setDisplayMode.ts:1` imports `DisplayMode` from
`../models/ScoringState`, while `presentations/views/ScoringPanel.tsx:12`
imports `DisplayMode` from `../../stores/scoringStore`. The two
files are not even type-aliased — they are independent definitions.

**Panel.** `ScoringPanel.tsx:48` calls
`useStore(scoringStore, {})` — subscribing the whole record. The panel
then narrows to `allInstances?.[deviceId]` (`:49`). Three child
canvases (`NeedleDisplay`, `StrobeDisplay`, `HistoryGraph`) own
`useEffect` redraws; `StrobeDisplay` and `HistoryGraph` mirror props
into `useRef` and run a `requestAnimationFrame` loop with `[]`
deps, but `NeedleDisplay` re-runs its `useEffect` on every prop
change (`[cents, active, confidence]`).

**Tests.** Two use-case tests pass partial fixtures (`{ a4Reference,
mode }`) and assert against the spread result — meaning the test
mocks return objects missing eight `TunerState` fields, and the
test never notices because the fields aren't asserted. The
`ScoringPanel.spec.tsx` test mocks `useStore` with a fixture that
omits `noteIndex` and `midiNote`.

---

## Findings

1. **Two sources of truth for `TunerState` / `DEFAULT_TUNER_STATE` /
   `DisplayMode`.** `models/ScoringState.ts:7-33` and
   `stores/scoringStore.ts:14-40` define identical-but-independent
   types. There is no `import type` between them and no compile-time
   guarantee they stay in sync. If a future change adds a field to one
   but not the other, runtime will silently lose it on every
   `setDisplayMode` / `setA4Reference` round-trip (see #3).

2. **Test mocks return partial states; production reads more fields.**
   `useCases/__tests__/setDisplayMode.spec.ts:5` mocks
   `getScoringState` to return `{ a4Reference: 440, mode: 'note' }` —
   `'note'` is **not** a valid `DisplayMode` (`'needle' | 'strobe' |
'poly'`). The assertion writes through that bogus value verbatim
   (`:21`), and the test passes because the production code never
   validates the mode. Same problem in `setA4Reference.spec.ts:5,21`
   and `ScoringPanel.spec.tsx:14-22` (omits `noteIndex` and `midiNote`).

3. **`updateTunerTelemetry` race vs. user-preference writes.** The
   audio thread fires telemetry at audio rate (typically every ~5–20 ms
   per worklet tick). Each call performs a non-atomic
   read-merge-write: `instances = scoringStore.value`, copy, write
   (`scoringStore.ts:55-59`). If `setA4Reference` (user action) lands
   between the audio thread's read and write, the user's change is
   silently overwritten by the telemetry's stale snapshot. This is a
   classic torn read-modify-write — `Store<T>` is not transactional;
   it is just a setter. Probability is low at one device but rises with
   multiple instances and rapid knob drag.

4. **`updateTunerTelemetry` allocates two objects per audio-thread
   tick.** `scoringStore.ts:58` builds a new outer record and a new
   inner per-device object on **every** telemetry update (one per worklet
   callback per scoring device). At ~10 ms cadence this is
   ~100 objects/sec/device. Combined with the write-the-whole-record
   pattern, every active device's slot is identity-changed even
   though only one slot's contents changed. `ScoringPanel.tsx:48`
   subscribes to the whole record (`useStore(scoringStore, {})`),
   so React invalidates and re-renders the panel ~100×/s **per
   device**, including pure-preference subtrees (mode buttons,
   reference knob). The React Compiler can memoise leaves but it does
   not save the parent diff.

5. **`ScoringPanel` subscribes to the whole multi-device record.**
   `ScoringPanel.tsx:48` `useStore(scoringStore, {})` returns the
   entire `Record<string, TunerState>`. Per #4, an unrelated device's
   telemetry update will re-render every other panel mounted in the
   workspace. The fix is per-device subscription (e.g. a derived
   store, a `useStore` overload that selects, or a child component
   that subscribes via `getScoringState(deviceId)` through its own
   selector).

6. **`useStore(scoringStore, {})` always passes the empty default**
   even though the panel immediately falls back to `getScoringState`
   for missing device ids (`ScoringPanel.tsx:48-49`). The redundant
   default `{}` allocates a new object literal on every render. It
   doesn't break, but it cancels any reference-equality short-circuit
   the store subscriber might do.

7. **No root `index.ts` for the module.** The convention (AGENTS.md
   "Barrel files") is that each module exposes its cross-module
   surface through a single `index.ts` at the module root. `Scoring`
   has none. Three external modules already deep-import:
   `#/modules/Scoring/stores`, `#/modules/Scoring/presentations/views`.
   AGENTS.md "Contract Boundaries": "Cross-module imports MUST only
   target the destination module's root **`index.ts`**. Deep imports
   into `useCases/`, `events/`, `stores/`, `presentations/views/`, or
   any other path from outside the module are forbidden." Three
   forbidden imports today.

8. **`models/ScoringState.ts` is dead-ish — only `setDisplayMode`
   imports `DisplayMode` from it.** The store re-defines `DisplayMode`,
   the panel imports `DisplayMode` from the store, and all other
   consumers (telemetry, panel) read from the store's copy. The
   models file is an orphan that exists to satisfy the layout
   convention but is bypassed by everyone except one use case.

9. **Use-case index says "no public use cases".**
   `useCases/index.ts:1` is a single comment. Yet two use cases
   exist — `setDisplayMode` and `setA4Reference` — and the panel
   imports them via the deep path
   `../../useCases/setDisplayMode` and `../../useCases/setA4Reference`.
   The panel is _inside_ the module so relative imports are correct
   (AGENTS.md "Same module — relative imports"), but the
   `useCases/index.ts` placeholder is misleading: these **are** public
   write-side actions on the module's state. They should be exposed
   through the root barrel for any future external caller (e.g. a
   command/preset system that wants to drive the tuner).

10. **`events/index.ts` is also a placeholder.** Same pattern — single
    `// no public events` comment. The module emits no events and has
    no `events/` payloads. The empty file is harmless but contributes
    to the convention-cargo-cult feel.

11. **`updateTunerTelemetry` does not validate `DisplayMode`.** It
    accepts `Partial<TunerState>`, so a caller could pass
    `{ mode: 'unknown' as DisplayMode }`. The audio engine never
    sends `mode`, so today this is theoretical — but combined with
    #2 (test mock passes `'note'`), it shows the type is the only
    line of defence.

12. **`scoringStore.value?.` optional chain is paranoia.**
    `stores/scoringStore.ts:47,56` use `scoringStore.value ?? {}` and
    `scoringStore.value?.[deviceId]` even though `createStore({
initialData: {} })` guarantees `value` is non-nullable from
    construction. The `?` is dead but signals uncertainty about the
    `Store<T>` contract that does not exist. If `Store<T>.value`
    can be nullable, the type should say so; if not, drop the `?`.

13. **`ScoringPanel.tsx` panel is ~600 lines with three canvas
    sub-components inline.** `NeedleDisplay`, `StrobeDisplay`,
    `HistoryGraph`, `PolyDisplay` are all defined as nested
    components (`:262`, `:376`, `:489`, `:602`). At a minimum
    `StrobeDisplay` (`:376-485`) and `HistoryGraph` (`:489-600`)
    each own a `requestAnimationFrame` loop, mutable refs, and a
    high-DPI canvas setup. They are independent units that should
    live under `presentations/components/`. AGENTS.md splits
    `presentations/views/` (page-level) from
    `presentations/components/` (reusable / leaf). Today the
    components folder doesn't exist for this module.

14. **`StrobeDisplay`/`HistoryGraph` render ~60 fps even when
    `active === false`.** Both use `requestAnimationFrame(draw)`
    with `[]` deps and read state via refs. `StrobeDisplay`
    (`:417-430`) does paint a "Waiting for signal..." text and
    `return`s, but the rAF still fires next frame. There is no
    pause when idle. Power on a laptop is not free.

15. **`StrobeDisplay` per-frame O(W·H) ImageData write in JS.**
    `:445-463` does a nested `for (let x ... { for (let y ...
{ data[idx] = r; … } })` over `physicalWidth × physicalHeight`
    pixels at devicePixelRatio. On a 2× retina display
    `480×180×2² = 691 200` × 4 bytes = 2.76 MB of typed-array writes
    every frame, in a JS loop. At 60 fps that is ~166 MB/s of bus
    traffic per panel. The kernel inside the loop (`r/g/b`
    constants) is constant per `x`, not per `y` — the column color
    can be filled with a single horizontal stripe and a `setLine`
    or per-row copy via `subarray + set`.

16. **`StrobeDisplay` uses `[]` deps but reads `cents`/`active` via
    refs.** `:383-386` copies `cents` and `active` into refs on every
    re-render, and the rAF loop reads `centsRef.current`. This is the
    standard "stale closure with ref escape hatch" pattern and is
    fine, but it is also the pattern AGENTS.md flagged with React
    Compiler: the Compiler doesn't memoise across this trick. The
    indirection is only there because the effect body is large; it
    would be cleaner to subscribe to a derived store via `useStore`
    and let React handle re-renders.

17. **`HistoryGraph` reads from a circular `Float32Array` with an
    `index!` non-null assertion.** `:532` `history[(pos - historyLength
+ i) % HISTORY_GRAPH_WINDOW]!` — for `pos < historyLength`
    (i.e. the very first ticks), `pos - historyLength` is negative.
    JavaScript's `%` returns a negative result for negative dividends,
    which becomes an out-of-bounds index on a typed array. Typed-array
    out-of-bounds reads return `undefined` at runtime, which the `!`
    silently asserts as `number`. The next consumer (`y = … - readHistory(index) /
50`) becomes `NaN`, and the canvas line tree quietly skips. AGENTS.md
    explicitly forbids `!` non-null assertions to silence the compiler.

18. **`HistoryGraph` plots the same path twice.** `:558-589` runs the
    exact same `moveTo + lineTo` sequence twice with two slightly
    different `strokeStyle`s — once with shadow blur (`:559-575`) and
    once without (`:577-589`). This is presumably "glow + line", but
    it doubles the per-frame cost and is uncommented. Replace with
    the `shadowColor`/`shadowBlur` save/restore alone, or document.

19. **`NeedleDisplay` redraws on every render but the parent renders
    ~100×/s.** `:271-371`'s `useEffect` deps are `[cents, active,
confidence]`. Because the parent panel re-renders on every
    telemetry tick (#4–#5), this effect re-runs on every tick. The
    `useEffect` does a full canvas clear, gradient fills, three
    arc/zone fills, and the needle draw. There is no rAF debounce.
    With multiple panels mounted this is ~100 redraws/s/panel.

20. **`NeedleDisplay` does not handle high-DPI.** Unlike
    `StrobeDisplay` (`:399-404`) and `HistoryGraph` (`:513-518`), it
    doesn't multiply `canvas.width / height` by `devicePixelRatio`
    or call `ctx.scale`. On a retina display the gradients and arcs
    appear at half resolution.

21. **`PolyDisplay` is decorative only.** `:602-617` renders six
    static guitar strings labelled `E2..E4` with hardcoded
    em-dashes for the cents column. There is no per-string telemetry
    plumbing. The store has only one `frequency`/`cents`/`midiNote`
    triple per device — there is no `polyphonicResults`. Selecting
    "Poly" mode shows a fake placeholder. UX-misleading: the user
    sees a feature that doesn't work.

22. **`MODES` array's `id` is `DisplayMode` but `detail` is loose
    prose.** `:16-20` uses `DisplayMode` correctly but the panel
    casts onclick: `setDisplayMode(deviceId, entry.id)` (#: 103).
    Fine here. But the `mode` displayed in the section detail is the
    raw `DisplayMode` literal (`:84` `detail={mode}`) which renders
    `'needle'` / `'strobe'` / `'poly'` lowercase to the user. If the
    intent is to show the human label (`'Needle'` etc.), that's a
    UX bug. If the intent is to show the literal id, fine — but it's
    inconsistent with `:131` "Concert A" and `:140` "Tuning deck"
    which use display copy.

23. **`PolyDisplay` and `GUITAR_STRINGS` are guitar-only.** The
    "Poly" feature is hardcoded to a 6-string guitar in standard
    tuning. No bass / 7-string / drop-D / DADGAD / piano. If the
    feature ships as is, it is a guitar tuner labeled as a
    polyphonic tuner.

24. **`a4Reference` clamp boundary off.** `:122-124`
    `min={400} max={490} step={1}` — the range stops at 490 Hz,
    excluding 491–500 Hz which Baroque-revival ensembles sometimes
    use, and the lower bound 400 Hz excludes a number of historical
    tunings (392 Hz French Baroque). The default `defaultValue={440}`
    is fine but the bounds are arbitrary and uncommented.

25. **`ScoringPanel.spec.tsx` over-mocks and under-asserts.** It
    mocks every UI component to a stub (`:48-97`) so the test
    asserts on text content of stubs, not actual layout. The spec
    "should render display mode buttons" (`:111-116`) only confirms
    the static `MODES` array's labels are emitted; click/select
    behaviour is not tested. The "should display cents value"
    (`:138-142`) accepts `\+?0\.0` — matching `0.0`, `+0.0`, or any
    derived render. There are no negative-cents, inactive-state, or
    knob-onChange tests.

26. **`useStore` mock uses `_store: unknown` and ignores the store
    arg entirely.** `ScoringPanel.spec.tsx:7-23` returns the same
    fixture regardless of which store is queried. If the panel ever
    starts subscribing to a second store (e.g. a derived per-device
    store per #5), this mock will silently feed it the same fixture
    and the test will pass with broken behaviour.

27. **`setDisplayMode.spec.ts` mock returns `mode: 'note'`** —
    `:5,21`. `'note'` is not a member of `DisplayMode`. The test
    passes because the mock is typed `unknown`. AGENTS.md "Tests:
    Do not stop at 'defined' / 'truthy' / generic
    `toBeTypeOf('object')` — assert the actual contract" — this is
    exactly the violation.

28. **`stores/scoringStore.ts` JSDoc lies about
    `updateTunerTelemetry`'s location.** `:8-9` says "also
    re-exported here for backward compat with
    AudioEngine/engine/wasmDeviceRegistry which imports from this
    path". The function is **defined** in this file and the
    "backward compat" framing implies it used to live elsewhere —
    but no other definition exists. Either the comment is
    historical and stale, or the function was moved and the prior
    location should be removed. Either way the comment is wrong.

29. **`stores/index.ts` only re-exports `updateTunerTelemetry` and
    `scoringStore`.** It omits `getScoringState` and `DEFAULT_TUNER_STATE`
    even though those are useful at module boundary. If a new
    consumer needs to read the default (e.g. a state migration in
    `Project`), it must deep-import. Either expose them or commit
    to the narrow surface (in which case future consumers go
    through use cases, which today don't exist for reads).

30. **No use case for `resetScoring(deviceId)` or `clearScoring()`.**
    `Project/.../resetModuleStoresToDefault.ts:14` imports
    `scoringStore` directly and (presumably) calls `.set({})` on
    it. AGENTS.md "Cross-module access is **only** via
    `get<Module>Handlers` in `useCases/`" — this is a write
    through the raw store from another module, which violates the
    `useCases/` orchestration boundary.

31. **No `presentations/components/` for inline canvases.** As noted
    in #13, `NeedleDisplay`, `StrobeDisplay`, `HistoryGraph`,
    `PolyDisplay` are all defined inline in the view. AGENTS.md
    "`presentations/hooks/` and `presentations/components/` are
    STRICTLY PRIVATE to their module" — the structure exists for a
    reason.

32. **`SectionCard` shadows the imported `DawPluginSectionCard`.**
    `ScoringPanel.tsx:24-45` defines a local `SectionCard` wrapper
    around `DawPluginSectionCard` with hardcoded
    `className="scoring-window"`, `titleClassName`, and
    `detailClassName`. Two issues: (a) the wrapper takes a
    `children: ReactElement | ReactElement[]` prop that rejects
    strings — but nothing prevents a child `string` at the call
    sites today. (b) the wrapper exists only to apply three CSS
    classes — could be a CSS variable or a `className` extension on
    `DawPluginSectionCard`. Pure indirection.

33. **`createCompactFloatBuffer` is imported but offers nothing
    over `new Float32Array(N)`.** `ScoringPanel.tsx:10,491` —
    the function is imported from `#/utils/createCompactFloatBuffer`
    and called with `{ length: HISTORY_GRAPH_WINDOW }` (= 300). For a
    300-element buffer the "compact" claim is meaningless — the
    underlying `Float32Array` is 1.2 KB. If this util has a real
    purpose (e.g. memory pool, alignment), document it; otherwise
    inline `new Float32Array(300)`.

34. **No accessibility on the panel.** No `role="status"`, no
    `aria-live`, no `aria-label` on the canvases. The "Cents" /
    "Pitch" / "Conf" metric tiles render numeric values that change
    ~100×/s; without `aria-live="polite"` (or, more correctly, a
    debounced text mirror) screen readers either get nothing or a
    flood. The display-mode buttons have `type="button"` and visible
    text — passable — but no `aria-pressed` to indicate the
    selected mode (the green `<DawPluginLed>` is visual-only).
    Nothing in the panel announces "tuned" / "out of tune"
    semantically — it's all colour and a needle.

35. **The mode-button `<button>` lacks keyboard affordance for
    "selected".** `:95-110` — selection state is communicated by
    `border-white/16` and a child LED. Keyboard users get no
    `aria-pressed` and no focus-visible ring beyond Tailwind's
    default. Combined with #34, the panel is not screen-reader-
    or keyboard-friendly.

36. **`a4Reference` knob `onChange` calls `Math.round(value)` but
    state is `number`.** `:120` — the knob can emit fractions; the
    panel rounds to integer Hz. Fine, but `RotaryKnob`'s `step={1}`
    already enforces this. The double-clamp is redundant; pick one.

37. **`HistoryGraph` history pointer wraparound in
    `Number.MAX_SAFE_INTEGER`.** `posRef.current++` (`:527`) is
    incremented every frame the device is `active`. At 60 fps it
    takes ~4.7 million years to overflow `2^53`, so this is not
    practically a problem — but the indexing math `(pos -
historyLength + i) % HISTORY_GRAPH_WINDOW` becomes wrong well
    before that for `pos > historyLength` because of negative
    modulus interaction with `historyLength` larger than `i` (see
    #17). Fix the modulus, not the overflow.

38. **`'note'` literal used as `DisplayMode` in two tests.**
    `setDisplayMode.spec.ts:5,21`, `setA4Reference.spec.ts:5`.
    The string is a phantom value — never accepted by the panel
    (which has only `'needle'/'strobe'/'poly'`). The tests pass
    only because the mock typing is loose. Cross-reference with
    #2, #27.

39. **`updateTunerTelemetry` accepts `Partial<TunerState>`, but
    the engine always sends 8 fields.** `wasmDeviceRegistry.ts:562-571`
    sends `{ frequency, cents, confidence, noteIndex, octave,
midiNote, noteName, active }` — every telemetry call. The
    `Partial` is wider than the contract. Tighten:
    `type TunerTelemetry = Pick<TunerState, 'frequency' | 'cents'
| ...>`. Then audio-thread bugs that omit a field break at
    compile time, not at the panel.

40. **No spec for `scoringStore.ts` itself.** `getScoringState`,
    `updateTunerTelemetry`, the default-state shallow-copy fallback —
    none have tests. The two tests in `useCases/__tests__/` mock
    the store entirely. A reset-to-default migration that breaks
    the default object would not be caught.

---

## Priorities

1. **Duplicate `TunerState`/`DEFAULT_TUNER_STATE`/`DisplayMode`
   definitions** (issue #1). The two files can drift and silently
   corrupt round-trips. One canonical source.
2. **Race + over-allocation in `updateTunerTelemetry`** (issues #3, #4).
   The store write is non-atomic against user actions and allocates
   two objects per audio-rate tick.
3. **Panel subscribes to the entire multi-device record** (issue #5).
   Every device's telemetry re-renders every other panel.
4. **Test mocks pass invalid `DisplayMode` literals** (issues #2, #27,
   #38). The use-case tests have no real coverage.
5. **No root `index.ts`; three external deep imports** (issue #7).
   Direct AGENTS.md violation.
6. **`StrobeDisplay`/`HistoryGraph` redraw at 60 fps even when idle,
   and `StrobeDisplay` writes 2.7 MB/frame in a nested JS loop**
   (issues #14, #15).
7. **`HistoryGraph` indexing bug for negative modulus** (issue #17).
   Silently emits `NaN` lines for the first `historyLength` frames.
8. **`PolyDisplay` is a fake feature** (issue #21). Selecting "Poly"
   shows static placeholder strings — no telemetry plumbing.
9. **No accessibility on the panel** (issues #34, #35). Pitch
   readouts, mode selection, and tuned/out-of-tune state are
   invisible to AT.

---

## Open issues

### 1. Two parallel definitions of `TunerState` / `DEFAULT_TUNER_STATE` / `DisplayMode`

**Problem:** `models/ScoringState.ts:7-33` and
`stores/scoringStore.ts:14-40` are byte-identical copies. The store
defines its own copies and does not import from `models/`. Use cases
import `DisplayMode` from `models/`; the panel imports it from the
store. There is no compile-time check that the two stay in sync. A
future field added to one will silently disappear when round-tripped
through the other.

**Representative files:**

- `src/modules/Scoring/models/ScoringState.ts:5-33`
- `src/modules/Scoring/stores/scoringStore.ts:14-40`
- `src/modules/Scoring/useCases/setDisplayMode.ts:1`
- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:12`

**Needed:** Pick one home. Prefer `models/` (per AGENTS.md
"Models (`models/`) are strictly private to their owning module"),
re-export `DisplayMode`/`TunerState`/`DEFAULT_TUNER_STATE` from
`stores/scoringStore.ts` via `import { type … } from '../models/...'`,
and have all consumers import from `models/`. Delete the duplicates.

### 2. `updateTunerTelemetry` race vs. user-preference writes

**Problem:** Audio-rate telemetry does
`scoringStore.value → mutate → set` non-atomically. A user knob drag
that lands its `setA4Reference` between the audio thread's read and
the audio thread's write is overwritten. Probability is low at one
device but rises with knob drags on multi-device sessions.

**Representative files:**

- `src/modules/Scoring/stores/scoringStore.ts:55-59`
- `src/modules/Scoring/useCases/setA4Reference.ts:3-7`
- `src/modules/Scoring/useCases/setDisplayMode.ts:4-8`

**Needed:** Either (a) split the store: per-device preference store
(written by user actions) and per-device telemetry store (written by
audio thread). The panel subscribes to both. Telemetry writes never
touch preferences. Or (b) use a transactional `set(updater)` API on
`Store<T>` that takes a function so the read/write happens inside a
single closure scheduled to the same task queue. (a) is simpler and
matches the Bacteria/Proof/Fermenter pattern visible in
`wasmDeviceRegistry`.

### 3. `updateTunerTelemetry` allocates two objects per audio-thread tick

**Problem:** `scoringStore.set({ ...instances, [deviceId]: { ...existing,
...data } })` allocates a new `Record` and a new per-device object on
every telemetry update. At ~10 ms cadence per device this is ~200
allocations/s/device. Combined with #4 below, it triggers a panel
re-render on every tick.

**Representative files:**

- `src/modules/Scoring/stores/scoringStore.ts:55-59`

**Needed:** Per #2, separate telemetry into its own per-device store
that the panel subscribes to with a selector. Write only the changed
fields. Consider a `Map<deviceId, TunerTelemetry>` or a SAB-backed
ring buffer if the audio thread already exposes one (it does for
other devices via `wasmDeviceRegistry`).

### 4. Panel subscribes to the whole multi-device record

**Problem:** `useStore(scoringStore, {})` returns
`Record<string, TunerState>`. Every device's telemetry tick changes
the outer record's identity, so React re-renders every panel
mounted in the workspace. Multiple `ScoringPanel` instances —
N-squared churn.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:48`

**Needed:** Subscribe per-device. Either (a) introduce a
`useScoringState(deviceId)` hook that selects the slot and returns it
with stable identity when the slot didn't change, or (b) split into a
per-device store keyed by `deviceId` (paired with #2). The
`useStore(store, defaultValue)` overload doesn't take a selector
today; either add one or wrap with `useSyncExternalStore` + selector
locally.

### 5. Tests pass invalid `DisplayMode` literal `'note'`

**Problem:** Both use-case tests and the panel test mock
`getScoringState` to return `{ a4Reference: 440, mode: 'note' }`.
`'note'` is not in `DisplayMode = 'needle' | 'strobe' | 'poly'`. The
tests pass because the mock typing is `unknown` / loose. AGENTS.md
"Tests: assert the actual contract".

**Representative files:**

- `src/modules/Scoring/useCases/__tests__/setA4Reference.spec.ts:5,21`
- `src/modules/Scoring/useCases/__tests__/setDisplayMode.spec.ts:5,21`
- `src/modules/Scoring/presentations/views/__tests__/ScoringPanel.spec.tsx:14-22`

**Needed:** Replace the mock fixtures with full `TunerState` values
typed as `TunerState`. Use `DEFAULT_TUNER_STATE` as the base. Drop
the `'note'` literal. Add positive coverage:
`setDisplayMode('d1', 'strobe')` then read the store and assert
`.value.d1.mode === 'strobe'`. Also test a real `DisplayMode` round
trip with a non-default existing slot.

### 6. No root `index.ts` — three external deep-imports

**Problem:** Module has no `src/modules/Scoring/index.ts`. Three
external modules deep-import private paths
(`#/modules/Scoring/stores`, `#/modules/Scoring/presentations/views`).
AGENTS.md "Cross-module imports MUST only target the destination
module's root **`index.ts`**".

**Representative files:**

- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:21`
- `src/modules/Workspace/presentations/views/AppShell.tsx:63`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:14`

**Needed:** Create `src/modules/Scoring/index.ts` re-exporting
`ScoringPanel`, `updateTunerTelemetry`, and `scoringStore` (the last
only because Project resets it; better long-term, replace that with a
`resetScoringStore()` use case — see #18). Update the three
external imports to target the barrel.

### 7. `StrobeDisplay` per-frame O(W·H) JS pixel writes

**Problem:** `:445-463` runs a nested JS loop over `physicalWidth ×
physicalHeight` pixels to produce a column-uniform stripe. The
column color is constant per `x`; the inner `y` loop just copies
the same RGBA quartet down the column. At retina resolution this is
~700 K iterations × 4 typed-array writes × 60 fps = ~166 MB/s of
ImageData traffic per panel.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:432-464`

**Needed:** Build a single-row `Uint32Array` for the line, then
`set` it into each row of the ImageData with a `subarray` per row.
Or render to a low-res ImageData and `drawImage` at logical size with
`imageSmoothingEnabled = false`. Or replace the per-frame ImageData
write with a CSS-driven striped background animated via
`background-position` — which is what most strobe tuners do.

### 8. `StrobeDisplay`/`HistoryGraph` rAF runs even when device inactive

**Problem:** Both rAF loops (`:480`, `:595`) are unconditional. When
`active` is false, `StrobeDisplay` paints a "Waiting for signal..."
text and continues scheduling next frame. `HistoryGraph` paints the
empty graph. Both burn GPU/CPU on idle UI.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:417-430,480-481,520-596`

**Needed:** Conditionally schedule the rAF: when `active === false`,
paint once, return. Re-trigger on the next `active === true`
transition via a separate effect with `[active]` deps.

### 9. `HistoryGraph` negative modulus bug

**Problem:** `:532` `(pos - historyLength + i) % HISTORY_GRAPH_WINDOW`
— for `pos < historyLength`, the dividend is negative; JS `%`
preserves sign. Reading at a negative index from a `Float32Array`
returns `undefined` at runtime; the `!` non-null assertion silently
asserts it as `number`. The downstream `(undefined / 50)` becomes
`NaN`, which the canvas line tree skips. AGENTS.md "TypeScript —
soundness" forbids `!` to silence the compiler.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:530-532`

**Needed:** Use a positive-modulus helper (`((a % n) + n) % n`)
and remove the `!`. Add a test for the first `HISTORY_GRAPH_WINDOW`
ticks (e.g. push 5 cents values, assert the rendered path has 5
defined points).

### 10. `PolyDisplay` is a placeholder feature

**Problem:** `:602-617` renders six static guitar strings with
hardcoded em-dashes for the cents column. There is no per-string
detection, no telemetry plumbing, and no path in `TunerState` to
carry per-string data. Selecting "Poly" mode shows the user a
non-functional UI.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:602-617`
- `src/modules/Scoring/stores/scoringStore.ts:14-27` (no
  `polyphonicResults` field)

**Needed:** Either (a) wire it up: extend `TunerState` with a
`perString: Array<{ note: string; cents: number; active: boolean
}>`, plumb through `wasmDeviceRegistry`, and update
`PolyDisplay`. (b) hide the "Poly" mode option until implemented.
(c) at minimum, add a "Coming soon" badge and disable the button.
Shipping it as is is misleading.

### 11. `models/ScoringState.ts` is orphaned

**Problem:** Only one consumer (`useCases/setDisplayMode.ts`)
imports from `models/`; the store, panel, and other use case
import the duplicate definitions from `stores/scoringStore.ts`.
The models file exists but is bypassed.

**Representative files:**

- `src/modules/Scoring/models/ScoringState.ts`
- `src/modules/Scoring/useCases/setDisplayMode.ts:1`
- `src/modules/Scoring/stores/scoringStore.ts:14-40`
- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:12`

**Needed:** Resolve via #1 (single canonical home in `models/`).
Have `stores/scoringStore.ts` import its types from `../models/ScoringState`
and re-export only its own runtime helpers (`scoringStore`,
`getScoringState`, `updateTunerTelemetry`).

### 12. `useCases/index.ts` and `events/index.ts` are placeholder comments

**Problem:** `useCases/index.ts:1` is `// no public use cases` —
but two use cases (`setDisplayMode`, `setA4Reference`) exist. They
are correctly imported via relative path inside the module, but
external modules cannot use them without deep-importing.
`events/index.ts:1` is `// no public events` — true today but the
file exists and conveys "this module emits events" by its
existence; either delete or document.

**Representative files:**

- `src/modules/Scoring/useCases/index.ts`
- `src/modules/Scoring/events/index.ts`

**Needed:** Re-export `setDisplayMode` and `setA4Reference` from
`useCases/index.ts` so they can flow through the root `index.ts`
to external modules (per #6). Delete `events/index.ts` if no events
are planned, or leave a stub that exports an empty `Events` type
union for future contracts.

### 13. `updateTunerTelemetry`'s `Partial<TunerState>` is wider than the contract

**Problem:** The audio thread always sends 8 specific fields
(`wasmDeviceRegistry.ts:562-571`). The `Partial<TunerState>`
parameter accepts any subset — including `mode` and `a4Reference`,
which the audio thread should never write. A bug in the worklet
glue that fires `updateTunerTelemetry({ mode: 'strobe' as DisplayMode })`
would silently flip the user's preference.

**Representative files:**

- `src/modules/Scoring/stores/scoringStore.ts:55`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:562-571`

**Needed:** Tighten the parameter type: `type TunerTelemetry =
Pick<TunerState, 'frequency' | 'cents' | 'confidence' | 'noteIndex'
| 'octave' | 'midiNote' | 'noteName' | 'active'>`. Coupled with #2,
move telemetry to its own store; the type narrows by definition.

### 14. `HistoryGraph` paints the same path twice

**Problem:** `:558-589` runs the same `moveTo + lineTo` sequence
twice — once with shadow, once without — uncommented.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:558-589`

**Needed:** Either consolidate into a single shadowed stroke or
document why the double-stroke is necessary.

### 15. Inline canvas components belong in `presentations/components/`

**Problem:** `NeedleDisplay`, `StrobeDisplay`, `HistoryGraph`,
`PolyDisplay` are 100–200 line components defined inside the view
file. AGENTS.md provides `presentations/components/` for exactly
this case, and each canvas owns independent state, refs, and rAF
loops.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:262-617`

**Needed:** Move each into
`src/modules/Scoring/presentations/components/<Name>.tsx`. The view
file shrinks to layout. Each component gets its own test file.

### 16. No accessibility on tuner readouts

**Problem:** Numeric pitch readouts change ~100×/s without
`aria-live`. Mode buttons lack `aria-pressed`. Canvases lack
`aria-label`. There is no screen-reader-friendly statement of
"in tune" / "sharp" / "flat".

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:95-110,150-174,177-217`

**Needed:** Add `aria-pressed={selected}` on mode buttons. Add a
debounced `<div role="status" aria-live="polite">` near the cents
readout that surfaces "{noteName}{octave}, {cents > 2 ? 'sharp' :
cents < -2 ? 'flat' : 'in tune'}" only when the value crosses a
threshold (avoid flooding). Add `role="img"` and `aria-label` on
each canvas with a meaningful description.

### 17. `NeedleDisplay` redraws on every render and is not high-DPI

**Problem:** `useEffect` deps `[cents, active, confidence]` re-run
on every parent render (~100×/s per #4). Combined with #4–#5 this
is wasted work. Also no devicePixelRatio handling — gradients render
at half resolution on retina.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:262-374`

**Needed:** Apply the same dpr scaling as `StrobeDisplay`/`HistoryGraph`.
Move to a rAF model with refs (mirror the strobe pattern) so the
draw call rate is bounded by the display refresh, not the audio
telemetry rate.

### 18. `Project` resets `scoringStore` directly

**Problem:**
`resetModuleStoresToDefault.ts:14` imports `scoringStore` from
`#/modules/Scoring/stores` and writes to it from another module.
This bypasses the use-case orchestration boundary and entangles
Project with Scoring's store shape.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:14`

**Needed:** Add a `resetScoringStore()` use case (single function,
single file under `src/modules/Scoring/useCases/resetScoringStore.ts`),
re-export from the new root `index.ts`, and have Project call that.
Cross-module write through the raw store goes away.

### 19. `useStore(scoringStore, {})` allocates a new default literal per render

**Problem:** `:48` `useStore(scoringStore, {})` — the empty object
literal is fresh on each render. The default is also unused: the
store is constructed with `initialData: {}` so `getSnapshot()` is
never null.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:48`

**Needed:** Drop the second argument or hoist a module-level
`EMPTY_INSTANCES = {} as Record<string, TunerState>` constant.
After fixing #4, the call signature changes anyway (selector or
per-device hook), so this becomes moot.

### 20. `'note'` is a phantom `DisplayMode` value in tests; no positive `DisplayMode` test

**Problem:** Both use-case tests and the panel test pass `'note'`
as the existing `mode`. There is no test that exercises a real
`DisplayMode` round-trip through `setDisplayMode` and asserts the
panel renders the corresponding display.

**Representative files:**

- `src/modules/Scoring/useCases/__tests__/setDisplayMode.spec.ts:5,18,21`
- `src/modules/Scoring/useCases/__tests__/setA4Reference.spec.ts:5,21`

**Needed:** Add per-`DisplayMode` test cases:
`setDisplayMode('d1', 'needle' | 'strobe' | 'poly')` and assert the
store value matches. Drop the `'note'` literal entirely.

### 21. `StrobeDisplay` rAF uses ref-mirroring around React state

**Problem:** The classic "mirror props into refs so the rAF closure
sees current values" pattern (`:383-386`). Works, but it is a
side-stepping of React Compiler memoisation and a sign that the
component is fighting the framework. Cleaner would be a per-device
store subscription that the rAF callback reads.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:380-386`

**Needed:** After #2 lands, the canvas can read directly from the
per-device telemetry store via `getScoringState(deviceId)` inside
its rAF body, eliminating the ref dance.

### 22. `a4Reference` knob bounds 400–490 Hz are arbitrary

**Problem:** Excludes 392 Hz French Baroque, 415 Hz Baroque, 466 Hz
high pitch, 500 Hz Renaissance Italian. Default 440 is fine; the
range is undocumented.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:122-124`

**Needed:** Either widen to 380–500 Hz with comments citing the
historical tunings, or surface a "preset" list (415 / 432 / 440 /
444). Document the chosen range in a constant.

### 23. `SectionCard` wrapper provides no value

**Problem:** `:24-45` defines a local `SectionCard` that wraps
`DawPluginSectionCard` with three hardcoded class names. Indirection
without abstraction.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:24-45`

**Needed:** Inline `DawPluginSectionCard` at call sites with the
class names, or extract a CSS variable
(`--scoring-section-class`) that the card reads.

### 24. `stores/scoringStore.ts` JSDoc is stale

**Problem:** `:8-9` claims `updateTunerTelemetry` is "re-exported here
for backward compat with AudioEngine/.../wasmDeviceRegistry which
imports from this path". The function is _defined_ here, not
re-exported. There is no other definition. The "backward compat"
phrasing is confusing or stale.

**Representative files:**

- `src/modules/Scoring/stores/scoringStore.ts:1-10`

**Needed:** Rewrite the JSDoc to state ownership: this is the home
of `updateTunerTelemetry`; AudioEngine pushes telemetry via this
function on every worklet callback.

### 25. No spec for `scoringStore.ts` itself

**Problem:** `getScoringState`, `updateTunerTelemetry`, the
default-state shallow-copy fallback have no direct tests. Both
existing specs mock the store entirely.

**Representative files:**

- `src/modules/Scoring/stores/scoringStore.ts`
- `src/modules/Scoring/useCases/__tests__/*.spec.ts` (mock the store)

**Needed:** Add `stores/__tests__/scoringStore.spec.ts` exercising:
default state for an unknown device, partial telemetry merge,
preference + telemetry interleaving (#2 reproducer), and isolation
between two device ids.

### 26. No keyboard `aria-pressed` on mode buttons

**Problem:** `:95-110` — selection state is colour and a child
`<DawPluginLed>`. Keyboard users see neither.

**Representative files:**

- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:95-110`

**Needed:** Add `aria-pressed={selected}` on each button. Combined
with #16, this is a small targeted fix.

---

## Open questions

- [ ] Is "Poly" mode planned to be wired up, or should it be hidden?
      (Affects whether issue #10 is a bug or a "do not promote yet"
      feature flag.)
- [ ] Does any other consumer (Snapshot, undo/redo, Project save)
      need to read `TunerState` outside the audio path? If yes, the
      store-level `Partial<TunerState>` boundary needs more than the
      `Pick<>` narrowing in #13.
- [ ] Is there a `Store<T>` selector overload planned, or should the
      panel split into per-device hooks (#4)?
- [ ] Does the audio worklet (`ScoringNode`) ever fail to send a
      `frequency` value (e.g. silence frame)? If yes, `frequency = 0`
      reaches the panel and `${frequency.toFixed(1)} Hz` renders
      "0.0 Hz" — UX-wise, this is a bug masquerading as a value.

---

## Risks

- **Race-induced preference loss.** Issue #2: a user dragging the
  A4 knob during active telemetry can see their change snap back.
  Subjectively, "the tuner ate my change". Hard to repro, easy to ship.
- **CPU/GPU drain on idle.** Issues #8, #15: a workspace with a
  scoring panel mounted but no input running pegs a fraction of
  GPU on rAF redraws of empty canvases. On battery this matters.
- **Multi-panel N² re-render.** Issue #4: two scoring devices send
  telemetry; both panels re-render on each other's tick. With four
  devices, 16× the renders.
- **DSP credibility.** Issue #10: "Poly" mode is decorative. Users
  who select it expect a polyphonic guitar tuner; they get six static
  rows of em-dashes. Erodes trust in the entire tuner.
- **Type drift.** Issue #1: two `TunerState` definitions will
  inevitably diverge under future edits. The first symptom will be
  a test that mocks one and the production code that uses the other.
- **Architectural drift.** Issues #6, #18: external modules
  deep-import; one bypasses the use-case boundary entirely. Left
  alone, this normalises private-internals access from anywhere in
  the codebase.

---

## Suggested approaches

- **Land the type unification first** (issue #1, #11). Mechanical:
  pick `models/`, point everyone there, delete the duplicate. This
  unblocks the test fixes (#5, #20) because the test fixtures must
  type-check against the canonical type.
- **Split telemetry from preferences** (issues #2, #3, #4, #13).
  Two stores: `scoringPreferencesStore` (preferences, written by
  use cases) and `scoringTelemetryStore` (telemetry, written only by
  `updateTunerTelemetry`). Panel subscribes to both. Telemetry store
  uses a per-device key + selector hook so panel re-renders are
  scoped. This addresses race + over-render + over-allocation in
  one pass.
- **Add the root barrel** (issue #6). Single `src/modules/Scoring/index.ts`
  re-exporting `ScoringPanel`, `updateTunerTelemetry`, and (per #18)
  a new `resetScoringStore` use case. Update three external imports.
- **Fix the canvas hot loop** (issue #7). The strobe display can be
  CSS-animated; if it stays canvas-driven, replace the nested per-
  pixel loop with row-replication. Pause rAF when inactive (#8).
  Fix the negative modulus in `HistoryGraph` (#9). Move all four
  canvases into `presentations/components/` (#15).
- **Decide on Poly mode** (issue #10). Either wire it up (extend
  `TunerState`, plumb worklet, build per-string view) or hide it
  behind a feature flag with a "Coming soon" message.
- **A11y pass** (issues #16, #26). `aria-pressed` on buttons,
  debounced live region for the cents readout, `role="img"` /
  `aria-label` on canvases.
- **Test rewrite** (issues #5, #20, #25). Type the fixtures as
  `TunerState`. Drop `'note'`. Add a `scoringStore.spec.ts`. Add a
  panel test that asserts mode-button click dispatches and a
  telemetry-update test that asserts the cents readout updates
  without throwing on the first `historyLength` ticks.

---

## Recommendation

Start with **issue #1 (unify `TunerState`/`DEFAULT_TUNER_STATE`/`DisplayMode`)**.
It is small, mechanical, and removes a class of silent-corruption bugs.
After that, tackle **issue #2 + #4 (split telemetry from preferences,
per-device subscription)** as one piece of work — the two issues share
the same fix shape and the panel test rewrite naturally falls out.

The accessibility pass (#16, #26) is independent and can be picked up
in parallel by another session. Leave the canvas hot-loop work (#7)
for last; it's the highest-effort and lowest-correctness-risk of the
priorities.

---

## Resolved

_No issues resolved yet._
