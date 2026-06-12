# Automation module audit

## Scope

Covers `src/modules/Automation/` in full — `models/`, `stores/`,
`services/`, `useCases/` (lane CRUD, recording, draw mode, shapes,
selection, zoom, modulation), `handlers/`, `presentations/views/`,
`events/`, and every spec under each `__tests__/`. Explicitly excludes
upstream callers (`Arrangement`, `Transport`, `Workspace`,
`AudioEngine`, `Project`, `MIDI`) except where they are imported by
this module or where the action contract crosses the boundary.

This is an adversarial review aimed at: curve-interpolation correctness;
sample-accurate vs control-rate scheduling; lane-edit races;
undo/redo invariants; AGENTS.md violations; type soundness;
React anti-patterns; performance; UX/a11y; testing gaps.

Related spec: none on disk.

---

## Goal

A correct, sample-accurate, undoable automation surface for the DAW:

- Every persisted curve type (`linear`, `exponential`, `step`,
  `s-curve`, `stairs`, `smooth`, `bezier`) is honoured by
  `interpolateAutomationPointValue` and by `getAutomationValueAtBeat`,
  using the neighbouring points where the algorithm needs them
  (Catmull-Rom needs `previousPoint`/`nextPoint`; cubic-bezier needs
  `cp1`/`cp2`).
- Lane edits (add/remove/update/quantize/scale/stretch/invert/reverse/
  thin/draw/record) all push **functional** undo entries — either an
  `inverseAction` that produces the original points or a callback-undo
  with a snapshot. `undoable: true` without an inverse is a bug.
- The scheduler is the single producer for the engine-side gain/pan/
  param writes during playback. Per-tick (~10 ms / 100 Hz) is the
  declared rate; no use case may bypass the slewer or write at a
  different cadence without justification.
- Recording sessions (`write` / `touch` / `latch`) carry the same
  latency-compensated semantics regardless of how many parameters
  are recorded simultaneously. Parameter values land in the lane in
  time order, with no silent merge/dedup that drops samples.
- Module structure conforms to AGENTS.md: a single root `index.ts`
  is the only cross-module entry point; cross-module callers do not
  reach into `useCases/automation/*`, `useCases/modulation/*`,
  `presentations/views/*`, or `models/`. One function per
  `useCases/` file; multi-arg signatures use a single object param.
- Tests assert behaviour, not module identity.
  `expect(fn).toBeDefined()` smoke tests that compile-time-check
  exports are not coverage.

---

## Relevant code paths

- `src/modules/Automation/models/Automation.ts`
- `src/modules/Automation/models/Modulator.ts`
- `src/modules/Automation/stores/automationStore.ts`
- `src/modules/Automation/stores/modulationStore.ts`
- `src/modules/Automation/stores/index.ts`
- `src/modules/Automation/events/index.ts`
- `src/modules/Automation/services/automationPointAlgorithms.ts`
- `src/modules/Automation/useCases/index.ts`
- `src/modules/Automation/useCases/automation/*.ts` (19 files)
- `src/modules/Automation/useCases/automationDrawMode.ts`
- `src/modules/Automation/useCases/automationShapes.ts`
- `src/modules/Automation/useCases/automationRecording/*.ts`
- `src/modules/Automation/useCases/automationSelection/*.ts`
- `src/modules/Automation/useCases/automationZoom/*.ts`
- `src/modules/Automation/useCases/modulation/*.ts`
- `src/modules/Automation/useCases/getAutomationHandlers.ts`
- `src/modules/Automation/useCases/getAutomationLanes.ts`
- `src/modules/Automation/useCases/getAutomationStoreState.ts`
- `src/modules/Automation/handlers/automation/handle*.ts` (9 files)
- `src/modules/Automation/presentations/views/ModulationMatrix.tsx`
- `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts`
  (consumer; relevant for the scheduling/race story)

---

## Current behavior

**No module-root `index.ts`.** Cross-module imports must therefore
target sub-barrels (`#/modules/Automation/useCases`,
`#/modules/Automation/stores`, `#/modules/Automation/presentations/views`).
This violates the AGENTS.md rule that "cross-module imports MUST only
target the destination module's root `index.ts`." Consumers across
`Workspace`, `Transport`, `Arrangement`, `Project`, `AudioEngine`,
`CrdtDocument` all reach into `#/modules/Automation/useCases`,
`/stores`, `/presentations/views`, `/models/Automation` — there is
nothing forcing a single contract surface.

**Lane CRUD use cases (19 files, `useCases/automation/`).** Pure
store mutators on `automationStore` (CRDT-backed Automerge doc).
Each one is a thin
`automationStore.set({ lanes: state.lanes.map(...) })` — no undo
emitted in the use case itself, no validation, no debouncing.
`addAutomationPoint` re-sorts the entire `points` array on every
insert (`addAutomationPoint.ts:14`). `batchAddAutomationPoints`
deduplicates by `Math.abs(beat - pt.beat) < 0.05`
(`batchAddAutomationPoints.ts:16`); the threshold is undocumented and
bites at high zoom levels where the user sees points 0.04 beats
apart but only one survives. `quantizeAutomationBeats` collapses
points landing on the same grid cell with last-write-wins via a Map
(`quantizeAutomationBeats.ts:14-17`) — silently destroys data.

**`getAutomationValueAtBeat` (`useCases/automation/getAutomationValueAtBeat.ts`).**
Per-tick read used by `applyAutomation`. Caches a lane-by-id Map
keyed by the lanes-array reference (`:11-13`). Binary search to find
the last point with `beat <= target` (`:60-70`). Calls
`interpolateAutomationPointValue` with `firstPoint`, `secondPoint`,
`beat` only — does **not** pass `previousPoint`/`nextPoint`, so the
'smooth' (Catmull-Rom) curve degenerates to a 2-point Hermite-ish
fallback for every interior point.

**Linked lanes.** `lane.linkedLaneId` recursion uses a `_visited`
default-arg `Set<string>` (`:18`). The `_visited.add(laneId)` happens
inside the `if (lane.linkedLaneId)` branch (`:43`), then recurses;
on null sourceVal, **falls through** to use the local lane's points,
silently turning the link into a "fallback to local" semantic that
isn't documented.

**`interpolateAutomationPointValue` (`services/automationPointAlgorithms.ts`).**
Handles `step`, `stairs`, `exponential` (with tension power
`2 ** (tension * 3)`), `s-curve`, `smooth` (Catmull-Rom with v0/v3
fallbacks). **Does not handle `'bezier'`** — the curve type exists
in the model and is accepted by `setAutomationPointCurve` and
`addAutomationPoint`, but bezier curves silently fall through to the
default linear branch. `cp1`/`cp2` are dead state.

**Draw mode (`useCases/automationDrawMode.ts`).** Module-level
`activeSession: DrawSession | null`. `paintDrawPoint` accumulates
into `pendingState` and schedules a single rAF flush per frame
(`:111-113`). `endDrawSession` cancels the pending rAF, flushes
synchronously, then computes `currentPoints` from the **post-flush**
store and pushes a callback-undo with `previousPoints`/`currentPoints`
(`:139-165`). `snapToGrid(beat, 0)` would divide by zero (no guard).

**Shapes (`useCases/automationShapes.ts`).** Generates points for
`sine` / `triangle` / `sawtooth` / `square` / `random` and routes
through `batchAddAutomationPoints`. The 'sine' shape (`:64-70`) is a
broken approximation — points are `[0, 1, 0, 0, 0]` at relative beats
`[0, 0.25, 0.5, 0.75, 1.0]`, which is a half-cycle followed by three
zeros, **not** a sine wave (would need `0, 1, 0, -1, 0` if values
spanned `[-1, 1]`, or `0.5, 1, 0.5, 0, 0.5` if normalised to `[0, 1]`).
'random' uses `Math.random()` — not seedable, not reproducible across
undo/redo.

**Recording (`useCases/automationRecording/`).** `recordAutomationValue`
compensates for `baseLatency + outputLatency + trackLatencySec`
(`recordAutomationValue.ts:28-31`) and pushes points into a
module-level `pendingPoints` Map keyed by `trackId::parameterId`.
Modes:

- `write`: `clearPointsInRange(laneId, session.startBeat, compensatedBeat)`
  on every value (`:60`), then push.
- `touch` / `latch`: push and mark `touchActive`.

`stopAutomationRecording` snapshots before/after via `structuredClone`
+ `JSON.stringify` deep-equality (`stopAutomationRecording.ts:39`)
and pushes a callback-undo if they differ. Does not group with
parallel parameter recordings — each parameter that landed values
ends up in the same group implicitly (single push for the whole
session) but the snapshot is the **whole** `lanes` array, so any
unrelated edit that landed between `start` and `stop` would be
"undone" by reverting to the start snapshot.

**Selection (`useCases/automationSelection/`).** Selection is
represented as `selectedBeats: number[]` (an array of beat
values), passed to `deleteSelectedPoints`, `getSelectionBounds`,
`transformSelectedPoints`. Equality compares with `===` on float
beats (`deleteSelectedPoints.ts:17-18`,
`transformSelectedPoints.ts:25`,
`getSelectionBounds.ts:21`). After
`updateAutomationPoint(laneId, oldBeat, newValue, newBeat)`
(`updateAutomationPoint.ts:13`), the old `selectedBeats` value
no longer matches; the selection is silently cleared from the
caller's perspective. `transformSelectedPoints` is exported from
its own file but **not** re-exported from `useCases/index.ts`
(`useCases/index.ts:25,42-43` lists `selectPointsInRange`,
`deleteSelectedPoints`, `getSelectionBounds` only).

**Zoom (`useCases/automationZoom/`).** Per-lane Y-axis zoom
(`viewMinValue`, `viewMaxValue`). `zoomToUsedRange` uses
`Math.min(...values)` / `Math.max(...values)` spread
(`zoomToUsedRange.ts:18-19`) — fine for typical lanes but
allocates on every call and can blow the call stack on >100k points.

**Modulation (`useCases/modulation/`).** `computeModulatorValue`
handles `lfo` (sine/saw/square/triangle/random) and `step`. The
`'envelope'` branch is missing — the function falls through and
returns 0 (`computeModulatorValue.ts:42`). `ModulationMatrix.tsx:166`
allows the user to create envelope modulators with attack/decay/
sustain/release inputs; they will never produce non-zero output.
The `'random'` LFO is `Math.abs((Math.sin(...) * 43758...) % 1)` —
a poor PRNG that loses precision at large `playheadBeat` (after
about 60 minutes at 120 BPM the floor() truncation collapses the
entropy). `applyModulationToEngine` writes engine values every
scheduler tick by calling `getModulationDependencies().updateDeviceParam`
directly (`applyModulationToEngine.ts:78`) — no slewer, no
deduplication-by-equality, every tick rewrites whether or not the
mod value moved.

**Handlers (`handlers/automation/`).** Nine handlers, each one a
1-line `createHandler<...>({ execute: ..., describe: ..., undoable:
true })`. Every handler claims `undoable: true` but **none** returns
an `inverseAction` from `describe()`. The undo/redo pipeline
(`#/modules/Command/useCases/undoRedo.ts:9-11`) is a no-op for
action-entries with `inverseAction === null`: the entry is consumed
from `past` but `executeUndo` simply doesn't execute anything.

**Action surface coverage.** Only 9 of the ~22 use cases are routed
through `AppAction`. `removeAutomationLane`, `setAutomationPointCurve`,
`toggleAutomationVisibility`, `toggleLaneCollapsed`,
`shiftClipAutomation`, `duplicateClipAutomation`, all `automationZoom/*`,
all `automationSelection/*`, all `automationDrawMode/*`, and all
`modulation/*` use cases are called directly from presentations.
None of these are command-bus undoable.

**Tests.** Of 22 lane-CRUD specs, **16 are smoke tests** asserting
only that the function is defined / `typeof` is `'function'`. The
six that test behaviour (`automationPoints`, `batchAddAutomationPoints`,
`invertAutomation`, `thinAutomationPoints`, `updateAutomationObjectPoint`,
`resetOverride`) include one (`thinAutomationPoints.spec.ts`) where
the `vi.mock('#/modules/Arrangement/useCases', ...)` mocks
`rdpSimplify` from the wrong module — production imports
`simplifyAutomationPoints` from `../../services/automationPointAlgorithms`,
so the mock is inert and the test passes by accident. Smoke tests
are present in: `getAutomationValueAtBeat.spec.ts`,
`automationDrawMode.spec.ts`, `getAutomationHandlers.spec.ts`,
`addAutomationLane.spec.ts`, `addAutomationPoint.spec.ts`,
`createAutomationLane.spec.ts`, `duplicateClipAutomation.spec.ts`,
`quantizeAutomationBeats.spec.ts`, `removeAutomationLane.spec.ts`,
`removeAutomationPoint.spec.ts`, `reverseAutomation.spec.ts`,
`scaleAutomationValues.spec.ts`, `setAutomationPointCurve.spec.ts`,
`shiftClipAutomation.spec.ts`, `stretchAutomationTime.spec.ts`,
`updateAutomationPoint.spec.ts`, `toggleAutomationVisibility.spec.ts`,
`toggleLaneCollapsed.spec.ts`. The shape and zoom tests are mixed.

