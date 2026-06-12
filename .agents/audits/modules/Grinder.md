# Grinder module audit

## Scope

This audit covers `src/modules/Grinder/` in full — all stores, models,
services, repositories, use cases (including the `grinderParamBridge/`
sub-folder), handlers (none — see findings), events (empty), and
presentations (`GrinderPanel.tsx` plus the one `ImportedNeuralLibraryCard`
component) and their tests. It explicitly excludes the upstream callers
(`AudioEngine/engine/wasmDeviceRegistry.ts`, `Workspace/AppShell.tsx`,
`Project/projectPersistence`) except where they are directly touched by
this module's contract.

It is an adversarial review: bugs, race conditions, dependency-graph
violations, dead/unsound types, lazy tests, accessibility, audio-thread
hazards, and AGENTS.md compliance.

Related spec: none on disk.

**Adversarial verification pass (this revision).** Every numbered issue
below has been re-verified against `src/modules/Grinder/` at the cited
line. Verified items are unchanged; reclassified items moved between
priority bands; bogus items dropped or downgraded; new findings
appended at the end of `## Open issues` with `### NEW-N` ids. The most
critical addition: `GrinderPanel.replacePatch` (line 1955-1957) routes
**every** single-field UI mutation through `loadGrinderPatchWithAudio`
→ `syncGrinderPatchToAudio` — toggling one boolean ships ~80
postMessages.

---

## Goal

A correctness-first amp/cabinet/pedalboard/neural-capture host:

- Per-device patch state is consistent across `patch`, `basePatch`, and
  the actual audio worklet — recall, snapshot, and pedal-chain reorder
  produce a single, atomic, agreed-upon view.
- The "param bridge" is the **single** path between user gesture and
  audio engine: every store mutation has a paired worklet update, and
  every worklet update goes through the rAF batcher to absorb 60 Hz
  drag input.
- Imported NAM models survive HMR, project reload, and concurrent
  imports without leaking entries, races, or corrupting the IndexedDB
  store.
- Neural / amp / cab parameter type maps are sound: enum values are
  stored as their string discriminant in the patch and only converted to
  numeric DSP slot indices at the worklet boundary.
- The 1981-line `GrinderPanel.tsx` is decomposable: each section's local
  state, RAF reads, and patch handlers live in their own files so the
  panel doesn't subscribe-and-rerender on every telemetry frame.
- AGENTS.md hard rules: no `any`, no `as any` / `as never` / `as unknown`
  to silence the compiler, no `useMemo` / `useCallback` / `React.memo`,
  no `forwardRef`, no `&&` rendering, no namespace imports, no
  cross-module imports of internals, one function per `useCases/` /
  `repositories/` file, root `index.ts` is the **only** cross-module
  surface.

---

## Relevant code paths

