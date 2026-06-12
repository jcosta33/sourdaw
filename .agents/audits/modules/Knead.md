# Knead module audit

## Scope

Adversarial review of every file under `src/modules/Knead/`:

- `models/KneadBlob.ts`
- `stores/kneadStore.ts`, `stores/index.ts`
- `useCases/dspAnalysis.ts`, `useCases/hydrateKneadFromTrackStore.ts`,
  `useCases/syncKneadToEngine.ts`, `useCases/updateClipKneadState.ts`,
  `useCases/index.ts`
- `useCases/__tests__/dspAnalysis.spec.ts`

Excluded: `AudioEngine` worklet (`services/kneadProcessor.ts`), `AudioEngine`
WASM exports (`analyze_pitch_wasm`), `Command/useCases/pitch/commitPitchEdit.ts`,
the `KneadEditor.tsx` / `PitchEditor.tsx` views, and the `Arrangement` /
`Project` data models — except where they are directly imported from this
module or directly hold a contract that this module advertises.

It is an adversarial review: data-shape divergence, a dead end-to-end pipeline
(analysis → blobs), missing barrel, races, leaked subscriptions, type
soundness, and AGENTS.md violations.

Related spec: none on disk.

---

## Goal

A small, self-contained pitch-editing domain owned by `Knead/`:

- A single canonical type for a "blob" (the editable pitch-correction unit);
  the Arrangement clip model and Knead's domain model agree on field set or
  the seam between them is explicit and tested.
- A working ingestion pipeline: an upstream pitch analyser (WASM /
  `analyzePitchForClip`) writes a `PitchContour`; **something** in `Knead/`
  converts that contour to `NoteBlob[]` and writes it via
  `updateClipKneadState`.
- Cross-module surface goes through one of the contract barrels
  (`stores/index.ts`, `useCases/index.ts`); deep imports into
  `stores/kneadStore.ts` from outside the module do not exist.
- `syncKneadToEngine` reacts to **both** the knead state and the track
  configuration (device list, clip start/end) so enabling the Knead device on
  a track immediately reaches the engine.
- AGENTS.md hard rules: no `as` escapes, no use-case `export type` on the
  contract barrel, one function per `useCases/` file, single-object params,
  no module-level mutable state outside `stores/`, no React anti-patterns in
  any consumer that this module's API forces (see KneadEditor cross-ref).
- Test coverage exercises the real ingestion contract: voiced runs, gap
  bridging, MIDI/cents arithmetic, and confidence weighting. Mocks point at
  the real production import path.

---

## Relevant code paths

- `src/modules/Knead/models/KneadBlob.ts`
- `src/modules/Knead/stores/kneadStore.ts`
- `src/modules/Knead/stores/index.ts`
- `src/modules/Knead/useCases/index.ts`
- `src/modules/Knead/useCases/dspAnalysis.ts`
- `src/modules/Knead/useCases/hydrateKneadFromTrackStore.ts`
- `src/modules/Knead/useCases/syncKneadToEngine.ts`
- `src/modules/Knead/useCases/updateClipKneadState.ts`
- `src/modules/Knead/useCases/__tests__/dspAnalysis.spec.ts`

Cross-module touch points (read-only references for context):

- `src/modules/Arrangement/models/Track.ts:122-139` — `ClipKneadState` /
  `ClipKneadBlob` (the persisted clip shape).