---

## Findings

### Adversarial review log (2026-04-28)

**Verified open issues #1-22** against current source (`Automation/` tree as of commit 0ef2e91d9). Every cited file:line still matches; nothing has been silently fixed and no issue could be moved to `## Resolved`.

**Promoted severity:**

- Issue #2 (silent undo loss) — re-confirmed: `executeAppAction.ts:35-37,66` reads `inverseAction` *only* if `handler.undoable === true` AND `describe()` returned an `inverseAction`; none of the 9 handlers do. `undoRedo.ts:6-12` short-circuits when `inverseAction === null`. The user *also* loses the associated `pushActionHistoryEntry` revert path (`executeAppAction.ts:60-72`), so the action-history "Revert" button is equally inert.
- Issue #4 (smooth curve degenerate) — promoted: the `automationPoints.spec.ts:122-138` positive-path test **explicitly asserts** the buggy 3-arg call shape (no `previousPoint`/`nextPoint`). The bug is now test-locked, the same way #5 is.
- Issue #10 (`removeMapping`/`updateMapping` identity) — promoted: cross-checked the React rendering path. `ModulationMatrix.tsx:599` keys `MappingRow` by `${row.modulator.id}:${row.mapping.targetParamId}` — the same wrong identity. Two mappings on different tracks for `cutoff` collide on the React key as well, so even *visually* the user sees one row even though two exist in the store. New issue #54 logs the React-key collision.
- Issue #16 (test theatre) — promoted: the previous list of 16 smoke specs is essentially correct, but `setAutomationPointCurve.spec.ts` and `quantizeAutomationBeats.spec.ts` were re-read and confirmed as `expect-defined`-only. `automationDrawMode.spec.ts` is *also* an `expect-defined`-only smoke that does not call `beginDrawSession`/`paintDrawPoint` — so `snapToGrid(beat, 0) → NaN` (issue #19e/#40) cannot be caught by any current test.

**Demoted severity:**

- Issue #19c stack overflow on `Math.max(...arr)` — demoted from "blows the stack at 100k+" to "blows the stack at JS-engine-specific arg cap (~32k V8 / ~64k JSC)". Spread-arg cap kicks in *much* earlier than 100k on V8; the audit was being generous. Real ceiling is closer to 32k points — well within reach for a single ~5-min recording session at 100 Hz.
- Issue #38 (DOC_PREFIX_ROOT shared) — demoted: the comment is correct that runtime store is intentionally storage-less, but the practical risk of a "future refactor" silently persisting it is low because `createAutomergeStorage(...)` requires a positional `prefix, name` and a future writer would need to *add* a config object. Useful belt-and-braces, not load-bearing.

**New issues added in this review (numbered #54–#65):** see issues at the end of `## Findings` and the matching `### NN.` blocks under `## Open issues`.

1. **No module-root `index.ts`.** Every `src/modules/<X>/` in the
   codebase must export through a single root `index.ts` (AGENTS.md
   "Contract Boundaries"). Automation does not. Cross-module
   consumers reach into three sub-barrels (`useCases`, `stores`,
   `presentations/views`) and even a private model
   (`#/modules/Automation/models/Automation` is imported by
   `Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts:9`).
   The "Model isolation" rule is violated.

2. **`undoable: true` everywhere, but `inverseAction` nowhere.**
   All nine handlers in `handlers/automation/` mark themselves
   `undoable: true` and `describe` returns `{ label: ... }` only.
   `executeAppAction` (`Command/useCases/executeAppAction.ts:35-66`)
   pushes the entry with `inverseAction: undoResult?.inverseAction ?? null`,
   and `undoRedo.executeUndo` (`Command/useCases/undoRedo.ts:6-12`)
   short-circuits when `inverseAction` is null. The user clicks
   undo after `Add automation point`/`Scale automation`/etc. and
   nothing happens — the entry is consumed from `past` and the
   action is left as-is. This is a **silent undo data loss**.

3. **`'bezier'` curve type is declared but never interpolated.**
   `models/Automation.ts:1` lists `'bezier'` in `AutomationCurveType`.
   `setAutomationPointCurve.ts:7` accepts it.
   `handleAddAutomationPoint.ts:10` accepts it. The
   `interpolateAutomationPointValue` chain
   (`services/automationPointAlgorithms.ts:88-127`) never branches
   on `'bezier'` — it falls through to linear. `cp1`/`cp2` fields
   are dead state. UI that lets users pick "bezier" produces a
   straight line at runtime.

4. **`getAutomationValueAtBeat` does not pass `previousPoint`/
   `nextPoint`** — so the `'smooth'` (Catmull-Rom) curve at every
   interior point gets `v0 = firstPoint.value` and `v3 =
   secondPoint.value` (`automationPointAlgorithms.ts:114-117`).
   The Catmull-Rom spline collapses to a 2-point Hermite that is
   mathematically equivalent to a cubic ease, **not** to the
   smooth-through-neighbours spline the curve type promises.

5. **`'envelope'` modulator kind is dead.** `computeModulatorValue.ts:42`
   has no envelope branch — falls through to `return 0`. The view
   (`ModulationMatrix.tsx:122-152`) lets users create envelope
   modulators with attack/decay/sustain/release. They will never
   produce non-zero output. The `computeModulatorValue.spec.ts:65`
   test even asserts this: "returns 0 for envelope modulators (no
   time-based evaluation yet)" — locked-in dead-feature.

6. **`undoable: true` handlers describe by label only — no
   inverse-action contract.** Same root cause as #2 but the deeper
   problem is that the use cases themselves are not invertible
   without a snapshot: `addAutomationPoint(laneId, point)` doesn't
   return the prior state; `removeAutomationPoint(laneId, beat)`
   doesn't return the deleted point; `scaleAutomationValues` is
   numerically reversible only if `factor !== 0`. To make handlers
   genuinely undoable we'd need either inverse-action symmetry
   (`addAutomationPoint` ↔ `removeAutomationPoint`,
   `scaleAutomation(factor)` ↔ `scaleAutomation(1/factor)`) or
   callback-undos with snapshots — neither is implemented.

7. **Float-key selection breaks across edits.** Selection is a
   `number[]` of beat values (`selectPointsInRange.ts:32`,
   `deleteSelectedPoints.ts:5`, `getSelectionBounds.ts:8`,
   `transformSelectedPoints.ts:9`). After
   `updateAutomationPoint(laneId, oldBeat, newValue, newBeat)`
   (`updateAutomationPoint.ts:13`) the previous selectedBeats
   entries no longer match any point. `transformSelectedPoints`
   itself shifts beats and then keeps the **old** `selectedSet`
   for subsequent calls (`:55,66`). Silent selection-corruption
   under any beat-changing edit.

8. **Action contract covers fewer than half of the use cases.**
   `getAutomationHandlers.ts:32-42` exposes 9 actions. The
   following use cases have **no** corresponding `AppAction`:
   `removeAutomationLane`, `setAutomationPointCurve`,
   `toggleAutomationVisibility`, `toggleLaneCollapsed`,
   `shiftClipAutomation`, `duplicateClipAutomation`,
   `updateAutomationPoint`, `updateAutomationObjectPoint`,
   `resetOverride`, `batchAddAutomationPoints`, all of
   `automationDrawMode.ts`, all of `automationSelection/*`, all
   of `automationZoom/*`, and all of `modulation/*`. Presentations
   call them directly. None of these go through the macro recorder,
   the audit history, or the undo tree.

9. **`Math.ceil(endBeat)` ghosts.** N/A here — Automation's
   `duplicateClipAutomation` does not ceil. But `quantizeAutomationBeats`
   `Math.round(beat / gridSize) * gridSize` (`:16`) silently
   collapses any two points whose quantized beat collides
   (last-write-wins via `Map<number, AutomationPoint>`). For a
   user who quantizes a recording, the curve points pile up at
   grid intersections in non-obvious ways.

10. **`reverseAutomation` allocates a spread for `Math.max`.**
    `reverseAutomation.ts:16` `Math.max(...lane.points.map(...))`.
    Spread on >~10k points blows the JS stack. The whole-lane
    reverse semantics also presume the lane starts at beat 0 —
    the last point lands at `maxBeat - lane.points[0].beat`,
    which is not the original `startBeat` of any clip-bound
    automation. For clip-bound lanes, reverse should anchor to
    `[startBeat, endBeat]`.

11. **`stretchAutomationTime` has no anchor for clip-bound lanes.**
    `stretchAutomationTime.ts:18`
    `Math.max(0, anchorBeat + (param.beat - anchorBeat) * factor)`.
    Default `anchorBeat = 0` ignores `lane.clipId`; stretching a
    clip's automation about beat 0 silently shifts every point by
    `clip.startBeat * (factor - 1)` relative to the audio. The
    handler (`handleStretchAutomation.ts:7`) takes
    `payload.anchorBeat` from the action — but the AppAction type
    declares it `anchorBeat?: number` (commandQueries.ts:203),
    making it omissible.

12. **`scaleAutomationValues` clamp ignores curve type.**
    `scaleAutomationValues.ts:17`
    `Math.min(maxValue, Math.max(minValue, anchor + (value - anchor) * factor))`.
    For `step` curves, scaling the value of a step-anchor point
    silently changes the plateau height for the segment that
    starts at that point — fine. For `smooth` / `s-curve` /
    `exponential` with non-zero `tension`, the scale also
    invalidates the assumed range that the tension parameter was
    tuned for; users see curve shape change unexpectedly. Not a
    bug per se, but undocumented coupling.

13. **`addAutomationPoint` re-sorts on every insert; `quantize`
    deduplicates without warning.** `addAutomationPoint.ts:14`
    sorts the entire `points` array per-insert. For a recording
    flush of N points, that's O(N² log N) total. Could be a
    sorted-insert (`bisectInsert`). `quantizeAutomationBeats.ts:14`
    silently drops collisions. A user quantizing a 100-point lane
    to 1/16 grid may see "20 points" after.

14. **`endDrawSession` callback-undo races with concurrent edits.**
    `automationDrawMode.ts:139-165` captures `previousPoints`
    once at `beginDrawSession`, then on `endDrawSession` reads
    `currentPoints = automationStore.value.lanes.find(...).points`
    and pushes a callback-undo. If anything else (recording flush,
    another draw session in another worker, Automerge sync from a
    collaborator) wrote to the lane between `begin` and `end`,
    those changes are silently rolled back by the undo and silently
    overwritten by the redo. The Automerge CRDT layer normally
    handles concurrent edits via merge — but the snapshot-based
    undo defeats the merge.

15. **`stopAutomationRecording` snapshots the entire `lanes` array
    for undo.** `stopAutomationRecording.ts:17,37,39`
    `structuredClone(automationStore.value.lanes)` before & after,
    `JSON.stringify(...)` for equality. Three issues:
    (a) `structuredClone` of a CRDT-projected snapshot may drop
    non-cloneable fields if any are added later;
    (b) `JSON.stringify` is order-sensitive — Automerge changes
    can re-order arrays for the same logical state;
    (c) the undo callback (`:43-45,48-51`) replaces all lanes,
    blowing away any unrelated lane edit (e.g. the user adjusts
    Track-3 gain mid-recording on Track-1). Cross-lane writes
    during a record session are silently undone.

16. **`recordAutomationValue` `write`-mode clears each tick.**
    `recordAutomationValue.ts:60`
    `clearPointsInRange(laneId, session.startBeat, compensatedBeat)`
    is called on every value sample. For a 120 BPM session with
    a 100 Hz scheduler, that's `clearPointsInRange` 100×/sec
    invoking `state.lanes.map(...)` to copy/filter each lane.
    O(lanes × points) per tick. Should be batched on flush.

17. **`recordAutomationValue` reads `transportStore.value.tempo`
    once per call; uses **base+output** latency at the moment of
    write.** `recordAutomationValue.ts:23-31`. If the audio context
    re-emits `outputLatency` mid-session (Chrome does this when
    audio output device changes), the recorded points before the
    change are at the old latency; new ones at the new latency.
    No splice / re-time. Also: `tempo` is read fresh each call;
    if tempo changes during recording, beats already recorded at
    the old tempo are not converted.