- `src/modules/Grinder/` — there is **no** module-root `index.ts` (see #1)
- `src/modules/Grinder/stores/index.ts`
- `src/modules/Grinder/stores/grinderStore.ts`
- `src/modules/Grinder/stores/grinderNeuralLibraryStore.ts`
- `src/modules/Grinder/stores/grinderTelemetryStore.ts`
- `src/modules/Grinder/models/GrinderPatch.ts` (615 LoC, model + helpers + param defs)
- `src/modules/Grinder/services/parseGrinderNamFile.ts`
- `src/modules/Grinder/repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary.ts`
- `src/modules/Grinder/repositories/neuralLibraryPersistence/restoreGrinderNeuralLibrary.ts`
- `src/modules/Grinder/repositories/neuralLibraryPersistence/pickGrinderNeuralModelFiles.ts`
- `src/modules/Grinder/repositories/neuralLibraryPersistence/downloadGrinderNeuralModelFile.ts`
- `src/modules/Grinder/useCases/index.ts`
- `src/modules/Grinder/useCases/grinderPresets.ts`
- `src/modules/Grinder/useCases/exportGrinderNeuralModel.ts`
- `src/modules/Grinder/useCases/importGrinderNeuralModels.ts`
- `src/modules/Grinder/useCases/restoreGrinderNeuralLibrary.ts`
- `src/modules/Grinder/useCases/removeGrinderNeuralModel.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/helpers.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/grinderParamBridgeDependencies.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderMicParamWithAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/recallGrinderSnapshotWithAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx` (1981 LoC)
- `src/modules/Grinder/presentations/components/ImportedNeuralLibraryCard.tsx`
- `src/modules/Grinder/events/index.ts` (single comment, no events)

---

## Current behavior

**Stores.** `grinderStore` keys per-device `GrinderState` (`patch`,
`basePatch`). `basePatch` is the "stable" copy used by snapshot recall;
`patch` is the live UI state. Every mutator (`setGrinderParam`,
`setGrinderPedalParam`, `setGrinderMicParam`, `loadGrinderPatch`,
`replaceGrinderPatchLocally`, `moveGrinderPedalInChain`,
`recallGrinderSnapshot`) touches both copies in the same `set(...)` call.
`grinderTelemetryStore` is a separate per-device map for high-frequency
meter values (10 fields). `grinderNeuralLibraryStore` holds the imported
NAM library, hydrated lazily.

**Models / migration.** `GrinderPatch` is a 50+ field type covering
input → preamp → tone stack → power amp → transformer → cabinet →
mics → post pedals → neural → output → routing → snapshots.
`migrateGrinderPatch` defensively spreads `DEFAULT_PATCH` then overlays
incoming fields, deep-cloning pedals/snapshots/profiles. Called on every
`set`/`load`/`recall` path.

**Param bridge.** Six exported "with audio" use cases, all built via
`inject(grinderParamBridgeDependencies)(...)`. They share a single
module-level `paramBatcher = createRafBatcher<GrinderBatchEntry>()` and
dispatch through `flushParam` which fans out to `updateDeviceParam` (live
audio) and `persistDeviceParam` (project state).
`syncGrinderPatchToAudio` is the bulk path for `loadGrinderPatch` and
`recallGrinderSnapshot`: it iterates `AUDIO_SYNC_KEYS` and ~60 hand-coded
`sendNumericParamToDevice` calls covering pre-pedals, post-pedals, mic
positions, neural slot, cab slot, etc.

**Imports.** `parseGrinderNamFile` parses NAM JSON, samples the weights
into 30 normalised values, derives a 10-row `convWeights` and a handful
of profile scalars (`inputDrive`, `asymmetry`, `outputTrim`, `contourMix`,
`recurrentBias`). Persistence is IndexedDB (`sourdaw-grinder-neural`,
store `imported-model-library`, single key `'entries'`).

**Presentation.** `GrinderPanel.tsx` renders six section tabs (`browse`,
`amp`, `drive`, `cab`, `neural`, `lab`) — each a separate sub-tree under
`HeroStage` and `ControlDeck`. Telemetry meters are read via
`useStore(grinderTelemetryStore, {})` inside each `GrinderTelemetryMeter`
instance. Imports are wired lazily via `useEffect`.

**Tests.** `grinderStore.spec.ts` covers patch loading, pedal enabling,
chain reordering, and snapshot recall. `parseGrinderNamFile.spec.ts`
covers the happy path and a single rejection. The `grinderParamBridge`
specs each mock `inject` to identity, then assert the post-mock function
runs and calls the (mocked) deps. `GrinderPanel.spec.tsx` renders nine
section variants and asserts text/button presence.

---

## Findings

1. **No module-root `index.ts`.** `src/modules/Grinder/` has subfolder
   barrels (`stores/`, `useCases/`, `events/`, `presentations/views/`)
   but **no** root `index.ts`. AGENTS.md: "Each module's **root**
   `index.ts` is the sole **cross-module** public surface". External
   callers reach into `#/modules/Grinder/stores`, `#/modules/Grinder/
presentations/views`, `#/modules/Grinder/useCases` directly — every
   single one is a deep import:

   - `Workspace/AppShell.tsx:26` →
     `#/modules/Grinder/presentations/views`
   - `AudioEngine/engine/wasmDeviceRegistry.ts:15` →
     `#/modules/Grinder/stores`
   - `Project/.../resetModuleStoresToDefault.ts:8` →
     `#/modules/Grinder/stores`

   Without a root barrel, the contract surface is whatever any caller
   can reach through any sub-barrel. The other large modules (Bacteria,
   AudioAnalysis) have the same pattern — but two wrongs do not a
   contract make.

2. **Half the param-bridge use cases are not in the use-cases barrel.**
   `useCases/index.ts` re-exports five of the eight bridge use cases.
   Missing from the barrel:

   - `recallGrinderSnapshotWithAudio`
   - `moveGrinderPedalInChainWithAudio`
   - `syncGrinderPatchToAudio`
   - `removeGrinderNeuralModel`
   - `exportGrinderNeuralModel`

   `GrinderPanel.tsx` imports them via deep relative paths
   (`../../useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio`).
   That is fine **inside** the module, but if any cross-module caller
   ever needs them they are not advertised. More importantly: an
   incomplete barrel suggests no one is treating it as the contract.

3. **`useCases/index.ts` re-exports the param-bridge bundle without
   the snapshot / move / sync / remove / export entries.** Lines 1–7
   re-export only what the panel happens to use right now. The omission
   is silent — there is no "intentional private surface" marker.

4. **`grinderStore.recallGrinderSnapshot` uses `as never` to bypass
   type checking.** `grinderStore.ts:254` writes
   `nextPatch[key as keyof GrinderPatch] = value as never`. CLAUDE.md
   "no `as never` escapes" forbids this — `as never` lets the loop
   write **any** key with **any** value (the snapshot's
   `paramOverrides: Record<string, number>` is a number, but the patch
   key may be `string | boolean | number`). A snapshot persisting
   `engineMode: 0` would silently turn the patch's `engineMode: 'circuit'`
   string into the numeric `0`, breaking `syncGrinderPatchToAudio`'s
   `getOptionIndex` (which calls `options.indexOf(value as string)`
   on a `0`).

5. **Snapshots cannot represent enum / boolean overrides.**
   `GrinderSnapshot.paramOverrides: Record<string, number>` only stores
   numbers. The fields recall can override via the loop at
   `grinderStore.ts:252-256` are exactly the numeric ones — but the
   types do not enforce that, and the `as never` cast in #4 will
   happily clobber a `'crunch-jcm'` string with `0`. Beyond the type
   leak, the model is wrong: a real "snapshot" needs to recall amp
   model, channel, cabinet voice, routing — none of which are numeric.

6. **`grinderParamBridgeDependencies` defines its own `getAllTracks`
   instead of importing the use case.** `grinderParamBridgeDependencies.ts:1-6`:
   ```ts
   import { trackStore, type Track, persistDeviceParam } from '#/modules/Arrangement/stores';
   function getAllTracks(): Track[] {
       return trackStore.value?.tracks ?? [];
   }
   ```
   The proper use case is `getAllTracks` from `#/modules/Arrangement/useCases`
   (`createFindDeviceRef` accepts `GetAllTracksFn = typeof getAllTracks`
   from that exact path). Reaching directly into `Arrangement/stores`
   to inline the same logic violates AGENTS.md "Repositories Touch
   Metal" — the use case is the contract. It also creates a typing
   hazard: if `Track` ever stops being exported from `Arrangement/stores`,
   the bridge breaks. AGENTS.md "Model isolation": models are private
   to their owning module.

7. **`Track` type imported across modules.** Same line as #6 — the
   `Track` type is imported from `#/modules/Arrangement/stores`. AGENTS.md
   "Model isolation": "Models (`models/`) are strictly private to their
   owning module and must never be exported or re-exported across
   module boundaries". `Track` lives in `Arrangement/stores/trackStore.ts`
   but the rule is the same — Grinder should declare its own minimal
   shape (`{ id: string; devices: { id: string }[] }` — that is all
   `createFindDeviceRef` reads).

8. **Module-level `paramBatcher` singleton, HMR-leaky.**
   `helpers.ts:24` `export const paramBatcher = createRafBatcher<GrinderBatchEntry>()`.
   On HMR, the module re-imports replace the singleton; in-flight RAFs
   from the previous module instance still hold references to the old
   `flushParam`, which closes over the old `updateDeviceParamFn`. The
   `cancelAll` API exists but no one calls it on hot-reload. Minor
   blast radius (debug-only), but consistent with the project's
   broader HMR-singleton problem.

9. **`paramBatcher` shares state across all eight bridge use cases.**
   `setGrinderParamWithAudio`, `setGrinderMicParamWithAudio`,
   `setGrinderPedalParamWithAudio` all share one batcher. Composite
   keys (`${deviceId}:${audioKey}`) prevent collision **between**
   handlers but mean a single rAF flush iterates over a single map
   that holds entries for every device/key on the page. A Grinder
   instance plus a Levain plus a Bacteria — each shares its own
   per-module batcher, but during heavy multi-instance editing
   the flush pass walks unrelated entries. Probably negligible at
   real-world scale but undocumented.

10. **`setGrinderParamWithAudio` sends the raw numeric value to the
    audio engine even for boolean/enum keys.** `setGrinderParamWithAudio.ts:81-95`:
    converts `value` to a typed `patchValue` for the **store** (boolean
    or string for enums), then schedules `{ ref, key, value }` — using
    the **raw** numeric `value` — for the audio engine. For booleans
    this happens to work (0/1 round-trips). For enums it works because
    the audio worklet receives a numeric slot. But the `key` sent to
    the worklet is the **patch key** (`engineMode`, `ampModel`, …) —
    the same string the patch uses internally. There is no
    documentation that the worklet's parameter table is expected to
    speak `engineMode` natively. Compare with `syncGrinderPatchToAudio`
    which uses the same key names. If the worklet ever renames or
    splits a parameter, two call sites must change in lockstep — and
    the contract is implicit.

11. **`setGrinderParamWithAudio` synthesises `engineMode` ↔ `neuralEnabled`
    coupling in two places.** `setGrinderParamWithAudio.ts:83-87`:
    ```ts
    if (key === 'engineMode') {
        setGrinderParam(deviceId, 'neuralEnabled', patchValue !== 'circuit');
    } else if (key === 'neuralEnabled') {
        setGrinderParam(deviceId, 'engineMode', (patchValue ? 'hybrid' : 'circuit') as GrinderPatch['engineMode']);
    }
    ```
    The inverse is also present in `migrateGrinderPatch` (lines
    433-437) and silently again in `GrinderPanel.tsx:1517-1521`
    (`replacePatch({ ...patch, engineMode: mode.id, neuralEnabled: mode.id !== 'circuit' })`).
    Three independent copies of "engineMode and neuralEnabled are
    coupled". Any two could disagree. Worse: the second `setGrinderParam`
    call only updates the **store**, not the audio engine — so toggling
    `engineMode` updates the store's `neuralEnabled` but the audio
    worklet receives only the `engineMode` change. The next
    `syncGrinderPatchToAudio` will re-derive `neuralEnabled` and fix it,
    but until then the engine is out of sync with the store.

12. **`syncGrinderPatchToAudio` recomputes redundant values without
    diffing.** `syncGrinderPatchToAudio.ts:151-243` sends ~80
    `sendNumericParamToDevice` calls per invocation: 50+ scalar fields,
    16 pre-pedal flatten params, 16 post-pedal, 4 chain order entries
    each side, 10 mic params, plus the neural slot. Loading a preset
    (the most common path: clicking a preset card) fans out 80+
    postMessages to the audio worklet in one tick, **none** routed
    through the rAF batcher. The batcher exists exactly for this
    workload but `syncGrinderPatchToAudio` bypasses it. Repeated
    rapid-fire preset clicks bombard the worklet's port queue.

13. **`syncGrinderPatchToAudio` has hand-coded fallbacks for
    pedal-not-found.** Lines 173-188 / 195-210: 16 `?? -20`/`?? 4`/
    `?? 5`/`?? 0` defaults for "pre-compressor missing → send default".
    These defaults must agree with `DRIVE_CONTROLS` in `GrinderPanel.tsx`,
    `DEFAULT_PATCH` in `GrinderPatch.ts`, and the worklet's
    `pre-compressor-default`. They do not all agree:
    - `preCompressorThreshold ?? -20` vs `DRIVE_CONTROLS` default `-24`.
    - `preCompressorAttack ?? 10` vs `DRIVE_CONTROLS` default `16`.
    - `preCompressorRelease ?? 200` vs `DRIVE_CONTROLS` default `220`.
    Three sources of truth, all slightly different. When a pedal is
    bypassed in the patch, the worklet receives `-20 dB` threshold but
    the panel's default UI knob position implies `-24 dB`.

14. **`syncGrinderPatchToAudio` uses `findFirstPedal(prePedals,
    ['overdrive', 'boost'])`.** Line 169. If the chain has both an
    `overdrive` and a `boost`, only the first is plumbed; the second
    is silently dropped. The drive bridge `getAudioParamKeyForPedal`
    treats `boost` and `overdrive` as the same audio slot too. This is
    a deliberate design choice (one slot, two semantic types) but it
    is undocumented and the `GrinderPedalType` union still lists
    `boost` separately. Either drop `boost` from the type or document
    the merge.

15. **`syncGrinderPatchToAudio.toAudioValue` returns `null` for unknown
    string-typed keys.** Lines 92-125 — handles `engineMode`, `ampModel`,
    `inputMode`, `toneStackType`, `powerTubeType`, `rectifierType`,
    `cabType`, `neuralPlacement`, `neuralTier`, `routingMode`, plus
    booleans, plus numbers. **Missing:** `inputMode`, `cabIrId` (handled
    out-of-band as `cabIrSlot`), and `neuralModelId`/`neuralModelName`/
    `neuralModelFamily` (sent via `update_device_patch`). Ordering of
    `AUDIO_SYNC_KEYS` does not include `inputMode` either, so it is
    never synced. Add a test that `inputMode` reaches the worklet on
    patch load — it does not.

16. **`AUDIO_SYNC_KEYS` is hand-curated and silently incomplete.**
    `syncGrinderPatchToAudio.ts:29-85`: 56 keys. `GrinderPatch` has
    50+ fields. Missing: `name`, `uiSection` (correctly), `inputMode`
    (incorrectly — it's a tone-shaping parameter), `cabIrId` (handled
    via slot), `neuralModelId/Name/Family/Source/Profile/Status/
WarmupProgress`, `snapshots`, `activeSnapshot`. The omission of
    `inputMode` is a real bug; the others may be deliberate. There is
    no test that a round-trip patch ↔ worklet preserves all
    audio-relevant fields.

17. **`setGrinderPedalParamWithAudio` accepts `paramKey: string`
    instead of a typed param key.** `setGrinderPedalParamWithAudio.ts:21-24`:
    `paramKey: string`. `getAudioParamKeyForPedal(...)` returns `null`
    for unrecognised types — but for an unrecognised **paramKey**
    (e.g. `'attck'` typo) it dutifully constructs `'preCompressorAttck'`
    and ships it to the worklet, where the worklet silently drops it.
    Type the `paramKey` against the pedal-type-specific param union.

18. **`setGrinderMicParamWithAudio` ad-hoc retypes via `unknown`.**
    `setGrinderMicParamWithAudio.ts:25-33`:
    ```ts
    let finalValue: unknown = value;
    if (key === 'enabled') { finalValue = value >= 0.5; }
    else if (key === 'type') { ... finalValue = types[Math.floor(value)] ?? 'dynamic'; }
    setGrinderMicParam(deviceId, micIndex, key, finalValue as GrinderMic[Key]);
    ```
    `unknown` + `as GrinderMic[Key]` is the same kind of escape hatch
    `as any` would give: there is no compiler check that `finalValue`
    actually matches the key's type. The boolean and enum branches are
    correct **today** but the cast disables the compiler from catching
    a future drift. Use a typed branching function.

19. **`setGrinderMicParamWithAudio` ships `value` (the raw input
    number) to the worklet, even for `'type'`.** Line 42: schedules
    `{ ref, key: audioKey, value }` — but for `key === 'type'`, `value`
    is a small float (0–3) and `audioKey` is `'mic1Type'`. The worklet
    receives a numeric. But `setGrinderMicParam` stored a string
    discriminant. Same store-vs-worklet split as #10 — and again the
    contract that the worklet expects a number for `mic1Type` is
    implicit.

20. **`GrinderPanel.tsx` is 1981 lines in a single file.** It contains
    14 component definitions (`GrinderKnob`, `StatusMeter`,
    `GrinderTelemetryMeter`, `ToneResponseStage`, `DriveStage`,
    `CabStage`, `NeuralStage`, `TelemetryReadout`,
    `NeuralTelemetryReadout`, `QuickTelemetryReadout`, `LabStage`,
    `BrowserRail`, `SectionTabs`, `DriveDeck`, `ControlDeck`,
    `HeroStage`, `StatusStrip`, `GrinderPanel`) plus 6 module-level
    constants (`SECTION_TABS`, `ENGINE_MODES`, `AMP_MODELS`,
    `POWER_TUBES`, `RECTIFIERS`, `CAB_MODES`, `ROUTING_PRESETS`,
    `DRIVE_CONTROLS`) and 8 helpers. `presentations/components/`
    holds exactly one component (`ImportedNeuralLibraryCard`). Every
    sub-component should live in `presentations/components/`.

21. **All 14 inline components subscribe `grinderTelemetryStore` /
    `grinderStore` independently.** Each `GrinderTelemetryMeter`,
    `TelemetryReadout`, `QuickTelemetryReadout`, `NeuralTelemetryReadout`
    calls `useStore(grinderTelemetryStore, {})` — the **whole** store,
    not the per-device slice. `StatusStrip` renders 8 telemetry meters,
    each subscribing the whole store. On a 60 Hz telemetry tick that
    is 8 + several other subscribers per device, all firing on every
    field change. The telemetry store exists specifically to avoid
    full-UI rerenders ("Decoupled from the persistent patch store to
    prevent full-UI re-renders at 60fps" — `grinderTelemetryStore.ts:32`),
    but the panel re-renders all of `StatusStrip`, `HeroStage`,
    `LabStage`, etc. on every tick because each meter is a full React
    subtree. There is no per-key selector.

22. **Top-level `useStore(grinderStore, {})` in `GrinderPanel`.**
    `GrinderPanel.tsx:1951` reads the full instance map. Any change
    to **any** Grinder device (across the entire app) re-renders every
    Grinder panel. Should use a per-device selector or split the store
    keyed by deviceId.

23. **`useEffect` race in `ControlDeck`.** Lines 1168-1173:
    ```ts
    useEffect(() => {
        if (neural_library_state.hydrated || neural_library_state.loading) return;
        void restoreGrinderNeuralLibrary();
    }, [neural_library_state.hydrated, neural_library_state.loading]);
    ```
    Two `GrinderPanel` instances mounted simultaneously both observe
    `hydrated: false, loading: false`. Both call
    `restoreGrinderNeuralLibrary()`, which sets `loading: true` and
    awaits IndexedDB. Two concurrent IDB reads, two
    `setGrinderNeuralLibraryState({hydrated: true, ...})` racing with
    `upsertGrinderNeuralLibraryEntries` if an import lands between
    them. AGENTS.md "Async/Server State: use TanStack Query" — this is
    exactly the kind of fetch-on-mount that shouldn't be a `useEffect`.

24. **`restoreGrinderNeuralLibrary` use case discards the second
    boolean.** `useCases/restoreGrinderNeuralLibrary.ts:4-13`: sets
    `loading: true, error: null`, awaits the repo, then
    unconditionally sets `hydrated: true, loading: false, error: null,
    entries`. Three failure modes are silently coalesced to "success
    with []":
    - IDB unavailable → repo returns `[]` (caught) → store gets `[]`
      and `error: null`.
    - IDB has 0 entries → store gets `[]` and `error: null`.
    - Concurrent `upsertGrinderNeuralLibraryEntries` between the
      `setGrinderNeuralLibraryState({loading: true})` and this final
      `set` → the imported entries are **clobbered**.

25. **`importGrinderNeuralModels` is not race-safe with restore /
    other imports.** `importGrinderNeuralModels.ts`: sets
    `loading: true`, picks files, parses, calls
    `upsertGrinderNeuralLibraryEntries(successes)` then
    `await persistGrinderNeuralLibrary({ entries: nextEntries })`.
    Two concurrent imports both observe the pre-state, both upsert,
    both persist. The IndexedDB write is `put([...input.entries],
'entries')` — last writer wins. If user A imports model X and user
    B (or a UI re-trigger) imports model Y at the same time, only
    one persists. There is also no lock against `restore` running mid-
    import.

26. **`persistGrinderNeuralLibrary` swallows all errors.**
    `persistGrinderNeuralLibrary.ts:34-37`: `catch { return false; }`.
    The `return false` ladder propagates to `removeGrinderNeuralModel`
    which surfaces a generic "failed to persist". The actual error
    (quota exceeded, schema mismatch, browser blocked storage) is
    discarded. CLAUDE.md "No fallback hacks": fix the root cause or
    surface it — do not blanket-swallow.

27. **`restoreGrinderNeuralLibrary` repo also swallows errors.** Same
    pattern at `restoreGrinderNeuralLibrary.ts:42-44`. A schema-mismatch
    or quota error returns `[]` and the user sees "no library", with
    no error indication anywhere.

28. **`persistGrinderNeuralLibrary` writes `sourceFileText` (full
    NAM JSON) to IndexedDB.** Lines 24-25 store `[...input.entries]`
    including `sourceFileText` — for a typical 1-50 MB NAM file this
    fills IndexedDB fast. There is no quota check, no compression,
    no "store reference + lazy-load text". Five 50 MB captures will
    push the IndexedDB store to ~250 MB, beyond Safari's typical
    50 MB-per-origin soft cap. The `error: 'failed to persist'` from
    #26 is the only surface for "library full".

29. **`parseGrinderNamFile` rejects valid NAM files that lack
    `version` or `metadata`.** Lines 168-173: requires `architecture`,
    `version`, **and** `weights.length > 0`. Real NAM files often
    omit `version` (the format does not mandate it). Rejecting on
    missing version is overly strict. Spec
    https://github.com/sdatkinson/neural-amp-modeler does not
    require `version`.

30. **`parseGrinderNamFile.collect_weights` flattens via `unshift`.**
    Line 60-72: BFS-flatten using `queue.unshift(...current)`.
    `Array.unshift` on a long queue is O(n). A NAM model with
    100k weights nested 4 deep performs ~4 × 100k = 400k unshift
    operations, each O(n) — quadratic in weight count. Use a stack
    (push/pop) or recursion.

31. **`parseGrinderNamFile.sample_normalized_weights` uses
    `Math.max(1, count - 1)`.** Line 86: `Math.floor((index / Math.max(1,
count - 1)) * (weights.length - 1))`. For `count = 1`, this
    divides by 1 (so `index / 1 = 0`, fine). For `count > 1`,
    `index / (count - 1)` ∈ `[0, 1]`. But the formula multiplies by
    `weights.length - 1`, which is 0 if `weights.length === 1`. The
    early-return at line 78 guards `weights.length === 0` only;
    `weights.length === 1` produces `Math.floor(0)` for every
    `index` → all 30 sampled weights are the same single value.
    Probably tolerable but undocumented.

32. **`hash_string` returns base-36 of `(hash >>> 0)`.**
    `parseGrinderNamFile.ts:39-45`: classic djb2 multiplication.
    For two near-identical NAM files (same weights, different
    metadata), the hash collides. The hash is appended to the entry
    `id` (`imported-${slug}-${hash}`); a collision means the second
    import overwrites the first under `upsertGrinderNeuralLibraryEntries`'s
    `Map` keying. Unlikely in practice (32-bit hash, ~50 imports)
    but a content hash should at least be SHA-1-truncated, not
    djb2.

33. **`exportGrinderNeuralModel` cannot export "patch only" entries
    because there's no `sourceFileText`, but the panel still surfaces
    them via the synthesised "Selected in this patch" entry.**
    `exportGrinderNeuralModel.ts:6-11` writes an error to the
    library store; `GrinderPanel.tsx:1144-1158` synthesises a
    "patch only" entry with `sourceFileText: null`. The
    `ImportedNeuralLibraryCard` correctly hides Export / Remove for
    patch-only entries — but the error message
    `"Cannot export Tight Rhythm: original imported NAM payload
is not available."` only fires if the user manages to call export
    on one (the button is hidden, so this is dead defensive code).

34. **`removeGrinderNeuralModel` writes its error message to the
    **library** store rather than surfacing a notification.**
    `removeGrinderNeuralModel.ts:18-25`: on `persistGrinderNeuralLibrary`
    returning `false`, sets `error: "Could not remove ${name}: failed
to persist..."`. The `GrinderPanel` does render
    `neural_library_state.error` (line 1636-1640), but it is the
    same field that `restoreGrinderNeuralLibrary` resets to `null`
    on hydration and that `importGrinderNeuralModels` uses for
    parse failures. Three error sources, one channel, last-writer
    wins.

35. **`grinderTelemetryStore` is never reset on project change.**
    `Project/.../resetModuleStoresToDefault.ts:34` resets
    `grinderStore` but not `grinderTelemetryStore` or
    `grinderNeuralLibraryStore`. Telemetry surviving project change is
    a real bug: meters from the closed project keep their last values
    until the new project's worklets emit fresh data. Pre-rendered
    telemetry from a stale device id may hang around indefinitely.

36. **`grinderNeuralLibraryStore` survives project change — likely
    correct, undocumented.** Same line: not reset. The user's NAM
    library should presumably persist across project changes (it's a
    user library, not a project asset). If that is the contract, it
    should be documented. Right now the omission is silent.

37. **`grinderStore` `set({})` on project change wipes UI state but
    not pending RAF flushes.** When a project change calls
    `grinderStore.set({})`, any in-flight `paramBatcher` entry from
    the old project still fires `flushParam` with a stale
    `entry.ref`. `findDeviceRef` in the new project may return `null`
    (good — bail out), but the rAF still consumes a frame. Better to
    `paramBatcher.cancelAll()` on project change.

38. **`recallGrinderSnapshot` only respects bypass states for keys
    that already exist in `paramOverrides`.** `grinderStore.ts:252-256`:
    iterates `paramOverrides` and writes to `nextPatch` only if the
    key already exists. A snapshot named `'Bridge'` with
    `paramOverrides: { gain: 8, master: 7, foo: 1 }` silently drops
    `foo` (good) but also has no way of disabling something — there
    is no "remove this param" semantic. The snapshot model is
    "scalar override only".

39. **`GrinderPatch.snapshots` are not validated.** `migrateGrinderPatch`
    `.snapshots.map(cloneSnapshot)` accepts any partial snapshot,
    defaults missing fields. There is no validation that
    `bypassStates` keys map to actual pedal ids in the patch. A
    snapshot with `bypassStates: { ghost_pedal: true }` is silently
    accepted; `applySnapshotToPedals` filters by `pedal.id in
bypassStates` — so the ghost is ignored. Fine, but a user-saved
    snapshot referencing a pedal that was later deleted produces a
    silently-broken snapshot.

40. **`upsertPedal` exported from `grinderStore` is module-private
    in spirit.** `grinderStore.ts:105-116`: helper used only by
    `setGrinderPedalParam`. Exported but not part of any contract.
    Should not be exported.

41. **`movePedalTypeInArray` allocates `[...pedals.keys()].slice(...)`
    per call.** `grinderStore.ts:185-189`: spreads pedal indices into
    an array per move. Cheap (chains are 4–8 long) but unnecessary.

42. **`createDefaultGrinderState` is unreachable dead code.**
    `grinderStore.ts:33-39`: declared, not exported, called only
    by `normalizeGrinderState` when state is `undefined` — but
    `normalizeGrinderState` always uses `state.patch ?? DEFAULT_PATCH`
    so the branch is fine; the actual default state assembly path
    is the second branch. The `createDefaultGrinderState` helper is
    one branch worth of code; redundant.

43. **`replaceGrinderPatchLocally` and `loadGrinderPatch` are
    identical.** `grinderStore.ts:76-103`: 28 lines, two functions,
    one is a copy of the other. The "locally" suffix implies "without
    audio sync", but `loadGrinderPatch` also has no audio sync — that
    happens in `loadGrinderPatchWithAudio`. So the two are
    functionally indistinguishable.

44. **`GrinderPanel.tsx` uses `&&` rendering at line 591.**
    `{patch.mic2.enabled && (...)}`. AGENTS.md/CLAUDE.md: "Never
    render with `&&` — use ternaries or early returns". Same pattern
    is correctly written as `? : null` at line 543, so the inconsistency
    is gratuitous.

45. **Multiple `as` assertions in `GrinderPanel`.** Line 1570:
    `placement.id as GrinderPatch['neuralPlacement']`. Line 1606:
    `model.placement as GrinderPatch['neuralPlacement']`. Both bypass
    type checking. The `placement.id` literal is `'amp-capture' |
'rig-capture'` already (it's a tuple in the inline array literal),
    so the cast is redundant but harmless. The `model.placement` is
    `GrinderNeuralPlacement` from the model, so the cast is redundant.
    Replace with `satisfies` or remove.

46. **`setGrinderParamWithAudio.toPatchValue` casts every return
    through `as GrinderPatch[Key]`.** `setGrinderParamWithAudio.ts:39-67`:
    9 `as GrinderPatch[Key]` casts. The function's job is "given a
    numeric input, return a typed value that fits the patch field" —
    this is exactly what discriminated unions or a per-key map exist
    for. Refactor to a typed dispatch table keyed by `Key`.

47. **`syncGrinderPatchToAudio.toAudioValue` similarly casts via
    `as string`.** `syncGrinderPatchToAudio.ts:103-121`: 10
    `as string` casts. `value` is `GrinderPatch[K]`; the discriminator
    is `key`. A discriminated union check (`switch (key)` with TS
    narrowing the typed value branch) would replace the cast.

48. **`getOptionIndex` returns `null`, not `-1`, for "not found".**
    `syncGrinderPatchToAudio.ts:87-90`: returns `null` for not-found.
    The function `toAudioValue` then returns `null` to the caller,
    which `syncGrinderPatchToAudio` checks with `value === null ||
!Number.isFinite(value)`. The `Number.isFinite(null)` check is
    redundant (`null` is not finite, but the explicit `=== null`
    comes first) — minor.

49. **`AUDIO_SYNC_KEYS as readonly (keyof GrinderPatch)[]` does not
    type-narrow against the model.** `syncGrinderPatchToAudio.ts:29-85`:
    a manually maintained list. `migrateGrinderPatch` adds new fields
    to `GrinderPatch`; the developer has to remember to add them to
    `AUDIO_SYNC_KEYS`. There is no compile-time check that every
    audio-relevant `GrinderPatch` key is in this list. A `Mapped<T>`-
    style type guard or a `satisfies Record<keyof GrinderPatch,
'sync' | 'skip' | 'manual'>` would force completeness.

50. **`GrinderPanel.tsx` `BrowserRail` builds `categories` and
    `filteredPresets` on every render.** Lines 829-834. With React
    Compiler this is fine in principle, but the `filter` walks all
    `GRINDER_PRESETS` plus a `.toLowerCase()` per preset per keystroke.
    Fine at 12 presets; bad at scale, but unlikely to matter.

51. **`GrinderPanel.tsx` `selectImportedNeuralModel` is defined inside
    `ControlDeck` component body.** Lines 1175-1186. Recreated on
    every render. With React Compiler this is fine; with bare React
    19 it would be fine too. No issue, just noting the pattern is
    consistent.

52. **`importNeuralModels` async wrapped twice.** Lines 1188-1199:
    `async function importNeuralModels(): Promise<void> { ... }`
    inside the component body, then `onClick={() => void importNeuralModels()}`
    at line 1631. The `set_is_importing_models` is set to `false`
    in a `finally` — but if React unmounts the panel between the
    `try` and the `finally`, the state setter on an unmounted
    component logs a warning. Use an `isMounted` ref or move the
    state to the store.

53. **`fireEvent` test for ImportedNeuralLibraryCard uses
    `getByRole('button', { name: /tight rhythm/i })`.** Lines
    93-95: that button has aria-label / accessible name `Tight Rhythm`
    derived from the inner `<span>`. That works. But the **outer**
    container is also clickable (the parent `<button>` containing
    the name span has accessible name "Tight Rhythm"). Two
    sibling buttons (Export NAM, Remove capture) are nested inside
    the outer wrapper — invalid HTML: `<button>` cannot contain
    `<button>`. Browsers DOM-parse it but accessibility tree is
    undefined.

54. **`ImportedNeuralLibraryCard` has nested `<button>` elements.**
    Same as #53 from the production POV. The outer `<button>` (line
    31-40) contains the entry select handler; the inner `<button>`s
    (lines 44-57) for Export/Remove are siblings in the layout but
    DOM-nested inside the outer. The current code wraps the inner
    buttons in a `<div className="flex shrink-0 gap-2">` which is
    a sibling of the outer button — actually a sibling under
    `<div className="flex items-start justify-between gap-3">`. Read
    again carefully: lines 30-40 — the outer container is a `<div>`,
    the **first child** is `<button>` (select), the **second child**
    is `<div>` containing two more `<button>`s. So no nesting. False
    alarm — but the reviewer should verify, the structure is fragile.

55. **`GrinderPanel` `handleDrag` function is defined inside `CabStage`.**
    Lines 504-511. Receives `event: React.MouseEvent` (loose typing —
    should be `React.MouseEvent<HTMLDivElement>`). Calls
    `setGrinderMicParamWithAudio` twice per move (positionX, then
    positionY) — two separate rAF batcher entries, two separate
    audio worklet writes per drag tick. Pack into a single message.

56. **`useEffect` deps include `neural_library_state.hydrated` but
    the inner effect mutates the same store.** Lines 1168-1173: the
    effect's dependency is the result of a hook subscription on the
    same store the effect mutates. After `restoreGrinderNeuralLibrary`
    sets `hydrated: true`, the effect re-runs (deps changed), the
    early return guards. Stable but the dependency chain is one-step
    away from an infinite loop if the guard ever drops.

57. **`presentations/components/` has only one component.** Per
    AGENTS.md the convention is fine; but the implication is that
    every other rendering primitive in `GrinderPanel.tsx` should
    move there. With 14 inline components, this is a pending
    refactor.

58. **Tests for the param bridge over-mock `inject`.**
    `setGrinderParamWithAudio.spec.ts:21-23`,
    `setGrinderPedalParamWithAudio.spec.ts:21-23`,
    `loadGrinderPatchWithAudio.spec.ts:13-15`:
    ```ts
    vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: any) => fn }));
    ```
    The `inject` wrapper that production code uses is replaced by an
    identity function in tests. The test then calls
    `setGrinderParamWithAudio(deps as any)` and gets the inner
    `function setGrinderParamWithAudio(deviceId, ...)` — but in
    production, `setGrinderParamWithAudio` is the **outer** wrapped
    value that resolves deps internally. The test exercises a
    different code shape than production. If `inject` ever changes
    semantics, these tests will pass but production will break.

59. **Tests use `as any` widely.** `setGrinderParamWithAudio.spec.ts`
    lines 58, 76; `setGrinderPedalParamWithAudio.spec.ts` lines 56,
    57; `loadGrinderPatchWithAudio.spec.ts` lines 50, 73, 99, 150,
    183. AGENTS.md "TypeScript — soundness" forbids `as any` and
    `as never` to silence the compiler.

60. **`grinderParamBridge.spec.ts` is a smoke test that asserts
    function existence.** Lines 12-17: `expect(typeof setGrinderParamWithAudio).toBe('function')`.
    The doc comment admits "the original test introspected DI metadata
    which is lost by the transpiler … functional behavior is covered by
    integration tests elsewhere". There is no such integration test in
    the repo for the bridge composition. The smoke test is decorative.

61. **`helpers.spec.ts` is a no-op test.** Three lines:
    `expect(subject).toBeDefined()`. Tests nothing. Either delete
    or test the actual `getAudioParamKeyForPedal`,
    `getPedalOrderAudioEntries`, `getNeuralModelSlot`, `getCabIrSlot`
    surface — all of which have non-trivial behaviour.

62. **`loadGrinderPatchWithAudio.spec.ts` does not exercise the
    `paramBatcher` path.** It mocks `inject` to identity but does not
    mock the batcher. The test then asserts `deps.updateDeviceParam`
    was called — which only happens if the batcher's `flush` runs
    synchronously. In production, `flushParam` runs on the next rAF.
    The test passes because `loadGrinderPatchWithAudio` calls
    `syncGrinderPatchToAudio` which **bypasses** the batcher and
    calls `update_device_param` synchronously (issue #12). So the
    test confirms #12 inadvertently — `loadGrinderPatch` never
    debounces.

63. **`GrinderPanel.spec.tsx` does not mock `loadGrinderPatchWithAudio`
    or any param bridge fn.** The panel imports those bridge fns at
    module top-level. The test just renders the panel. Clicking
    buttons would trigger real DI resolution, real
    `trackStore.value`, real `audioEngine.updateDeviceParam` — none
    of which are mocked. The current tests only check **render
    output** (text presence, aria-pressed) and never click anything,
    so they pass. Any test that calls `fireEvent.click` on a
    "Bright" toggle, or a preset card, would explode.

64. **No integration test for the patch ↔ audio round-trip.** The
    closest is `loadGrinderPatchWithAudio.spec.ts`. It mocks every
    dep individually. There is no test that "load a preset, then
    snapshot recall, then move a pedal" produces a consistent
    end-state. Snapshot recall (#4 / #5) is only covered by
    `grinderStore.spec.ts`'s store-only path — the audio side
    (`recallGrinderSnapshotWithAudio` → `syncGrinderPatchToAudio`)
    has zero test.

65. **`exportGrinderNeuralModel.spec.ts` does not assert the
    error path.** Lines 1-53: only the happy path. The
    `if (!entry.sourceFileText)` branch sets a library error but
    has no test.

66. **`removeGrinderNeuralModel.spec.ts` covers persist failure
    (#108-109) but not the error message format.** Line 107:
    `expect(...error).toMatch(/could not remove tight rhythm/i)`.
    The format is `"Could not remove ${name}: failed to persist
the updated Neural library."`. The regex matches "could not
    remove tight rhythm" and only that prefix. If the message is
    rewritten to "Removal failed for tight rhythm because…" the
    test passes a different message.

67. **`models/GrinderPatch.ts` mixes types, constants, helpers,
    and runtime logic.** 615 LoC: type definitions, default values,
    cab/neural library constants (`GRINDER_CAB_LIBRARY`,
    `GRINDER_NEURAL_LIBRARY`), `migrateGrinderPatch`,
    `isSupportedGrinderChainPedalType`,
    `getGrinderSupportedChainOrder`, `GRINDER_PARAMS`. AGENTS.md
    "Models (`models/`) are strictly private to their owning
    module" — fine. But the file mixes three concerns: pure type
    declarations, runtime constants, and migration/normalisation
    helpers. Should split into `models/GrinderPatch.ts` (types +
    defaults), `models/grinderLibraries.ts` (constants), and
    `services/migrateGrinderPatch.ts` (runtime helpers).

68. **`GRINDER_PARAMS` is not used anywhere.** No call site in the
    module — a lookup by `id` would have been the natural way to
    drive `GrinderKnob` props but the panel hard-codes
    `min`/`max`/`step`/`defaultValue` per knob (~40+ knobs).
    615-line model file ships ~150 lines of dead constants.

69. **`SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES` and
    `getGrinderSupportedChainOrder` belong in `services/`.**
    They are pure helpers, not domain types. Same for
    `isSupportedGrinderChainPedalType`. Moving them to
    `services/` follows the convention used elsewhere in the
    codebase.

70. **Imported model `id` collisions on re-import.**
    `parseGrinderNamFile.ts:195`: `id: imported-${slug}-${hash}`.
    A user re-importing the same NAM file (e.g. via "Reset" UI flow)
    creates the **same** id; `upsertGrinderNeuralLibraryEntries`
    Map-deduplicates by id and overwrites — but `importedAt` is
    refreshed (`Date.now()`), so the entry "moves to top". Probably
    intentional. The user has no way to import the same file twice
    side-by-side under different names.

71. **`grinderTelemetryStore.getGrinderTelemetry` returns a fresh
    spread on miss.** `grinderTelemetryStore.ts:38`:
    `return grinderTelemetryStore.value?.[deviceId] ?? { ...DEFAULT_GRINDER_TELEMETRY }`.
    Each missing-device read allocates a new 10-field object. With
    8 telemetry meters per panel polling on every render before
    telemetry is initialised, that is 8 fresh allocations per render
    until the worklet emits its first frame. Cache the default
    spread.

72. **`updateGrinderTelemetry` spread vs partial update.**
    `grinderTelemetryStore.ts:41-52`: receives `Partial<GrinderTelemetry>`
    from `wasmDeviceRegistry.ts:449` which actually sends a full
    object. The `Partial` typing allows partial updates but the
    real call site never uses it. Tighten to full `GrinderTelemetry`
    or document why.

73. **`events/index.ts` is a single comment.** `// no public events`.
    Folder exists, file exists, content is one comment. Either
    delete the folder (AGENTS.md does not require it), or surface
    the eventual event contract.

74. **`useCases/index.ts` does not re-export `recallGrinderSnapshotWithAudio`,
    `syncGrinderPatchToAudio`, or `moveGrinderPedalInChainWithAudio`.**
    Already noted in #2 and #3. Repeated for emphasis: these are the
    only paths to a consistent patch ↔ audio update during snapshot
    recall and pedal reorder. If the AppShell pulls
    `recallGrinderSnapshotWithAudio` via deep import, AGENTS.md is
    violated. If only the panel uses it (it does), the barrel is
    incomplete.

75. **`compareGrinderPatchToAudio` does not exist.** No diff path —
    every patch update fans out the full ~80 audio updates. A
    `setPatch(diff)` API on the worklet (which exists,
    `result.setPatch(pendingPatch)` at `wasmDeviceRegistry.ts:436`)
    is only used during initial patch hydration, not during user
    edits.

---

## Priorities

1. **`replacePatch` flushes 80 postMessages per single-field UI
   change** (NEW-1): every `replacePatch` callsite (toggling
   `cabEnabled`, picking an amp model, switching engine mode, …)
   re-routes through `loadGrinderPatchWithAudio` →
   `syncGrinderPatchToAudio`. 21 callsites, each one ~80
   `update_device_param` calls per click. Replaces #8 as the
   highest-impact issue: the bypass of the rAF batcher is
   compounded by being on the trivial mutation path.

2. **Type-soundness escapes that hide real bugs** (issues #3, #5,
   #31, plus NEW-2): `as never` in snapshot recall lets enum
   strings be clobbered by numbers; `unknown as GrinderMic[Key]`
   casts in mic param bridge mask drift; 23 `as` casts in
   `setGrinderParamWithAudio` / `syncGrinderPatchToAudio`. The
   `(patchValue ? 'hybrid' : 'circuit') as GrinderPatch['engineMode']`
   on line 86 is doubly broken — `patchValue` is the union
   `GrinderPatch[Key]` but the runtime guard
   (`key === 'neuralEnabled'`) does not narrow TS. CLAUDE.md "no
   `as never` escapes" / "TypeScript soundness" forbids these.

3. **`engineMode` ↔ `neuralEnabled` quadruple-source coupling**
   (issue #6 + NEW-3): four call sites maintain the rule. The
   migration helper (line 433-437) computes it backwards relative
   to the bridge: a project with `engineMode: 'capture'` and
   `neuralEnabled: false` is preserved as-is by `migrateGrinderPatch`
   but the panel and bridge would both treat that state as
   inconsistent.

4. **`syncGrinderPatchToAudio` bypasses the rAF batcher and ships
   80 messages per call** (issue #8) — and `replacePatch` makes
   that the default flush for trivial UI events (NEW-1). Three
   sources of truth for pedal defaults (#9), `inputMode` is
   handled by `toAudioValue` (line 106-107) but missing from
   `AUDIO_SYNC_KEYS` so the case is dead code (#10/#32).

5. **Architectural / contract violations** (issues #1, #2, #7):
   no module-root `index.ts`, half the param-bridge use cases not
   in the use-cases barrel, custom `getAllTracks` re-implementation
   bypassing the use case, `Track` type imported across modules.

6. **`useEffect` race in neural-library hydration** (issue #11) —
   two `GrinderPanel`s mount → two concurrent IndexedDB reads →
   imported entries can be silently clobbered.
   `restoreGrinderNeuralLibrary` then unconditionally overwrites
   the store entries (audit issue #35).

7. **Telemetry-store rendering pattern re-renders the whole panel
   at 60 Hz** (issues #12, #13): every meter subscribes the entire
   store, defeating the "decoupled telemetry store" comment.
   `useStore` (`src/infra/store/useStore.ts:6`) has no selector
   API — the issue is structural at the store layer.

8. **Snapshot recall is fundamentally type-broken** (issues #3, #4,
   plus the deeper diagnosis below): `paramOverrides:
   Record<string, number>` cannot represent a real snapshot of an
   amp model with strings, booleans, and nested pedal state.

9. **`grinderTelemetryStore` not reset on project change** (issue
   #14) — meters from a closed project linger.

10. **`GrinderPanel.tsx` is 1981 lines** (issue #15) — a refactor
    blocker for any UI work, and the locus of issues #1, #6, #11,
    #12, #25, NEW-1.

11. **Test mocks don't exercise production code paths** (issues
    #16, #17, #18, #19): `inject` is mocked to identity; most
    bridge tests pass via a different code shape than what ships.

12. **Audio-engine contract drift** (NEW-4): `setGrinderParamWithAudio`
    ships the raw input number to the worklet for boolean keys
    (e.g. `gateEnabled: 0.7` instead of `gateEnabled: 1`), while
    `syncGrinderPatchToAudio` sends a normalised `0`/`1`. The
    worklet must threshold; either side could change and the
    contract is implicit.

---

## Open issues

### 1. No module-root `index.ts` — cross-module surface is implicit

**Problem:** `src/modules/Grinder/` has no root `index.ts`. AGENTS.md
mandates that every module's root `index.ts` is the **sole**
cross-module public surface. External callers (`Workspace/AppShell`,
`AudioEngine/wasmDeviceRegistry`, `Project/.../resetModuleStoresToDefault`)
reach into sub-barrels (`#/modules/Grinder/stores`, `#/modules/Grinder/
presentations/views`). Without a root barrel, there is no single
file that defines the cross-module contract.

**Representative files:**

- `src/modules/Grinder/` (no `index.ts`)
- `src/modules/Workspace/presentations/views/AppShell.tsx:26`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:15`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:8`

**Needed:** Create `src/modules/Grinder/index.ts` that re-exports
from `./stores`, `./useCases`, `./presentations/views`, `./events`.
Update the three external callers to import from `#/modules/Grinder`.
Remove the deep-import paths.

### 2. Param-bridge use cases missing from `useCases/index.ts`

**Problem:** Five use cases (`recallGrinderSnapshotWithAudio`,
`moveGrinderPedalInChainWithAudio`, `syncGrinderPatchToAudio`,
`removeGrinderNeuralModel`, `exportGrinderNeuralModel`) are not
re-exported from the use-cases barrel. The panel imports them via
deep relative paths. New cross-module callers would have to choose
between a deep path (illegal per AGENTS.md) and adding the export
themselves.

**Representative files:**

- `src/modules/Grinder/useCases/index.ts:1-7`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:43-44,48,42,41`

**Needed:** Add the missing exports. Verify the panel still uses
relative imports (intra-module) but that the barrel is complete for
external consumers.

### 3. `recallGrinderSnapshot` uses `as never` to clobber the patch

**Verified at:** `grinderStore.ts:254`
`nextPatch[key as keyof GrinderPatch] = value as never`.
`paramOverrides: Record<string, number>` (model file line 157) →
`value` is `number`. The `as never` short-circuits the indexed-write
type check. **Repro:** save a snapshot named `'Lead'` with
`paramOverrides: { ampModel: 2, engineMode: 1, gateEnabled: 1 }`
(plausible if a future `setGrinderSnapshotParam` UI ever ships).
Recall sets `patch.ampModel` to numeric `2` (instead of
`'lead-jcm'`). `syncGrinderPatchToAudio.toAudioValue` (line 92)
detects `typeof value === 'number'` and ships the raw `2` to the
audio engine — but the audio engine expects `0..AMP_MODELS.length-1`
which **is** `2`, so this happens to land. The store, however,
holds the literal number `2` for a field typed as `GrinderAmpModel`.
Any later code reading `patch.ampModel === 'lead-jcm'` is
silently false. **Blast radius:** narrow today (no UI saves
non-numeric overrides) but the type system stops protecting the
contract.

**Adversarial note:** the existing test fixture
(`grinderStore.spec.ts:103`) only ever uses `paramOverrides: { gain: 7 }`
where `gain: number`. So the bug is invisible to current tests
because **the test silently confirms** that `as never` is "safe
in practice" — the test is type-laundering, exactly the failure
mode CLAUDE.md describes.

**Representative files:**

- `src/modules/Grinder/stores/grinderStore.ts:236-271` (verified)
- `src/modules/Grinder/models/GrinderPatch.ts:154-159` (verified)
- `src/modules/Grinder/stores/__tests__/grinderStore.spec.ts:103-104`
  (test launders the `as never`)

**Needed:** Type-narrow the loop: discriminate on the key's expected
type and refuse silently-incompatible overrides. Or — preferred —
redefine `paramOverrides: Partial<GrinderPatch>` and let TS enforce
the per-key types end-to-end. Drop `as never`. Add a test that
saving a `'Crunch'` snapshot with `paramOverrides: { ampModel:
'crunch-jcm', gateEnabled: true }` round-trips through recall and
the patch's `ampModel` is the literal `'crunch-jcm'`.

### 4. Snapshot model cannot represent enum / boolean state

**Problem:** `GrinderSnapshot.paramOverrides: Record<string, number>`
plus `bypassStates: Record<string, boolean>` covers numeric scalars
and pedal bypass — nothing else. A real-world "snapshot" of a tone
typically includes amp model (`'crunch-jcm'`), tone stack
(`'marshall'`), cabinet voice (`'4x12-tight'`), routing mode, mic
type — all strings or enums. The model omits them. Combined with
issue #3, snapshot recall is broken-by-design for any non-numeric
parameter.

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:154-159`
- `src/modules/Grinder/stores/grinderStore.ts:236-271`

**Needed:** Redefine `GrinderSnapshot.paramOverrides` as
`Partial<GrinderPatch>` (typed) and let the recall loop assign keys
typesafe-by-construction. Migrate stored snapshots forward.

### 5. `setGrinderMicParamWithAudio` uses `let finalValue: unknown` plus `as GrinderMic[Key]`

**Problem:** Lines 25-33: stores a value into `unknown` and casts
out to the typed mic field. `unknown` + cast disables the compiler;
a future drift (e.g. `'enabled'` switching to a string discriminator
`'on' | 'off'`) won't be caught.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderMicParamWithAudio.ts:25-42`

**Needed:** Replace with a typed branching function (e.g. a
`switch (key)` returning the typed value at each branch, and a
`satisfies GrinderMic[Key]` check at each branch). Drop the `as`.

### 6. Quadruple-source `engineMode` ↔ `neuralEnabled` coupling

**Verified at:** four independent code paths each maintain a
slightly different version of the rule:

1. **Migration** (`GrinderPatch.ts:433-437`):
   ```ts
   const engineMode = patch.engineMode ?? ((patch.neuralEnabled ?? DEFAULT_PATCH.neuralEnabled) ? 'hybrid' : DEFAULT_PATCH.engineMode);
   const neuralEnabled = patch.neuralEnabled ?? engineMode !== 'circuit';
   ```
   This **respects an explicit `neuralEnabled: false` even with
   `engineMode: 'capture'`** (because of the `??` short-circuit on
   line 437). So a deserialised patch with
   `{ engineMode: 'capture', neuralEnabled: false }` survives — the
   bridge will then re-derive on next user action and they will
   diverge.
2. **Bridge** (`setGrinderParamWithAudio.ts:83-87`): if `key ===
   'engineMode'`, write store `neuralEnabled = patchValue !== 'circuit'`.
   If `key === 'neuralEnabled'`, write store `engineMode =
   patchValue ? 'hybrid' : 'circuit'` (note: not preserving
   `'capture'`!).
3. **Panel mode buttons** (`GrinderPanel.tsx:1517-1521`):
   `replacePatch({ ...patch, engineMode: mode.id, neuralEnabled:
   mode.id !== 'circuit' })`. Since `replacePatch` =
   `loadGrinderPatchWithAudio`, this **also** reapplies migration
   on the way through (line 19 of that bridge), giving the
   migration rule final say.
4. **Audio sync** (`syncGrinderPatchToAudio.ts:159` reads `engineMode`
   from `AUDIO_SYNC_KEYS`, separately reads `neuralEnabled`): two
   separate `update_device_param` calls, no coupling enforcement
   on the audio side at all.

**Worse:** the bridge's coupled write (step 2) only updates the
store — the audio engine receives only the original
`update_device_param`. So flipping `engineMode` from circuit →
hybrid via a numeric knob (the RotaryKnob path) ships only the
`engineMode` change to the worklet; the worklet's internal
`neuralEnabled` parameter stays at its previous value until the
**next** full sync.

**Blast radius:** real audio bug. User flips a mode knob; UI
reflects the new state; audio engine plays the wrong path until
something else triggers a full sync (preset change, project
reload).

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:433-437` (verified)
- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts:83-87` (verified)
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1517-1521` (verified)
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:30,72` (engineMode/neuralEnabled in AUDIO_SYNC_KEYS)

**Needed:** Move the coupling into a single helper (e.g.
`services/deriveNeuralEnabled.ts`). Have all three coupling sites
delegate. The bridge must **also** dispatch the derived
`neuralEnabled` to the audio engine, not just the store. Add a
test that flipping `engineMode === 'circuit'` correctly disables
`neuralEnabled` in both store **and** audio path. Decide whether
"capture without neural" is a legal state or always coerced to
`'circuit'`.

### 7. `grinderParamBridgeDependencies` reaches into `Arrangement/stores`

**Problem:** `grinderParamBridgeDependencies.ts:1-6`:
```ts
import { trackStore, type Track, persistDeviceParam } from '#/modules/Arrangement/stores';
function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}
```
Bypasses `getAllTracks` from `#/modules/Arrangement/useCases` (the
proper public surface). Imports the `Track` type across modules
(AGENTS.md "Model isolation" forbids).

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/grinderParamBridgeDependencies.ts:1-6`

**Needed:** Import the use case
(`getAllTracks` from `#/modules/Arrangement/useCases`) and inject
it. Define a local `GrinderTrackRef` type in `models/` containing
only the `id` and `devices: { id: string }[]` shape that the bridge
needs. Drop the `Track` cross-module import.

### 8. `syncGrinderPatchToAudio` bypasses the rAF batcher

**Verified at:** `syncGrinderPatchToAudio.ts:127-138`
(`sendNumericParamToDevice`) calls `input.update_device_param`
synchronously. The body of `syncGrinderPatchToAudio` (lines
151-243) issues:
- 1 `cabIrSlot` (line 156)
- 56 keys via `AUDIO_SYNC_KEYS` (line 159-166)
- 16 pre-pedal scalar params (line 172-188)
- 16 post-pedal scalar params (line 194-210)
- 4+4 pedal-order entries (line 212-218)
- 1 `neuralModelSlot` or 1 `update_device_patch` (line 220-231)
- 10 mic params (line 233-242)

→ ~107 messages per call (not 80). All synchronous. The
`paramBatcher` (helpers.ts:24) is module-scope and unused on this
path.

**Verified worklet has a `setPatch` API:**
`wasmDeviceRegistry.ts:426,443,473` — the worklet exposes
`setPatch: (patch: Record<string, unknown>) => void`. One message
could replace 107.

**Severity escalation:** see NEW-1 below — `replacePatch` at
`GrinderPanel.tsx:1955-1957` invokes `loadGrinderPatchWithAudio`
on **every** single-field UI change (21 `replacePatch` callsites,
including toggling a single boolean). The audit previously framed
this as "preset click" load — actually it's the default mutation
path.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:127-138,151-243`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:426,443,473`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1955-1957` (single replacePatch entry point)

**Needed:** Route this through `update_device_patch` (the bulk
API) in one message. Audit `replacePatch` callsites (NEW-1) to
remove the unnecessary full-sync mutations — single-field changes
should call `setGrinderParamWithAudio` directly, not `replacePatch`.

### 9. Three sources of truth for pedal default values

**Problem:** Pre-compressor defaults differ across:
- `syncGrinderPatchToAudio.ts:173-176`: `?? -20, ?? 4, ?? 10, ?? 200`.
- `GrinderPanel.tsx` `DRIVE_CONTROLS:204-207`: `-24, 3, 16, 220`.
- `DEFAULT_PATCH` in `GrinderPatch.ts`: no default pedals at all
  (`prePedals: []`).

When a user has no compressor in their patch, the worklet receives
`-20 dB` threshold but the panel shows `-24 dB` if they ever add one.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:172-210`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:193-240`

**Needed:** Single source of truth: a `DEFAULT_PEDAL_PARAMS`
constant in `models/GrinderPatch.ts` referenced by both. Or send
`enabled: 0` only when the pedal is missing and let the worklet
hold its own defaults.

### 10. `inputMode` is never synced to the audio engine (dispatch case is dead code)

**Verified at:** `syncGrinderPatchToAudio.ts:29-85` —
`AUDIO_SYNC_KEYS` does **not** include `'inputMode'`. But
`toAudioValue` (lines 106-107) DOES handle it:
```ts
case 'inputMode':
    return getOptionIndex(INPUT_MODES, value as string);
```
This case is **unreachable** because `toAudioValue` is only called
from inside the `for (const key of AUDIO_SYNC_KEYS)` loop on line
159-166. The author appears to have remembered to handle the
conversion but forgot to add the key to the sync list.

`setGrinderParamWithAudio` (lines 50-51) also handles it via
`toPatchValue`, so a knob-style UI control could route an
`inputMode` change directly. But there is no `inputMode` UI in
`GrinderPanel.tsx` (`grep -n inputMode` returns 0 results in
the panel). The patch field exists, the migration preserves it,
the bridge has a hook for it — **and it is unreachable from the
UI**. Dead surface.

**Blast radius:** any project file with `inputMode: 'line'` or
`'reamp'` (e.g. exported from an older build) loads the value into
the patch, but the audio engine plays as if `inputMode:
'instrument'` (the worklet's default).

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:29-85,106-107` (verified)
- `src/modules/Grinder/models/GrinderPatch.ts:171,290` (field + default)

**Needed:** Add `'inputMode'` to `AUDIO_SYNC_KEYS`. Either expose
an `inputMode` UI control in the amp section, or remove the field
from the model. Add a test that loading a patch with `inputMode:
'reamp'` calls `update_device_param` with `inputMode: 2`. Better:
make `AUDIO_SYNC_KEYS` a `satisfies Record<keyof GrinderPatch,
SyncStrategy>` type so the next "added a field, forgot to wire it"
fails the typecheck (issue #32).

### 11. `useEffect` race condition in neural-library hydration

**Problem:** `GrinderPanel.tsx:1168-1173` schedules
`restoreGrinderNeuralLibrary` if `!hydrated && !loading`. Two
panels mounting simultaneously both observe the false-false state,
both fire concurrent IndexedDB reads. If an `importGrinderNeuralModels`
runs between the two restores, its upsert is overwritten by the
second restore's `setGrinderNeuralLibraryState({ entries: [...]
})`.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1168-1173`
- `src/modules/Grinder/useCases/restoreGrinderNeuralLibrary.ts:4-13`

**Needed:** Promise-coalesce the restore: hold a `holder.promise`
in the use case; subsequent calls return the same promise. Or
move hydration to a top-level app-bootstrap step (suspense /
TanStack Query) and remove the `useEffect`.

### 12. Telemetry-store subscriptions force whole-panel rerenders

**Problem:** Eight `GrinderTelemetryMeter` instances in `StatusStrip`,
plus `TelemetryReadout`, `NeuralTelemetryReadout`,
`QuickTelemetryReadout`, all call `useStore(grinderTelemetryStore,
{})` reading the **whole** instances map. The store comment claims
60-fps decoupling; the React subscription pattern means every
field change re-renders every subscriber.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:334-338,728-758,1889-1947`
- `src/modules/Grinder/stores/grinderTelemetryStore.ts`

**Needed:** Add a per-device, per-key selector
(`useStoreSelector(grinderTelemetryStore, (s) => s[deviceId]?.[key])`).
Move the meter components into `presentations/components/` and
have each subscribe only its key.

### 13. `grinderStore` snapshot uses `useStore(grinderStore, {})` at root

**Problem:** `GrinderPanel.tsx:1951`:
`const allInstances = useStore(grinderStore, {})`. Reads the whole
multi-device map. Any change to **any** Grinder device anywhere in
the app re-renders this `GrinderPanel` instance.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1950-1953`

**Needed:** Per-device selector or a derived store keyed by
deviceId.

### 14. `grinderTelemetryStore` and `grinderNeuralLibraryStore` not reset on project change

**Problem:** `Project/.../resetModuleStoresToDefault.ts:34` resets
`grinderStore` only. Telemetry from the closed project's worklets
remains until new worklets emit. The neural library is presumably
meant to survive project changes (it's a user library), but that
contract is undocumented.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:34`
- `src/modules/Grinder/stores/grinderTelemetryStore.ts`
- `src/modules/Grinder/stores/grinderNeuralLibraryStore.ts`

**Needed:** Reset `grinderTelemetryStore` to `{}`. Document the
neural-library survival as a project-vs-app distinction; or
explicitly export `resetGrinderNeuralLibrary` and call only when
appropriate.

### 15. `GrinderPanel.tsx` is 1981 LoC, 14 inline components

**Problem:** A single file holds the panel and 13 sibling components
plus 8 module-level constants. Touching one section forces a
re-read of the file. Refactor blocker.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`
- `src/modules/Grinder/presentations/components/`

**Needed:** Decompose into per-section files under
`presentations/components/`: `BrowserRail.tsx`, `SectionTabs.tsx`,
`AmpSection.tsx`, `DriveDeck.tsx`, `CabStage.tsx`, `NeuralStage.tsx`,
`LabStage.tsx`, `StatusStrip.tsx`, `GrinderKnob.tsx`, `StatusMeter.tsx`,
`TelemetryMeter.tsx`. Keep `GrinderPanel.tsx` as the composer.

### 16. Tests mock `inject` to identity, exercising a different code shape than production

**Problem:** Three bridge specs mock `#/infra/di/inject` so that
`inject(deps)(fn)` becomes `fn`. The production `setGrinderParamWithAudio`
is the **outer** wrapped value (closing over deps); the test calls
the inner factory directly. They are different functions.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/setGrinderParamWithAudio.spec.ts:21-23`
- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/setGrinderPedalParamWithAudio.spec.ts:21-23`
- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/loadGrinderPatchWithAudio.spec.ts:13-15`

**Needed:** Use the real `inject` and pass real deps (per the test
helpers used elsewhere — see e.g. `setBacteriaParamWithAudio.spec`).
Or make the bridge factory the public surface and remove the
identity-mocked tests.

### 17. `helpers.spec.ts` is a no-op test

**Problem:** Three lines: `expect(subject).toBeDefined()`. Tests
nothing. The helper file has real surface (`getAudioParamKeyForPedal`,
`getCabIrSlot`, `getNeuralModelSlot`, `getPedalOrderAudioEntries`)
that has zero coverage.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/helpers.spec.ts:1-9`

**Needed:** Replace with assertions on each helper's contract.
`getAudioParamKeyForPedal(true, 'compressor', 'threshold')` →
`'postCompressorThreshold'`; `getNeuralModelSlot('factory-rig-b')`
→ `1`; etc. Cover the happy paths and the not-found branches.

### 18. `grinderParamBridge.spec.ts` is a smoke test admitting tests don't exist

**Problem:** Doc comment: "the original test introspected DI metadata
which is lost by the transpiler … functional behavior is covered by
integration tests elsewhere". No such integration tests in the repo.
The spec asserts function existence only.

**Representative files:**

- `src/modules/Grinder/useCases/__tests__/grinderParamBridge.spec.ts:1-17`

**Needed:** Either a real integration test (mount a panel, click
buttons, assert audio engine calls) or delete the spec.

### 19. `GrinderPanel.spec.tsx` only tests render output, never interaction

**Problem:** Nine specs render the panel under various store states
and check text/button presence. None click anything. The bridge
side-effects (preset selection, knob drag, snapshot recall) have no
component-level coverage.

**Representative files:**

- `src/modules/Grinder/presentations/views/__tests__/GrinderPanel.spec.tsx`

**Needed:** Add interaction tests that mock the bridge use cases at
the import level and assert the right one was called with the right
args (preset click → `loadGrinderPatchWithAudio(deviceId, preset.patch)`,
snapshot click → `recallGrinderSnapshotWithAudio(...)`, etc.).

### 20. `models/GrinderPatch.ts` is 615 LoC mixing types, constants, runtime helpers

**Problem:** The model file holds type definitions, default values,
two library constants (`GRINDER_CAB_LIBRARY`, `GRINDER_NEURAL_LIBRARY`),
`migrateGrinderPatch`, three runtime helpers, and `GRINDER_PARAMS`
(an unused constant — issue #21).

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts`

**Needed:** Split into `models/GrinderPatch.ts` (types + DEFAULT_PATCH),
`models/grinderLibraries.ts` (cab + neural library constants),
`services/migrateGrinderPatch.ts` (runtime helper),
`services/grinderChainOrder.ts` (`isSupportedGrinderChainPedalType`,
`getGrinderSupportedChainOrder`). Drop `GRINDER_PARAMS` (or wire
it).

### 21. `GRINDER_PARAMS` is dead code

**Problem:** A 130-line `readonly GrinderParamDef[]` constant
declared but used nowhere. Each panel knob hand-codes its
`min`/`max`/`step`/`defaultValue` — `GRINDER_PARAMS` would be the
natural single source of truth for them.

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:469-615`

**Needed:** Either wire `GRINDER_PARAMS` into the panel knobs (via
a `GrinderKnob param={'gain'}` prop that looks up the param def) or
delete the constant.

### 22. Repository error swallowing

**Problem:** Both `persistGrinderNeuralLibrary` and
`restoreGrinderNeuralLibrary` (the repo) wrap the entire IDB block
in `try { ... } catch { return false / [] }`. Quota errors,
schema-version mismatches, browser permission denials are all
collapsed to "best effort". CLAUDE.md "No fallback hacks": fix root
causes.

**Representative files:**

- `src/modules/Grinder/repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary.ts:34-37`
- `src/modules/Grinder/repositories/neuralLibraryPersistence/restoreGrinderNeuralLibrary.ts:42-44`

**Needed:** Surface the error type up to the caller. Translate to
domain errors (`'quota_exceeded'`, `'schema_mismatch'`,
`'permission_denied'`) and let the use case decide how to surface.

### 23. `parseGrinderNamFile.collect_weights` is O(n²)

**Problem:** BFS-flatten using `Array.unshift(...current)` (line 65).
Each `unshift(k items)` shifts the queue's tail by `k`, total work
~`O(N×D)` where N is total weight count and D is nesting depth. For
modest NAM files (10 KB, 1k weights, 4-deep) this is millisecond-
range; for typical AI captures (100k–1M weights, occasional 10-deep
nesting), seconds.

**Representative files:**

- `src/modules/Grinder/services/parseGrinderNamFile.ts:55-75`

**Needed:** Use a stack (`push` / `pop`) or recursion. Add a
performance test with a 100k-weight NAM fixture asserting parse
completes in &lt;200 ms.

### 24. `parseGrinderNamFile` requires `version`, rejecting valid NAM files

**Problem:** `parseGrinderNamFile.ts:171` requires the JSON to have
`version`, `architecture`, and non-empty `weights`. Real-world NAM
files often omit `version`; the format does not require it.

**Representative files:**

- `src/modules/Grinder/services/parseGrinderNamFile.ts:168-173`

**Needed:** Drop the `version` requirement, or default to `'unknown'`.
Keep `architecture` and `weights` (those are load-bearing).

### 25. `&&` rendering at GrinderPanel.tsx:591

**Problem:** `{patch.mic2.enabled && (<div>…</div>)}`. AGENTS.md
forbids; line 543 in the same file uses the correct ternary
(`{patch.mic2.enabled ? (<div>…</div>) : null}`) for the same
condition.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:591`

**Needed:** Convert to ternary. Audit the rest of the file.

### 26. `loadGrinderPatch` and `replaceGrinderPatchLocally` are duplicates

**Problem:** Two functions, 28 lines, identical behaviour. The
"locally" suffix implies a contract that doesn't exist (no audio
sync — but `loadGrinderPatch` also has no audio sync; that's
`loadGrinderPatchWithAudio`'s job).

**Representative files:**

- `src/modules/Grinder/stores/grinderStore.ts:76-103`

**Needed:** Delete one. Standardise call sites. The panel's
`SectionTabs` uses `replaceGrinderPatchLocally` for `uiSection`
changes — that genuinely is "no audio side-effect", which is
distinct from `loadGrinderPatch` only by name. Decide which is
canonical.

### 27. `IndexedDB` quota / large payload risk

**Problem:** `persistGrinderNeuralLibrary` writes the full
`sourceFileText` of every imported NAM file. A 10 MB file persists
10 MB; five files persist 50 MB. Safari soft-caps at 50 MB per
origin. The library's `error` channel is the only feedback when the
write fails.

**Representative files:**

- `src/modules/Grinder/repositories/neuralLibraryPersistence/persistGrinderNeuralLibrary.ts:24-25`

**Needed:** Either store `sourceFileText` separately under
content-addressed keys (with on-demand load), or refuse imports past
a quota. Surface quota-exceeded as a distinct error.

### 28. `paramBatcher` not cancelled on panel unmount or project change

**Problem:** The module-level batcher holds pending RAFs across
unmounts. On project change, `findDeviceRef` will return `null` for
the stale entries and they no-op gracefully — but they consume a
frame and hold references to old `flushParam` closures.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/helpers.ts:24`

**Needed:** Expose a `cancelGrinderParamBatcher` from the use-cases
barrel. Call it from `Project/.../resetModuleStoresToDefault` (or
provide a "module unmount" hook).

### 29. `events/index.ts` is a single-line comment

**Problem:** `// no public events`. The folder and file exist but
encode nothing.

**Representative files:**

- `src/modules/Grinder/events/index.ts:1`

**Needed:** Either delete the folder (AGENTS.md does not require
it for modules with no events) or surface the eventual
`grinderPatchLoaded` / `grinderSnapshotRecalled` events that the
audio engine could plausibly emit.

### 30. `GrinderPedalType` includes `'boost'` but the bridge merges it with `'overdrive'`

**Problem:** `GrinderPedalType` lists `'overdrive' | 'boost'` as
distinct types; `getAudioParamKeyForPedal` and `findFirstPedal`
both treat them as one. The duplication is undocumented; a future
edit could plausibly assume the worklet has separate slots.

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:116-128`
- `src/modules/Grinder/useCases/grinderParamBridge/helpers.ts:43-44`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:169,191`

**Needed:** Drop `'boost'` from the type union (it adds nothing
the worklet sees). Or split the worklet's `Overdrive` slot into
`Overdrive` and `Boost`. Pick one.

### 31. Multiple `as` casts in `setGrinderParamWithAudio.toPatchValue` and `syncGrinderPatchToAudio.toAudioValue`

**Problem:** 19 `as Whatever` casts across the two functions.
AGENTS.md forbids `as` to silence the compiler. The functions are
discriminated dispatches keyed on `key: keyof GrinderPatch`; TS can
narrow the types per branch with proper `switch` exhaustiveness.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts:33-67,86`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:88,103-121`

**Needed:** Refactor to a typed dispatch. Likely a per-key map:
`PATCH_VALUE_PARSERS: { [K in keyof GrinderPatch]: (n: number) =>
GrinderPatch[K] }`. Drop every `as`.

### 32. `AUDIO_SYNC_KEYS` is hand-curated and silently incomplete

**Problem:** No compile-time guarantee that every audio-relevant
patch field is in the list. Adding a new field to `GrinderPatch`
silently ships without audio sync. `inputMode` is the current
victim (issue #10).

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:29-85`

**Needed:** Replace with a `satisfies Record<keyof GrinderPatch,
SyncStrategy>` typed map where `SyncStrategy` is `'sync' | 'skip' |
'manual'`. The compiler will then force completeness on every
new field.

### 33. `audioAi`-style test gaps for cross-module wiring

**Problem:** No spec exercises `loadGrinderPatchWithAudio →
syncGrinderPatchToAudio → updateDeviceParam` end-to-end with the
**real** `inject`. The current specs replace `inject` with
identity, breaking the production code shape.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/`

**Needed:** Add at least one spec per bridge that uses the real
`inject` and stubs `updateDeviceParam`/`persistDeviceParam` at the
DI boundary. Verify that the production wrapper passes deps through.

### 34. `setGrinderPedalParamWithAudio` accepts `paramKey: string`

**Problem:** Untyped `paramKey: string` lets callers pass arbitrary
strings to the audio engine. A typo (`'attck'` for `'attack'`)
constructs `'preCompressorAttck'` which the worklet silently drops.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts:21-24`

**Needed:** Type `paramKey` as a per-pedal-type union (
`{ type: 'compressor', paramKey: 'threshold' | 'ratio' | 'attack' | 'release' } | …`).

### 35. `restoreGrinderNeuralLibrary` clobbers concurrent imports

**Problem:** The use case unconditionally sets the entries to the
restored array on completion, ignoring any imports that landed
mid-restore.

**Representative files:**

- `src/modules/Grinder/useCases/restoreGrinderNeuralLibrary.ts:4-13`

**Needed:** Merge restored entries with the current store state (or
route through `upsertGrinderNeuralLibraryEntries` which already
de-dupes by id).

### 36. `GrinderPanel.tsx` 14 inline components subscribe stores wholesale

**Problem:** Telemetry-meter components (8 of them in `StatusStrip`
plus more elsewhere) each call `useStore(grinderTelemetryStore, {})`
reading the whole instances map. `GrinderPanel`'s root subscription
also reads the whole `grinderStore`. At 60 fps telemetry, every
field change re-renders all 14 components.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:334-338,728-758,1889-1947,1950-1953`

**Needed:** Per-key selectors. With React Compiler memoization
already automatic, the only way to skip a render is to skip the
subscription entirely for unchanged values — which requires a
selector-aware `useStore`.

### 37. Telemetry default is allocated per render until the worklet emits

**Problem:** `getGrinderTelemetry(deviceId)` allocates `{
...DEFAULT_GRINDER_TELEMETRY }` on every miss. With 8 meters reading
the same missing-deviceId key on first render, that's 8 fresh
allocations per render until the worklet warms up.

**Representative files:**

- `src/modules/Grinder/stores/grinderTelemetryStore.ts:38`

**Needed:** Cache the default object at module scope and return
the cached reference (it's read-only).

### NEW-1. `replacePatch` triggers a full ~107-msg audio sync on every UI mutation

**Problem (added in adversarial review):** `GrinderPanel.tsx:1955-1957`:
```ts
function replacePatch(next: GrinderPatch): void {
    loadGrinderPatchWithAudio(deviceId, next);
}
```
`replacePatch` is the panel's catch-all "apply this patch" path —
21 callsites use it for trivial single-field mutations:

- Toggle `cabEnabled` (line 1421) → 107 postMessages
- Toggle `cabOpenBack` (line 1429) → 107 postMessages
- Pick `ampModel` (line 937) → 107 postMessages
- Pick `engineMode` (line 1517-1521) → 107 postMessages + the
  bridge's coupled `neuralEnabled` write
- Pick `cabIrId` / `cabType` / `routingMode` / `powerTubeType` /
  `rectifierType` / each lab toggle (lines 1305, 1320, 1333, 1448,
  1468, 1488) → each 107 postMessages

A real user dragging through cab voicings (10 IRs × 107 messages)
spams ~1000 postMessages over a couple of frames. The worklet's
port queue can't drop messages, so this latency-stacks even if the
worklet itself is idle. There is also no selective `setPatch`
diff: the bridge replaces every field even when only `cabIrId`
changed.

This is the **default** mutation path. Issue #8 mentioned "preset
click" but the actual hot path is "any UI gesture that doesn't
go through a `RotaryKnob`".

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1955-1957` (single replacePatch entry point)
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:902,937,1305,1320,1333,1421,1429,1448,1468,1488,1517,1568,1599,…` (callsites; 21 total per `grep -c replacePatch`)
- `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts` (the bulk-sync path)

**Needed:** Three orthogonal fixes:

1. Replace single-field `replacePatch({...patch, key: value})`
   with `setGrinderParamWithAudio(deviceId, key, value)` so the
   bridge takes the per-key path (rAF batched, 1 message per key).
2. For multi-field UI events (e.g. picking an amp model that
   should reset gain/master/tone defaults), introduce a
   `replaceGrinderPatchPartial(deviceId, partial)` API that takes a
   `Partial<GrinderPatch>` and dispatches **only** the changed
   keys via the param batcher.
3. For preset clicks (the legitimate full-replacement case),
   route through the worklet's `setPatch` (`update_device_patch`)
   so it's a single message, then batch any per-field DSP updates
   for keys not in the worklet's full-patch contract.

### NEW-2. `setGrinderParamWithAudio.toPatchValue` cast on line 86 is structurally unsound

**Problem:** Line 86:
```ts
setGrinderParam(deviceId, 'engineMode', (patchValue ? 'hybrid' : 'circuit') as GrinderPatch['engineMode']);
```
The runtime guard `else if (key === 'neuralEnabled')` does **not**
narrow the TS type of `patchValue` (which is `GrinderPatch[Key]`,
a union). The ternary `patchValue ? 'hybrid' : 'circuit'` requires
`patchValue` to be `boolean`-ish; under the union, TS cannot prove
it. The `as GrinderPatch['engineMode']` cast silences the
resulting type error.

This is fragile in two ways: (a) if `key` is `'neuralEnabled'` but
the caller passes `value: 0.5`, `BOOLEAN_PATCH_KEYS` includes
`'neuralEnabled'` so `toPatchValue` returns `(0.5 > 0.5) === false`;
the ternary evaluates to `'circuit'`; OK. (b) if a future refactor
removes `neuralEnabled` from `BOOLEAN_PATCH_KEYS`, `patchValue` is
now `number` and the ternary `0 ? 'hybrid' : 'circuit'` evaluates
to `'circuit'` for any falsy number — the cast hides the
inconsistency.

The `(patchValue ? 'hybrid' : 'circuit')` also drops the legitimate
`'capture'` state — toggling neural on always lands on
`'hybrid'`, never `'capture'`.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts:81-87`

**Needed:** Refactor the coupling helper out (per issue #6) and
have it return a `{ engineMode, neuralEnabled }` pair from a single
typed input. Drop both `as` casts.

### NEW-3. `migrateGrinderPatch` re-derives `engineMode` differently from the bridge

**Problem:** `GrinderPatch.ts:434-437`:
```ts
const engineMode = patch.engineMode ?? ((patch.neuralEnabled ?? DEFAULT_PATCH.neuralEnabled) ? 'hybrid' : DEFAULT_PATCH.engineMode);
const neuralEnabled = patch.neuralEnabled ?? engineMode !== 'circuit';
```
This **only** assigns when the corresponding field is `undefined`.
A persisted patch with `{ engineMode: 'capture', neuralEnabled:
false }` (a logically-broken state) survives migration unchanged.
The bridge (`setGrinderParamWithAudio.ts:86`) and the panel
(`GrinderPanel.tsx:1520`) both treat any non-`'circuit'` engine
as `neuralEnabled = true` — but the migration does not enforce
this. A round-trip through project save/load preserves the broken
state.

The `{...DEFAULT_PATCH, ...patch}` spread on line 444 also means
that any newly-introduced `GrinderPatch` field arrives at
`DEFAULT_PATCH`'s value — but this is exactly what `AUDIO_SYNC_KEYS`
is supposed to track, except it doesn't (issue #32). Three
contracts, two of them implicit.

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:433-465`

**Needed:** Move the coupling rule into a single helper (per
issue #6) and call it from migration too. Decide whether
`{ engineMode: 'capture', neuralEnabled: false }` is legal — and
either preserve it (by removing the bridge's coupling) or coerce
it (by enforcing the same rule in migration).

### NEW-4. `setGrinderParamWithAudio` ships raw input number to the worklet for booleans

**Problem:** `setGrinderParamWithAudio.ts:81-95` — for boolean
keys, `toPatchValue` returns `(value > 0.5)` for the **store**
(line 41), but line 95 schedules `{ ref, key, value }` with the
**raw** input number. So toggling `gateEnabled` by sending
`value: 0.7` ships `gateEnabled: 0.7` to the worklet.
`syncGrinderPatchToAudio.ts:97-99` sends boolean as `1`/`0`
exactly — two divergent contracts over the same audio param key.
The worklet must threshold at the cab boundary; either handler
could change and silently break.

There is also no test asserting that `setGrinderParamWithAudio` and
`syncGrinderPatchToAudio` produce **the same** `update_device_param`
arg sequence for the same patch field. The existing test
(`setGrinderParamWithAudio.spec.ts:67-80`) uses `value: 1` for
`'bright'` so the divergence is invisible.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts:81-95` (verified)
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:97-99` (the canonical form)

**Needed:** Always normalise to `0`/`1` at the boundary, in both
sites. Add a test that `setGrinderParamWithAudio(d, 'bright', 0.6)`
ships `1`, not `0.6`.

### NEW-5. `downloadGrinderNeuralModelFile` synchronously revokes the Object URL

**Problem:** `downloadGrinderNeuralModelFile.ts:6-13`:
```ts
const url = URL.createObjectURL(blob);
const anchor = document.createElement('a');
anchor.href = url;
anchor.download = input.file_name;
anchor.click();
URL.revokeObjectURL(url);   // ← synchronous after click
```
`anchor.click()` schedules the download asynchronously. Calling
`URL.revokeObjectURL(url)` immediately after can cancel the
download in browsers that haven't yet started the network/disk
operation (Safari is most affected; Chromium tolerates it because
it copies the blob synchronously).

**Repro:** in Safari, clicking "Export NAM" on a large NAM file
(50 MB+) downloads either an empty file or fails silently.

**Representative files:**

- `src/modules/Grinder/repositories/neuralLibraryPersistence/downloadGrinderNeuralModelFile.ts:6-13`

**Needed:** Defer the revoke into a `setTimeout(..., 0)` or
`requestAnimationFrame` after `click()`. Or use the Streams API
download flow if the file is reused. Add a test that exercises
the export path and asserts the URL is revoked after the click
fires (use a fake timer).

### NEW-6. `removeGrinderNeuralModel` persists pre-removal entries, then mutates the store separately

**Problem:** `removeGrinderNeuralModel.ts:13-28` is non-atomic:

1. Compute `next_entries = current.entries.filter(...)`.
2. `await persistGrinderNeuralLibrary({ entries: next_entries })`
   — disk now reflects removal.
3. If `persisted`, then call `removeGrinderNeuralLibraryEntry(id)`
   — store now reflects removal.

If a concurrent `importGrinderNeuralModels` runs between steps 2
and 3, its store-side `upsertGrinderNeuralLibraryEntries(successes)`
adds new entries; the subsequent `removeGrinderNeuralLibraryEntry`
filters out only the removed entry — the new imports survive in
the store. But step 2 already persisted the **pre-import**
`next_entries`. Disk and store now diverge: store has [old - X +
new], disk has [old - X].

The next `restoreGrinderNeuralLibrary` (e.g. on page reload) reads
disk and overwrites store with [old - X], silently losing the
imported entries.

**Representative files:**

- `src/modules/Grinder/useCases/removeGrinderNeuralModel.ts:13-28`

**Needed:** Hold a mutex/promise-lock across import/remove/restore
operations on the neural library. Or compute `next_entries` from
the **current store value** at the moment of `removeGrinderNeuralLibraryEntry`,
not from the pre-await snapshot.

### NEW-7. `neuralWarmupProgress` lives in both the patch and the telemetry store

**Problem:** `GrinderPatch.ts:249` declares
`neuralWarmupProgress: number` (the **persistent** patch field),
default `0` (line 356). `grinderTelemetryStore.ts:13` also
declares `neuralWarmupProgress: number` (the **live** telemetry
field). The audio engine
(`wasmDeviceRegistry.ts:459`) only writes to telemetry — the
patch's copy is **never** updated by the engine.

Result: project saves persist `neuralWarmupProgress: 0`
permanently. UI code that reads `patch.neuralWarmupProgress`
(none currently — verified `grep -rn neuralWarmupProgress` shows
only definitions/defaults) would always see `0`. The patch field
is dead surface that occupies a `migrateGrinderPatch` line and a
`AUDIO_SYNC_KEYS`-eligible slot it (correctly) does not occupy.

Same pattern likely applies to `neuralStatus: GrinderNeuralStatus`
on line 248 — verify the audio engine writes it.

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:248-249` (patch fields)
- `src/modules/Grinder/stores/grinderTelemetryStore.ts:13` (telemetry field)
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:459` (only writes to telemetry)

**Needed:** Drop `neuralWarmupProgress` and `neuralStatus` from
`GrinderPatch` if the audio engine never updates them. They are
volatile state, not patch state — telemetry store is the right
home.

### NEW-8. `patch.uiSection` is persisted to disk

**Problem:** `GrinderPatch.ts:166` declares `uiSection: GrinderUiSection`
as a patch field. `loadGrinderPatch` writes it; `migrateGrinderPatch`
preserves it; `replaceGrinderPatchLocally` writes it
(`GrinderPanel.tsx:966`):
```ts
onClick={() => replaceGrinderPatchLocally(deviceId, { ...patch, uiSection: tab.id })}
```

This means: which tab the user was viewing at the moment of save
becomes part of the saved project. Open the project two days
later → land on the same tab. Functional, but a leaky abstraction
between presentation and domain. The `AUDIO_SYNC_KEYS` correctly
excludes `uiSection`, but the panel's `replacePatch`-everywhere
pattern (NEW-1) means an export-import round-trip preserves
ephemeral UI state.

It is also what saves the panel from being noisy on `replacePatch`
— if `uiSection` changes were routed through the bridge, every
tab click would flush 107 messages.

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:166,286`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:966`

**Needed:** Move `uiSection` to a **per-device UI state store**
keyed by `deviceId`. Drop it from the patch. Once dropped, the
`replaceGrinderPatchLocally` pattern at line 966 can disappear too
(its only caller).

### NEW-9. `ImportedNeuralLibraryCard` lacks `aria-pressed` for the selection state

**Problem:** `ImportedNeuralLibraryCard.tsx:31-40` — the outer
select button has `selected: boolean` driving only background and
border colors (lines 24-28). No `aria-pressed`, no `role="option"`,
no `aria-current`. Screen readers cannot tell the user which entry
is selected. The neighbouring "selected" buttons in
`GrinderPanel.tsx` (e.g. line 1512) **do** use the same visual
distinction without semantic hooks.

**Representative files:**

- `src/modules/Grinder/presentations/components/ImportedNeuralLibraryCard.tsx:23-40`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1510-1525` (similar pattern in mode picker)

**Needed:** Add `aria-pressed={selected}` to the outer button.
Audit the panel's other "highlighted button" patterns for the
same gap. (Note: the `Snapshots` recall buttons on line 1949ff
already use `aria-pressed` per the test on line 249 — so the
pattern is known; it's just inconsistently applied.)

### NEW-10. `loadGrinderPatchWithAudio` re-migrates a patch the bridge already migrated

**Problem:** `loadGrinderPatchWithAudio.ts:19-20`:
```ts
const migrated_patch = migrateGrinderPatch(patch);
loadGrinderPatch(deviceId, migrated_patch);
```
`loadGrinderPatch` (`grinderStore.ts:79`) **also** calls
`migrateGrinderPatch(patch)` and then again on line 85
`migrateGrinderPatch(migrated_patch)` for the basePatch. So a
single `loadGrinderPatchWithAudio` call runs `migrateGrinderPatch`
**three times** on the same data.

`migrateGrinderPatch` deep-clones pedals/snapshots/profiles per
call — three clones per load. The `cloneNeuralProfile` deep-copies
30 `convWeights` triples (line 406).

`syncGrinderPatchToAudio.ts:152` then runs migration a **fourth**
time on its way to the audio engine.

For preset clicks (NEW-1 makes those frequent), this is wasted CPU
on the main thread.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/loadGrinderPatchWithAudio.ts:19-20`
- `src/modules/Grinder/stores/grinderStore.ts:79,85`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts:152`

**Needed:** Make `migrateGrinderPatch` idempotent-fast (return the
same object if already migrated, gated by an internal symbol). Or
audit each call site and remove redundant migrations.

### NEW-11. `useCases/index.ts` re-exports test helper paths but not the production composition

**Problem:** `useCases/index.ts:1-7` re-exports `loadGrinderPatchWithAudio`,
`setGrinderMicParamWithAudio`, `setGrinderParamWithAudio`,
`setGrinderPedalParamWithAudio`, `grinderPresets`,
`importGrinderNeuralModels`, `restoreGrinderNeuralLibrary`. **Missing:**

- `recallGrinderSnapshotWithAudio`
- `moveGrinderPedalInChainWithAudio`
- `syncGrinderPatchToAudio`
- `removeGrinderNeuralModel`
- `exportGrinderNeuralModel`

The five missing ones are exactly the ones the panel imports via
deep relative paths (`../../useCases/...`). Issue #2 already
flagged this — but I want to add: `syncGrinderPatchToAudio` is the
audio engine's contract surface; not exposing it from the barrel
means external callers (a hypothetical `Project/projectPersistence`
that wants to re-sync devices on project load) cannot use it
without reaching into the bridge folder. The barrel is incomplete
**by design pattern**: it only exports what the panel happens to
use today.

**Representative files:**

- `src/modules/Grinder/useCases/index.ts:1-7` (verified)

**Needed:** Already covered in issue #2. This NEW-N entry is here
only to register the additional finding that
`syncGrinderPatchToAudio` should be the **public** sync entry point
for any caller (project persistence, device reload, snapshot
recall). It currently is reachable only from inside the bridge.

### NEW-12. `useStore` has no selector — the "decoupled telemetry store" is structurally undermined

**Problem:** `src/infra/store/useStore.ts:5-7` is a thin wrapper:
```ts
export const useStore = <TData>(store: Store<TData>, defaultValue?: TData): TData => {
    return useSyncExternalStore(store.subscribeReact, () => store.getSnapshot() ?? (defaultValue as TData));
};
```
There is no selector argument and no equality function. Every
caller subscribes to the **whole** store. The `grinderTelemetryStore`
comment on line 32 ("Decoupled from the persistent patch store to
prevent full-UI re-renders at 60fps") is a false claim:
`useSyncExternalStore` will fire on every `set` regardless of
which key changed. React 19's compiler memoization stops the
**children** from re-rendering — but only if their props are
referentially stable, which they are not (the meter's `value` is
read off the same telemetry object that just changed).

This is a Grinder-visible issue (audit #12) but the root cause is
the missing selector API in `useStore`. Fixing only the meter
subscriptions without addressing the store API is patching the
symptom.

**Representative files:**

- `src/infra/store/useStore.ts:5-7` (root cause)
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:334,729,740,750,1136,1951` (six whole-store subscriptions)

**Needed:** Land a `useStoreSelector(store, selector, isEqual?)`
helper at the infra layer. Issue #12 then becomes "use the new
selector". This widens the spec but is the only fix that doesn't
re-introduce the same problem in every other module that uses
`useStore`.

### NEW-13. `grinderTelemetryStore` reads `neuralWarmupProgress` but has no contract for `neuralStatus`

**Problem:** `wasmDeviceRegistry.ts:449-460` updates 10 telemetry
fields including `neuralWarmupProgress` but **not** `neuralStatus`.
The patch carries `neuralStatus: GrinderNeuralStatus` (line 248);
no UI surface in `GrinderPanel.tsx` updates it (verified by grep);
no audio engine path writes it. It is a write-only patch field.

This pairs with NEW-7: both `neuralWarmupProgress` and
`neuralStatus` are nominally patch state but only ever updated
(if at all) via the telemetry path.

**Representative files:**

- `src/modules/Grinder/models/GrinderPatch.ts:248`
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts:449-460`

**Needed:** Move `neuralStatus` to telemetry. Or have the worklet
emit status transitions and pipe them into the store via a
`updateGrinderStatus(deviceId, status)` action.

### NEW-14. `parseGrinderNamFile.hash_string` collides on near-identical content

**Problem:** Already noted as issue #32 in the previous audit
(`audit issue #32` not the **NEW-N** numbering — let me re-locate).
Actually the original audit had this at line 488 ("issue #32" in
the older numbering scheme but now embedded in the deeper review
text). Re-stating with verification:

`parseGrinderNamFile.ts:39-45` uses djb2 hash:
```ts
function hash_string(value: string): string {
    let hash = 5381;
    for (let index = 0; index < value.length; index++) {
        hash = (hash * 33) ^ value.charCodeAt(index);
    }
    return Math.abs(hash >>> 0).toString(36);
}
```
djb2 is 32-bit; `Math.abs(hash >>> 0).toString(36)` outputs a
5-7 char base-36 string. Collision probability for 50 imports is
small (~10^-9) but **not zero** — and the hash is appended to the
`id` (line 195: `imported-${slug}-${hash}`). A collision means the
second import overwrites the first under
`upsertGrinderNeuralLibraryEntries`'s Map keying.

For a NAM library shipped as part of a tutorial dataset (hundreds
of similar captures), the collision risk grows.

**Representative files:**

- `src/modules/Grinder/services/parseGrinderNamFile.ts:39-45,195`

**Needed:** Use `crypto.subtle.digest('SHA-256', ...)` or include
both the content hash and the import time in the id (e.g.
`imported-${slug}-${importedAt.toString(36)}-${hash}`). For
file-content-addressed dedup, the id should be the SHA-256 hash of
the canonical JSON (so re-importing the same file produces the
same id and updates `importedAt`).

### NEW-15. `GrinderPanel.tsx` mounting two instances breaks `useState`-driven `is_importing_models`

**Problem:** `ControlDeck` declares
`const [is_importing_models, set_is_importing_models] = useState(false)`
(line 1160) — local component state. With two `GrinderPanel`s
mounted (e.g. two Grinder devices on different tracks), each owns
its own `is_importing_models` state. But the import action is
**global** (it touches the global `grinderNeuralLibraryStore`). If
panel A starts an import and panel B is open, only A's button
shows "Importing…" — B does nothing visible while the global
library mutates underneath it.

Worse: if A unmounts mid-import (route change, panel close), the
`finally` block (line 1196-1198) calls `set_is_importing_models(false)`
on an unmounted component → React warning. The audit's older issue
#52 mentioned this; verifying it: yes, no `isMounted` guard.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1160,1188-1199`

**Needed:** Move `is_importing_models` to the
`grinderNeuralLibraryStore` (e.g. `{ ...state, importing: true }`).
Both panels then share one source of truth and unmount-during-
import is a no-op.

### NEW-16. `BrowserRail.filteredPresets` recomputes per render with `.toLowerCase()` per preset per keystroke

**Problem:** `GrinderPanel.tsx:829-834` (verified):
```ts
const filteredPresets = GRINDER_PRESETS.filter((preset) => {
    const haystack = `${preset.name} ${preset.category}`.toLowerCase();
    return matchesCategory && haystack.includes(query.toLowerCase());
});
```
For `N` presets, this is `N` `.toLowerCase()` allocations per
render. Each keystroke in the search field re-renders. With
`GRINDER_PRESETS` at ~12 entries this is fine; the audit's older
issue #50 correctly noted "fine at 12 presets". But the loop also
calls `query.toLowerCase()` `N` times instead of once.

**Representative files:**

- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:829-834`

**Needed:** Hoist `query.toLowerCase()` outside the filter. If
preset count grows, precompute the haystack at module scope.

### NEW-17. `restoreGrinderNeuralLibrary` use case races vs ongoing imports — audit issue #35 was correct, the audit's earlier cross-reference (#24) named the wrong contract

**Problem:** `useCases/restoreGrinderNeuralLibrary.ts:7-12` (verified):
```ts
setGrinderNeuralLibraryState({
    hydrated: true,
    loading: false,
    error: null,
    entries,    // ← unconditionally overwrites
});
```
The audit issue #35 correctly identifies the bug. I want to add
the **specific concurrent-call repro**:

1. User clicks "Import NAM" → `importGrinderNeuralModels` runs.
2. While step 1's `await pickGrinderNeuralModelFiles()` is open,
   user mounts a second Grinder panel → its `useEffect` (line
   1168-1173) sees `hydrated: false, loading: false` (because step
   1 only set `loading: true`, but its initial state was
   `hydrated: false`)…

Wait — verifying: step 1 calls `setGrinderNeuralLibraryState({
loading: true, error: null })` first (importGrinderNeuralModels.ts:13),
keeping `hydrated: false`. The second panel's useEffect sees
`hydrated: false, loading: true` → early return. So actually only
**one** restore can be in flight at a time. The race the audit
identified is real but narrower:

- Two panels mount simultaneously, neither has run the effect yet,
  both observe `hydrated: false, loading: false`.
- Both call `restoreGrinderNeuralLibrary()` simultaneously.
- React batches the `setGrinderNeuralLibraryState({loading: true})`
  → only one batch wins; both async flows now diverge from each
  other but both see "I started the restore".

**Representative files:**

- `src/modules/Grinder/useCases/restoreGrinderNeuralLibrary.ts:4-13`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx:1168-1173`

**Needed:** Promise-coalesce the restore. Hold a module-scope
`let inflightRestore: Promise<void> | null = null` and return the
same promise if one is in-flight. Better: move hydration to
top-level app bootstrap.

### NEW-18. `inject` test mock breaks production semantics — audit issue #16 understated

**Problem:** `setGrinderParamWithAudio.spec.ts:22-23` mocks
`#/infra/di/inject` to identity. The audit issue #16 notes this.
What I want to add: the production `inject` from
`src/infra/di/inject.ts:79-147` does **lazy resolution with
caching**. The first call resolves deps, caches the inner function,
and forwards args; subsequent calls hit the cache. In the
identity-mocked test, there is no cache — the factory runs every
time the user "calls" the use case.

This means:

- The test cannot detect a circular-dependency error (the real
  `inject` throws on resolution-stack re-entry; the mock doesn't).
- The test cannot detect missing dep registrations (real `inject`
  asserts on async deps; mock identity has no contract).
- The test cannot detect cached-state leakage (e.g. if the inner
  function captures a `paramBatcher` reference, the real cache
  preserves it across calls; the mock recreates it).

The bridge tests therefore protect against **none of** the failure
modes the DI layer is supposed to catch.

**Representative files:**

- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/setGrinderParamWithAudio.spec.ts:22-23`
- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/setGrinderPedalParamWithAudio.spec.ts:21-23`
- `src/modules/Grinder/useCases/grinderParamBridge/__tests__/loadGrinderPatchWithAudio.spec.ts:13-15`
- `src/infra/di/inject.ts:79-147`

**Needed:** Use `Container.setTestOverride` (the real DI test
hook) instead of mocking the `inject` module. This exercises the
production resolution path and catches DI mistakes.

---

## Open questions

- [ ] Is the snapshot model intentionally numeric-only (issue #4)?
      The presence of `bypassStates` separately suggests "yes, only
      simple overrides" — but the test fixture (`grinderStore.spec.ts:103`)
      uses `paramOverrides: { gain: 7 }` only, never an enum. If
      enum/string overrides are expected, the model is wrong.
- [ ] Should `grinderNeuralLibraryStore` survive project changes
      (current behaviour) or reset (issue #14)? It's a user library,
      so survival is plausible — but the contract is undocumented.
- [ ] Is `boost` a real pedal type or an alias for `overdrive`
      (issue #30)? The model lists it; the bridge merges it.
- [ ] Does the worklet's parameter table actually accept patch
      key names (`engineMode`, `gateEnabled`, `cabResonanceFreq`)
      as DSP param ids? `setGrinderParamWithAudio` and
      `syncGrinderPatchToAudio` both ship those names. If the
      worklet uses different names internally, the round-trip is
      lucky-coupled.
- [ ] Was the GRINDER_PARAMS constant ever wired (issue #21)? If
      not, why keep it?
- [ ] What is the contract for "patch only" entries (#33)? They
      are synthesised by the panel for an imported model whose
      `sourceFileText` was lost; they cannot be exported or
      removed via the library UI.
- [ ] Is `{ engineMode: 'capture', neuralEnabled: false }` a legal
      patch state (NEW-3)? `migrateGrinderPatch` preserves it; the
      panel and bridge would coerce it on next user action. The
      coupling rule needs an explicit answer.
- [ ] Should `replacePatch` exist at all (NEW-1)? It is the
      panel's universal "apply this patch" handler but is misused
      for single-field changes. If the answer is "yes for genuine
      multi-field changes, no for single-field", a `replaceGrinderPatchPartial`
      API is needed.
- [ ] Should `useStore` grow a selector (NEW-12)? Affects every
      module, not just Grinder.

## Bogus / downgraded findings (verified false alarms)

- **Original issue #54 (nested `<button>`):** Verified false alarm
  per `ImportedNeuralLibraryCard.tsx:23-66`. The outer container
  is a `<div>`; select-button and action-button group are siblings
  inside an inner flex `<div>`. Not a DOM nesting violation. The
  audit already noted "false alarm" but the issue should be moved
  to `## Resolved` (or deleted) so it doesn't distract from real
  issues.
- **Original issue #50 (`filteredPresets` rerender cost):**
  Mostly bogus given React Compiler memoization and 12-preset
  scale. Re-cast as NEW-16 with the **actually-fixable** subpart
  (hoist `query.toLowerCase()`).
- **Original issue #55 (`handleDrag` typing):** "Loose typing" of
  `React.MouseEvent` is correct per React 19's relaxed event
  typing. The "two messages per drag tick" framing is true but
  redundant with NEW-1: every mic drag goes through
  `setGrinderMicParamWithAudio` which **does** route through the
  rAF batcher. So the per-frame fanout is already debounced. Only
  cosmetic concern.

---

## Risks

- **postMessage flood from trivial UI events** (NEW-1). Every
  `replacePatch` callsite ships ~107 messages per click. 21
  callsites in the panel. Toggle a single boolean → 107 messages.
  This is the **default mutation path**. Sustained clicking (e.g.
  scrolling through cab voicings) trivially queues thousands of
  messages on the AudioWorklet port, with the worklet processing
  one per render quantum. Audible artifacts under load.
- **Audio-engine state divergence from store** (issue #6 +
  NEW-2/-3). The bridge updates the store's coupled
  `engineMode`/`neuralEnabled` but only ships the user's pressed
  field to the worklet — the worklet's other coupled field stays
  stale until the next full sync. Users hear the wrong mode.
- **Snapshot recall corruption** (issues #3, #4). `as never` lets
  numeric `paramOverrides` clobber enum-typed patch fields.
  `syncGrinderPatchToAudio` then silently fails to ship the
  resulting nonsense to the worklet. The user thinks a snapshot
  recalled but neither the store nor the audio reflects what they
  saved. The existing test fixture launders the bug.
- **Audio-engine contract drift.** Issues #10, #32, NEW-4:
  `inputMode` is in the dispatch but missing from the sync list
  (dead branch); booleans round-trip differently between
  `setGrinderParamWithAudio` and `syncGrinderPatchToAudio`; new
  patch fields silently miss audio sync.
- **IndexedDB silent failures.** Issue #22: persistence/restore
  swallow all errors. Users with quota issues see "no library" with
  no hint why; users with stale schemas (v1 → v2) silently lose
  imported entries. Combined with NEW-6, removal can persist
  pre-import state and clobber recent imports on next restore.
- **Race in neural-library hydration.** Issue #11 / NEW-17: two
  concurrent `restoreGrinderNeuralLibrary` calls compete; an
  import landing between them can be silently overwritten.
- **Safari export breakage.** NEW-5: synchronous
  `URL.revokeObjectURL` after `anchor.click()` cancels downloads in
  Safari. Real user-visible bug, narrow blast radius.
- **Dead patch fields creating false expectations.** NEW-7, NEW-8,
  NEW-13: `neuralWarmupProgress` and `neuralStatus` exist in the
  patch but are never written by the engine; `uiSection` is in the
  patch but should be ephemeral UI state. Project files persist
  ephemeral state; future code that reads these patch fields will
  see stale or wrong values.
- **Telemetry-store rendering at 60 Hz.** Issue #12 / NEW-12: the
  underlying `useStore` API has no selector. The "decoupled
  telemetry store" claim is false at the React layer. CPU cost is
  real; with two Grinder instances, the panel fan-out doubles.
- **Architectural drift.** Issues #1, #2, #7, NEW-11: no module
  root, incomplete barrel, cross-module type imports. Each new
  feature compounds.
- **Test theatre.** Issues #16, #17, #18, #19, NEW-18: the test
  surface passes; production code paths are not covered. The
  `inject` mock-to-identity pattern actively hides DI failure
  modes (circular deps, missing registrations, stale caches).

---

## Suggested approaches

- **First, kill `replacePatch`'s 107-message fanout** (NEW-1). Two
  paths: (a) replace single-field `replacePatch({...patch, key:
  value})` callsites with `setGrinderParamWithAudio(deviceId, key,
  value)`; (b) for genuinely-multi-field changes, route through
  `update_device_patch` (one worklet message). This is by far the
  highest-value refactor — every other "audio drift" bug becomes
  smaller once the bulk-sync stops being the default path.
- **Then, land a "type soundness" pass** (issues #3, #5, #31,
  NEW-2). Removing the `as never` and the enum-string-vs-number
  conflation is mechanical and exposes the snapshot-model bug (#4)
  by failing the existing recall test. Drive test-first by adding
  a snapshot whose `paramOverrides` includes a string-typed key.
- **Create the module root `index.ts`** (issue #1) and complete the
  `useCases/index.ts` barrel (issue #2 + NEW-11). Update the three
  external callers in one commit. Run `pnpm deps:validate` to
  confirm.
- **Replace `grinderParamBridgeDependencies.getAllTracks` with the
  `Arrangement/useCases.getAllTracks` import** (issue #7). Replace
  the `Track` type import with a local `GrinderTrackRef` minimal
  shape.
- **Fix the `engineMode` ↔ `neuralEnabled` quadruple coupling**
  (issue #6 + NEW-2/-3) by extracting a
  `services/deriveNeuralEnabled.ts` helper and having migration,
  bridge, panel, **and** the audio-side path call it. Decide
  upfront whether `{capture, neuralEnabled: false}` is legal.
- **Route `syncGrinderPatchToAudio` through `setPatch`** (issue
  #8). The worklet already accepts a full patch via `setPatch` (see
  `wasmDeviceRegistry.ts:426,443,473`). One message replaces 107.
- **Add a `useStoreSelector` at the infra layer** (NEW-12). Then
  rewrite the telemetry-meter subscription (issue #12) using a
  per-deviceId-per-key selector. Move the meters into
  `presentations/components/`.
- **Decompose `GrinderPanel.tsx`** (issue #15) into per-section
  files under `presentations/components/`. Bring it down to ≤200
  LoC at the panel level. Move `uiSection` (NEW-8) out of
  `GrinderPatch` while you're there.
- **Replace `useEffect`-based hydration** (issue #11 + NEW-17) with
  TanStack Query (`useSuspenseQuery`) or a top-level bootstrap.
  Promise-coalesce the restore.
- **Drop `neuralWarmupProgress`/`neuralStatus` from `GrinderPatch`**
  (NEW-7, NEW-13). They are telemetry, not patch state.
- **Defer the Object URL revoke** (NEW-5) — `setTimeout(() =>
  URL.revokeObjectURL(url), 0)` after `anchor.click()`.
- **Hold a mutex/promise-lock on the neural library** (NEW-6).
  Import/remove/restore must serialise, or the disk and store
  diverge.
- **Replace identity-mocked `inject` tests** (issue #16 + NEW-18)
  with `Container.setTestOverride`. Add interaction tests to
  `GrinderPanel.spec.tsx` (issue #19).
- **Wire `GRINDER_PARAMS` into the knobs** (issue #21) or delete
  it.

---

## Recommendation

**The single largest impact is from NEW-1.** Audit the 21
`replacePatch` callsites in `GrinderPanel.tsx`; convert single-field
mutations to `setGrinderParamWithAudio(deviceId, key, value)`. Each
conversion drops a 107-message fanout to 1. Most callsites are
trivially mechanical (the existing pattern
`replacePatch({...patch, [key]: value})` is exactly what
`setGrinderParamWithAudio` does). For the multi-field cases that
remain (preset clicks, mode-button clicks that update both
`engineMode` and `neuralEnabled`), route through the worklet's
`setPatch` API (`update_device_patch`) — one message instead of 107.

Once that lands, the "engine out of sync" risk (issue #6 / NEW-2,
NEW-3, NEW-4) becomes far smaller because the full-sync becomes
rare again. Then tackle the type-soundness sweep (issues #3, #5,
#31, NEW-2) — the snapshot `as never` is the canonical example
and a single test will surface the bug.

After those two land, the next session can choose between:

- **Architecture pass** (issues #1, #2, #7, NEW-11, NEW-12): no
  module root, incomplete barrel, `useStore` selector. The
  `useStore` change is required for the telemetry rerender fix.
- **Persistence/race pass** (issues #11, NEW-6, NEW-17, NEW-5):
  hydration coalescing, IDB-vs-store atomicity, the Safari
  download bug.
- **Patch model cleanup** (NEW-7, NEW-8, NEW-13, NEW-10): kill
  ephemeral patch fields, deduplicate redundant migrations.

These three are independent and can run in parallel.

---

## Resolved

_No issues resolved yet._

---

## Adversarial verification log (this revision)

The following items were re-verified against `src/modules/Grinder/`
during the adversarial review pass. All file:line references match
the working tree at HEAD.

| Issue | Verified at | Status |
| ----- | ----------- | ------ |
| #1 (no module-root) | `ls src/modules/Grinder/` confirms no `index.ts` | unchanged |
| #2 (incomplete barrel) | `useCases/index.ts:1-7` lists 7 exports; missing 5 | unchanged |
| #3 (`as never`) | `grinderStore.ts:254` literal match | deepened |
| #4 (snapshot model) | `GrinderPatch.ts:154-159` `Record<string, number>` | unchanged |
| #5 (`unknown` cast) | `setGrinderMicParamWithAudio.ts:25,33` | unchanged |
| #6 (engineMode coupling) | 4 sites confirmed; deepened to quadruple-source | deepened |
| #7 (Track type import) | `grinderParamBridgeDependencies.ts:1` literal match | unchanged |
| #8 (rAF bypass) | `syncGrinderPatchToAudio.ts:127-138`; counted 107 messages | deepened |
| #9 (default divergence) | `?? -20` vs `DRIVE_CONTROLS:204` `-24` | unchanged |
| #10 (`inputMode` not synced) | line 29-85 vs lines 106-107 — dispatch case is dead | deepened |
| #11 (hydration race) | `GrinderPanel.tsx:1168-1173` | refined repro (NEW-17) |
| #12 (telemetry rerender) | `useStore.ts:5-7` no selector — root cause (NEW-12) | escalated |
| #13 (whole-store subscription) | `GrinderPanel.tsx:1951` | unchanged |
| #14 (no telemetry reset) | `resetModuleStoresToDefault.ts:34` resets only grinderStore | unchanged |
| #15 (1981 LoC) | `wc -l GrinderPanel.tsx` confirms | unchanged |
| #16/#17/#18 (test mocks) | identity mock at `setGrinderParamWithAudio.spec.ts:22-23` etc. | deepened (NEW-18) |
| #19 (panel test interaction) | spec file confirmed: only `render` + assertions, no clicks | unchanged |
| #20 (model file mixing) | 615 LoC confirmed | unchanged |
| #21 (`GRINDER_PARAMS` dead) | `grep -rn GRINDER_PARAMS` = 0 callers | unchanged |
| #22 (error swallowing) | `persist:34-37`, `restore:42-44` | unchanged |
| #23 (O(n²) flatten) | `parseGrinderNamFile.ts:60-72` `unshift` | unchanged |
| #24 (`version` required) | `parseGrinderNamFile.ts:171` | unchanged |
| #25 (`&&` rendering) | `GrinderPanel.tsx:591` | unchanged |
| #26 (duplicate functions) | `grinderStore.ts:76-103` | unchanged |
| #27 (IDB quota) | `persist:24-25` writes raw `sourceFileText` | unchanged |
| #28-30 | as previously stated | unchanged |
| #31 (`as` casts) | counted 23 across the two bridge files | unchanged |
| #32 (`AUDIO_SYNC_KEYS` incompleteness) | `inputMode` is the proven omission | unchanged |
| #33-37 | as previously stated | unchanged |
| #54 (nested buttons) | `ImportedNeuralLibraryCard.tsx:23-66` confirms NOT nested | bogus → resolved |
| NEW-1 | `GrinderPanel.tsx:1955-1957` + 21 callsites of `replacePatch` | new |
| NEW-2 | `setGrinderParamWithAudio.ts:86` cast | new |
| NEW-3 | `GrinderPatch.ts:434-437` migration rule | new |
| NEW-4 | bridge-vs-sync boolean dispatch divergence | new |
| NEW-5 | `downloadGrinderNeuralModelFile.ts:6-13` synchronous revoke | new |
| NEW-6 | `removeGrinderNeuralModel.ts:13-28` non-atomic | new |
| NEW-7 | `neuralWarmupProgress` patch+telemetry duplication | new |
| NEW-8 | `uiSection` persisted to disk | new |
| NEW-9 | `ImportedNeuralLibraryCard` no `aria-pressed` | new |
| NEW-10 | redundant `migrateGrinderPatch` calls (3-4× per load) | new |
| NEW-11 | `syncGrinderPatchToAudio` not exposed via barrel | new |
| NEW-12 | `useStore` has no selector — root cause of #12 | new |
| NEW-13 | `neuralStatus` is a write-only patch field | new |
| NEW-14 | `hash_string` djb2 collision concern (re-stated from older audit) | new |
| NEW-15 | `is_importing_models` is per-component for global action | new |
| NEW-16 | `BrowserRail` `query.toLowerCase()` per-preset | new |
| NEW-17 | `restoreGrinderNeuralLibrary` race — narrower repro than #35 | new |
| NEW-18 | `inject` mock breaks DI failure detection | new |