- `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts` —
  the only writer of `kneadStore.contours`.
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:334-343` —
  `audioEngine.syncKneadState(trackId, clips: Record<string, unknown>)`.
- `src/modules/AudioEngine/services/kneadProcessor.ts` — the worklet that
  consumes the per-track clips dictionary; defines its own `KneadClip` /
  `KneadClipBlob` types (yet another fork).
- `src/modules/Command/useCases/pitch/commitPitchEdit.ts:4` — imports
  `PitchContour` directly from `Knead/stores/kneadStore` (deep import).
- `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx` and
  `.../PitchEditor.tsx` — sole UI consumers.

---

## Current behavior

**Module shape.** No root `index.ts` (the `cross-module-index-only` rule in
`.dependency-cruiser.cjs` accepts contract-folder barrels, so this is not a
hard violation, but the module exposes only `stores/` and `useCases/`).
There is no `handlers/`, no `repositories/`, no `services/`, no `events/`.
The `models/` folder contains a single dead file; the actual domain types
live inside `stores/kneadStore.ts`.

**Stores.** `kneadStore.ts` is an Automerge-backed store keyed by `clipId`,
holding `clips: Record<string, KneadClipState>`,
`contours: Record<string, PitchContour>`, plus `activeClipId`,
`isAnalyzing`, `analysisProgress`. `setActiveKneadClip` is exported but
never called anywhere outside the file — `activeClipId` reads as dead.
`stores/index.ts` re-exports the store, the default state, and five types
(`KneadClipState`, `KneadStoreState`, `NoteBlob`, `PitchContour`,
`PitchPoint`) — three of which (`PitchContour`, `PitchPoint`, `NoteBlob`)
are used cross-module.

**Use cases.**

- `ingestDspAnalysis(clipId, frames)`: groups voiced frames into blobs,
  filters runs shorter than 5 frames, bridges gaps shorter than 3 frames,
  computes confidence-weighted pitch centre and a per-frame cent-deviation
  curve, writes via `updateClipKneadState`.
- `hydrateKneadFromTrackStore()`: walks the trackStore once and copies any
  `clip.kneadState` into `kneadStore.clips` keyed by clip id, with a hard
  `as KneadClipState` cast.
- `syncKneadToEngine()`: subscribes to `kneadStore` only; on each fire,
  iterates every track in `trackStore`, finds tracks whose devices include
  one named "knead" (case-insensitive substring on `type`), builds a
  `Record<string, EngineKneadState>` for the track's clips, and pushes the
  whole record into `audioEngine.syncKneadState(trackId, …)`.
- `updateClipKneadState(clipId, updater)`: reads `kneadStore.clips[clipId]`
  (or seeds defaults), applies `updater`, writes back to `kneadStore`, and
  also mirrors the result into `trackStore` via `updateClipInStore` —
  using the **Knead-shaped** `nextKneadState`, which has fields
  Arrangement's model does not declare.

**Tests.** Only `dspAnalysis.spec.ts` exists. It covers three cases: empty
voiced output, six-frame A4 produces one blob with `pitchCenterCents`
6900, and a 2-frame voiced region is discarded. Uses
`{ blobs: [] } as never` to bypass typing the seed state.

**Pipeline reality check.** The end-to-end flow that the codebase _appears_
to advertise — record audio → analyse pitch → edit blobs → re-render — is
**broken**: `analyzePitchForClip` writes only the `contours` map.
`KneadEditor` reads `kneadState.blobs`, which can only become populated by
`ingestDspAnalysis`. **`ingestDspAnalysis` has no production caller.**
Searching the entire repo for `ingestDspAnalysis` returns the use-case
file, the `useCases/index.ts` re-export, the spec, and one mock in
`KneadEditor.spec.tsx` — and that mock is for a function the component
never calls. Result: a user who clicks "Enable Knead" and waits sees the
analyser run, the contour land in the store, and the editor stay stuck on
the "Analyzing pitch tracking data..." spinner forever (`KneadEditor.tsx`
gate at `:464` is `kneadState.blobs.length === 0`).

---

## Findings

1. **Two parallel "knead clip" type families that quietly diverge.**

   - `Knead/stores/kneadStore.ts:6-30` — `NoteBlob` (12 fields) and
     `KneadClipState` (7 fields including `clipId`, `toleranceCents`,
     `toleranceTimeMs`).
   - `Arrangement/models/Track.ts:125-139` — `ClipKneadState` (4 fields)
     and `ClipKneadBlob` (6 fields, no
     `originalPitchCenterCents`/`voicedConfidence` semantics that match,
     no `vibratoDepthPercent`, no `formantShiftCents`, no `gainDb`, no
     `muted`).
   - `AudioEngine/services/kneadProcessor.ts:13-24` — `KneadClipBlob` (4
     fields: `startTime`, `endTime`, `pitchCenterCents`,
     `originalPitchCenterCents`).
   - `Knead/models/KneadBlob.ts:1-24` — a fourth `NoteBlob` with
     **no** `originalPitchCenterCents`. Dead file (no importer).

   The Knead/Arrangement seam is bridged by two unsafe operations:

   - `hydrateKneadFromTrackStore.ts:21` does
     `clip.kneadState as KneadClipState` (Arrangement → Knead). The
     Arrangement shape is missing `clipId`, `toleranceCents`, and
     `toleranceTimeMs`; the cast produces a runtime object where reads of
     those fields return `undefined`. Consumers default-coalesce
     (`?? 25` in `KneadEditor.tsx:488`, `?? 40` at `:546`,
     `?? true` at `:557`), but the Knead type advertises them as
     non-optional.
   - `updateClipKneadState.ts:31` writes the **Knead** `nextKneadState`
     into `clip.kneadState` (Knead → Arrangement). The Arrangement model
     does not declare `clipId`, `toleranceCents`, `toleranceTimeMs`,
     `blobs[i].originalPitchCenterCents`, `vibratoDepthPercent`,
     `vibratoRateHz`, `formantShiftCents`, `gainDb`, `muted`,
     `voicedConfidence`. Either Automerge persistence silently discards
     them, or the persisted document is a structural superset of what
     the type system says.

2. **The dead pipeline: `ingestDspAnalysis` is never called.** The use
   case is exported via `useCases/index.ts`, has spec coverage, but no
   production caller. The end-to-end UX promise (analyse audio → show
   editable blobs) is not wired together. `analyzePitchForClip` writes
   `contours[clipId]` and **nothing** translates that contour to
   `NoteBlob[]`. `KneadEditor.tsx:87` gates rendering on
   `kneadState.blobs.length === 0`, so the user is stuck on the
   "Analyzing pitch tracking data..." overlay even after analysis
   succeeds.

3. **`models/KneadBlob.ts` is a stale duplicate.** Defines `NoteBlob` and
   `KneadClipState` separately from `stores/kneadStore.ts`. Nothing
   imports from this file. The two `NoteBlob`s differ
   (`models/KneadBlob.ts` has no `originalPitchCenterCents`); a
   future-me importing the wrong one introduces a silent regression.

4. **No module root barrel; cross-module deep import bypasses the
   contract.** `Command/useCases/pitch/commitPitchEdit.ts:4` and
   `AudioEngine/useCases/audioAnalysis/processPitchEditWasm.ts:4` import
   `PitchContour` directly from `#/modules/Knead/stores/kneadStore`. The
   dependency-cruiser `cross-module-index-only` rule rejects deep paths
   that aren't a contract barrel; this is `…/stores/kneadStore`, not
   `…/stores`. Either the rule is currently letting these slide via the
   transitional regex, or this is a violation that has not been audited
   against. Either way, **the cross-module surface exposes
   `stores/kneadStore.ts` as a public path**, which means renaming or
   restructuring the store breaks two unrelated modules silently.

5. **`stores/index.ts` re-exports five types, three of which leak across
   modules.** `KneadClipState`, `KneadStoreState`, `NoteBlob` —
   the type is private to Knead by AGENTS.md "Model isolation". They
   are not imported cross-module today, but the export advertises them
   as part of the contract.

6. **`syncKneadToEngine` ignores trackStore changes.** It subscribes
   only to `kneadStore` (`syncKneadToEngine.ts:14`); enabling the Knead
   device on a track via `addDevice` (Arrangement) updates `trackStore`
   but does not fire any kneadStore notification. The engine never
   learns about the new device until something else writes to
   `kneadStore`. Symptom: open KneadEditor on a brand-new Knead track,
   start playback, hear no pitch shift until you tweak a slider that
   triggers `updateClipKneadState`.

7. **`syncKneadToEngine`'s subscriber is leaked.** It returns an
   unsubscribe function (`syncKneadToEngine.ts:42-44`), but
   `useAppInitialization.ts:35` calls `syncKneadToEngine();` and
   discards the return value. Across HMR / re-renders / re-mounts of
   `useAppInitialization`, subscribers accumulate: each store mutation
   fires N callbacks, each of which sends N tracks worth of
   `audioEngine.syncKneadState` calls.

8. **`syncKneadToEngine` is O(tracks × clips × devices) per kneadStore
   write, with no diffing.** Every kneadStore mutation iterates every
   track, every track's devices, every track's clips, and pushes the
   entire dictionary to the engine — even for tracks whose clips did
   not change. The "did anything change for this track" decision is
   not made; the engine receives full snapshots on every keystroke in
   the editor. With per-clip `pitchCenterCents` updates being the
   primary KneadEditor interaction, this is a write-amplification
   hotspot.

9. **Device-detection by stringly-typed substring match.** `track.devices.some((d) => d.type.toLowerCase() === 'knead')`
   (`syncKneadToEngine.ts:22`) and the same comparison in
   `KneadEditor.tsx:42`. There is no central registry / enum / `as
   const` constant for device type identifiers. Any rename of the
   device type ("Knead" → "PitchCorrection" → "Knead Pitch") silently
   breaks the engine sync without a type error.