18. **`isRecordingAutomation` returns true in `latch` mode whenever
    `lastValue !== null`** — even after the user releases the
    control. `isRecordingAutomation.ts:25-27` says
    `return touchActive.has(key) || session.lastValue !== null`.
    `releaseTouchAutomation` (`:3-7`) only deletes from
    `touchActive`; it never resets `lastValue`. So every parameter
    that was touched once during a latch session keeps reporting
    `isRecordingAutomation === true` until `stopAutomationRecording`,
    which means `applyAutomation` skips writing the lane
    (`applyAutomation.ts:59-61`) and the audio engine drifts off
    the lane's curve until stop.

19. **`createAutomationLane` use case duplicates the model
    factory.** `useCases/automation/createAutomationLane.ts:8-17`
    is a 9-line wrapper around
    `models/Automation.createAutomationLane`. No added
    responsibility. AGENTS.md "useCases wrap repositories" —
    this wraps a model factory, not a repository, and adds
    nothing.

20. **`getAutomationLanes`, `getAutomationStoreState` are passive
    pass-throughs.** `getAutomationLanes.ts:4-6` returns
    `automationStore.value?.lanes ?? []`.
    `getAutomationStoreState.ts:3-5` returns `automationStore.value`.
    Cross-module consumers can read `automationStore` via the
    `stores/` barrel directly — the use cases add nothing. (Same
    pattern as the `audioAi/*.ts` no-op pass-throughs called out
    in the AudioAnalysis audit.)

21. **`scaleAutomationValues.ts` defaults `anchor = 0`.** For a
    parameter with `minValue=0, maxValue=1` (gain expressed
    linearly), an anchor of 0 means scaling values toward 0.
    Reasonable. For `minValue=-Infinity` or pan
    (`minValue=-50, maxValue=50`), anchor=0 still works. For dB
    gains with `minValue=-60, maxValue=12`, anchor=0 means
    scaling toward 0 dB — surprising. There is no per-parameter
    anchor (e.g. "scale around the lane's mean").