10. **`updateClipKneadState` couples two stores invisibly.** Writes to
    `kneadStore.clips[clipId]` and `trackStore.clips[clipId].kneadState`
    in the same call. There is no transactional guarantee — if
    `updateClipInStore` throws, the kneadStore is already updated.
    More worryingly, the two writes hold structurally different
    objects (issue #1). This is the kind of dual-store sync that
    AGENTS.md "Cross-Domain UI State" describes as belonging in a
    use case; it is in the right place architecturally, but the
    contract divergence makes it a footgun.

11. **`hydrateKneadFromTrackStore` strips fields silently.** The
    Arrangement clip's `kneadState` lacks `clipId`,
    `toleranceCents`, `toleranceTimeMs`. After hydrate, those Knead
    parameters read as `undefined`. The KneadEditor falls back to
    constants (`?? 25`, `?? 30`, `?? 40`, `?? true`) so the user
    cannot tell — but any code that reads `kneadStore.clips[id]
    .toleranceCents` directly without a fallback will get
    `undefined`. The `tolerance*` parameters are also never written
    back to the trackStore in `updateClipKneadState` because
    Arrangement's model doesn't carry them.

12. **`hydrateKneadFromTrackStore` clobbers contours and analysis
    state.** The hydrate writes `{ ...currentKnead, clips:
    clipsWithKnead }` (`hydrateKneadFromTrackStore.ts:28-31`). It
    does not touch `contours`/`isAnalyzing`/`analysisProgress` —
    correct. But it also overwrites any **in-memory-only** clip
    state (e.g. blobs created during the current session that
    haven't been persisted yet) when called after a project load.
    `projectProjection.ts:29` calls
    `hydrateKneadFromTrackStore()` after every projection — so any
    clip whose Arrangement persistence lags behind kneadStore
    drops its blobs.

13. **`stores/kneadStore.ts:6-44` duplicates types that
    `analyzePitchForClip.ts` also defines.** Both files declare
    `PitchPoint` and `PitchContour`. The Knead version's
    `algorithm` is **optional**; the AudioEngine version's is
    **required** (`analyzePitchForClip.ts:14-26`). The result of
    `JSON.parse(jsonStr) as PitchContour` lands in a Knead store
    typed as the optional-`algorithm` shape, then is pulled out
    again by `commitPitchEdit.ts:4` via the deep import as the
    Knead shape — but `commitPitchEditCommand` accepts it as
    `PitchContour` typed in its own file (in turn redefined…
    actually it imports from Knead). Anyone changing one of the
    two definitions does not get a type error in the other.

14. **`ingestDspAnalysis`: signature is positional with two required
    params.** AGENTS.md "Function Signatures" requires a single
    object param for module-level functions with more than one
    parameter (and a named `IngestDspAnalysisInput` type).
    `dspAnalysis.ts:13-16`: `ingestDspAnalysis(clipId, frames)`.
    Same issue: `updateClipKneadState(clipId, updater)`
    (`updateClipKneadState.ts:5`).

15. **`ingestDspAnalysis` allocates and grows arrays inside the
    voiced loop.** A `currentPitchPoints: { cents, confidence,
    time }[]` is built up frame by frame; on every voiced frame
    a new object literal is allocated and pushed. For long voiced
    regions this is non-trivial GC work. In practice the function
    runs offline (post-analysis) so the audio thread isn't
    affected, but the `MIN_BLOB_FRAMES = 5` constant means short
    regions throw away all the allocations — a moving-window
    approach with two-phase commit would avoid the wasted work.

16. **`ingestDspAnalysis` confidence-weighted average uses the
    raw `periodicity` as confidence and silently divides by zero.**
    `dspAnalysis.ts:39`: `Math.round(totalWeightedCents /
    totalConfidence)`. The early guard requires `>= MIN_BLOB_FRAMES
    = 5` voiced frames where each had `periodicity > 0.6`, so
    `totalConfidence > 3.0` is guaranteed _today_. But that
    invariant is implicit; if `MIN_BLOB_FRAMES` is ever lowered or
    the periodicity threshold is changed, the divide can produce
    `NaN` and propagate into `pitchCenterCents`. There is no
    runtime guard.

17. **`ingestDspAnalysis` boundary off-by-one.** `frame.f0!` —
    the non-null assertion is correct (the `isVoiced` branch
    guarantees non-null), but the time stored is `frame.time` (the
    centre or start of the analysis window — depending on what
    the WASM layer chose, which is undocumented here). The blob's
    `endTime` is the time of the **last voiced frame**, not the
    end of that frame. A blob from frames at 0.000s, 0.010s,
    0.020s, 0.030s, 0.040s reports `endTime = 0.040` even though
    the last voiced sample sits at ~0.050. KneadProcessor's
    `clipTimeSeconds <= b.endTime` interval check
    (`kneadProcessor.ts:120`) will then de-activate the shift one
    hop early.

18. **Bridge-gap logic finalises a blob inside the loop without
    consuming the gap.** `dspAnalysis.ts:74-82`: when a non-voiced
    frame is seen and `gapCounter > MAX_GAP_FRAMES`, the blob is
    finalised — but the loop then continues, so the **next**
    voiced run begins with `currentPitchPoints = []` and
    `gapCounter = 0` (reset inside `finalizeBlob`). Correct
    behaviour, but the dual responsibility (finalize + reset)
    makes the function impure in a confusing way; the
    `currentPitchPoints` and `gapCounter` are closed-over mutables
    written by both the loop and the finaliser, making the
    control flow hard to reason about.

19. **`ingestDspAnalysis` discards the post-MIDI semitone
    quantization.** `midiNote = 69 + 12 * Math.log2(frame.f0! /
    440)`; `cents = midiNote * 100`. Pitch centre is stored as
    cents on the standard MIDI grid, but the per-frame
    `pitchCurveCents` is `cents - avgCents` — i.e. the deviation
    from the **mean MIDI cents of the blob**, not from the
    nearest semitone or the original target pitch. KneadProcessor
    interprets `pitchCenterCents - originalPitchCenterCents` as
    the shift; if a blob is bridged across two pitches (because
    of the 3-frame gap merge), the average sits between them and
    the curve looks like a wobble around nowhere. There is no
    test for the multi-pitch case.

20. **`ingestDspAnalysis` test cast `{ blobs: [] } as never`.**
    `dspAnalysis.spec.ts:23, :37, :55`. AGENTS.md "TypeScript —
    soundness" forbids `as never` / `as unknown` / `as any` to
    silence the compiler. Because the test invokes
    `updateClipKneadState`'s updater callback with an incomplete
    `KneadClipState`, the invariant the spec is asserting is
    "if the updater were called on this junk, it would produce
    a correctly-shaped output" — which is _not_ what production
    does (production passes a real or default-seeded state).

21. **`updateClipKneadState` defaults are magic-numbered and
    asymmetric with `KneadEditor`'s defaults.**
    `updateClipKneadState.ts:11-19` seeds `retuneSpeedMs: 25,
toleranceCents: 25, toleranceTimeMs: 30, humanizePercent: 40,
formantPreserve: true`. `KneadEditor.tsx:488` reads
    `kneadState.retuneSpeedMs ?? 25`; `:546` reads
    `humanizePercent ?? 40`; `:557` reads `formantPreserve ?? true`.
    Two sources of truth, identical numbers, no shared constant.

22. **No `handlers/` and no `AppAction` integration.** The Knead
    domain has no `executeAppAction` surface. Pitch correction
    state changes cannot participate in the undo/redo system
    (see `Command/useCases/pitch/commitPitchEdit.ts` — that file
    creates an undo entry only for the destructive "render
    pitched audio" step, not for the editorial knead state
    changes). The user can drag pitch up, then expect Cmd-Z to
    revert — and nothing happens.

23. **`KneadStoreState` is Automerge-persisted but `isAnalyzing`
    and `analysisProgress` are transient runtime state.**
    `kneadStore.ts:46-52`: the same store carries persisted user
    edits (`clips`, `contours`) and transient session state
    (`isAnalyzing`, `analysisProgress`, `activeClipId`). A
    page reload that restores the Automerge document will
    rehydrate `isAnalyzing: true` if the previous session
    crashed mid-analysis; the UI will show a stuck progress
    bar. Transient state belongs in a separate store (or local
    state) — Automerge persistence should not own it.

24. **`PitchContour.algorithm` is optional in Knead, required in
    AudioEngine (issue #13 corollary).** A producer
    (`analyzePitchForClip.ts`) emits `algorithm: string`; the
    consumer side accepts it but the persisted Automerge doc may
    have `algorithm` absent (e.g. older documents). Reading the
    contour and forwarding it through `commitPitchEditCommand`
    will then satisfy `Knead`'s type but not
    `AudioEngine`'s. Type drift across the boundary.

25. **`setActiveKneadClip` and `activeClipId` are dead.** No
    cross-module caller, no in-module caller. The KneadEditor
    has its own `clipId` prop and uses that. Either delete
    `activeClipId` from state and remove the setter, or wire it
    up so opening the editor sets it (and the worklet uses it
    instead of scanning every track's clips).

26. **`syncKneadToEngine` builds `EngineKneadState` with
    `startBeat`/`endBeat` from `trackStore` clip — but the worklet
    expects exactly that shape, undocumented.** The producer
    (`syncKneadToEngine.ts:6` defines `EngineKneadState`) and the
    consumer (`AudioEngine/services/kneadProcessor.ts:13-24`
    defines `KneadClipBlob` / `KneadClip`) live in two modules
    and disagree: `EngineKneadState` is `KneadClipState & {
startBeat, endBeat }` (i.e. has all 7 KneadClipState fields
    plus 2), `KneadClip` declares only `{ startBeat, endBeat,
blobs }`. The worklet accepts the wider object via duck typing
    and the engine API erases the type to `Record<string, unknown>`
    (`createWebAudioEngine.ts:334`). A schema change to
    `KneadClipBlob` (e.g. add `formantShiftCents`) is not
    propagated back to `Knead/`; the engine just silently
    ignores fields it doesn't read.

27. **`hydrateKneadFromTrackStore` runs on every CRDT projection.**
    `CrdtDocument/useCases/projection/projectProjection.ts:29` calls
    `hydrateKneadFromTrackStore()` after each projection. Each
    call walks every track and every clip, rebuilds the
    `clipsWithKnead` dictionary, and writes the kneadStore
    unconditionally — even when nothing knead-related changed.
    Combined with #7 (`syncKneadToEngine` listening to kneadStore),
    every CRDT projection triggers a full per-track engine
    re-sync.

28. **No `events/` contract for "blobs ingested" / "knead state
    changed".** Other modules that care (e.g. an "auto-tune
    auto-fix" feature, an "export with pitch correction baked-in"
    flow) have to subscribe to the entire kneadStore and
    re-derive change. Knead has no event surface despite being a
    pipeline-style module.

29. **No tests for `hydrateKneadFromTrackStore`,
    `syncKneadToEngine`, or `updateClipKneadState`.** The single
    spec file covers `ingestDspAnalysis` only. The dual-store
    sync behaviour (issue #10), the missing-trackStore-subscription
    (issue #6), and the type-cast in hydrate (issue #11) all
    have zero coverage. A regression in any of these silently
    breaks user-visible behaviour.

30. **No `formantShift` or `gainDb` writeback path.** `NoteBlob`
    advertises `formantShiftCents`, `gainDb`, `muted`,
    `vibratoDepthPercent`, `vibratoRateHz`, `driftPercent`. None
    of these are surfaced by `KneadEditor.tsx`; none have a
    dedicated `updateClipKneadState` path. `kneadProcessor.ts`
    reads only `pitchCenterCents` and `originalPitchCenterCents`.
    The fields exist as data with no code that writes or reads
    them. This is API surface area without a contract — type
    rot.

31. **`updateClipKneadState`'s seed default writes a clip object
    even on a no-op update.** Calling
    `updateClipKneadState(id, (state) => state)` on a clip that
    has no kneadState yet still calls `kneadStore.set(...)` with
    the seeded defaults, fires a notification, and pushes a full
    sync to the engine via #6/#7. Reads-as-writes for any code
    path that "checks current state" via the updater pattern.

32. **No `defaultKneadClipState` constant.** The defaults inside
    `updateClipKneadState.ts:11-19` are duplicated implicitly with
    the KneadEditor (#21). Extracting a `DEFAULT_KNEAD_CLIP_STATE`
    constant and exporting it from `stores/index.ts` would let
    the editor and the use case share one definition.

33. **`stores/kneadStore.ts:1-65` mixes concerns.** The file
    declares the data types, the `defaultKneadState` constant,
    the store factory call, **and** a setter helper
    (`setActiveKneadClip`). AGENTS.md "One Function Per File"
    applies to `useCases/` and `repositories/`, not stores, so
    this is technically allowed — but `setActiveKneadClip` is
    a use-case-shaped operation living in `stores/`, which is
    why it's not exported from `stores/index.ts` (see #25).
    Migrate it to `useCases/` or delete it.

---

## Priorities

1. **The pipeline is broken — `ingestDspAnalysis` has no caller** (issue
   #2). The user-visible "Enable Knead → analyze → edit blobs" flow
   never reaches the editing stage. This is the headline finding:
   without #2 fixed, the entire module is decorative.
2. **Three forks of the "knead clip" type with silent casts between them**
   (issue #1, plus #3, #11, #13, #24, #26). Renaming or extending any
   field requires updating every fork manually. Today the type system
   provides no protection.
3. **`syncKneadToEngine` does not react to track-list changes and leaks
   subscribers** (issues #6, #7). Symptom: enabling Knead on a track
   produces no audio change; over time, every store mutation fires
   stale callbacks.
4. **Two `PitchContour` definitions across the cross-module boundary**
   with deep imports into `stores/kneadStore` from `Command` and
   `AudioEngine` (issues #4, #13). Schema drift waiting to happen.
5. **No undo/redo integration; no `handlers/`; no `AppAction` surface**
   (issue #22). Knead edits cannot be undone.
6. **Persisted `isAnalyzing` / `analysisProgress`** (issue #23). A
   crashed analysis pollutes the next session.
7. **Performance write-amplification through `syncKneadToEngine`**
   (issues #8, #27). Every CRDT projection becomes an O(N×M) engine
   sync; every blob drag does the same.

---

## Open issues

### 1. The DSP-analysis pipeline is dead — `ingestDspAnalysis` has no caller

**Problem:** `analyzePitchForClip` (in `AudioEngine`) writes
`kneadStore.contours[clipId]`. `KneadEditor` reads
`kneadStore.clips[clipId].blobs`. No production code path connects the two
— the bridge is `ingestDspAnalysis`, but it is invoked only by tests. The
user clicks "Enable Knead", waits for the analyser, and is left on the
"Analyzing pitch tracking data..." overlay forever.

**Representative files:**

- `src/modules/Knead/useCases/dspAnalysis.ts`
- `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts`
- `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx:86-106`

**Needed:** Wire `analyzePitchForClip`'s success path to call
`ingestDspAnalysis(clipId, framesFromContour)`. Either expose a
`ingestPitchContour(clipId, contour)` use case from Knead that translates
`PitchContour.points` into the `{ time, f0, periodicity }` frames shape
that `ingestDspAnalysis` expects, or have `analyzePitchForClip` pre-shape
the frames and call `ingestDspAnalysis` directly. Add an integration test
that runs the analyser, asserts `kneadStore.contours[clipId]` is set
**and** `kneadStore.clips[clipId].blobs.length > 0`.

### 2. Three parallel "knead clip" type families with silent casts at the boundaries

**Problem:** `Knead/stores/kneadStore.ts`, `Arrangement/models/Track.ts`,
and `AudioEngine/services/kneadProcessor.ts` each declare their own clip /
blob type, with different field sets. The Knead/Arrangement seam is
crossed by an `as KneadClipState` cast and a free-form mirror write that
puts Knead-shaped data into an Arrangement-typed slot. The
Knead/AudioEngine seam is crossed by `Record<string, unknown>` at the
engine API.

**Representative files:**

- `src/modules/Knead/stores/kneadStore.ts:6-30`
- `src/modules/Arrangement/models/Track.ts:122-139`
- `src/modules/AudioEngine/services/kneadProcessor.ts:13-24`
- `src/modules/Knead/useCases/hydrateKneadFromTrackStore.ts:21`
- `src/modules/Knead/useCases/updateClipKneadState.ts:31`

**Needed:** Either consolidate to one canonical type owned by Knead with
explicit transformer functions at each boundary
(`toArrangementKneadState`, `toEngineKneadClip`), or accept the seam and
make the conversions typed. Drop the `as KneadClipState` cast (have
`hydrateKneadFromTrackStore` build a `KneadClipState` from the Arrangement
fields explicitly, with documented defaults for missing fields). At the
engine boundary, replace `Record<string, unknown>` with a typed shape
co-located with the worklet's `KneadClip` so the producer and consumer
agree.

### 3. Dead `models/KneadBlob.ts` file with stale type definitions

**Problem:** `models/KneadBlob.ts` defines `NoteBlob` and `KneadClipState`
that no code imports. The types differ from `stores/kneadStore.ts`'s
versions (no `originalPitchCenterCents`). A future maintainer importing
the wrong definition silently breaks the worklet's
`pitchCenterCents - originalPitchCenterCents` shift calculation.

**Representative files:**

- `src/modules/Knead/models/KneadBlob.ts`

**Needed:** Delete the file (requires explicit user instruction per
project safety rules — surface as a recommendation), or make it the
canonical type and have `stores/kneadStore.ts` import from it.

### 4. Cross-module deep imports into `Knead/stores/kneadStore`

**Problem:** `Command/useCases/pitch/commitPitchEdit.ts:4` and
`AudioEngine/useCases/audioAnalysis/processPitchEditWasm.ts:4` import
`PitchContour` from `#/modules/Knead/stores/kneadStore`. Per
`.dependency-cruiser.cjs` `cross-module-index-only`, cross-module imports
must hit a contract barrel (`stores/index.ts` is acceptable;
`stores/kneadStore.ts` is not).

**Representative files:**

- `src/modules/Command/useCases/pitch/commitPitchEdit.ts:4`
- `src/modules/AudioEngine/useCases/audioAnalysis/processPitchEditWasm.ts:4`

**Needed:** Change the imports to `#/modules/Knead/stores`. The barrel
already re-exports `PitchContour` and `PitchPoint`. Then run
`pnpm deps:validate` to confirm no remaining deep imports.

### 5. `PitchContour` is double-declared in Knead and AudioEngine

**Problem:** `stores/kneadStore.ts:32-44` and
`AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts:14-26` declare
`PitchPoint` and `PitchContour` independently. The Knead version's
`algorithm` is optional; the AudioEngine version's is required. Drift
between the two will not be caught by the type system because they are
not connected.

**Representative files:**

- `src/modules/Knead/stores/kneadStore.ts:32-44`
- `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts:14-26`

**Needed:** Decide which module owns `PitchContour`. If Knead owns it
(matches the persistence boundary), `analyzePitchForClip` should
`import { type PitchContour } from '#/modules/Knead/stores'` and drop its
local definition. If AudioEngine owns it (matches the producer side),
Knead should import it. The fact that the file path is currently used as
a deep import (issue #4) is a smell pointing at the same problem.

### 6. `syncKneadToEngine` ignores trackStore, missing the "device added"
event

**Problem:** Subscribes only to `kneadStore`. Adding a Knead device to a
track via `addDevice` updates `trackStore` but not `kneadStore`, so the
worklet never receives an initial state push. The user enables the Knead
device, hits play, and hears no pitch shift until they nudge a slider.

**Representative files:**

- `src/modules/Knead/useCases/syncKneadToEngine.ts:14-44`

**Needed:** Subscribe to **both** stores (combine into a single derived
"sync trigger") with proper diffing — only push to engine when the set of
Knead-enabled tracks or any clip's blobs/startBeat/endBeat actually
changed for that track. Add a test that simulates "add Knead device on
empty track" and asserts `audioEngine.syncKneadState` is called.

### 7. `syncKneadToEngine`'s unsubscribe is discarded

**Problem:** `useAppInitialization.ts:35` calls `syncKneadToEngine()` and
throws away the returned unsubscribe. Across HMR or any re-mount, every
new subscription stacks onto the previous one. After 5 HMR cycles, every
kneadStore mutation fires 5 callbacks, each pushing N tracks to the
engine.

**Representative files:**

- `src/modules/Workspace/presentations/hooks/useAppInitialization.ts:35`
- `src/modules/Knead/useCases/syncKneadToEngine.ts:42-44`

**Needed:** Capture the unsubscribe in `useAppInitialization` and return
it from the `useEffect` cleanup. Better: refactor the side-effect into a
proper `useEffect` so React owns the lifecycle. Add a regression test
that asserts a second `syncKneadToEngine()` call replaces (not stacks)
the previous subscription, or that the returned function is honoured.

### 8. `syncKneadToEngine` has no diffing — write amplification

**Problem:** Every kneadStore mutation iterates every track, every track's
devices, every clip, builds a `Record<string, EngineKneadState>`, and
pushes to the engine. A single `pitchCenterCents` drag on one blob
produces N engine syncs (one per track with a Knead device), each
carrying the full clip state for every clip on that track. Combined with
issue #27 (CRDT projection re-runs hydrate-then-sync), the engine
receives orders of magnitude more state writes than it needs.

**Representative files:**

- `src/modules/Knead/useCases/syncKneadToEngine.ts:21-39`
- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:29`

**Needed:** Diff the previous and current snapshot per track. Use a
shallow equality check on `(devices, clips × kneadState)` and skip the
`audioEngine.syncKneadState` call when nothing changed. Coalesce
notifications via `requestAnimationFrame` if needed. Add a benchmark or a
"how many engine syncs per single drag" test.

### 9. `hydrateKneadFromTrackStore` casts `clip.kneadState as
KneadClipState`

**Problem:** Arrangement's `ClipKneadState` has 4 fields; Knead's
`KneadClipState` has 7. The cast fabricates 3 fields out of thin air;
they read as `undefined` at runtime. Code that doesn't fall back lands
on `undefined`. Fields that the editor relies on
(`toleranceCents`/`toleranceTimeMs`) are never persisted — they live in
kneadStore only.

**Representative files:**

- `src/modules/Knead/useCases/hydrateKneadFromTrackStore.ts:21`
- `src/modules/Arrangement/models/Track.ts:125-130`

**Needed:** Replace the cast with an explicit projection that reads
each Arrangement field and applies a default for the Knead-only fields:
`{ clipId: clip.id, blobs, retuneSpeedMs, humanizePercent,
formantPreserve, toleranceCents: DEFAULT_TOLERANCE_CENTS,
toleranceTimeMs: DEFAULT_TOLERANCE_TIME_MS }`. Then either decide that
tolerances are persistable (add them to `Arrangement.ClipKneadState`)
or that they are session-only (do not persist them through the
trackStore mirror in `updateClipKneadState`).

### 10. `updateClipKneadState` mirrors Knead-shaped data into the
Arrangement clip

**Problem:** Writes `{ ...clip, kneadState: nextKneadState }` where
`nextKneadState` carries `clipId`, `toleranceCents`, `toleranceTimeMs`
that the Arrangement type does not declare. The persisted document is a
structural superset of the type; the type system protects nothing here.

**Representative files:**

- `src/modules/Knead/useCases/updateClipKneadState.ts:31`
- `src/modules/Arrangement/models/Track.ts:125-130`

**Needed:** Project `nextKneadState` to the Arrangement-shaped subset
before writing — `{ blobs, retuneSpeedMs, humanizePercent,
formantPreserve }`. Or extend the Arrangement model to match (with a
spec/migration plan). Either way, kill the implicit-superset persistence.

### 11. `KneadStoreState` mixes persisted and transient state

**Problem:** `kneadStore` is Automerge-backed (`createAutomergeStorage(...)`)
yet holds `isAnalyzing` and `analysisProgress`, which are session-only
runtime flags. A page reload that restores the doc rehydrates
`isAnalyzing: true` if the previous session crashed mid-analysis. The
UI then shows a stuck spinner.

**Representative files:**

- `src/modules/Knead/stores/kneadStore.ts:46-60`
- `src/modules/AudioEngine/useCases/audioAnalysis/analyzePitchForClip.ts:91-97,142-151,162-169`

**Needed:** Split the store: keep the persisted state (clips, contours,
activeClipId) in `kneadStore`; move `isAnalyzing` /
`analysisProgress` into a separate transient store (e.g.
`kneadAnalysisStatusStore` with a `MemoryStorage`). Or: clear them
explicitly during `kneadStore.hydrate()`. Add a regression test that
loads a doc with `isAnalyzing: true` and asserts the runtime flag is
reset on hydrate.

### 12. No `handlers/`, no `AppAction` surface, no undo for Knead edits

**Problem:** Pitch-correction edits (drag a blob's pitch up, change
retune speed, etc.) are direct store writes via `updateClipKneadState`.
There is no `executeAppAction(...)` wrapping, no `createHandler`
registration, no undo entry. Cmd-Z does not revert a knead edit.

**Representative files:**

- `src/modules/Knead/useCases/updateClipKneadState.ts`
- `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx:60-66,413-441`
- `src/modules/Command/useCases/pitch/commitPitchEdit.ts` (the only
  Knead-adjacent undo entry, and it covers only the "render destructive
  audio" step)

**Needed:** Define `AppAction` variants for the editorial ops
(`updateKneadBlobPitch`, `updateKneadRetuneSpeed`, etc.), add
`handlers/knead*.ts` files with `createHandler` registrations, and
expose `getKneadHandlers()` from the module barrel. The editor calls
`executeAppAction(...)` instead of `updateClipKneadState` directly. Each
handler creates an undo entry via `createCallbackUndoEntry`.

### 13. `setActiveKneadClip` and `activeClipId` are dead

**Problem:** `setActiveKneadClip` is defined in `stores/kneadStore.ts`
and never imported. `activeClipId` is never read by any consumer. Dead
state and a dead setter.

**Representative files:**

- `src/modules/Knead/stores/kneadStore.ts:46-72`

**Needed:** Either delete `activeClipId` from `KneadStoreState` and
delete the setter, or wire it: when `KneadEditor` mounts, call
`setActiveKneadClip(clipId)`; the worklet (or `syncKneadToEngine`) uses
`activeClipId` to skip processing inactive clips. Expose the setter from
`stores/index.ts` (or move it to `useCases/`) if kept.

### 14. Persisted Automerge document leaks Knead-only fields into
Arrangement

**Problem:** Because `updateClipKneadState` mirrors the full
Knead-shaped state into `clip.kneadState` (issue #10), the persisted
project document under Arrangement carries extra fields that the
Arrangement model doesn't recognise. Migrating the Arrangement model
(e.g. dropping `kneadState`) would silently lose these fields; reading
them back into Knead's `hydrateKneadFromTrackStore` already silently
drops the structural drift.

**Representative files:**

- `src/modules/Project/models/ProjectData.ts:333-343`
  (`ProjectClipKneadBlob` — yet another fork, used by project demo
  utilities)
- `src/modules/Knead/useCases/updateClipKneadState.ts:31`

**Needed:** Cross-reference with the Arrangement / Project audits.
Decide whether the Arrangement model is the source of truth (then
project Knead state down to that subset) or whether Knead persistence
is independent (then store the full Knead state in `kneadStore` only,
and don't mirror to Arrangement). The current "mirror but drop fields"
hybrid is the worst of both.

### 15. `ingestDspAnalysis` end-time off-by-one

**Problem:** A blob's `endTime` is the timestamp of the **last voiced
frame**, not the end of that frame's analysis window. The worklet's
`clipTimeSeconds <= b.endTime` check de-activates the shift one
analysis-hop early.

**Representative files:**

- `src/modules/Knead/useCases/dspAnalysis.ts:41`
- `src/modules/AudioEngine/services/kneadProcessor.ts:117-126`

**Needed:** Either store `endTime = lastFrame.time + hopSize` (requires
plumbing `hopSize` into the use case) or expand the worklet's interval
check to `clipTimeSeconds < b.endTime + smallHopMargin`. Add a test that
verifies the active interval matches the voiced span end-to-end.

### 16. `ingestDspAnalysis` cross-pitch averaging silently produces
nonsense

**Problem:** When a voiced run with two different pitches is bridged
through a 3-frame gap, the confidence-weighted **mean** lands between
the two pitches, and `pitchCurveCents` becomes the deviation from that
midpoint. The worklet then applies `pitchCenterCents -
originalPitchCenterCents` as a single shift across what was actually two
notes.

**Representative files:**

- `src/modules/Knead/useCases/dspAnalysis.ts:24-86`

**Needed:** Add a pitch-stability check inside `finalizeBlob` (or split
the run when consecutive voiced frames differ by more than e.g. one
semitone). Add a test with two voiced regions at different pitches
separated by a 2-frame gap and assert two blobs are emitted, not one.

### 17. `ingestDspAnalysis` `totalConfidence` divide guard is implicit

**Problem:** `totalWeightedCents / totalConfidence` (`dspAnalysis.ts:39`)
relies on `MIN_BLOB_FRAMES = 5` and the upstream `periodicity > 0.6`
threshold. If either changes, the divide can produce `NaN` and propagate
into `pitchCenterCents`.

**Representative files:**

- `src/modules/Knead/useCases/dspAnalysis.ts:34-39`

**Needed:** Guard `if (totalConfidence <= 0) { return; }` before the
divide, or assert `totalConfidence > 0` with a typed error. Add a test
that feeds zero-confidence frames and asserts no blob is emitted.

### 18. Function signatures take positional args (AGENTS.md violation)

**Problem:** AGENTS.md "Function Signatures" requires single-object
params for module-level functions with more than one parameter, named
`<FunctionName>Input`.

**Representative files:**

- `src/modules/Knead/useCases/dspAnalysis.ts:13`
  (`ingestDspAnalysis(clipId, frames)`)
- `src/modules/Knead/useCases/updateClipKneadState.ts:5`
  (`updateClipKneadState(clipId, updater)`)

**Needed:** Refactor to
`ingestDspAnalysis({ clipId, frames }: IngestDspAnalysisInput)` and
`updateClipKneadState({ clipId, updater }: UpdateClipKneadStateInput)`.
Update callers (1 production caller for `updateClipKneadState`, 0 for
`ingestDspAnalysis` — see issue #1).

### 19. `stores/index.ts` exports private types

**Problem:** `KneadClipState`, `KneadStoreState`, `NoteBlob` are
re-exported from `stores/index.ts`. AGENTS.md "Model isolation" forbids
re-exporting internal types across the module boundary; consumers
should define their own local types or use `Parameters<typeof fn>` /
`ReturnType<typeof fn>`.

**Representative files:**

- `src/modules/Knead/stores/index.ts:2`

**Needed:** Drop the type re-exports. Audit cross-module consumers (none
today, but `WaveformEditor.spec.tsx` and `KneadEditor.spec.tsx` reach
into the store value structurally) and have them use `ReturnType<typeof
kneadStore.value>` or a local shape they own. Note: `PitchContour` and
`PitchPoint` are arguably wire-format types and may belong in `events/`
or stay if cross-module persistence requires it — but if they stay,
move them out of `stores/kneadStore.ts` into a clearly cross-module
file.

### 20. Test casts via `as never`

**Problem:** `dspAnalysis.spec.ts:23, :37, :55` casts a partial
`KneadClipState` as `never` to satisfy the updater's parameter type.
AGENTS.md "TypeScript — soundness" forbids this.

**Representative files:**

- `src/modules/Knead/useCases/__tests__/dspAnalysis.spec.ts:23,37,55`

**Needed:** Build a typed default `KneadClipState` fixture (or import
the real default constant once it exists per issue #21). Replace the
`as never` casts with the real shape.

### 21. Default `KneadClipState` is duplicated and magic-numbered

**Problem:** `updateClipKneadState.ts:11-19` seeds defaults
(`retuneSpeedMs: 25`, `toleranceCents: 25`, `toleranceTimeMs: 30`,
`humanizePercent: 40`, `formantPreserve: true`). `KneadEditor.tsx` uses
the same numbers via `?? 25` / `?? 40` / `?? true` fallbacks. Two
sources of truth.

**Representative files:**

- `src/modules/Knead/useCases/updateClipKneadState.ts:11-19`
- `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx:488,546,557`

**Needed:** Extract `DEFAULT_KNEAD_CLIP_STATE` to `stores/kneadStore.ts`
(or a `models/` file with a real purpose), export from
`stores/index.ts`, and use it in both call sites. Add unit test that
asserts the constant is referenced by both.

### 22. No tests for hydrate / sync / update use cases

**Problem:** `dspAnalysis.spec.ts` is the only spec. Hydrate's silent
field-strip (issue #9), sync's missing trackStore subscription (issue
#6), update's dual-store mirror (issue #10), all uncovered.

**Representative files:**

- `src/modules/Knead/useCases/__tests__/`

**Needed:** Add specs for `hydrateKneadFromTrackStore`,
`syncKneadToEngine`, and `updateClipKneadState`. For `syncKneadToEngine`
specifically: assert that adding a Knead device fires an engine sync,
assert that mutating an unrelated track does not, assert that the
returned unsubscribe stops the subscription.

### 23. `NoteBlob` advertises six fields with no producer or consumer

**Problem:** `formantShiftCents`, `gainDb`, `muted`,
`vibratoDepthPercent`, `vibratoRateHz`, `driftPercent` are declared but
never read or written outside their definition. The worklet
(`kneadProcessor.ts`) reads only `pitchCenterCents` and
`originalPitchCenterCents`. The editor surface does not expose them.

**Representative files:**

- `src/modules/Knead/stores/kneadStore.ts:6-20`
- `src/modules/AudioEngine/services/kneadProcessor.ts:13-24`
- `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx`

**Needed:** Either implement the editing UI and worklet handling for the
remaining fields (and define their semantics in a spec), or remove them
from `NoteBlob`. Today they are persisted unfilled fields rotting in
the Automerge doc.

### 24. `hydrateKneadFromTrackStore` clobbers session blobs on every CRDT
projection

**Problem:** `projectProjection.ts:29` calls
`hydrateKneadFromTrackStore()` after every projection. The hydrate
overwrites `kneadStore.clips` from `trackStore.clips[*].kneadState`. If
a clip's blobs exist in `kneadStore` but not yet in the Arrangement
doc (e.g. just-ingested analysis), the hydrate erases them.

**Representative files:**

- `src/modules/Knead/useCases/hydrateKneadFromTrackStore.ts:9-33`
- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:29`

**Needed:** Make the hydrate idempotent / additive: merge clips that
exist only in `kneadStore` rather than dropping them. Or trigger
hydrate only on initial project load (not on every projection). Add a
test where the `kneadStore` has a clip the trackStore doesn't, assert
the clip survives a hydrate.

---

## Open questions

- [ ] Was `ingestDspAnalysis` written as a future hook for the
      analyser pipeline, or has the wiring code been removed? Git history
      will say. (Affects how aggressively #1 needs to wire vs. design new
      code.)
- [ ] Is `Arrangement.ClipKneadState`'s narrow shape intentional (only
      persist user-facing settings) or accidental (someone wrote it
      first, Knead diverged)?
- [ ] Should `PitchContour` live in `Knead` or `AudioEngine`? The
      analyser produces it; the editor consumes it; the persistence layer
      stores it. Picking an owner closes #4 and #5 together.
- [ ] Is the worklet's wider duck-typing of clip state intentional
      (forward-compat) or accidental? If intentional, it deserves a
      documented contract; if accidental, the engine API should be
      tightened to the minimum shape.
- [ ] Does the Knead device-detection happen by `device.type === 'Knead'`
      anywhere else? `KneadEditor.tsx` uses `.toLowerCase() === 'knead'`,
      `syncKneadToEngine.ts` uses the same. Is there a canonical
      registry or constant somewhere this should reference?

---

## Risks

- **User-visible feature is non-functional** (issue #1). The "knead"
  feature ships with a broken pipeline. A user enabling the device sees
  a perpetual spinner. Any QA that didn't drag a blob explicitly would
  not catch this; any spec that exercises the analyser→edit flow does
  not exist.
- **Schema drift across module boundaries** (issues #2, #5, #14). Three
  forks of the type can diverge silently. The next field added to the
  worklet's blob (e.g. `formantShiftCents` becomes meaningful) requires
  manual updates in three places, with no compiler warning when one
  is missed.
- **HMR-caused ghost subscribers** (issue #7). Not a correctness bug
  per-se, but a memory + CPU drain that grows with developer activity.
  In production this is irrelevant — but the code path is the same one
  that would surface on a re-mount of the AppShell, and we have no
  evidence that doesn't happen.
- **Persistence + transient-state collision** (issue #11). A
  mid-analysis crash leaves the next session with a stuck UI. Not
  catastrophic, but the kind of bug that surfaces during demos.
- **No undo/redo** (issue #12). Users will press Cmd-Z and lose
  confidence in the editor. This is a UX trust issue.
- **Engine write amplification** (issues #8, #24). Per-keystroke audio
  artefacts (clicks, drop-outs) if the engine has to chew through
  thousands of full state pushes per second during a drag.

---

## Suggested approaches

- **Wire the pipeline first** (issue #1). The cheapest fix that
  unblocks the entire feature: have `analyzePitchForClip`'s success
  path call into a Knead use case that converts `PitchContour.points`
  into `ingestDspAnalysis` frames. Land it with a test that asserts
  blobs appear after analysis.
- **Then collapse the type forks** (issues #2, #3, #5, #14). Pick
  Knead as the canonical owner of `NoteBlob` / `KneadClipState` /
  `PitchContour`. Define explicit transformer functions at the
  Arrangement and AudioEngine seams. Delete `models/KneadBlob.ts`.
  Single PR.
- **Fix the sync subscriber bugs** (issues #6, #7, #8). Replace the
  stand-alone `syncKneadToEngine()` call with a `useEffect` in
  `useAppInitialization` that subscribes to both stores and returns
  the cleanup. Add diffing.
- **Move transient state out of Automerge** (issue #11). Two-store
  split or hydrate-time reset.
- **Add the `handlers/` surface** (issue #12). One handler per
  editorial op, each creating an undo entry. The editor calls
  `executeAppAction` instead of `updateClipKneadState` directly.
- **AGENTS.md compliance pass** (issues #18, #19, #20). Mechanical
  refactor; should land in a single follow-up commit.

---

## Recommendation

**Issue #1 first.** The whole module is gated on this — without the
analyser→ingest wiring, every other improvement is decoration. The fix
is mechanical: one new use case, one call site, one integration test.
Land it standalone. Then **issue #2 (type fork consolidation)** —
because every subsequent change touches the seam, and unifying the
type story makes those changes safe. After that, **issue #6 + #7
(syncKneadToEngine bugs)** because they are user-visible audio
correctness defects.

The "tests + signatures + barrels" cleanup (issues #18, #19, #20, #22)
can run in parallel with any of the above as a small mechanical PR.

---

## Resolved

_No issues resolved yet._