22. **`automationShapes.ts` 'sine' shape is wrong.** Lines 64-70
    produce `[0, 1, 0, 0, 0]` at relative beats `[0, 0.25, 0.5,
    0.75, 1.0]`. A sine in `[0, 1]` would be
    `[0.5, 1.0, 0.5, 0.0, 0.5]`. The current implementation is a
    triangular up-half + zero, **not** a sine. Combined with
    `'smooth'` curve (which degenerates to 2-point Hermite per
    issue #4), it's not even a useful approximation.

23. **`automationShapes.ts` 'random' is non-reproducible.**
    `automationShapes.ts:75` `Math.random()`. Insertion is
    non-deterministic; `undo`/`redo` round-trips of the random
    shape will see different points. CRDT merges across
    collaborators will diverge.

24. **`shiftClipAutomation` does not clamp `beat >= 0`.**
    `shiftClipAutomation.ts:18` `param.beat + beatDelta`. If a
    user nudges a clip backward past beat 0, the points get
    negative beats and `getAutomationValueAtBeat`'s binary search
    still works, but downstream UI rendering / serialisation may
    not handle negatives. Compare to
    `stretchAutomationTime.ts:18` which `Math.max(0, ...)` clamps.

25. **`duplicateClipAutomation` shallow-copies points.**
    `duplicateClipAutomation.ts:28`
    `sourceLanes[index]!.points.map((param) => ({ ...param }))`.
    Spread is shallow — `cp1` and `cp2` (objects with x/y) are
    shared references between source and duplicate. Editing
    `cp1.x` on the duplicate mutates the source. Same for any
    future nested fields.

26. **`duplicateClipAutomation` relies on index alignment.**
    `:15-30` runs `.map` twice, the second using
    `sourceLanes[index]!` to grab the corresponding source. The
    first map filters; the second map uses the index. This works
    only because both maps run over the same filtered array
    in-order. A future refactor that adds filtering or async
    inside the chain would silently break the alignment.

27. **`addAutomationLane` duplicate guard differs from
    `createAutomationLane`'s consumer.** `addAutomationLane.ts:10`
    bails on `(trackId, parameterId)` duplicate. But
    `Workspace/.../timelineTools.ts:140-145` reads the store,
    finds the lane, and if not found calls `addAutomationLane`,
    then re-reads. Two calls landing in the same tick (e.g. two
    automation points dropped on the same lane simultaneously)
    will both fail the find, both call `addAutomationLane`, and
    one will be silently no-op'd by the duplicate guard — but
    the caller will use a re-read result that exists.

28. **`setAutomationPointCurve` overwrites tension on every call.**
    `setAutomationPointCurve.ts:8` defaults `tension = 0.5`.
    `setAutomationPointCurve(laneId, beat, 'linear')` (no
    tension) silently overwrites the existing tension to 0.5.
    For 'linear' that's harmless (tension is unread); for any
    later switch to 'exponential' or 's-curve', the tension is
    now 0.5. Default mismatch with `addAutomationPoint`'s
    `tension ?? 0` (`handleAddAutomationPoint.ts:11`).

29. **`applyModulationToEngine` writes engine values every tick
    with no slewer.** `applyModulationToEngine.ts:75-83`
    computes `engineValue = clamp(base + delta, min, max)` and
    calls `updateDeviceParam(...)` unconditionally — no
    smoothing, no skip-when-unchanged. Compare to
    `applyAutomation` (`Transport/.../applyAutomation.ts:14-17,84-100`)
    which slews with `SLEW_ALPHA = 0.4` and skips when `Math.abs(delta) < SLEW_EPSILON`.
    Modulation produces audible zipper noise on low-rate parameters
    (e.g. filter cutoff at low Q). The two pipelines (modulation
    + automation) can also fight when both target the same param —
    last call wins per tick, so whichever runs after
    (`applyModulationToEngine` runs after `applyAutomation` per
    `playheadScheduler.ts:261-263`) silently overrides automation.

30. **`applyModulation` runtime store update spreads on every
    change.** `applyModulation.ts:17`
    `const runtimeValues: Record<string, number> = { ...(rtState?.runtimeValues ?? {}) };`
    — full clone every tick, even if only one of N modulators
    changed. At 100 Hz with 10 modulators that's 1000 small
    object allocations / sec. The `if (changed)` guard at `:32`
    prevents the store-set but the spread is unconditional.

31. **`computeModulatorValue` 'random' LFO has poor entropy and
    drifts.** `computeModulatorValue.ts:26`
    `Math.abs((Math.sin(Math.floor(playheadBeat / period) * 12.9898) * 43758.5453123) % 1)`.
    Hash-noise hack from a shader tutorial — fine for visual
    effects, poor for audio modulation. Not seedable. Loses
    precision as `playheadBeat` grows (the `floor` quantises;
    after very long sessions, the multiplied input loses bits).

32. **`computeModulatorValue` LFO `phase` modular reduction is
    wasteful.** `computeModulatorValue.ts:9`
    `(((playheadBeat / period + phase) % 1) + 1) % 1` — handles
    negative phase. Fine. But the `period = cfg.rate || 1`
    fallback (`:7`) silently coerces `rate=0` to `rate=1` instead
    of returning a constant; users typing 0 in the rate field
    get a 1-beat LFO. Naming: `rate` actually means *period*
    in beats — `LfoModulator.rate` should be renamed.

33. **`addModulator` doesn't validate `trackId`.**
    `addModulator.ts:5-10` writes whatever `trackId` is passed.
    If the track is later removed, the modulator becomes a
    dangling reference and `applyModulationToEngine.resolveBinding`
    silently returns null (`applyModulationToEngine.ts:21-24`).
    No reconciliation hook on track removal.

34. **`updateModulator` patch overwrites `mappings` if user
    passes them.** `updateModulator.ts:10`
    `{ ...m, ...patch, id: m.id }`. `Partial<Modulator>` allows
    `mappings: ...` to be passed; the spread replaces the entire
    array, not merged. The use case name suggests "update the
    modulator's metadata"; the contract permits replacing
    mappings wholesale. UI could call `updateModulator(id, { name: 'X' })`
    safely, but `updateModulator(id, { config: newCfg })` would
    discard accumulated mappings if a caller misreads.

35. **`removeMapping` has wrong identity key.** `removeMapping.ts:10`
    `m.mappings.filter((x) => x.targetParamId !== targetParamId)`.
    `ModulatorMapping` is identified by `(targetTrackId, targetDeviceId, targetParamId)`
    — `addMapping.ts:14-19` uses all three for de-dup. But
    `removeMapping` removes all mappings to **any** track/device
    that share the same `targetParamId`. A modulator that drives
    `cutoff` on Track A's filter AND `cutoff` on Track B's filter
    will lose **both** when the user removes one.

36. **`updateMapping` has the same wrong identity key.**
    `updateMapping.ts:14-15` matches by `targetParamId` only.
    Updating Track A's cutoff mapping silently mutates Track B's
    cutoff mapping if both share `cutoff`.

37. **`linkedLaneId` cycle guard adds visited inside a branch.**
    `getAutomationValueAtBeat.ts:38-49`. `_visited.add(laneId)`
    is added on the recursion-down path only. If lane B with
    `linkedLaneId = A` is read first and A has no
    `linkedLaneId`, `_visited` is `{B}` after the first call.
    Then on subsequent reads of B in the same scheduler tick
    (via the cache hit path), `_visited` is a fresh `Set`
    (default arg). Fine. But the inline doc says "Guard against
    circular links (A→B→A)" — the implementation does, but the
    fall-through behaviour when `sourceVal === null` (the linked
    lane is empty) silently uses local points instead, which
    isn't documented and is surprising. Either drop local fallback
    or document.

38. **`automationStore` and `modulationStore` share `DOC_PREFIX_ROOT = 'root'`.**
    `automationStore.ts:8`, `modulationStore.ts:6`. The Automerge
    storage keys are `('root', 'automation')` and `('root', 'modulation')`.
    Fine. But `modulationRuntimeStore`
    (`modulationStore.ts:20-24`) is created with **no** storage —
    correct (ephemeral 30 fps values shouldn't persist) but the
    creation is silent. If a future refactor passes a storage
    arg by mistake, runtime values land in CRDT history and
    every modulator value gets sync'd to collaborators. Add a
    runtime-only assertion or type-brand.

39. **`endDrawSession` snapshot of `currentPoints` deep-copies via
    `[...currentLane.points]`.** `automationDrawMode.ts:137`. The
    spread is shallow — the `cp1`/`cp2` references are shared
    between the snapshot and the live store. A subsequent edit to
    a curve's control point mutates both the live state and the
    callback-undo snapshot. The undo would then "undo" to a
    state that already includes the post-edit cp.

40. **`automationDrawMode.snapToGrid(beat, 0)` divides by zero.**
    `automationDrawMode.ts:36-37`. `Math.round(beat / 0) * 0` is
    `NaN * 0 = NaN`. `paintDrawPoint` then sets `snappedBeat = NaN`,
    which trickles into `points.filter(p => Math.abs(p.beat - NaN) > 0.001)`
    — `NaN` comparisons are always false, so the filter drops
    nothing; then `[...filtered, { beat: NaN, ... }]` adds a NaN
    point that the binary search later misorders. No guard on
    `gridResolution > 0`.

41. **`updateAutomationObjectPoint` does not push undo.**
    `updateAutomationObjectPoint.ts:8-52`. Mutates pooled-clip
    automation points. No undo. R-H1 (pool propagation) and
    R-H2 (override) semantics are implemented, but the user
    drags a control-point in a pooled clip and **cannot undo** it.

42. **AGENTS.md "function signature" rule violations.** Functions
    with multiple positional parameters that should take a single
    object param:
    - `addAutomationLane(trackId, parameterId, parameterName)`
    - `addAutomationPoint(laneId, point)`
    - `batchAddAutomationPoints(laneId, points)`
    - `createAutomationLane(trackId, parameterId, parameterName, minValue, maxValue, clipId)` (model factory; use case mirrors)
    - `duplicateClipAutomation(sourceClipId, newClipId)`
    - `getAutomationValueAtBeat(laneId, beat, _visited)`
    - `quantizeAutomationBeats(laneId, gridSize)`
    - `removeAutomationPoint(laneId, beat)`
    - `resetOverride(laneId, objectId, property)`
    - `scaleAutomationValues(laneId, factor, anchor)`
    - `setAutomationPointCurve(laneId, beat, curve, tension)`
    - `shiftClipAutomation(clipId, beatDelta)`
    - `stretchAutomationTime(laneId, factor, anchorBeat)`
    - `thinAutomationPoints(laneId, tolerance)`
    - `updateAutomationObjectPoint(laneId, objectId, beat, newValue, newBeat)`
    - `updateAutomationPoint(laneId, beat, newValue, newBeat)`
    - `recordAutomationValue(trackId, parameterId, value, beat)`
    - `selectPointsInRange(laneId, beatStart, beatEnd, valueMin, valueMax)`
    - `deleteSelectedPoints(laneId, selectedBeats)`
    - `getSelectionBounds(laneId, selectedBeats)`
    - `transformSelectedPoints(laneId, selectedBeats, xScale, yScale, xOffset, yOffset)`
    - `adjustYZoom(laneId, delta)`
    - `addModulator(modulator)` (1 param, OK)
    - `updateModulator(id, patch)` / `addMapping(modulatorId, mapping)` / `removeMapping(modulatorId, targetParamId)` / `updateMapping(modulatorId, targetParamId, patch)` — all positional.

    Per AGENTS.md "Functions with more than one parameter take a
    single object param".

43. **AGENTS.md "Use-case types stay private" violations.**
    `useCases/index.ts:9` re-exports
    `type AutomationRecordingDependencies`, `:11` re-exports
    `type ModulationDependencies`. AGENTS.md: "Do not `export type`
    from `useCases/` for other modules". Cross-module callers
    that consume these (e.g. `bootstrap.ts`) import the values,
    not the types — but the type names are still surfaced.

44. **AGENTS.md "Model isolation" violation: cross-module model
    import.** `Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts:9`
    `import { type AutomationCurveType, type AutomationLane } from '#/modules/Automation/models/Automation'`.
    `models/` is private. The Project module should define its
    own local type or accept an opaque `unknown` from the doc
    and validate.

45. **Cross-module consumers reach into `useCases/automation/*`
    (deep imports).** Multiple test files in
    `Workspace/...` and `Transport/...` import directly from
    `#/modules/Automation/useCases/automation/<name>`,
    `/automationRecording/<name>`, `/modulation/<name>`. Per
    AGENTS.md "no-cross-module-internals". These are mostly in
    test files using `vi.mock(...)`, but production code includes
    `Workspace/handlers/workspace/handleSetWorkspaceMode` (test
    only) — still a smell when the import path leaks through.

46. **`presentations/views/index.ts` only exports `ModulationMatrix`.**
    No `AutomationLaneRow` or `AutomationView` lives in this
    module — those are in `Workspace/`. Fine, but means the
    Automation module's own UI is one screen; the rest of the
    automation editing UI is in `Workspace/presentations/views/AutomationView/`.
    The split is not justified by a comment; a future reader
    will look for the lane editor here and not find it.

47. **`events/index.ts` is an empty module with a single comment.**
    "No event payload types exported from this module". Either
    delete the file (the index isn't required if there are no
    events) or move the comment to the root index. As-is, the
    barrel exists for nothing.

48. **`getAutomationHandlers.spec.ts` is a smoke test only.**
    `useCases/__tests__/getAutomationHandlers.spec.ts:7-10`
    asserts the function exists and is a function. Does not
    invoke it; does not assert the returned map has the 9 keys
    or that they are the right action handlers. A handler
    accidentally renamed in the import would still pass.

49. **`automationHandlers.spec.ts` mocks every use case but
    asserts only `delegate-to` semantics.** `:21-29` mocks all
    9 use cases as `vi.fn()`; tests assert
    `expect(useCase).toHaveBeenCalledWith(<args>)`. None of the
    handlers' `describe()` outputs are tested (label content,
    inverseAction shape) and none of the `undoable: true`
    contract is tested. The silent-undo bug (#2) would not be
    caught by any current test.

50. **16 of 22 lane CRUD specs are smoke tests only.** Listed
    in "Current behavior". Pattern:
    `expect(subject.foo).toBeDefined(); const time = typeof subject.foo; expect(time === 'function' || time === 'object').toBe(true);`
    These tests cost CI cycles and confer no behavioural
    guarantees.

51. **`thinAutomationPoints.spec.ts` mocks the wrong module.**
    `useCases/automation/__tests__/thinAutomationPoints.spec.ts:11-17`
    `vi.mock('#/modules/Arrangement/useCases', ..., { rdpSimplify: vi.fn() })`.
    Production
    (`useCases/automation/thinAutomationPoints.ts:1`) imports
    `simplifyAutomationPoints` from
    `../../services/automationPointAlgorithms`. The mock is
    inert. Test passes by accident — `state` is null in the
    test, so the use case returns early before any algorithm
    is called.

52. **AGENTS.md `Modulator.config` discriminated union has a
    redundant `kind` discriminator.** `Modulator.kind` and
    `Modulator.config.kind` both exist (`models/Modulator.ts:38-46`).
    They must agree. `addModulator.ts:5` builds the id from
    `modulator.kind` only — doesn't validate that
    `modulator.config.kind === modulator.kind`. `updateModulator`
    `{ ...m, ...patch, id: m.id }` (`updateModulator.ts:10`) lets
    a caller patch `kind: 'lfo'` without patching `config` —
    silently corrupts the discriminated state.

53. **`zoomToUsedRange` blows the stack on 100k+ points.**
    `zoomToUsedRange.ts:18-19`
    `Math.min(...values)` / `Math.max(...values)` — JS spread
    has a per-engine arg-count cap (~32k V8 / ~64k JSC). For a
    long recording session at 100 Hz, ~5 minutes already produces
    30k samples — within reach during normal use. This silently
    throws. Compare to `getSelectionBounds`
    (`getSelectionBounds.ts:33-46`) which already does the
    single-pass.

54. **React key collision in `ModulationMatrix.MappingRow`.**
    `presentations/views/ModulationMatrix.tsx:599`
    `key={`${row.modulator.id}:${row.mapping.targetParamId}`}`.
    Two mappings on the same modulator that target the same
    `targetParamId` (e.g. `cutoff` on Track A's filter and Track
    B's filter) collide on the React key. React warns in dev and
    re-uses the DOM node in prod — the second mapping is
    invisible in the UI. Combined with issue #10
    (`removeMapping` matches by `targetParamId` only), the user
    never sees the duplicate, clicks the only "remove" they see,
    and both mappings disappear. Even the `flatMap` at
    `ModulationMatrix.tsx:534-540` produces both rows in the
    array; only React's dedup hides the second.

55. **`recordAutomationValue` silently uses 120 BPM when the
    transport store is unset.** `recordAutomationValue.ts:23-24`
    `const tempo = transport?.tempo ?? 120;`. Hardcoded fallback
    is never logged and never tracked — recordings made before
    transport hydrates land with the wrong beat-to-second
    conversion. Worse: `transport` is read fresh on every call,
    so a tempo *change* mid-recording converts new samples at
    the new tempo while old samples keep the old timestamp —
    silent timing drift across the recording.

56. **`applyAutomation` only writes to the FIRST device that
    exposes the parameter.** `Transport/.../applyAutomation.ts:81-91`
    iterates `track.devices`, finds the first device with
    `device.parameterValues[lane.parameterId] !== undefined`,
    writes, then `break;`. If two devices on the same track
    expose the same `parameterId` (legitimately — multiple
    filters with `cutoff`), only the first is automated and the
    rest never get the lane value. The MIDI FX loop
    (`:94-104`) has the same `break;`. The Automation lane has
    no way to disambiguate by device id; it carries
    `(trackId, parameterId)` only — so this is an *architectural*
    gap, not just a missing branch.

57. **`removeMapping` / `updateMapping` API is positional and
    typed as `string`.** `removeMapping.ts:3` takes
    `(modulatorId: string, targetParamId: string)`;
    `updateMapping.ts:4` takes
    `(modulatorId: string, targetParamId: string, patch: ...)`.
    The two `string`s have no type-level distinction —
    swap-the-arguments bugs are silent. Together with issue #10,
    fix the signature to take a discriminated identity object:
    `{ modulatorId: ModulatorId, mapping: ModulatorMapping }`
    (with branded ids).

58. **`addMapping` writes amount silently when the mapping
    already exists.** `addMapping.ts:14-31` — when a duplicate
    mapping is added (same `targetTrackId/targetDeviceId/targetParamId`),
    the existing mapping is replaced via `{ ...x, ...mapping }`
    (`:27`). Net effect: re-adding from the picker silently
    *resets* the user's `amount` to 0.5 (the picker default,
    `ModulationMatrix.tsx:366`). The user creates a mapping, dials
    amount to 0.9, accidentally re-creates the mapping, amount
    snaps back to 0.5. No warning.

59. **`activeRecording` / `pendingPoints` / `touchActive` are
    module-level mutable maps — not test-isolated.**
    `recordingSessionState.ts:21-23` exports raw `Map`/`Set`
    singletons. Any test that imports `recordAutomationValue` or
    `isRecordingAutomation` and forgets to `clear()` them in
    `beforeEach` carries state across specs. The current test
    suite does the right thing in isolated specs (each one
    `vi.mock`s the module), but *integration* tests that don't
    mock will see leftover state. The pattern violates the
    AGENTS.md "no module-level mutable state without DI seam"
    principle (the latency dependency went via DI; the recording
    session state did not).

60. **`startAutomationRecording` does not seed sessions with the
    current playhead beat — they all start at 0.**
    `startAutomationRecording.ts:30-35` sets
    `startBeat: 0` for every active recording, regardless of
    playhead position. If the user starts recording mid-arrangement
    at beat 32, then in `latch`/`touch` mode `clearPointsInRange(laneId, 0, lastBeat)`
    (`stopAutomationRecording.ts:30`) would clear from beat 0 —
    not from the actual recording start. Saved by happy
    accident: latch-mode clear is gated on `lastBeat > startBeat`
    (`:29`), and `lastBeat` is `compensatedBeat` from the
    recorder which *is* the playhead. So the clear is from beat 0
    to roughly `playhead`, wiping any pre-existing automation
    before the user started recording. **This is silent data
    loss in latch mode, not a near-miss.** Same hazard exists
    in write mode via `recordAutomationValue.ts:60`
    `clearPointsInRange(laneId, session.startBeat, compensatedBeat)`
    where `session.startBeat` is `compensatedBeat` of the *first*
    recorded value, not 0 — so write mode is OK. Latch is the
    bug.

61. **`removeModulator` does not clear runtime values for the
    *modulator's mappings* — only for its own id.**
    `removeModulator.ts:12-17` deletes `runtimeValues[id]` (the
    modulator id). But `getModulationForParam.ts:20` reads
    `rtState?.runtimeValues[mod.id]` — so removing the modulator
    while playback is active *should* zero its contribution. OK.
    However `applyModulationToEngine.ts:77-83` writes
    `engineValue = clamp(baseValue + delta, ...)` *every tick*
    while the modulator exists — the moment the modulator is
    removed, no further writes happen, but the engine retains the
    last written value. The user removes a mapping → the param
    is stuck at the last modulated value, not the base value.
    The fix is either to write `binding.baseValue` once on
    `removeModulator`/`removeMapping`, or to track all modulated
    params and reset them when their last modulator goes away.

62. **`computeModulatorValue` `'random'` LFO returns
    `Math.abs((sin(...) * 43758...) % 1)` — `Math.abs(x % 1)`
    is in `[0, 1)`, but the `Math.sin` argument
    `Math.floor(playheadBeat / period) * 12.9898` is integer ×
    12.9898 → as `playheadBeat` grows past ~2³⁰ × period, the
    integer multiplied by 12.9898 exceeds Number.MAX_SAFE_INTEGER
    bits and the modulo loses entropy.** At 120 BPM with
    `period = 1`, that's ~64 hours of playback — beyond practical
    sessions. **Demote** to "harmless in practice" but document
    the assumption.

63. **`updateModulator` allows the caller to overwrite `kind`
    and break the `kind`/`config.kind` discriminator.**
    `updateModulator.ts:10`
    `{ ...m, ...patch, id: m.id }` — `patch` is
    `Partial<Modulator>`. A caller can pass `{ kind: 'envelope' }`
    while `m.config.kind` stays `'lfo'`. `computeModulatorValue.ts:6`
    branches on `cfg.kind` (the config-side discriminator), so
    the modulator computes as LFO but the UI renders the
    envelope card (`ModulationMatrix.tsx:491` `KIND_LABELS[modulator.kind]`).
    The two are silently inconsistent.

64. **`stopAutomationRecording` `JSON.stringify` whole-`lanes`
    deep-equality is a memory and time hazard.**
    `stopAutomationRecording.ts:39`
    `JSON.stringify(laneBefore) !== JSON.stringify(laneAfter)`.
    For 100 lanes × 1k points × ~40 bytes/point that's ~4 MB
    serialised, twice, on every recording stop — and the
    serialisation order is array-stable, but Automerge can change
    object-property order during a sync. A successful recording
    that adds zero points but changes Automerge metadata can
    silently push an undo entry that "restores" to the same
    state, polluting the undo stack with no-ops. Replace with
    a per-lane `points.length`/`points` reference compare gated
    by the active recording sessions' lane ids.

65. **`Modulator.config` discriminator and `Modulator.kind` are
    redundant and forbidden by AGENTS.md "soundness".**
    `models/Modulator.ts:37-45`. The two fields must agree but
    nothing enforces it (issues #18b, #63). The cleanest fix is
    to remove `Modulator.kind` entirely — `m.config.kind` is the
    single discriminator. Callers that today use `modulator.kind`
    (`ModulationMatrix.tsx:491,599`, `addModulator.ts:5`) switch
    to `modulator.config.kind`. The `id` prefix can either stay
    (`mod-${modulator.config.kind}-...`) or use `'mod'` only.

---

## Priorities

1. **Silent undo data loss (issue #2 / #6).** Every action handler
   marks `undoable: true` but provides no `inverseAction`. Undo is
   a no-op; the entry is consumed from `past` and the user's edit
   sticks. This is the most user-visible correctness bug today.
2. **`'bezier'` curve never interpolated; `'envelope'` modulator
   never produces value (issues #3 / #5).** Two declared features
   are dead at runtime. UI lets users pick them; the audio engine
   ignores them.
3. **Test theatre: 16 smoke tests + 1 wrong-mock-path test
   (issues #50 / #51 / #48).** Lane CRUD and the handler-delegation
   surface are effectively uncovered. Any DSP / state regression
   ships green.
4. **`removeMapping` / `updateMapping` wrong identity key
   (issues #35 / #36).** Modulating the same parameter on two
   tracks is broken: removing or updating one mapping mutates
   both.
5. **Action surface covers <50% of use cases (issue #8).** Most
   automation edits don't go through the command bus; they have
   no undo path, no audit trail, no macro recording.
6. **`isRecordingAutomation` `latch`-mode never resets `lastValue`
   (issue #18).** Once a parameter is touched in latch, the
   scheduler skips writing its automation lane until
   `stopAutomationRecording` — the user hears the recorded value
   stick instead of the curve continuing.
7. **`applyModulationToEngine` no slewer; fights with
   `applyAutomation` (issue #29).** Audible zipper on filter
   cutoff & friends; modulation overrides automation when both
   target the same param.
8. **Selection identity is float-keyed (issue #7).** Any beat-
   modifying edit silently corrupts selection.
9. **`endDrawSession` / `stopAutomationRecording` undo replaces
   whole `lanes` array (issues #14 / #15).** Cross-lane edits
   during a draw or record session are silently undone.
10. **Architectural drift: no module-root index (issue #1),
    `useCases/index.ts` exports types (issue #43), `Project`
    imports models directly (issue #44), 22+ functions take
    positional params (issue #42).**
11. **`startAutomationRecording` seeds sessions with `startBeat: 0`
    regardless of playhead — latch-mode `clearPointsInRange`
    wipes pre-existing automation from beat 0 to playhead
    (issue #60).** Silent data loss when the user starts
    recording mid-arrangement.
12. **`applyAutomation` only writes the first device exposing the
    parameter (issue #56).** Multi-instance plugins on the same
    track can never be co-automated through the lane.
13. **`removeModulator`/`removeMapping` leaves the engine param
    stuck at the last modulated value (issue #61).** No reset
    to the base value — the user perceives a stuck filter or
    cutoff after removing a modulator while playing.
14. **`addMapping` silently resets `amount` to 0.5 on duplicate
    add (issue #58).** Re-creating a mapping wipes user-tuned
    amount.

---

## Open issues

### 1. No module-root `index.ts`

**Problem:** `src/modules/Automation/` has no `index.ts`. AGENTS.md
"Contract Boundaries" mandates a root `index.ts` as the only cross-
module entry. Today consumers reach into three sub-barrels
(`useCases`, `stores`, `presentations/views`) and the private
`models/` directory. There's no enforcement of what's "public" vs
"internal".

**Representative files:**

- `src/modules/Automation/` (no `index.ts`)
- `src/modules/Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts:9`
- `src/modules/Workspace/presentations/views/Inspector/DeviceParameterControl.tsx:8`
- `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts:8-9`

**Needed:** Add `src/modules/Automation/index.ts` that re-exports
the public API only — `useCases/index.ts` (runtime values),
`stores/index.ts`, `presentations/views/index.ts`, and any genuinely
public types (none should be from `useCases/` per AGENTS.md). Audit
cross-module imports and migrate them to the root barrel.
Demote the existing sub-barrel imports in consumer modules.

### 2. `undoable: true` handlers never provide `inverseAction` — undo silently does nothing

**Problem:** Every handler in `handlers/automation/` is marked
`undoable: true` and `describe()` returns `{ label }` only.
`executeAppAction` pushes the entry with `inverseAction: null`;
`undoRedo.executeUndo` short-circuits on null — the entry is
consumed from `past` and **no inverse action runs**. The user's
edit persists; the user's undo button consumes a slot but does
nothing.

**Verified call chain (2026-04-28):**

1. `executeAppAction.ts:36-38` — sets `undoResult` only if `handler.undoable`. Every Automation handler has `undoable: true`.
2. `executeAppAction.ts:50` — runs `handler.execute(action)` (mutates the store irreversibly).
3. `executeAppAction.ts:60-72` — pushes an action-history entry with `inverseAction: undoResult?.inverseAction ?? null`. Since none of the Automation `describe()` calls return `inverseAction`, this is **always null**.
4. `executeAppAction.ts:75-87` — calls `commitUndoEntry(createUndoEntry(label, action, undoResult.inverseAction ?? null, …))`. The undo entry is `{ kind: 'action', action, inverseAction: null }`.
5. `undoRedo.ts:6-12` — `executeUndo` checks `entry.kind === 'callback'` (false — kind is `'action'`), then `entry.inverseAction` (null) — falls through, does nothing.
6. `undoRedo.ts:50-56` — pops the entry from `past` and pushes to `future`.

Net effect: the user's history entry is consumed, but the underlying state is never reverted. **Redo** is equally broken in the symmetric direction — `executeRedo` re-runs the original action, which produces the *same* mutated state, so the user can't tell from the UI whether they're undoing or redoing.

**Representative files:**

- `src/modules/Automation/handlers/automation/handleAddAutomationLane.ts:5-11`
- `src/modules/Automation/handlers/automation/handleAddAutomationPoint.ts:5-19`
- `src/modules/Automation/handlers/automation/handleRemoveAutomationPoint.ts:6-23`
- `src/modules/Automation/handlers/automation/handleScaleAutomation.ts:5-11`
- `src/modules/Automation/handlers/automation/handleStretchAutomation.ts:5-11`
- `src/modules/Automation/handlers/automation/handleInvertAutomation.ts:5-11`
- `src/modules/Automation/handlers/automation/handleReverseAutomation.ts:5-11`
- `src/modules/Automation/handlers/automation/handleThinAutomation.ts:5-11`
- `src/modules/Automation/handlers/automation/handleQuantizeAutomation.ts:5-11`
- `src/modules/Command/useCases/undoRedo.ts:6-12` (the no-op path)

**Needed:** Either provide a real `inverseAction` per handler
(symmetric pairs: `addAutomationLane` ↔ `removeAutomationLane`;
`addAutomationPoint` ↔ `removeAutomationPoint`;
`scaleAutomation(factor, anchor)` ↔ `scaleAutomation(1/factor, anchor)`;
`stretchAutomation(factor, anchorBeat)` ↔ `stretchAutomation(1/factor, anchorBeat)`;
`invertAutomation` is its own inverse;
`reverseAutomation` is its own inverse) — or capture a snapshot in
`describe()` and emit a callback-undo via `pushUndoEntry`. For
`thin` / `quantize` the snapshot route is the only honest one
(both are lossy). Add a test per handler that asserts undo
restores the prior state.

### 3. `'bezier'` curve type is declared but never interpolated

**Problem:** `AutomationCurveType` includes `'bezier'`.
`setAutomationPointCurve` and `addAutomationPoint` accept it.
`AutomationPoint` has `cp1`/`cp2` fields. But
`interpolateAutomationPointValue` has no bezier branch — falls
through to the linear default. A user who picks "bezier" sees a
straight line at runtime.

**Representative files:**

- `src/modules/Automation/models/Automation.ts:1`
- `src/modules/Automation/services/automationPointAlgorithms.ts:88-127`
- `src/modules/Automation/useCases/automation/setAutomationPointCurve.ts:7`
- `src/modules/Automation/handlers/automation/handleAddAutomationPoint.ts:10-14`

**Needed:** Implement cubic bezier interpolation using `cp1`/`cp2`
as normalised (0..1) control points within the `[firstPoint,
secondPoint]` segment. Add a positive-path test that asserts the
curve passes through the endpoints and bends through the control
points. Or remove `'bezier'` from the union and `cp1`/`cp2` from
the model if the feature is not shipping.

### 4. `getAutomationValueAtBeat` does not pass `previousPoint` / `nextPoint` for Catmull-Rom smoothing

**Problem:** `interpolateAutomationPointValue` accepts optional
`previousPoint` and `nextPoint` for the `'smooth'` Catmull-Rom
spline (`automationPointAlgorithms.ts:113-125`). The call site in
`getAutomationValueAtBeat` (`getAutomationValueAtBeat.ts:79-83`)
does not pass them. Every interior point falls back to
`v0 = firstPoint.value` and `v3 = secondPoint.value`, collapsing
the spline to a 2-point Hermite that doesn't smooth across
neighbours.

**Test-locked.** `useCases/automation/__tests__/automationPoints.spec.ts:133-138`
explicitly asserts:

```ts
expect(mocks.interpolateAutomationPointValue).toHaveBeenCalledWith({
    firstPoint: points[0],
    secondPoint: points[1],
    beat: 7.5,
});
```

The buggy 3-arg call shape is now the *contract* the test enforces. Adding the fix (passing `previousPoint`/`nextPoint`) will fail this test — the test must be updated together with the fix, otherwise a future agent will revert the fix to keep CI green.

**Representative files:**

- `src/modules/Automation/useCases/automation/getAutomationValueAtBeat.ts:79-83`
- `src/modules/Automation/services/automationPointAlgorithms.ts:69-125`

**Needed:** Look up `previousPoint` (= `points[beforeIdx - 1]`)
and `nextPoint` (= `points[beforeIdx + 2]`) and pass them when
`firstPoint.curve === 'smooth'`. Add a test that compares the
smooth-curve output for `[A, B, C, D]` against
`[B, C]` (two-point) and asserts they differ.

### 5. `'envelope'` modulator kind has no implementation

**Problem:** `computeModulatorValue` (`computeModulatorValue.ts:3-43`)
handles `'lfo'` and `'step'`. The `'envelope'` kind is declared in
`Modulator['config']` (with attack/decay/sustain/release) and the
view UI lets users create envelopes — but `computeModulatorValue`
falls through to `return 0` for envelopes. Forever.

**Representative files:**

- `src/modules/Automation/models/Modulator.ts:14-21`
- `src/modules/Automation/useCases/modulation/computeModulatorValue.ts:42`
- `src/modules/Automation/presentations/views/ModulationMatrix.tsx:122-152`
- `src/modules/Automation/useCases/modulation/__tests__/computeModulatorValue.spec.ts:65-76`
  (the test asserts `return 0`, locking in the dead behaviour)

**Needed:** Implement envelope evaluation against the trigger source
(`triggerMode: 'midi' | 'audio' | 'sync'`). Or remove envelope
from `ModulatorKind` and from the UI until trigger plumbing exists.
Don't ship a UI that produces no audio effect.

### 6. Float-key selection breaks across edits

**Problem:** Selection is `selectedBeats: number[]`. After any edit
that moves a point's beat (`updateAutomationPoint(laneId, oldBeat,
newValue, newBeat)`, `transformSelectedPoints`,
`stretchAutomationTime`, `quantizeAutomationBeats`,
`reverseAutomation`, `shiftClipAutomation`), the previously-
selected beats no longer correspond to any point. Selection
silently empties.

**Representative files:**

- `src/modules/Automation/useCases/automationSelection/selectPointsInRange.ts:32`
- `src/modules/Automation/useCases/automationSelection/deleteSelectedPoints.ts:5,17-18`
- `src/modules/Automation/useCases/automationSelection/getSelectionBounds.ts:8,21`
- `src/modules/Automation/useCases/automationSelection/transformSelectedPoints.ts:9,25,55-66`
- `src/modules/Automation/useCases/automation/updateAutomationPoint.ts:14`

**Needed:** Either add a stable per-point id (`AutomationPoint.id`)
and key selection by id, or have edit operations return a beat-
remapping that callers apply to the `selectedBeats` set. The
current contract — float-equality on a mutable beat field — is
load-bearing-by-accident.

### 7. Action surface covers <50% of use cases

**Problem:** Only 9 actions land in `getAutomationHandlers`. The
following use cases have **no** AppAction routing and therefore no
audit trail, no undo, no macro recording, no AI access:
`removeAutomationLane`, `setAutomationPointCurve`,
`toggleAutomationVisibility`, `toggleLaneCollapsed`,
`shiftClipAutomation`, `duplicateClipAutomation`,
`updateAutomationPoint`, `updateAutomationObjectPoint`,
`resetOverride`, `batchAddAutomationPoints`,
`automationDrawMode/*`, `automationSelection/*`,
`automationZoom/*`, `modulation/*`. Presentation calls them
directly (`AutomationLaneRow.tsx:240`, etc.).

**Representative files:**

- `src/modules/Automation/useCases/getAutomationHandlers.ts:13-43`
- `src/modules/Command/useCases/commandQueries.ts:128-207`
  (the AppAction union)
- `src/modules/Workspace/presentations/views/AutomationView/AutomationLaneRow.tsx:10-15`

**Needed:** Decide which use cases are command-bus material. At
minimum: `removeAutomationLane`, `setAutomationPointCurve`,
`updateAutomationPoint`, `deleteSelectedPoints`, modulation CRUD.
For "view-only" toggles (`toggleAutomationVisibility`,
`toggleLaneCollapsed`, `automationZoom/*`), explicitly mark them
"UI-only, not undoable" and document the decision.

### 8. `isRecordingAutomation` `latch` mode never resets `lastValue`

**Problem:** `isRecordingAutomation.ts:25-27` returns `true` in
latch mode whenever `session.lastValue !== null`.
`releaseTouchAutomation.ts:3-7` only deletes from `touchActive` —
it never resets `lastValue`. Every parameter that was touched once
in a latch session keeps reporting "recording" until
`stopAutomationRecording`. `applyAutomation.ts:59-61` skips
writing the lane when `isRecordingAutomation` is true, so the
audio engine drifts off the lane's curve and holds at the last
recorded value until stop.

**Representative files:**

- `src/modules/Automation/useCases/automationRecording/isRecordingAutomation.ts:25-27`
- `src/modules/Automation/useCases/automationRecording/releaseTouchAutomation.ts:3-7`
- `src/modules/Automation/useCases/automationRecording/recordingSessionState.ts:21,38-54`
- `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts:59-61`

**Needed:** Decide latch semantics: either `releaseTouchAutomation`
also clears `session.lastValue`, or `isRecordingAutomation` for
latch returns `touchActive.has(key)` only and the latch "hold the
last value" is implemented in the lane (a synthetic hold-point at
release time) rather than as a scheduler skip. Add a positive-path
test that asserts `applyAutomation` writes the lane after a latch
release.

### 9. `applyModulationToEngine` writes engine values every tick — no slewer, fights with `applyAutomation`

**Problem:** Two sub-issues. (a) Modulation writes are
unconditional per tick — no slewer, no skip-when-unchanged. Audible
zipper noise on low-rate parameters. (b) Both `applyAutomation`
and `applyModulationToEngine` write the same engine params; the
later one wins per tick. `playheadScheduler.ts:261-263` runs them
in order: automation, then modulation. Modulation silently
overrides automation when both target the same parameter.

**Representative files:**

- `src/modules/Automation/useCases/modulation/applyModulationToEngine.ts:75-83`
- `src/modules/Transport/useCases/playheadScheduler.ts:261-263`
- `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts:14-17,84-100`
  (for the slewer reference)

**Needed:** Add the same `SLEW_ALPHA` / `SLEW_EPSILON` slewer in
`applyModulationToEngine` (or pull it into a shared helper). Decide
the contract when both automation and modulation target the same
param: typically modulation should be additive/multiplicative on
top of automation (modulation as a delta). Either way, the two
writers must coordinate — add a single write site (combine in a
single function call per device per tick).

### 10. `removeMapping` / `updateMapping` use `targetParamId` as the identity key

**Problem:** Mappings are uniquely identified by
`(targetTrackId, targetDeviceId, targetParamId)` — `addMapping`
de-dupes on all three. But `removeMapping` and `updateMapping`
match by `targetParamId` alone. A modulator that drives `cutoff`
on Track A's filter AND on Track B's filter loses both when the
user removes one; updating one silently mutates the other.

**Compounded with React-key collision (issue #54).** The
`MappingRow` component is keyed by
`${row.modulator.id}:${row.mapping.targetParamId}`
(`ModulationMatrix.tsx:599`) — same wrong identity. Two mappings
with matching `(modulatorId, targetParamId)` produce duplicate
React keys: React will warn in dev and silently reuse the same
DOM node in prod, so the user *sees* one row in the matrix and
believes the second mapping doesn't exist. They click "remove"
on the only visible row → both mappings vanish (because of the
matching `removeMapping` bug). Two bugs covering for each
other — the user never sees the second mapping until reload.

**Representative files:**

- `src/modules/Automation/useCases/modulation/addMapping.ts:14-19`
  (correct identity)
- `src/modules/Automation/useCases/modulation/removeMapping.ts:10`
- `src/modules/Automation/useCases/modulation/updateMapping.ts:14-15`
- `src/modules/Automation/presentations/views/ModulationMatrix.tsx:435,463`
  (consumers that pass only `targetParamId`)

**Needed:** Change the signature of `removeMapping` /
`updateMapping` to take the full mapping identity
(`{ targetTrackId, targetDeviceId, targetParamId }`). Update
consumers. Add tests with two mappings sharing the same
`targetParamId` across tracks and assert the operations only
affect the intended one.

### 11. `endDrawSession` / `stopAutomationRecording` undo replaces the whole `lanes` array

**Problem:** Both paths capture a whole-`lanes` snapshot and a
callback-undo that restores it. Any unrelated lane edit (or
collaborator-driven CRDT change) that landed during the session
is silently undone when the user clicks undo, and silently
re-overwritten on redo.

**Representative files:**

- `src/modules/Automation/useCases/automationDrawMode.ts:139-165`
- `src/modules/Automation/useCases/automationRecording/stopAutomationRecording.ts:17,37-55`

**Needed:** Replace whole-lanes snapshot with **per-lane**
snapshot: capture only the lanes that were actually modified
during the session. For a draw session, that's exactly one lane —
use `previousPoints` and `currentPoints` already kept on the lane
(the existing draw-mode code captures these but then snapshots all
lanes at end). For a recording session, capture per-(track,
parameter) lane snapshots keyed by the active `pendingPoints`
keys.

### 12. `'sine'` shape is wrong; `'random'` shape is non-reproducible

**Problem:** `automationShapes.ts:64-70` produces
`[0, 1, 0, 0, 0]` at relative beats `[0, 0.25, 0.5, 0.75, 1.0]`.
That's not a sine — it's a triangular up-half + zero. (A normalised
sine in `[0, 1]` would be `[0.5, 1, 0.5, 0, 0.5]`.)
`automationShapes.ts:75` uses `Math.random()` for 'random' —
non-deterministic; undo/redo round-trips and CRDT merges across
collaborators all diverge.

**Representative files:**

- `src/modules/Automation/useCases/automationShapes.ts:64-79`

**Needed:** Replace 'sine' with the correct phase-locked
sample-and-hold (or, given the smooth-curve fallback, generate
quarter-period samples at `[0, π/2, π, 3π/2, 2π]` mapping to
`[0.5, 1, 0.5, 0, 0.5]`). Replace `Math.random()` with a seeded
PRNG and persist the seed on the inserted points (or on a
parent automation object) so undo/redo is deterministic.

### 13. `recordAutomationValue` write-mode clears per tick; no batching

**Problem:** `recordAutomationValue.ts:60` calls
`clearPointsInRange(laneId, session.startBeat, compensatedBeat)`
on every value sample, which `state.lanes.map()`s the entire
lanes array and per-lane `points.filter()` per call. At a 100 Hz
scheduler, that's 100 full-lanes copies per second per recording
parameter.

**Representative files:**

- `src/modules/Automation/useCases/automationRecording/recordAutomationValue.ts:57-62`
- `src/modules/Automation/useCases/automationRecording/recordingSessionState.ts:38-54`

**Needed:** Defer the clear until flush time, or maintain a
"clear-up-to" beat in the session and let `flushPendingPoints`
clear once before merging. Add a perf test that records 10 s of
write-mode automation and asserts the call count of
`clearPointsInRange`.

### 14. `linkedLaneId` fall-through: empty linked lane silently uses local points

**Problem:** `getAutomationValueAtBeat.ts:38-49` recurses into
`linkedLaneId`. If the linked lane is empty (no points), its
recursive call returns `null`; control then falls through to use
the local lane's points. The doc says "follow linked lane" —
nothing about "fall back to local". The behaviour is surprising.

**Representative files:**

- `src/modules/Automation/useCases/automation/getAutomationValueAtBeat.ts:38-53`
- `src/modules/Automation/models/Automation.ts:42-43`

**Needed:** Decide: when linked, always follow (even if linked is
empty → return null); or always fall back to local (and document
the override semantic). Add tests for both empty-linked and
populated-linked. Currently the test suite has no `linkedLaneId`
coverage at all.

### 15. AGENTS.md compliance: function signatures, type re-exports, model isolation

**Problem:** Three intertwined AGENTS.md violations:
(a) ~22 functions take positional parameters where AGENTS.md
mandates a single object param (full list in finding #42).
(b) `useCases/index.ts:9,11` re-exports
`type AutomationRecordingDependencies` and
`type ModulationDependencies` — AGENTS.md "Use-case types stay
private" forbids `export type` from `useCases/`.
(c) `Project/.../hydrateModuleStoresFromProjectData.ts:9` imports
`type AutomationCurveType, AutomationLane` directly from
`#/modules/Automation/models/Automation` — AGENTS.md "Model
isolation" forbids cross-module model imports.

**Representative files:**

- `src/modules/Automation/useCases/automation/*.ts` (most files)
- `src/modules/Automation/useCases/automationSelection/*.ts`
- `src/modules/Automation/useCases/automationZoom/*.ts`
- `src/modules/Automation/useCases/automationRecording/recordAutomationValue.ts:17`
- `src/modules/Automation/useCases/modulation/{updateModulator,addMapping,removeMapping,updateMapping}.ts`
- `src/modules/Automation/useCases/index.ts:9,11`
- `src/modules/Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts:9`

**Needed:** (a) Refactor each function to take a single object
parameter named `<FunctionName>Input`. Mostly mechanical; care with
the cross-module `recordAutomationValue` whose signature is
exposed via `bootstrap.ts → setMidiLearnDependencies`.
(b) Drop the type re-exports from `useCases/index.ts`; consumers
use `Parameters<typeof setAutomationRecordingDependencies>[0]`
or define their own local types.
(c) Define a Project-local `ProjectAutomationLane` (and curve
type union) and validate at the persistence boundary; do not
import the Automation model.

### 16. 16 of 22 lane-CRUD specs are `expect-defined` smoke tests; one mocks the wrong path

**Problem:** Listed in finding #50. The pattern
`expect(subject.foo).toBeDefined(); const time = typeof subject.foo;`
provides no behavioural coverage — a function whose body was
deleted would still pass. Compounded by
`thinAutomationPoints.spec.ts` (#51) which mocks
`#/modules/Arrangement/useCases/rdpSimplify` while production
imports `simplifyAutomationPoints` from the local services
directory — the mock is inert and the test passes only because
the use case returns early on `state === null`.

**Representative files:**

- `src/modules/Automation/useCases/automation/__tests__/{addAutomationLane,addAutomationPoint,createAutomationLane,duplicateClipAutomation,quantizeAutomationBeats,removeAutomationLane,removeAutomationPoint,reverseAutomation,scaleAutomationValues,setAutomationPointCurve,shiftClipAutomation,stretchAutomationTime,updateAutomationPoint,toggleAutomationVisibility,toggleLaneCollapsed}.spec.ts`
- `src/modules/Automation/useCases/__tests__/{getAutomationValueAtBeat,automationDrawMode,getAutomationHandlers}.spec.ts`
- `src/modules/Automation/useCases/automation/__tests__/thinAutomationPoints.spec.ts:11-17`

**Needed:** Replace each smoke test with at least one positive-
path behavioural test (set up a lane, call the use case, assert
the store mutation matches expectations). Fix the
`thinAutomationPoints` mock to point at
`'../../services/automationPointAlgorithms'` and assert
`simplifyAutomationPoints` is called with the right args.

### 17. `scheduleStretchAutomation` / `reverseAutomation` ignore `clipId` anchor

**Problem:** `stretchAutomationTime.ts:18` uses `anchorBeat = 0` by
default; `reverseAutomation.ts:16` reverses around `maxBeat` of
the points. Neither uses `lane.clipId` to anchor the operation to
the clip's `[startBeat, endBeat]` window. A clip-bound automation
lane that gets stretched silently shifts its points relative to
the clip start.

**Representative files:**

- `src/modules/Automation/useCases/automation/stretchAutomationTime.ts:3-24`
- `src/modules/Automation/useCases/automation/reverseAutomation.ts:3-25`

**Needed:** When the lane has a `clipId`, look up the clip's
`startBeat`/`endBeat` (via the dependency-injection seam used for
`recordAutomationValue`) and anchor stretch/reverse to that
window. Add tests with a clip-bound lane.

### 18. `removeMapping` / `updateModulator` / `discriminator` mismatch in modulator state

**Problem:** Three small but real consistency hazards:
(a) `updateModulator(id, patch)` allows `Partial<Modulator>` —
`{ kind: 'lfo' }` could be patched without `config.kind` —
silently corrupting the discriminated union.
(b) `addModulator(modulator)` doesn't validate
`modulator.kind === modulator.config.kind`.
(c) Modulator on a removed track keeps existing — no
reconciliation hook on track removal in
`Arrangement/handlers/track/handleRemoveTrack.ts`.

**Representative files:**

- `src/modules/Automation/useCases/modulation/updateModulator.ts:4-12`
- `src/modules/Automation/useCases/modulation/addModulator.ts:4-11`
- `src/modules/Automation/models/Modulator.ts:37-45`

**Needed:** Replace `Partial<Modulator>` patch with a
discriminated update type:
`UpdateModulatorPatch = { name?: string; enabled?: boolean; mappings?: ModulatorMapping[]; config?: ... }`
that explicitly forbids changing `kind` (or pairs `kind` with a
matching `config`). Add validation in `addModulator`. Add a track-
removal listener that prunes orphaned modulators.

### 19. Numerical / shallow-copy hazards: `cp1`/`cp2` shared refs, `Math.max(...)` stack overflow, `addAutomationPoint` re-sort

**Problem:** Several smaller correctness/perf issues:
(a) `duplicateClipAutomation.ts:28` shallow-copies points; `cp1`
and `cp2` objects share refs between source and duplicate.
(b) `automationDrawMode.ts:137`
`currentPoints = currentLane ? [...currentLane.points] : []`
shallow — undo snapshot shares cp refs with live state.
(c) `reverseAutomation.ts:16`,
`zoomToUsedRange.ts:18-19` use `Math.max(...arr)` /
`Math.min(...arr)` spread — stack overflow on 100k+ points.
(d) `addAutomationPoint.ts:14` `.sort()` per insert is O(n log n);
flushing N recorded points is O(N² log N).
(e) `automationDrawMode.snapToGrid(beat, 0)` divides by zero
unguarded.

**Representative files:**

- `src/modules/Automation/useCases/automation/duplicateClipAutomation.ts:28`
- `src/modules/Automation/useCases/automationDrawMode.ts:36-37,137`
- `src/modules/Automation/useCases/automation/reverseAutomation.ts:16`
- `src/modules/Automation/useCases/automationZoom/zoomToUsedRange.ts:18-19`
- `src/modules/Automation/useCases/automation/addAutomationPoint.ts:14`

**Needed:** (a-b) Deep-clone points (or freeze them, since
`AutomationPoint` is a value type — switch to `readonly`).
(c) Single-pass min/max loops (already done in
`getSelectionBounds`/`transformSelectedPoints`).
(d) Bisect-insert in `addAutomationPoint`.
(e) Guard `gridResolution > 0` in `snapToGrid` /
`beginDrawSession`.

### 20. `setAutomationPointCurve` overwrites tension to 0.5 silently

**Problem:** `setAutomationPointCurve.ts:8` defaults `tension = 0.5`.
Any call site that passes only `(laneId, beat, curve)` overwrites
the existing tension with 0.5. Default mismatch with
`addAutomationPoint`'s `tension ?? 0`. Switching curve types
silently mutates an unrelated field.

**Representative files:**

- `src/modules/Automation/useCases/automation/setAutomationPointCurve.ts:4-27`
- `src/modules/Automation/handlers/automation/handleAddAutomationPoint.ts:11`

**Needed:** Make `tension` `tension?: number` and only update it
when explicitly passed (`{ ...param, curve, ...(tension !== undefined ? { tension } : {}) }`).
Document the default per curve type if any.

### 21. `events/index.ts` is empty; `presentations/views/index.ts` exports a single view

**Problem:** Two near-empty barrels with no documented justification.
`events/index.ts` has only the comment "No event payload types
exported from this module". `presentations/views/index.ts`
exports `ModulationMatrix` only; the rest of the automation UI
lives in `Workspace/`.

**Representative files:**

- `src/modules/Automation/events/index.ts`
- `src/modules/Automation/presentations/views/index.ts`

**Needed:** If `events/` is intended for future events, leave it
and add a comment naming the planned events. If the automation
editor is permanently in `Workspace/`, document that decision in a
top-level Automation README or in the new module-root `index.ts`.

### 22. Architectural drift: deep cross-module imports into Automation internals

**Problem:** Many cross-module callers reach into Automation
sub-paths instead of going through a single barrel:

- `Workspace/...` test files mock
  `#/modules/Automation/useCases/automation/<name>` and
  `#/modules/Automation/useCases/modulation/<name>` directly.
- `Transport/useCases/__tests__/playheadScheduler.spec.ts:3-4`
  imports `#/modules/Automation/useCases/automationRecording/<name>`.
- `AppShell.tsx:18` imports `ModulationMatrix` from
  `#/modules/Automation/presentations/views`.

**Representative files:**

- `src/modules/Workspace/presentations/views/AutomationView/__tests__/TrackAutomationSection.spec.tsx:78,82`
- `src/modules/Workspace/presentations/views/Inspector/__tests__/TrackAutomationSection.spec.tsx:15,20,25`
- `src/modules/Workspace/handlers/workspace/__tests__/handleSetWorkspaceMode.spec.ts:3-4`
- `src/modules/Transport/useCases/__tests__/playheadScheduler.spec.ts:3-4,72-81`

**Needed:** With a root `index.ts` (issue #1) in place, migrate
deep imports to the root barrel. Update test mocks to mock the
barrel paths. Run `pnpm deps:validate` until clean.

### 23. React-key collision in `ModulationMatrix.MappingRow`

**Problem:** `ModulationMatrix.tsx:599` keys the rendered row by
`${row.modulator.id}:${row.mapping.targetParamId}`. Two mappings
on the same modulator that target the same parameter id on
different tracks produce duplicate keys. React warns in dev and
silently re-uses the same DOM node in prod. The user perceives
*one* row even though the store contains two.

Combined with issue #10 (`removeMapping` matches on
`targetParamId` only), the user sees the visible mapping, clicks
"remove", and *both* mappings disappear silently — they never
discover the second mapping until reload. This is two bugs
covering for each other.

**Representative files:**

- `src/modules/Automation/presentations/views/ModulationMatrix.tsx:599`
  (key)
- `src/modules/Automation/presentations/views/ModulationMatrix.tsx:534-540`
  (the `flatMap` that produces both rows)
- `src/modules/Automation/useCases/modulation/removeMapping.ts:10`
  (the matching wrong identity)

**Needed:** Key by the full mapping identity:
`${modulator.id}:${mapping.targetTrackId}:${mapping.targetDeviceId}:${mapping.targetParamId}`.
Add a Testing Library test that renders two mappings with the
same `targetParamId` on different tracks and asserts both
`MappingRow`s are present.

### 24. `recordAutomationValue` hardcodes 120 BPM fallback; no logging on missing transport

**Problem:** `recordAutomationValue.ts:23-24`
`const tempo = transport?.tempo ?? 120;`. If the transport store
hasn't hydrated yet (rare, but possible during early bootstrap),
recordings land with the wrong beat-to-second conversion. No
warning, no logger call. Worse: `transport` is read fresh per
call, so a tempo *change* mid-recording converts subsequent
samples at the new tempo while previously-recorded points keep
the old timestamp — silent timing drift.

**Representative files:**

- `src/modules/Automation/useCases/automationRecording/recordAutomationValue.ts:22-31`
- `src/modules/Transport/stores/transportStore.ts` (the source)

**Needed:** Either short-circuit recording entirely when transport
is unset (return early with a logger.warn — caller should not be
recording when the transport doesn't exist) or convert all
in-flight points when tempo changes (re-time the `pendingPoints`
queue). Document the chosen semantics in the use case header.

### 25. `applyAutomation` writes only the first device that exposes the parameter

**Problem:** `Transport/.../applyAutomation.ts:81-91` iterates
`track.devices`, finds the first device with
`device.parameterValues[lane.parameterId] !== undefined`, writes,
and `break`s. The MIDI FX loop (`:94-104`) has the same `break`.
If a track has two devices that both expose `cutoff` (e.g.
parallel filters), only the first is automated. The Automation
lane carries `(trackId, parameterId)` only — there is no way to
disambiguate by `deviceId` from the lane.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts:81-104`
- `src/modules/Automation/models/Automation.ts:28-50` (the
  `AutomationLane` type — has no `deviceId` field for plugin
  lanes)

**Needed:** Either (a) lane carries `deviceId?: string` for plugin
parameters and the scheduler matches by `(deviceId, parameterId)`,
or (b) the scheduler iterates *all* devices and writes the same
value to every device exposing the param (treat them as a single
logical "track parameter"). Option (a) is the audio-correct
answer; (b) is a UX shortcut. Decide in the spec, then
implement.

### 26. `removeMapping`/`updateMapping` API uses positional `string` args — easy to swap

**Problem:** Two `string` parameters with no type-level
distinction (`removeMapping.ts:3`, `updateMapping.ts:4`) — the
caller can swap `(modulatorId, targetParamId)` and the code
won't notice. AGENTS.md "Functions with more than one parameter
take a single object param" applies.

**Representative files:**

- `src/modules/Automation/useCases/modulation/removeMapping.ts:3`
- `src/modules/Automation/useCases/modulation/updateMapping.ts:4`
- `src/modules/Automation/presentations/views/ModulationMatrix.tsx:435,463`
  (call sites)

**Needed:** Take a single object param of shape
`{ modulatorId: ModulatorId; mapping: { targetTrackId, targetDeviceId, targetParamId } }`
(plus `patch` for update). Combined with issue #10's identity
fix.

### 27. `addMapping` silently resets `amount` on duplicate add

**Problem:** `addMapping.ts:14-31` — when a duplicate mapping is
added, the use case replaces the existing mapping wholesale via
`{ ...x, ...mapping }`. The picker (`ModulationMatrix.tsx:362-367`)
constructs the mapping with `amount: 0.5` (a hardcoded default).
A user who tunes amount to 0.9 then accidentally re-adds the
mapping (e.g. via a quick double-click) sees the amount snap
back to 0.5 with no warning.

**Representative files:**

- `src/modules/Automation/useCases/modulation/addMapping.ts:14-31`
- `src/modules/Automation/presentations/views/ModulationMatrix.tsx:362-367`

**Needed:** Either (a) `addMapping` no-ops on duplicate (the
caller can `updateMapping` if they want) — preferred — or (b) the
duplicate branch preserves the existing `amount` and only patches
fields that the caller explicitly passed. Add a test for both
the no-op semantics and the no-amount-clobber semantics.

### 28. Module-level mutable state in `recordingSessionState` has no DI seam

**Problem:** `recordingSessionState.ts:21-23` exports
`activeRecording: Map`, `pendingPoints: Map`, `touchActive: Set`
as raw module-level singletons. Tests that don't `vi.mock` them
inherit state from prior specs. Compare to
`recordingDependencies.ts` which uses a private `dependencies` +
`set/get` accessor pattern — the same pattern would suit the
session state.

**Representative files:**

- `src/modules/Automation/useCases/automationRecording/recordingSessionState.ts:21-23`
- `src/modules/Automation/useCases/automationRecording/recordingDependencies.ts:14-25`
  (the DI pattern used elsewhere in the same module)

**Needed:** Wrap the maps in a `getRecordingSessionState()` /
`resetRecordingSessionState()` accessor pair. The
`startAutomationRecording.ts:8-10` "clear all" calls become
`resetRecordingSessionState()`. Tests reset between specs without
needing to import the internals.

### 29. `startAutomationRecording` seeds `startBeat: 0` — latch-mode wipes prior automation

**Problem:** `startAutomationRecording.ts:30-35` initialises every
active recording session with `startBeat: 0`, regardless of the
current playhead position.
`stopAutomationRecording.ts:24-31` then reads
`session.startBeat` (= 0) for `latch` mode and calls
`clearPointsInRange(laneId, 0, lastBeat)` — wiping any
pre-existing automation between beat 0 and the user's recorded
range. Even a user who carefully crafts automation from beat 0
to 16, then records a *latch* tweak from beat 32 to 36, will
lose every point in `[0, 36]`.

In **write** mode this is masked because
`recordAutomationValue.ts:42` rebinds `session.startBeat` to
`compensatedBeat` of the *first* recorded value, then clears
from there. Only `latch` (and `touch` to a lesser extent) leaks
the bug.

**Representative files:**

- `src/modules/Automation/useCases/automationRecording/startAutomationRecording.ts:30-35`
- `src/modules/Automation/useCases/automationRecording/stopAutomationRecording.ts:24-31`
- `src/modules/Automation/useCases/automationRecording/recordAutomationValue.ts:38-46`

**Needed:** Either (a) seed `startBeat` with the current
transport playhead at recording-start, or (b) move the
`startBeat = compensatedBeat` rebinding from `recordAutomationValue`
into a session-create branch shared by all modes. Add a positive
test: pre-existing automation in `[0, 16]`, start latch
recording at beat 32, push a single value, stop — assert the
`[0, 16]` automation is intact.

### 30. `removeModulator`/`removeMapping` leaves engine params stuck

**Problem:** `applyModulationToEngine.ts:75-83` writes
`engineValue = clamp(baseValue + delta, ...)` every tick. When a
modulator or mapping is removed, the next tick simply doesn't
write — the engine retains the *last* written value, not the
base. The user removes a filter LFO mid-playback and the cutoff
sticks at whatever modulated position it was last at.

**Representative files:**

- `src/modules/Automation/useCases/modulation/removeModulator.ts:3-18`
- `src/modules/Automation/useCases/modulation/removeMapping.ts:3-13`
- `src/modules/Automation/useCases/modulation/applyModulationToEngine.ts:75-83`

**Needed:** On removal, snapshot the affected `(trackId, deviceId, paramId)` tuples and write `paramDef.defaultValue` (or `binding.baseValue` if available) once. Add a test that removes a modulator with a non-zero amount and asserts the engine receives the base value.

### 31. `computeModulatorValue` `'random'` LFO loses entropy at large playhead beats

**Problem:** `computeModulatorValue.ts:26`
`Math.abs((Math.sin(Math.floor(playheadBeat / period) * 12.9898) * 43758.5453123) % 1)`.
The `Math.floor(playheadBeat / period) * 12.9898` argument
exceeds `Number.MAX_SAFE_INTEGER` precision for very large
playheads. At 120 BPM with `period = 1`, this kicks in around
64 hours of playback — beyond practical sessions, but the hash
is also non-seedable, so undo/redo round-trips are
non-deterministic and CRDT collaborators see different values
for the same beat.

**Representative files:**

- `src/modules/Automation/useCases/modulation/computeModulatorValue.ts:26`

**Needed:** Replace with a seeded PRNG (mulberry32 or splitmix64)
keyed on `(modulatorId, floor(playheadBeat / period))`. The
modulator's id provides per-instance variation; the floor index
provides per-step variation. Deterministic across undo/redo and
collaborators. Document the assumption.

### 32. `Modulator.kind` and `Modulator.config.kind` discriminator redundancy

**Problem:** `models/Modulator.ts:37-45` declares `kind` at both
`Modulator` and `Modulator.config`. They must agree but nothing
enforces it. `updateModulator.ts:10`'s `Partial<Modulator>` patch
lets a caller pass `{ kind: 'envelope' }` without updating
`config.kind`. The `applyModulationToEngine` /
`computeModulatorValue` branch on `config.kind` (the inner one),
while the UI branches on `modulator.kind` (the outer one).
Silent disagreement.

**Representative files:**

- `src/modules/Automation/models/Modulator.ts:37-45`
- `src/modules/Automation/useCases/modulation/computeModulatorValue.ts:6,32`
- `src/modules/Automation/presentations/views/ModulationMatrix.tsx:491,532-540`
- `src/modules/Automation/useCases/modulation/updateModulator.ts:10`

**Needed:** Drop `Modulator.kind`. Use `m.config.kind` everywhere.
Update callers (`addModulator.ts:5`, `ModulationMatrix.tsx:424,491`,
test fixtures). Use a discriminated `UpdateModulatorPatch` type
that explicitly forbids changing the discriminator without a
matching new config (issue #18a).

### 33. `stopAutomationRecording` whole-lane `JSON.stringify` is a memory hazard and undo-stack polluter

**Problem:** `stopAutomationRecording.ts:17,37,39` snapshots the
entire `lanes` array via `structuredClone`, then deep-equals via
`JSON.stringify`. For 100 lanes × 1k points × 40 bytes/point that
is ~4 MB serialised on every stop. Worse, Automerge can re-order
object properties for the same logical state; the
`JSON.stringify` comparison is order-sensitive — a recording that
*added zero points* but triggered an Automerge re-order pushes
an undo entry that restores to the same state. The user's undo
stack fills with no-ops.

**Representative files:**

- `src/modules/Automation/useCases/automationRecording/stopAutomationRecording.ts:17,37-55`

**Needed:** Replace with per-lane snapshot keyed on the *active*
recording session lane ids. For each session in
`activeRecording`, snapshot the lane's `points` (and `objects` if
modified) — not the whole `lanes` array — and compare lengths
plus reference identity before serialising. If reference
unchanged, skip the snapshot.

---

## Open questions

- [ ] Are envelope modulators planned for this milestone, or should
      they be removed from the UI / `ModulatorKind` until trigger
      plumbing exists?
- [ ] Is `'bezier'` a planned curve type, or should it be removed
      from `AutomationCurveType` and `cp1`/`cp2` from
      `AutomationPoint`?
- [ ] What is the intended priority when both automation and
      modulation target the same parameter — automation as base
      with modulation as additive delta, or modulation overrides
      automation (current behaviour)?
- [ ] Should clip-bound automation lanes anchor `stretch` / `reverse`
      to the clip's `[startBeat, endBeat]` instead of beat 0 /
      `maxBeat`?
- [ ] Is the `linkedLaneId` "empty linked → fall back to local"
      semantic intentional, or a leftover from an early
      implementation?
- [ ] Should `automationZoom`, `automationSelection`, draw-mode,
      and modulation use cases route through `AppAction`? If yes,
      they need types and undo support; if no, they need to be
      labelled "UI-local, not undoable" with a comment.
- [ ] Why does `ModulationMatrix` live in
      `Automation/presentations/views/` while the rest of the
      automation editing UI lives in `Workspace/`? Is the split
      intentional?

---

## Risks

- **User-visible silent undo loss.** Issue #2: every undoable
  action in this module is a no-op on undo. The user clicks undo
  after a Scale Automation, sees the curve unchanged, and assumes
  the undo system is broken or the action didn't happen. Worst
  case: the user re-scales to compensate, compounding the change.
- **Dead UI features.** Issues #3 / #5: the "bezier" curve picker
  and the "envelope" modulator both look interactive but produce
  no audio effect at runtime. Users who pick them and tweak
  parameters get no feedback — the worst kind of broken.
- **Audible zipper noise on modulation.** Issue #9: filter cutoff
  and similar low-rate parameters get unsmoothed control-rate
  writes at 100 Hz, which is below an audio-friendly slewer rate.
  Combined with the modulation-overrides-automation behaviour,
  this also kills automated rides on any param that has a
  modulator mapped.
- **Latch recording sticks.** Issue #8: any parameter touched once
  during a latch recording continues to skip the lane until stop.
  The user hears "the value I set" instead of "the curve I drew",
  even after release.
- **Cross-lane undo collateral damage.** Issue #11: a draw or
  record session's undo replaces all lanes with a snapshot,
  silently undoing any unrelated edit that landed during the
  session. In a collaborative session, CRDT changes from a
  collaborator can be silently rolled back.
- **DSP credibility.** Issue #4 (smooth curve degenerate to 2-point
  Hermite), Issue #12 ('sine' shape is wrong), Issue #28 (curve
  switch silently changes tension): users see curves that don't
  match what the UI promises.
- **Architectural drift.** Issues #1 / #15 / #22: AGENTS.md
  violations are accumulating. No module-root index, type leaks
  through `useCases/`, model imported across the boundary,
  positional-arg signatures throughout. Each one normalises a
  pattern that other modules will copy.
- **Test theatre.** Issue #16: 16 smoke tests mean the lane CRUD
  surface ships with no behavioural coverage. The undo-loss bug
  (#2), the bezier-no-op bug (#3), the envelope-no-op bug (#5),
  and the wrong-mock-path bug (#51) all pass through CI green.
- **Latch-mode silent data loss.** Issue #29: starting a latch
  recording mid-arrangement deletes pre-existing automation from
  beat 0 to the playhead at stop time. A user with carefully
  drawn automation in the first 32 bars who records a latch tweak
  in bar 33 loses everything before bar 33. There is no warning;
  CRDT history records the deletion as a normal "Record
  Automation" undo entry whose snapshot also restores the
  deletion (via #11/#33), so even the undo path is poisoned.
- **Multi-instance plugin under-coverage.** Issue #25: tracks with
  two devices exposing the same parameter id (e.g. parallel
  filters with `cutoff`) only ever see the first device
  automated. The lane carries no `deviceId` for plugin
  parameters; the architecture cannot disambiguate.
- **Stuck params after modulator removal.** Issue #30: removing a
  modulator while playback is active leaves the engine param at
  the last modulated value rather than the base. The user
  experiences a "stuck filter" with no visual indication of
  why.

---

## Suggested approaches

- **Land the test fixes first** (issue #16). The smoke tests are
  cheap to upgrade — replace each `expect-defined` with a
  positive-path assertion that exercises the use case against a
  mock store. Once those pass, the DSP fixes (#3, #4, #5, #12) and
  the undo fixes (#2, #11) can be driven test-first.
- **Fix the undo invariant** (issue #2) as one focused commit.
  Either symmetric inverse actions or callback-undos with
  per-lane snapshots. This is the most user-visible fix.
- **Decide on `'bezier'` and `'envelope'`** (issues #3 / #5). Cheap
  to remove (one git revert in the model + UI) or moderately
  involved to implement (a few hours each). Either way, the dead
  UI must go.
- **Add the module-root `index.ts`** (issue #1) before doing any
  refactors. Even if the barrel is initially a thin re-export of
  the existing sub-barrels, it sets the contract surface and lets
  `pnpm deps:validate` enforce it.
- **Fix `removeMapping` / `updateMapping` identity** (issue #10) —
  small, obvious, with a clear test. Land standalone.
- **Address modulation-vs-automation precedence** (issue #9) with
  a single combined writer per param: each tick computes
  `automation_value + modulation_delta` and writes once with the
  slewer.
- **AGENTS.md compliance pass** (issue #15) as a follow-up sweep —
  small mechanical refactors in one commit.
- **Fix latch-mode `startBeat` seeding** (issue #29) before
  shipping any "release notes" mentioning latch recording. One
  line in `startAutomationRecording.ts` plus a positive-path
  test against pre-existing automation.
- **Fix the React-key collision** (issue #54/#23) at the same
  time as `removeMapping` identity (#10/#26). They are
  symptoms of the same wrong-identity assumption. Pair the two
  fixes in a single commit so neither lands without the other.
- **Combine modulation reset into removeModulator/removeMapping**
  (issue #30). On removal, snapshot affected `(track, device,
  param)` tuples and write the base value once. This both fixes
  the stuck-param bug and removes the need for a separate
  "modulation halo" reset path.
- **Drop `Modulator.kind`** (issue #32/#65). `m.config.kind` is
  the single discriminator; the outer `kind` field is redundant
  and a footgun. Touches a handful of UI sites.

---

## Recommendation

Start with **issue #16 (replace smoke tests with behavioural tests)**.
It is mechanical (~16 files) and unblocks the DSP / undo /
modulation fixes by giving them a test bed. Land it as a single
commit and re-run CI to confirm the previously-passing tests still
pass with real assertions.

Then tackle **issue #2 (undo)** because it is the most user-visible
correctness bug. Add an `inverseAction` to each handler (symmetric
pairs where possible; callback-undos with per-lane snapshots
otherwise). Add a per-handler test that asserts undo restores the
prior state.

After those two land, the next session can pick between the
"correctness pass" (issues #3, #4, #5, #8, #9, #10, #11, #12, #28,
plus the new entries #29 latch-startBeat, #25 multi-device,
#30 stuck params, #27 amount-clobber, #24 BPM fallback, #31 PRNG)
and the "architecture pass" (issues #1, #7, #15, #22, plus
#26 positional API, #28 module-state DI, #32 discriminator
redundancy, #33 JSON.stringify undo). The two passes are
independent; no need to serialise.

**Sequencing constraint discovered in this review:** issue #4
(smooth curve degeneracy) cannot be fixed without simultaneously
updating `automationPoints.spec.ts:122-138`, which currently
asserts the buggy 3-arg call shape — see the deepening note on
issue #4. Likewise issue #5 has a test that locks in `return 0`
for envelopes (`computeModulatorValue.spec.ts:65-76`).
Test-locked bugs must be untangled before the implementation
fix lands, otherwise CI will reject the fix.

---

## Resolved

_No issues resolved yet._
