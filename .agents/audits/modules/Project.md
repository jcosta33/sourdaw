# Project module audit

## Scope

This audit covers `src/modules/Project/` in full — every non-test source file
and the major test specs in scope:

- Models: `ProjectData`, `ProjectVersion`, `DemoProjectTypes`, `ProjectTemplateTypes`.
- Stores: `projectStore`, `arrangementStore`, `versionControlStore`.
- Use cases: project persistence (save/load/new/import/export, file IO,
  hydrate/reset/verify helpers, autoSaveHandle), arrangements
  (create/duplicate/rename/switch/helpers), DAW Project import/export
  (zip, XML, asset decode), version control (snapshot/restore/branching/
  tagging/queries/auto-save), demo projects (Nebula Drift, Resonance, demo
  utils), project templates (definitions, files, builder, previews),
  recent projects, render-to-clip, file dialog, SCL import.
- Repositories: project storage (IndexedDB + localStorage), download,
  native file dialog (Tauri/web), native project files (Tauri-only).
- Handlers: project save/new/export, DAW project import/export,
  song-structure detection, version-control create/branch/restore.
- Presentations: `ArrangementSelector`, `ExportDialog`, `RecentProjectsMenu`,
  `TemplateChooser`.

It explicitly excludes:

- The CRDT layer (`#/modules/CrdtDocument/...`) and Automerge storage
  (`#/infra/store/storage/createAutomergeStorage`) — only the way the
  Project module uses these.
- Cross-module callers (`Arrangement`, `AudioEngine`, `Transport`, `MIDI`,
  `Automation`, `Command`, instrument modules) except where directly
  imported by `Project/`.
- The DAW Project XML standard itself (we audit the Sourdaw mapping, not
  the spec).

It is an **adversarial review**: save/load schema migration, demo-project
correctness, asset reference integrity, OPFS / IDB persistence races,
versioning compatibility, type soundness, AGENTS.md violations, UX, and
testing gaps.

Related spec: none on disk.

---

## Goal

A correctness-first, durable project surface for the DAW:

- A single canonical, **versioned** `ProjectData` JSON schema with
  forward-compatible migrations. `version` is checked on every load and
  upgraded through a chain of pure migration functions; nothing reads
  fields that are not part of the active schema.
- Save / load is **transactional**: a partially-written file or
  half-hydrated store never appears as a valid project. A crash
  mid-save leaves either the previous valid project or a
  recoverable journal — never a corrupted current.
- **Asset reference integrity**: every `audioBufferId` /
  `frozenBufferId` / `assetHash` in the saved file resolves to a
  real buffer at load time, or the user is informed at the call site
  with a clear, actionable error. Imports that bundle PCM survive
  round-trips byte-identically.
- **Demo & template builders are deterministic**, idempotent, and
  produce projects that pass the same validation as user-saved
  projects. They do not bypass the persistence layer or hit the
  audio graph in a non-deterministic order.
- **Version control snapshots round-trip exactly** through
  `captureSnapshot` → `restoreSnapshot` for every store they cover,
  with a documented set of stores and a forward-compatible snapshot
  format.
- **Persistence races are eliminated**: store-write A followed by
  store-write B leaves IDB / localStorage / OPFS in state B; a
  concurrent loadProject does not interleave with an in-flight save;
  legacy localStorage migration runs at most once.
- AGENTS.md hard rules: no `any`, no `as`/`as unknown as` to silence
  errors, no namespace imports, no cross-module barrel imports of
  internals; one function per `useCases/` /`repositories/` file;
  multi-arg functions take a single object param; no `useMemo` /
  `useCallback` / `React.memo` / `forwardRef`; no `&&` rendering.

---

## Relevant code paths

- `src/modules/Project/models/ProjectData.ts` — canonical save schema
- `src/modules/Project/models/ProjectVersion.ts` — VC types
- `src/modules/Project/models/DemoProjectTypes.ts`,
  `models/ProjectTemplateTypes.ts`
- `src/modules/Project/stores/{projectStore,arrangementStore,versionControlStore}.ts`
- `src/modules/Project/useCases/projectPersistence/{newProject,loadProject}.ts`
- `src/modules/Project/useCases/projectPersistence/saveProject/{saveProject,markDirty,renameProject}.ts`
- `src/modules/Project/useCases/projectPersistence/fileIO/{exportProjectFile,pickAndImportProjectFile,applyImportedProjectData}.ts`
- `src/modules/Project/useCases/projectPersistence/helpers/{hydrateModuleStoresFromProjectData,resetModuleStoresToDefault,verifyAudioBufferReferences,autoSaveHandle}.ts`
- `src/modules/Project/useCases/versionControl/**` — VC ops
- `src/modules/Project/useCases/dawProject/**` — .dawproject zip + XML
- `src/modules/Project/useCases/demoProjects/{nebulaDrift,resonance,demoUtils}/**`
- `src/modules/Project/useCases/projectTemplates/**`
- `src/modules/Project/useCases/recentProjects/**`
- `src/modules/Project/useCases/{renderToClip,importSclFile,exportActions,fileDialog}.ts`
- `src/modules/Project/repositories/project/{downloadProjectFile,storageOperations}.ts`
- `src/modules/Project/repositories/native{ProjectFiles,FileDialog}/**`
- `src/modules/Project/handlers/{project,dawProject,songStructure,versionControl}/**`
- `src/modules/Project/presentations/views/**`

---

## Current behavior

**Save schema.** `ProjectData` is shaped from snapshots of multiple
sibling-module stores (`trackStore`, `transportStore`, `automationStore`,
`midiStore`, `tempoMapStore`, `timeSignatureMapStore`, `markerStore`,
`takeLaneStore`, `adjustmentLayerStore`, sidechain via
`getAllSidechainRoutes`, `arrangementStore`). It is a `version: number`
schema (currently `1`) but there is no migration table, no version
constants file, and no schema validator. `exportProjectFile.ts:82`
hard-codes `version: 1` and `importProjectFile.ts:14`/`:30`/`:60`
rejects anything that is not strictly `=== 1`.

**Save path.** `saveProject()` (`saveProject.ts:7`) is the documented
in-app save: it calls `persistCrdtProject()` (Automerge) and adds a
recent-projects entry. It does **not** write `ProjectData` JSON or call
`writeProjectJson` from `storageOperations.ts`. The legacy IDB path
(`storageOperations.ts:135`) is only invoked from
`pickAndImportProjectFile` and the legacy localStorage migration in
`readProjectJson()`.

**Load path.** `loadProject()` (`loadProject.ts:15`) reads from the
Automerge document via `loadCrdtProject()`, hydrates stores, then runs
`migrateAbsoluteMidiNotes()` from MIDI. There is **no** call to
`hydrateModuleStoresFromProjectData` here — that helper is only used by
`applyImportedProjectData` for `.sourdaw` file imports.

**Two persistence paths coexist.** The CRDT path (`saveProject` /
`loadProject` / `startCrdtAutoSave`) is the primary persistence. The
JSON export/import path (`exportProjectFile` /
`pickAndImportProjectFile`) round-trips a flat `ProjectData` with PCM
audio bundled as base-64 strings (`ProjectExportedAudioBuffer`). They
read different stores in different orders, with different normalisers
(`hydrateModuleStoresFromProjectData` vs `applyImportedProjectData`
inline), and emit subtly different shapes.

**Demo projects.** `createNebulaDriftDemo.ts` (~1700 lines) and
`createResonanceDemo.ts` (~2000 lines) imperatively call
`createTrack`, `setTrackGain`, `setTrackPan`, `addDeviceToStrip`,
`ensureTrackStrip`, `applyPreset`, etc., then call `syncArrangement`
to push the track list into the active arrangement snapshot. Each
demo also writes `transportStore.set(defaultTransportState)`,
`tempoMapStore.set({...})`, etc., and calls `addTempoChange` /
`addTimeSignatureChange` directly. Audio buffers for demo drums are
generated on-demand via `OfflineAudioContext` and dropped into
`audioBufferCache`. `note()` produces a `MidiNote` with a 8-character
suffix from `crypto.randomUUID().slice(0, 8)`.

**Version control.** `versionControlStore.ts:22` stores the full
state in `localStorage` with a "lightweight" persist that **strips
`snapshot.data`** before writing (`versionControlStore.ts:30`). The
in-memory store still holds the full snapshots, but they vanish on
page reload. `captureSnapshot` JSON.stringify-es five stores;
`restoreSnapshot` parses them back. Auto-save calls
`createProjectVersion` on a setInterval driven by
`autoSaveInterval` minutes (`autoSaveVersion.ts:5`), but
`autoSaveVersion.ts` itself is just the body — the timer wiring lives
elsewhere (TBD).

**OPFS / IDB persistence.** `storageOperations.ts` opens IDB on
module load (`void initDB()` at `:109`) without awaiting. Reads
(`readProjectJson`) are sync from a cache (`cachedJson`) populated
asynchronously. Writes call both IDB and `localStorage` in the same
function. `writeNamedProjectJson` writes to both; `readNamedProjectJson`
**only reads from localStorage** (`:172` — IDB read is deliberately
skipped because "would need async"). `removeProjectJson` clears the
in-memory cache + IDB + localStorage.

**DAW Project import/export.** `useCases/dawProject/` builds a `.zip`
containing `project.xml`, `metadata.xml`, and audio assets (referenced
by relative path inside the zip). `parseDawProject` decodes the zip,
`mapToProjectData` translates the upstream `Project` model into our
`ProjectData`, `decodeDawProjectAssets` decodes WAV/AIFF/etc. into
`AudioBuffer` and writes them to `audioBufferCache`. `serializeProjectXml`
and `serializeMetadataXml` are the inverse.

**Recent projects.** `recentProjects/helpers.ts` reads/writes
`localStorage` under `RECENT_PROJECTS_KEY`. `loadRecentProject(key)`
calls `readNamedProjectJson(key)` (localStorage only) and parses it as
`ProjectData`.

**Tests.** Most files have at least one spec. Several specs use
`as any` / `as never` / partial fixtures (see issues below).

---

## Findings

1. **There are two parallel persistence systems with no contract
   between them.** The CRDT path (`saveProject` ↔ `loadProject` via
   `persistCrdtProject` + Automerge) is the actual app-state
   persistence. The JSON `ProjectData` path
   (`exportProjectFile` ↔ `applyImportedProjectData`) is reachable
   only via Export/Import but reads/writes the **same module stores**
   the CRDT path does. They share no schema versioning, no shared
   normaliser, and they hydrate stores in **different orders**
   (`applyImportedProjectData` calls `hydrateModuleStoresFromProjectData`
   first, then overrides `arrangementStore` itself with an inline
   shape). A future field added to `ProjectData` is silently lost on
   the CRDT side — and a CRDT field that has no place in `ProjectData`
   is silently lost on export.

2. **`ProjectData.version === 1` is the only schema check.** There is
   no `MIN_SUPPORTED_VERSION`, `CURRENT_VERSION`, no migration chain,
   no separate schema-validation step (Zod or otherwise). When a new
   field is added, every old saved file becomes invalid and the user
   sees a generic "Invalid project file format" toast.
   `pickAndImportProjectFile.ts:14`/`:30`/`:60` and
   `exportProjectFile.ts:82` bake the version literal in three
   places.

3. **`loadProject` does not consult `ProjectData` at all.** It only
   loads from the CRDT document. The `version` field is meaningless
   for normal app loads — only export/import is gated by it. So we
   are simultaneously (a) versioning a schema that the main code
   path ignores, and (b) failing to version the schema the main code
   path actually uses (Automerge document layout).

4. **Save schema collisions: `ProjectClip` vs `ProjectTrackAlternative`
   vs `arrangementStore.ProjectClip`.** `models/ProjectData.ts:111`
   defines a `ProjectClip` with `bufferId`, `sampleStartBeat`, `notes`,
   `kneadState`. `stores/arrangementStore.ts:16` defines a *different*
   `ProjectClip` with `audioBufferId`, `assetHash`, `audioOffsetBeats`,
   `stretchMode`, `loopEnabled`, `loopLength`, `followAction`,
   `generating`, `isGhost`, `parentClipId`, `overrides` — and **no**
   `notes`/`kneadState`/`bufferId`/`sampleStartBeat`. Both are exported.
   The export path writes `tracks.map(...)` straight into
   `data.arrangement.tracks` (`exportProjectFile.ts:110`), so the file
   on disk uses **arrangementStore's** `ProjectClip` shape with
   `audioBufferId`/`assetHash`. The import path types it as
   **ProjectData**'s `ProjectClip` (`pickAndImportProjectFile.ts:12`)
   which has `bufferId`. The `audioBufferId` field is read in
   `applyImportedProjectData.ts:73` (correctly) and `verifyAudioBufferReferences.ts:14`
   (correctly), so the runtime path uses arrangementStore's shape; but
   `ProjectData.ProjectClip.bufferId` and `sampleStartBeat` are dead
   fields that no exporter writes and no importer reads.

5. **`audioBufferId` reference integrity is partial.** `exportProjectFile.ts:23`
   collects buffer IDs from `clips`, `freezeState.frozenBufferId`, and
   alternatives' clips, but **does not** collect from arrangement
   snapshots inside `arrState.arrangements` — wait, it does at `:65`,
   but only if those snapshots have a typed `tracks` field. Note the
   `ProjectArrangementSnapshot.tracks: unknown` (`models/ProjectData.ts:388`)
   — typed as `unknown` because the schema mixes "what the store has"
   (a `TrackStoreState`) with "what's in the file" (also a
   `TrackStoreState`, but no compile-time enforcement). The snapshot
   walker silently fails for any arrangement whose `tracks` is shaped
   differently than expected — there is no runtime check. Also
   missing: take-lane buffer references (takes can reference audio
   buffers in some setups) and any buffer-id referenced from a
   `frozenBufferId` inside an alternative's frozen state — only the
   active track's frozen state is collected.

6. **`exportProjectFile` writes a `mixer` block that is never read.**
   `exportProjectFile.ts:113` hard-codes
   `mixer: { master: { gain: 0.8, pan: 0 }, buses: [] }` on every
   export, regardless of `transport.masterGain` or any actual bus
   state. The import path
   (`applyImportedProjectData.ts`/`hydrateModuleStoresFromProjectData.ts`)
   does not read `data.mixer` at all. Master gain is round-tripped
   through `transport.masterGain` instead. Result: the schema field
   exists, is always written with bogus values, and is silently
   ignored on load.

7. **`midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} }`
   is empty on export.** `exportProjectFile.ts:117` hard-codes empty
   maps, but the actual MIDI data lives in `midiStore.value`. The
   import path tries to reconstruct `notesByClipId` from
   `clip.notes` — which arrangementStore's `ProjectClip` does **not**
   define (`stores/arrangementStore.ts:16`). So per-clip MIDI notes
   round-trip only through `data.arrangement.tracks[i].clips[j].notes`,
   which on a normal save is undefined. This means MIDI is silently
   lost on export.

8. **`applyImportedProjectData` overrides `arrangementStore` after
   `hydrateModuleStoresFromProjectData` already touched
   `trackStore`/`automationStore`/`markerStore`.**
   `applyImportedProjectData.ts:38` builds a single arrangement
   snapshot but **completely ignores** `data.arrangements` (the
   plural, multi-arrangement field) and `data.activeArrangementId`.
   Imports always collapse to "Main Arrangement" with the active
   tracks, dropping any non-active arrangements that were exported.

9. **`applyImportedProjectData` does not hydrate transport, tempo
   map, time-signature map, take lanes, or sidechain routes.**
   `exportProjectFile.ts` writes them all (`:91-131`); the import
   helper writes only `tracks`, `automation`, `markers`, and
   `adjustmentLayers`. Exported transport (tempo, loop range,
   metronome, punch-in/out, count-in, pre-roll, master gain) is
   simply discarded on import. Tempo and time-signature changes are
   discarded. Sidechain routes are discarded.

10. **`pickAndImportProjectFile.ts` has three near-duplicate functions.**
    `importProjectFile`, `importProjectFromNativePath`, and
    `pickAndImportProjectFile` each repeat the same
    parse-+-validate-+-apply-+-toast block (`:9-25`, `:27-40`,
    `:42-71`). The validation predicate is duplicated three times;
    when it changes, all three must change.

11. **`captureSnapshot` covers 5 of ~14 stores.** It serialises
    `trackStore`, `markerStore`, `transportStore`, `midiStore`,
    `automationStore` only. The current export path covers nine
    stores; the diff between captured-snapshot and exported-state
    silently grows. Restoring a 'snapshot' to a live project leaves
    `tempoMapStore`, `timeSignatureMapStore`, `takeLaneStore`,
    `adjustmentLayerStore`, sidechain routes, **arrangements**, all
    in their pre-restore state, mixing with the restored data.

12. **`versionControlStore` strips snapshot data on persist —
    versions do not survive page reload.**
    `versionControlStore.ts:30`: `lightweight.versions[i].snapshot.data = ''`.
    On reload, `loadFromStorage()` sees `snapshot.data === ''` and
    restoreVersion's `if (!version.snapshot.data) return;` (`restoreVersion.ts:13`)
    becomes an early no-op. The user creates a "version", sees it in
    the list, reloads, the entry remains **but cannot be restored**.
    The "Auto-save every N minutes" feature compounds this — entries
    accumulate that are silently un-restorable.

13. **`storageOperations.ts:109` boots IDB asynchronously from a
    side effect at module import.** `void initDB()` at top level
    means any synchronous `readProjectJson` call before IDB resolves
    sees `cachedJson === null` and falls through to the
    localStorage-legacy branch. If IDB resolves *after* a
    `writeProjectJson(json)` call, the cache and IDB diverge: the
    cache holds the new write, but `idbPut` is a no-op (db null) and
    the legacy localStorage write may also fail for size. There is
    no flush/retry on db ready.

14. **`writeProjectJson` writes the same JSON to *both* IDB and
    localStorage on every save.** `storageOperations.ts:140-147` —
    for projects above ~5 MB (any project with embedded PCM), the
    localStorage write throws QuotaExceeded silently. For smaller
    projects, it doubles the storage cost and the two stores can
    drift if writes interleave.

15. **`readNamedProjectJson` only reads localStorage; legacy
    projects in IDB-only are unreachable.** `storageOperations.ts:172`.
    Comment says "for named projects, try localStorage first (sync),
    then IndexedDB would need async" — but there is no IDB read at
    all. `recentProjects/loadRecentProject.ts` calls this and silently
    fails for any user who exceeded localStorage quota.

16. **`removeProjectJson` runs sync, but IDB is async — race on
    "new project after save".** `newProject.ts:65` calls
    `removeProjectJson()` synchronously, then writes through CRDT.
    The IDB delete transaction is in flight — if a `readProjectJson`
    fires from another tab or HMR, it can see stale state.

17. **`versionControlStore.value` mutations cascade through
    localStorage on every set.** `versionControlStore.ts:41-46`
    subscribes to every store change and writes the full
    lightweight state to localStorage synchronously. With
    auto-save creating a version every N minutes and the
    versions array growing unbounded, every snapshot creation
    triggers an O(N) JSON.stringify of the entire history. There is
    no cap on `versions[]` length.

18. **Demo projects mutate global stores directly inside their
    builders, bypassing CRDT persistence.** `createNebulaDriftDemo`
    calls `tempoMapStore.set(...)`, `timeSignatureMapStore.set(...)`,
    `transportStore.set(defaultTransportState)`, `markerStore.set(...)`,
    `chordTrackStore.set(...)`, `automationStore.set(...)`, etc. The
    same imperative writes happen during a normal session, so they
    do flow through `createAutomergeStorage` — but the order of
    writes is non-deterministic, and the demo also calls async
    helpers like `waitForDevices()` and async `addDeviceToStrip(...)`
    interleaved with sync `trackStore.set(...)`. A user who clicks
    "Demo" twice in rapid succession can race the two demos against
    each other (no idempotency check, no cancellation).

19. **`note().id` collisions are statistically possible.**
    `demoUtils/note.ts:6` uses `crypto.randomUUID().slice(0, 8)` —
    32 bits of entropy. A demo with thousands of notes (e.g.
    Resonance with full toaster patterns) has a non-negligible
    birthday-collision risk. Same pattern in
    `nebulaDrift/createNebulaDriftDemo.ts:186` for device IDs
    (`toaster-${slice(0, 8)}`). The Note IDs flow into MIDI store
    keys; a collision silently overwrites a note.

20. **Demo `createMidiClip` returns a different shape than the
    arrangementStore's `ProjectClip`.**
    `demoUtils/createMidiClip.ts:19` declares `DemoMidiClip` with
    `notes: ProjectMidiNote[]`, `parentClipId`, `isLinkedInstance`,
    `kneadState`. The actual `arrangementStore.ProjectClip` (the
    one trackStore stores) has none of those — but demo code
    builds `Track.clips: DemoMidiClip[]` and passes them to
    `syncArrangement(tracks)` which writes into `arrangementStore`.
    The cast happens implicitly through `Track.clips` typing —
    if `Track.clips` accepts arbitrary shapes, the type isn't
    enforcing the contract. The notes are then *not* indexed in
    `midiStore.notesByClipId` because no demo writes there
    (Resonance/NebulaDrift never call `midiStore.set`/`addNote`).
    So MIDI playback for demo MIDI clips depends on whether the
    runtime reads from `clip.notes` or from `midiStore`.

21. **`createAudioClip` returns a frozen `stretchMode: 'repitch'`
    default.** `demoUtils/createAudioClip.ts:25`. The user has no
    way to override; demos that want `'off'` or `'timestretch'`
    must construct the clip manually. Minor, but uniformity with
    `arrangementStore.ProjectClip.stretchMode` (which is optional)
    would let demos opt in.

22. **`generateDemoDrumBuffer` swallows all errors.**
    `demoUtils/generateDemoDrumBuffer.ts:129` `catch { /* ignore */ }`.
    A failed `OfflineAudioContext` render leaves
    `audioBufferCache.get(bufferId) === null` and the demo's audio
    clips reference a missing buffer. The user sees silent clips
    with no diagnostic. Should at least `logger.warn`.

23. **`captureSnapshot` uses `JSON.stringify` with no replacer —
    `Map`/`Set`/typed-array fields silently degrade.** The JSDoc at
    `captureSnapshot.ts:9` admits this. Today none of the captured
    stores hold those types. The day one does (e.g. a typed-array
    waveform peak cache), version control will silently drop it
    and `restoreSnapshot` will see undefined.

24. **`restoreSnapshot` re-uses `inject`; siblings do not.** All
    other use cases in this module are plain functions
    (`createProjectVersion`, `restoreVersion`, etc). Inconsistent
    DI usage across one folder makes the convention unclear.

25. **`exportProjectFile` always emits `history: { checkpoints: [] }`.**
    `exportProjectFile.ts:136`. The "checkpoints" concept is
    declared in the schema but no code populates it. Dead schema
    field — either remove it or populate from `versionControlStore`.

26. **Recent projects keys are leaked across users.** The key is
    `sourdaw:project:${name}` (`saveProject.ts:28`). Two distinct
    projects with the same name (e.g. "Untitled Project") collide
    in localStorage. `addToRecentProjects(name, key)` is called with
    the project name as the human-visible key, so renaming a project
    creates a new entry while orphaning the old key. There is no
    deduplication by file path or project ID.

27. **`pickAndImportProjectFile` `paths[0]` is typed as a `File`,
    but the path-name suggests `string`.** Local variable name
    `paths` then `const file = paths[0]` (`pickAndImportProjectFile.ts:53`).
    Misleading naming — `pickFiles` returns `File[]`. Refactor name
    or split the Tauri-vs-web variants.

28. **Three different schema validators across import paths.**
    `importProjectFile.ts:14`, `importProjectFromNativePath.ts:30`,
    `pickAndImportProjectFile.ts:60` each repeat
    `data.version !== 1 || !data.arrangement?.tracks || !data.meta`.
    Forwarded to issue #10 above; called out separately because the
    validator is also wrong: `arrangement.tracks` may be an empty
    array in a valid project, but `!data.arrangement?.tracks`
    rejects only `null` / `undefined`, so this passes. It does
    **not** check `data.transport`, `data.automation`,
    `data.midi`, `data.mixer`. A file with `version: 1` and
    `meta` and `arrangement.tracks: []` and nothing else passes
    validation, then `applyImportedProjectData` runs and sets
    `transportStore` to `data.transport` if present, otherwise
    leaves it untouched (issue #9).

29. **`applyImportedProjectData` reduces clips to per-clip
    `notesByClipId` from `clip.notes`, but
    `arrangementStore.ProjectClip.notes` does not exist.**
    `applyImportedProjectData.ts:50-54`. The reducer reads
    `context.notes` (where `context` is a clip). Compile-time, this
    is `unknown` access on a clip type that does not declare
    `notes`. At runtime, demo files (issue #20) and old `ProjectData`
    files do have `clip.notes`; the export path
    (`exportProjectFile.ts:117`) does **not** write `clip.notes`,
    so a normal export → import round-trip yields zero MIDI notes.
    This is a broken contract.

30. **`audioBuffers` round-trip uses base-64 PCM with no codec
    metadata beyond `sampleRate` / `numberOfChannels` /
    `channelData[]`.** `models/ProjectData.ts:349`. Float32 channel
    data is base-64-encoded ad-hoc by `audioBufferCache.exportBuffers`
    (out of scope) and decoded on import. There is no
    bit-depth / encoding tag, no length prefix, no checksum. A
    truncated or corrupted base-64 string decodes to a buffer of
    different length and silently plays.

31. **`recentProjects` are bound to localStorage only and never
    cleared on `newProject`.** `newProject.ts:65` calls
    `removeProjectJson()` (clears the *current* project) but does
    not touch `RECENT_PROJECTS_KEY`. Old recent-projects entries
    accumulate forever; deleting the only project from disk leaves
    the orphan in the recent-projects list.

32. **`hydrateModuleStoresFromProjectData` casts `points.curve as
    AutomationCurveType`.** `hydrateModuleStoresFromProjectData.ts:36`.
    AGENTS.md "TypeScript — soundness" forbids `as` to silence
    errors. The fix is a runtime narrow (a `ALLOWED_CURVES.includes(...)`
    check or Zod), not a cast.

33. **`hydrateModuleStoresFromProjectData` casts
    `effectType as AdjustmentEffectType` and lanes
    `as AutomationLane[]`.** `hydrateModuleStoresFromProjectData.ts:39,67`.
    Same `as`-escape issue.

34. **`exportProjectFile` casts `markerStore.value` markers via
    `(message as { label?: string }).label`.**
    `exportProjectFile.ts:127`. Reaching into an undeclared field
    via an inline cast — should be either the field is on the type
    or it should not be read.

35. **`AutoSaveHandle` uses module-level mutable state.**
    `helpers/autoSaveHandle.ts:10` `let stopAutoSave`. HMR-unsafe;
    a hot reload of `loadProject.ts` orphans the previous handle.
    Same pattern flagged across modules in the AudioAnalysis audit.

36. **`saveProject()` swallows `addToRecentProjects` after a
    failed CRDT persist.** `saveProject.ts:15`: the `then(...)`
    chain on `persistCrdtProject()` updates the store on success
    and warns on failure, but `addToRecentProjects(name, ...)` runs
    **synchronously** outside the chain (`:28`) — so a failed save
    still adds a recent-projects entry pointing at a project that
    was never persisted.

37. **`saveProject()` updates `updatedAt` to capture-time, not
    persist-completion-time.** `saveProject.ts:13` reads
    `Date.now()` *before* calling `persistCrdtProject()`, then
    sets it on the store inside `then(...)`. If the persist takes
    several seconds (CRDT compaction, large doc), `updatedAt` is
    stale on subsequent reads relative to wall-clock. Minor, but
    the schema field is documented as "last save time".

38. **`projectStore` initial `loading: true` plus mid-load
    `set({ ...current, loading: true })`.** `projectStore.ts:43`
    initial value is `loading: true`. `loadProject.ts:18` sets it
    again. Subscribers see two `loading: true` notifications back
    to back. Not a bug per se, but the initial state is contradictory:
    until any user interaction the project is named "Untitled Project"
    with `initialized: false` and `loading: true`. The
    LaunchScreen-gating doc comment on `initialized` says it's the
    only flag that matters — `loading` then is redundant.

39. **`projectStore` `tuning.frequencies` regenerated on every
    `newProject` call.** `newProject.ts:60-62` recomputes the
    128-entry frequency table inline; `projectStore.ts:46-48` does
    the same in initialData. Two copies of identical bootstrapping
    logic.

40. **`importSclFile` not reviewed in detail (~~ pending file
    read~~).** Tracked as an open question; flagged here so the
    audit acknowledges incomplete coverage.

41. **`renderToClip` not reviewed in detail (~~ pending file
    read~~).** Same.

42. **`exportActions` not reviewed in detail.** Same.

43. **`getProjectHandlers` / `getDawProjectHandlers` /
    `getSongStructureHandlers` / `getVersionControlHandlers`
    function-per-file convention is followed but per-handler details
    not exhaustively reviewed.** Most handler files in
    `handlers/` follow the `createHandler` pattern; each handler is
    one-function-per-file and registered through the corresponding
    `get*Handlers` aggregator.

44. **Presentations not reviewed in detail (~~ pending file
    read~~).**

45. **DAW Project import/export (`useCases/dawProject/*`) not
    reviewed in detail (~~ pending file read~~).** Asset reference
    integrity, XML schema compliance, round-trip equality of
    metadata are open questions.

46. **Tempo/time-signature changes during demo creation race the
    transport store reset.** `createNebulaDriftDemo` calls
    `transportStore.set(defaultTransportState)` after creating
    tracks but `tempoMapStore.set(...)` calls happen earlier.
    `addTempoChange` writes to `tempoMapStore` while the same
    function may be in flight (the demo also calls
    `addTimeSignatureChange`). If the user has any subscriber
    in `Transport` that resets on `transportStore` change, the
    tempo map intermediate is observable.

47. **`crypto.randomUUID()` is assumed available.** All ID
    generation in this module (`projectVersion.ts:58`,
    `note.ts:6`, `createTrack`, etc.) calls `crypto.randomUUID()`.
    Older Safari (< 15.4) and any non-secure context lack it.
    There is no polyfill or fallback.

48. **`localStorage` is read synchronously from `versionControlStore.ts:11`
    and `storageOperations.ts:121` at module-import time.** SSR
    or pre-render contexts (and the test environment without a
    `window` shim) will throw. The store init does a `try/catch`
    but `readProjectJson`'s legacy fallback does too — it falls
    through to `null`. No SSR support is plausibly needed today,
    but the assumption should be explicit.

---

## Priorities

1. **Schema collisions and silent data loss on export/import**
   (issues #4, #6, #7, #8, #9, #29) — `exportProjectFile` writes a
   schema that `applyImportedProjectData` cannot fully consume.
   MIDI, transport, tempo map, time-signature map, take lanes,
   sidechain, multi-arrangement state, mixer, history are all
   silently lost on round-trip. This is the most user-visible
   correctness issue.
2. **No `ProjectData` schema versioning beyond a literal `1`**
   (issues #2, #3, #28) — there is no migration chain, no shared
   validator, three duplicated validators, and the validator does
   not actually check most required fields. The first schema
   change will brick every existing exported `.sourdaw` file.
3. **Version control snapshots do not survive page reload**
   (issue #12) — the persistence path strips `snapshot.data`. The
   feature appears to work in-session, then silently fails on
   reload.
4. **`captureSnapshot` covers fewer stores than `exportProjectFile`**
   (issue #11) — restoring a version into a live project mixes
   the restored five stores with whatever was already in the other
   nine.
5. **IDB / localStorage write race + dead read paths** (issues
   #13, #14, #15, #16) — `void initDB()` at module load + sync
   reads from cache + writes to two backends + IDB-only data
   unreachable from `readNamedProjectJson` is a footgun cluster.
6. **Demo projects: ID collision risk and silent buffer
   generation failure** (issues #19, #22) — 32-bit IDs across
   thousands of notes; failed `OfflineAudioContext.render` is
   silenced.
7. **AGENTS.md type-soundness violations** (issues #4, #20, #29,
   #32, #33, #34) — `as` escapes, divergent type shapes for
   "the same" `ProjectClip`.
8. **Recent projects entries leak and break with renames**
   (issues #26, #31).

---

## Open issues

### 1. Two parallel persistence systems with no shared schema or normaliser

**Problem:** The CRDT persistence path (`saveProject`, `loadProject`)
and the JSON file path (`exportProjectFile`,
`applyImportedProjectData`) read the same module stores but use
different shapes, different normalisers, and different field sets.
A field added on one path is silently dropped on the other.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts:15`
- `src/modules/Project/useCases/projectPersistence/loadProject.ts:22`
- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:81-138`
- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts:13-83`
- `src/modules/Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts`

**Needed:** Define a single canonical `serializeProject()` /
`deserializeProject(data: ProjectData)` pair that both the CRDT
path and the JSON path drive through. Both paths must read and
write through the same mapper, with the same field coverage and
the same normalisation. A diff test (`exportProjectFile` of state
S, `applyImportedProjectData(out)`, re-export, deep-equal to first
output) prevents future drift.

### 2. `ProjectData.version` has no migration chain

**Problem:** `version` is a literal `1` everywhere; the validator
is `data.version !== 1`. There is no `MIN_SUPPORTED_VERSION`,
`CURRENT_VERSION`, no migration table. The first schema bump will
invalidate every existing exported `.sourdaw` file with a generic
toast.

**Representative files:**

- `src/modules/Project/models/ProjectData.ts:10`
- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:82`
- `src/modules/Project/useCases/projectPersistence/fileIO/pickAndImportProjectFile.ts:14,30,60`

**Needed:** A `models/projectVersionMigrations.ts` file with
`CURRENT_VERSION`, `MIN_SUPPORTED_VERSION`, an array of pure
`migrate_v1_to_v2(data) => data` functions, and a single
`upgradeProjectData(raw): ProjectData | { error }` entry point.
Replace all three duplicated validators with one Zod schema +
migration chain. Add tests for each migration step and for "v1
file imports cleanly into v2 stores".

### 3. `loadProject` does not consult the saved schema version

**Problem:** The Automerge CRDT path is the actual app-load path;
it ignores `ProjectData.version`. So we are versioning a schema
that the main code path does not read.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/loadProject.ts:22`
- `src/modules/CrdtDocument/useCases` (out of scope)

**Needed:** Decide where the canonical schema lives. Either (a)
make CRDT documents version-tagged and gate `loadCrdtProject` on
the same migration chain as `pickAndImportProjectFile`, or (b)
formally split: file imports use migrations, in-place CRDT loads
use the live schema. Document the decision in a spec.

### 4. `ProjectData.ProjectClip` and `arrangementStore.ProjectClip` are different types

**Problem:** `ProjectData.ProjectClip` (`models/ProjectData.ts:111`)
declares `bufferId`, `sampleStartBeat`, `notes`, `kneadState`.
`arrangementStore.ProjectClip` (`stores/arrangementStore.ts:16`)
declares `audioBufferId`, `assetHash`, `audioOffsetBeats`,
`stretchMode`, `loopEnabled`, `loopLength`, `followAction`,
`generating`, `isGhost`, `parentClipId`, `overrides` — and **no**
`notes` / `kneadState` / `bufferId` / `sampleStartBeat`. The
runtime store uses the second; the file schema declares the first;
the export path writes from the second into a slot typed as the
first.

**Representative files:**

- `src/modules/Project/models/ProjectData.ts:111-130`
- `src/modules/Project/stores/arrangementStore.ts:16-41`
- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:110`
- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts:49-58`
- `src/modules/Project/useCases/projectPersistence/helpers/verifyAudioBufferReferences.ts:14`

**Needed:** Pick one type. The `arrangementStore` shape is the
runtime contract; the file schema must mirror it (or a strict
subset). Delete `ProjectData.ProjectClip.bufferId` /
`sampleStartBeat` (dead) and add `audioBufferId`,
`stretchMode`, etc., to the schema. Add a round-trip test:
serialize → parse → assert deep-equal.

### 5. Asset reference integrity is partial

**Problem:** `collectBufferIds` walks the active `trackStore` and
each `arrangementStore.arrangements[i].tracks` snapshot, but
snapshots' `tracks` is typed `unknown` and the walker does no
runtime guard. Frozen-buffer references inside non-active
alternatives are skipped. Take-lane buffer references are not
collected at all.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:23-43,61-69`
- `src/modules/Project/models/ProjectData.ts:386-395`

**Needed:** Type `ProjectArrangementSnapshot.tracks` as
`ProjectTrackStoreState` (or equivalent typed shape) so the walker
is type-safe. Walk `alternatives[i].clips` for frozen buffers in
each alternative, and walk take lanes for any buffer refs. Add a
test that exports a project with a non-active alternative
referencing an audio clip and verifies the buffer is bundled.

### 6. `ProjectData.mixer` is dead schema field — written with bogus values, never read

**Problem:** `exportProjectFile.ts:113` always writes
`{ master: { gain: 0.8, pan: 0 }, buses: [] }`. The import path
does not read `data.mixer`. Master gain is round-tripped via
`transport.masterGain` instead.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:113-116`
- `src/modules/Project/models/ProjectData.ts:283-299`
- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts`

**Needed:** Either populate `mixer` from real state and read it
on import, or delete the field from the schema. As-is it is
misleading. Decide based on what a future bus/master refactor
needs.

### 7. MIDI notes are silently dropped on export

**Problem:** `exportProjectFile.ts:117` hard-codes empty
`notesByClipId`/`ccByClipId`/`pitchBendByClipId` instead of
reading from `midiStore.value`. The import path tries to
reconstruct from `clip.notes` (which the runtime store does not
populate). Round-trip → zero MIDI notes survive.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:117-121`
- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts:49-58`
- `src/modules/MIDI/stores`

**Needed:** Read `midiStore.value` and write its contents into
`data.midi`. On import, hydrate `midiStore` from `data.midi`.
Drop the per-clip-`notes` reducer in `applyImportedProjectData`.
Add a round-trip test for a project with MIDI notes.

### 8. Multi-arrangement and active-arrangement state lost on import

**Problem:** `applyImportedProjectData.ts:38` always sets a
single arrangement called "Main Arrangement". `data.arrangements`
and `data.activeArrangementId` (both written by export) are
silently ignored.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:132-133`
- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts:38-66`

**Needed:** Read `data.arrangements` and `data.activeArrangementId`;
fall back to a single arrangement only when those fields are
absent (legacy v1 file). Add a test: project with two
arrangements, export, re-import, assert both survive and the
active one is preserved.

### 9. Transport, tempo map, time signature, take lanes, sidechain — silently lost on import

**Problem:** `applyImportedProjectData` only hydrates tracks,
automation, markers, adjustment layers. Transport (tempo, loop,
metronome, punch-in/out, count-in, pre-roll, master gain), tempo
map, time-signature map, take lanes, sidechain routes — all
written by export, all dropped on import.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts:13-83`
- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:91-132`

**Needed:** Hydrate every store the export writes. Cleanest path:
have `applyImportedProjectData` reuse the same canonical
`deserializeProject(data)` proposed in issue #1.

### 10. Three duplicated import-validate-apply paths

**Problem:** `importProjectFile`, `importProjectFromNativePath`,
and `pickAndImportProjectFile` repeat the same parse + validate
+ apply + toast block.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/pickAndImportProjectFile.ts:9-71`

**Needed:** Extract a single
`tryApplyProjectJson(content: string): Promise<boolean>` helper
and reduce the three call sites to source-specific input handling.
Tests should target the helper directly.

### 11. `captureSnapshot` covers 5 of 9 exported stores

**Problem:** `captureSnapshot` only serialises trackStore,
markerStore, transportStore, midiStore, automationStore. It misses
tempoMapStore, timeSignatureMapStore, takeLaneStore,
adjustmentLayerStore, sidechain routes, arrangementStore.
Restoring a snapshot leaves the other stores untouched, mixing
restored and current state.

**Representative files:**

- `src/modules/Project/useCases/versionControl/snapshotHelpers/captureSnapshot.ts:14-22`
- `src/modules/Project/useCases/versionControl/snapshotHelpers/restoreSnapshot.ts:14-21`

**Needed:** Bring snapshot coverage in line with export coverage
(or share the same canonical serializer — issue #1). Add a
"capture → mutate every store → restore → deep-equal original"
test.

### 12. Version control snapshots do not survive a reload

**Problem:** `versionControlStore.ts:30` strips `snapshot.data`
before persisting to localStorage. On reload, `loadFromStorage`
sees `snapshot.data === ''` and `restoreVersion` early-returns at
the `!version.snapshot.data` check.

**Representative files:**

- `src/modules/Project/stores/versionControlStore.ts:25-39`
- `src/modules/Project/useCases/versionControl/restoreVersion.ts:12-13`

**Needed:** Either (a) persist full snapshots to IDB instead of
localStorage so the size limit is not a problem, or (b) persist
metadata only and store snapshots in a separate IDB object store
keyed by version ID, fetched on demand at restore time. The
current "show in list, fail to restore" UX is the worst combination.
Add a test: create version, reload (simulate), restore, assert
state matches.

### 13. IDB initialised asynchronously from a top-level side effect; sync reads see stale `cachedJson`

**Problem:** `storageOperations.ts:109` `void initDB()` does not
await. Any sync `readProjectJson` before IDB resolves sees
`cachedJson === null` and may falsely fall through to the
localStorage-legacy branch. After IDB resolves, no flush/retry.

**Representative files:**

- `src/modules/Project/repositories/project/storageOperations.ts:21-110,135-148`

**Needed:** Make readers async (`readProjectJson(): Promise<...>`)
and `await initDB()` inside, or expose a `whenReady()` Promise
that callers must await before reading. Either way, no more
"silently sync but actually async" semantics.

### 14. Every save writes to both IDB and localStorage; quota errors swallowed

**Problem:** `writeProjectJson` always writes to both backends.
Projects with embedded PCM exceed localStorage quota and the
write throws silently. Two divergent backends serve the same
key.

**Representative files:**

- `src/modules/Project/repositories/project/storageOperations.ts:135-167`

**Needed:** Drop the localStorage write for the primary project
key; rely on IDB. If localStorage fallback is needed for any
specific named project (small, e.g. recents), do it explicitly
with size checks.

### 15. `readNamedProjectJson` only reads localStorage — IDB-only entries unreachable

**Problem:** `storageOperations.ts:172` admits "IndexedDB would
need async". Anyone whose named project landed in IDB only (after
a localStorage quota error) cannot reload it through
`recentProjects`.

**Representative files:**

- `src/modules/Project/repositories/project/storageOperations.ts:170-177`
- `src/modules/Project/useCases/recentProjects/loadRecentProject.ts`

**Needed:** Make `readNamedProjectJson` async and read from IDB
(falling back to localStorage). Update `loadRecentProject` and
the recent-projects UI to await.

### 16. `removeProjectJson` is sync; IDB delete is async; race window

**Problem:** `newProject.ts:65` calls `removeProjectJson()`
synchronously. The IDB delete transaction is in flight when
subsequent stores write through CRDT. Concurrent
`readProjectJson` (e.g. from another tab or HMR re-mount) can
observe stale state.

**Representative files:**

- `src/modules/Project/repositories/project/storageOperations.ts:95-106,150-158`
- `src/modules/Project/useCases/projectPersistence/newProject.ts:65`

**Needed:** Await the IDB delete transaction (`oncomplete` /
`onsuccess` event). At minimum, return the Promise from the
public function so callers can await.

### 17. `versionControlStore` re-stringifies the entire history on every change

**Problem:** `versionControlStore.ts:41` subscribes to every
store change and writes the full lightweight state to
localStorage synchronously. With auto-save creating a version
every N minutes and the versions array growing unbounded, every
snapshot triggers an O(N) JSON.stringify of full history.

**Representative files:**

- `src/modules/Project/stores/versionControlStore.ts:25-46`

**Needed:** Cap `versions[]` length (e.g. 200 with FIFO eviction,
keeping tagged versions). Throttle the persist subscriber. Move
to IDB so the cost is amortised differently.

### 18. Demo projects mutate global stores directly with interleaved sync/async writes

**Problem:** `createNebulaDriftDemo` and `createResonanceDemo`
imperatively call `tempoMapStore.set`, `transportStore.set`,
`addTempoChange`, `addDeviceToStrip` (async), `applyPreset` etc.
A user double-clicking "Demo" can race two demos against each
other; HMR reloads of the demo file mid-run leave stores in
mixed state.

**Representative files:**

- `src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts:137`
- `src/modules/Project/useCases/demoProjects/resonance/createResonanceDemo.ts`

**Needed:** Wrap each demo in `await newProject(name)` first
(reset stores), then build. Track in-flight construction with a
module-level Promise; if a second invocation arrives, abort or
queue. At minimum, take a `signal: AbortSignal` parameter.

### 19. `note().id` and demo device IDs use 32-bit truncated UUIDs — collision risk

**Problem:** `demoUtils/note.ts:6` uses
`crypto.randomUUID().slice(0, 8)` (32 bits). For a project with
thousands of notes the birthday-collision probability rises into
the percent range. Same pattern for `toaster-${slice(0, 8)}` device
IDs in demos.

**Representative files:**

- `src/modules/Project/useCases/demoProjects/demoUtils/note.ts:6`
- `src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts:186`

**Needed:** Use the full UUID (36 chars), or a counter-based
generator. Note IDs are stored as MIDI store keys; a collision
silently overwrites a note. Add a test that generates 10 000
notes and asserts unique IDs.

### 20. Demo `createMidiClip` shape diverges from runtime `ProjectClip`; MIDI may not play

**Problem:** `demoUtils/createMidiClip.ts:19` builds
`DemoMidiClip` with a `notes: ProjectMidiNote[]` field that
`arrangementStore.ProjectClip` does not declare. Demos do not
populate `midiStore.notesByClipId`. MIDI playback depends on
where the runtime reads from.

**Representative files:**

- `src/modules/Project/useCases/demoProjects/demoUtils/createMidiClip.ts:19-62`
- `src/modules/Project/stores/arrangementStore.ts:16`

**Needed:** Either (a) make `arrangementStore.ProjectClip` carry
optional `notes` and have the runtime read from there, or (b)
have demo code write to `midiStore.notesByClipId` after creating
clips. Pick one and document. Add a playback test for a demo
clip's first note.

### 21. `generateDemoDrumBuffer` swallows errors silently

**Problem:** A failed `OfflineAudioContext.startRendering()`
leaves the buffer cache empty; the demo's audio clips reference
a missing buffer ID; the user sees silent clips with no
diagnostic.

**Representative files:**

- `src/modules/Project/useCases/demoProjects/demoUtils/generateDemoDrumBuffer.ts:127-131`

**Needed:** Replace `catch { /* ignore */ }` with
`logger.warn(...)` and let the caller decide. Demo files should
verify buffer presence before referencing.

### 22. `captureSnapshot` JSON-stringifies blindly; future Map/Set/typed-array fields silently drop

**Problem:** Documented in the file's JSDoc. Future store
additions that rely on non-JSON-serialisable values will silently
truncate.

**Representative files:**

- `src/modules/Project/useCases/versionControl/snapshotHelpers/captureSnapshot.ts:14-22`

**Needed:** Replace with a typed mapper that preserves typed
arrays (e.g. base-64) and enforces the known store shapes.
Validate via a "round-trip equality" test for each captured store.

### 23. `as` escapes in `hydrateModuleStoresFromProjectData`

**Problem:** Three `as` casts to silence the type checker on
fields that come from JSON: `param.curve as AutomationCurveType`,
`as AutomationLane[]`, `layer.effectType as AdjustmentEffectType`.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/helpers/hydrateModuleStoresFromProjectData.ts:36,39,67`

**Needed:** Validate the strings against the allowed-values lists
(e.g. `if (!ALLOWED_CURVES.includes(curve)) curve = 'linear'`)
and propagate the narrowed type without a cast. Or use Zod at
the import boundary.

### 24. `markerStore` write reads through an anonymous `(message as { label?: string })` cast

**Problem:** `exportProjectFile.ts:127` reaches into a field that
the typed `markerStore.value.markers[i]` does not declare via an
inline cast. AGENTS.md forbids `as`-escapes.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:124-129`

**Needed:** Either the field belongs on the type or it does not
exist. Find out which marker shapes have `label` (legacy?
unused?) and either declare it or remove the access.

### 25. `ProjectData.history` is a dead schema field

**Problem:** `exportProjectFile.ts:136` always writes
`history: { checkpoints: [] }`. Nothing reads it.

**Representative files:**

- `src/modules/Project/models/ProjectData.ts:308-316,26`
- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:136`

**Needed:** Either populate from `versionControlStore.versions`
on export and restore on import, or delete the field from the
schema.

### 26. Recent-projects keys collide on duplicate names; renaming orphans entries

**Problem:** `saveProject.ts:28` keys a recent-projects entry by
project name. Two projects named "Untitled Project" collide;
renaming "Foo" → "Bar" creates a new key and orphans the old one.
There is no deduplication by file path or stable project ID.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts:28`
- `src/modules/Project/useCases/recentProjects/addToRecentProjects.ts`
- `src/modules/Project/useCases/recentProjects/helpers.ts`

**Needed:** Generate a stable per-project ID at create time
(`projectStore.id`) and key recents by ID. Display name in the UI.
Migrate existing entries by name once.

### 27. Three import paths repeat schema validation; the validator is incomplete

**Problem:** Each repeats `data.version !== 1 || !data.arrangement?.tracks || !data.meta`.
A file with `version: 1`, `meta`, and `arrangement.tracks: []`
passes — even with `transport`/`automation`/`midi` missing.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/pickAndImportProjectFile.ts:14,30,60`

**Needed:** Single Zod (or hand-written) schema validator,
called from one place. Validate every required field. (See
issue #2 — same canonical migration entry point.)

### 28. `applyImportedProjectData` reads `clip.notes` from a type that does not declare it

**Problem:** `clip.notes` is read at `applyImportedProjectData.ts:52`
but `arrangementStore.ProjectClip` does not have `notes`. Compile
proceeds because `data.arrangement.tracks` is typed as
`ProjectData.ProjectTrack` (the model with `clips: ProjectClip[]`
where `ProjectClip` has `notes`). Cross-type confusion (issue #4)
hides the bug.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts:49-58`

**Needed:** Pick one `ProjectClip` shape (issue #4) and fix the
reducer accordingly. If MIDI moves to top-level
`data.midi.notesByClipId` (issue #7), drop this reducer entirely.

### 29. `audioBuffers` round-trip lacks a content checksum

**Problem:** Base-64 PCM is stored as `channelData[]` with no
checksum. A truncated or corrupted decode produces a
different-length buffer that silently plays.

**Representative files:**

- `src/modules/Project/models/ProjectData.ts:349-353`

**Needed:** Add a `sha256` (or simpler CRC-32) per channel and
verify on decode. Surface a per-clip "audio mismatch" toast when
mismatched.

### 30. `recentProjects` not cleared on `newProject` or project deletion

**Problem:** `newProject.ts:65` clears the current project but
not recents. Deleting the only project from disk leaves the
orphan.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/newProject.ts:65`
- `src/modules/Project/useCases/recentProjects/removeFromRecentProjects.ts`

**Needed:** Decide policy. "Recent" implies "previously opened" —
deleting a project should remove it from the list; creating a new
project should leave the list intact. Audit each path.

### 31. `crypto.randomUUID()` assumed available; no fallback

**Problem:** Used throughout for ID generation. Older Safari
(< 15.4) and any non-secure context lack it.

**Representative files:**

- `src/modules/Project/models/ProjectVersion.ts:58,69`
- `src/modules/Project/useCases/demoProjects/demoUtils/note.ts:6`
- (and many other call sites)

**Needed:** Centralise ID generation behind a `#/utils/uuid.ts`
helper with a polyfill. Verify the supported browser matrix.

### 32. `versionControlStore` reads localStorage at module-import; SSR/test envs without `window` throw without explicit handling

**Problem:** `versionControlStore.ts:11` calls
`window.localStorage` inside `loadFromStorage` at top-level of
the module. Wrapped in try/catch but the failure mode is silent.

**Representative files:**

- `src/modules/Project/stores/versionControlStore.ts:9-23`
- `src/modules/Project/repositories/project/storageOperations.ts:121`

**Needed:** Confirm there is no SSR/test path that imports this
module without a `window` shim; if there is, gate the read on
`typeof window !== 'undefined'`.

### 33. `saveProject()` adds recent-projects entry even when persist fails

**Problem:** `saveProject.ts:28` calls `addToRecentProjects(...)`
synchronously, outside the `persistCrdtProject().then(...)`
chain. A failed save still records a recent entry.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts:14-28`

**Needed:** Move `addToRecentProjects` into the success branch of
the `then(...)` chain.

### 34. Module-level mutable `stopAutoSave` (HMR-unsafe)

**Problem:** `helpers/autoSaveHandle.ts:10` `let stopAutoSave: (() => void) | null = null;`.
On HMR reload of `loadProject.ts`, the handle leaks: the previous
auto-save closure is still alive and references stale store
imports.

**Representative files:**

- `src/modules/Project/useCases/projectPersistence/helpers/autoSaveHandle.ts:10`

**Needed:** Use `import.meta.hot?.dispose(() => stopActiveAutoSave())`,
or a global registry under `globalThis.__sourdaw_autoSave__`,
so HMR collapses the handle.

### 35. Two copies of `tuning.frequencies` bootstrapping logic

**Problem:** Identical 12-TET frequency table generated in
`projectStore.ts:46` and `newProject.ts:60`.

**Representative files:**

- `src/modules/Project/stores/projectStore.ts:46-48`
- `src/modules/Project/useCases/projectPersistence/newProject.ts:59-62`

**Needed:** Extract a `defaultEqualTemperamentTuning()` helper and
reuse.

### 36. Demo MIDI insertion / device chain ordering is interleaved sync + async

**Problem:** `createNebulaDriftDemo.ts:137` runs ~1700 lines of
imperative `createTrack` / `setTrack*` / `addDeviceToStrip`
(async) / `applyPreset` / `addTempoChange` calls in mixed sync /
async order. There is no transactional bracket; subscribers can
observe partial state.

**Representative files:**

- `src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts`
- `src/modules/Project/useCases/demoProjects/resonance/createResonanceDemo.ts`

**Needed:** Either (a) bracket the demo build in a "loading"
flag that pauses store-subscribers, or (b) accumulate all writes
into a draft and apply them in one `*Store.set(...)` per store at
the end. The latter matches how `applyImportedProjectData` is
shaped and avoids partial-state observability.

### 37. `inject(...)` only used in `restoreSnapshot` — inconsistent within the folder

**Problem:** Other version-control use cases are plain functions.
Only `restoreSnapshot` uses `inject({ logger })`.

**Representative files:**

- `src/modules/Project/useCases/versionControl/snapshotHelpers/restoreSnapshot.ts:26`

**Needed:** Either standardise on `inject` for all logger access
in this module or drop it from the one outlier and import
`logger` directly. Pick one convention.

### 38. DAW Project export reads `mixer` and `audioBuffers` paths inconsistently with import

**Problem:** `exportDawProject.ts:97` writes `mixer: { master: { gain: 0.8, pan: 0 }, buses: [] }` (same dead value as `exportProjectFile`), and `:127` `sidechainRoutes: undefined`. The corresponding `mapToProjectData` (the *import* side) emits `mixer: { master: { gain: 0.8, pan: 0 }, buses: [] }` and **does not** emit `sidechainRoutes`. So the DAW Project import/export drops sidechain routes by design and writes the same dead mixer block.

Additionally, `exportDawProject.collectAudioBufferIds` only walks `tracksState.tracks[*].clips[*]` — it does **not** walk `alternatives` or `freezeState.frozenBufferId`, while the JSON `exportProjectFile.collectBufferIds` does. The two exporters disagree on which buffers count as "referenced" — a frozen buffer survives JSON export but is dropped from DAWproject export.

**Representative files:**

- `src/modules/Project/useCases/dawProject/exportDawProject.ts:22-32,97,127`
- `src/modules/Project/useCases/dawProject/mapToProjectData.ts:282`

**Needed:** Share `collectBufferIds` between the two exporters (single helper). Document the sidechain-route omission or fix it. Address the dead `mixer` block (same as issue #6).

### 39. DAW Project import `parseProjectXml` `parseChannelInfo` defaults `pan` to `0.5` then doubles to `(0.5*2 - 1) = 0` — ok; but `volume` defaults to `0.8` regardless of the schema

**Problem:** `parseProjectXml.ts:106` `volumeNode?.attrNumber('value', 0.8) ?? 0.8` — DAWproject volume is a normalized 0..1; defaulting to 0.8 silently raises mute tracks to 80%. A track with `<Volume>` absent imports as audible at 80% gain when the source intent was "no volume node = use channel default". The 0.5 pan fallback is similarly arbitrary.

**Representative files:**

- `src/modules/Project/useCases/dawProject/parseProjectXml.ts:99-127`

**Needed:** Pick a documented default (1.0 unity is more conventional for DAWs) or treat absence as "do not change the track gain after creation". Current 0.8 is a magic constant that does not match any sister DAW.

### 40. DAW Project XML export uses Sourdaw track IDs as DAWproject XML IDs

**Problem:** `serializeProjectXml.ts:100` uses `track.id` (Sourdaw's internal `crypto.randomUUID()` IDs like `track-abc12345`) as DAWproject `<Track id>` and `<Channel id>`. DAWproject IDs are project-local but should be stable, simple identifiers — leaking our internal IDs into the file is not wrong but means a re-import generates *new* internal IDs (`parseProjectXml.ts:227`) so a Sourdaw export → re-import on the same project changes every clip/track ID. Undo history, recent-projects keys, and any external references break.

**Representative files:**

- `src/modules/Project/useCases/dawProject/serializeProjectXml.ts:100`
- `src/modules/Project/useCases/dawProject/parseProjectXml.ts:226-228`

**Needed:** Either preserve IDs across the round-trip (use the XML id as the parsed id when re-importing the same project), or document that IDs are not stable across export/import.

### 41. DAW Project export hard-codes default tuning on import, ignoring `<Project>` tuning

**Problem:** `mapToProjectData.ts:256-259` always emits the standard 12-TET frequency table on import. Any project-level tuning info in the source DAWproject is silently discarded. Conversely, `serializeProjectXml.ts:241-247` does not write `tuning` either — Sourdaw cannot round-trip its own `projectStore.tuning` through DAWproject.

**Representative files:**

- `src/modules/Project/useCases/dawProject/mapToProjectData.ts:256-259`
- `src/modules/Project/useCases/dawProject/serializeProjectXml.ts`

**Needed:** Either round-trip tuning through a DAWproject extension (custom namespace) or document the loss. As-is, importing a Sourdaw export back into Sourdaw resets the tuning to default.

### 42. DAW Project clip duration fallback `Math.max(endBeat, startBeat + 0.25)` silently expands zero-length clips

**Problem:** `parseProjectXml.ts:185,197,210` `endBeat: Math.max(endBeat, startBeat + 0.25)` — if a source DAW writes a zero-duration clip (placeholder, marker, region anchor), Sourdaw extends it to a quarter beat. This is a "data correction" buried in a parser; users will see unexpected clips on import.

**Representative files:**

- `src/modules/Project/useCases/dawProject/parseProjectXml.ts:185,197,210`

**Needed:** Either drop the clamp (preserve zero-length, downstream code handles it) or surface a per-clip warning. Document the policy.

### 43. `versionControlStore` `lightweight.versions[].snapshot.size` retains size but `data` is empty — restore reports "size 12 KB" but data is gone

**Problem:** When versions are persisted via `persistVersionControlState`, `snapshot.size` is preserved but `snapshot.data` is `''`. The UI may show "Version: 12 KB" yet `restoreVersion` is a no-op. Conflicting signals to users.

**Representative files:**

- `src/modules/Project/stores/versionControlStore.ts:30-35`

**Needed:** Fold into issue #12. If sticking with metadata-only persist short-term, also strip `size` so the UI does not advertise non-existent data.

### 44. `parseProjectXml.ts` picks fallback color from a small hard-coded palette via `index % 8`

**Problem:** `parseProjectXml.ts:31-35` defines an 8-color palette and assigns by track index. Two tracks with the same index modulo 8 share a color. Minor, but the palette is a constant in a parser file; AGENTS.md keeps such constants in `models/` or `services/`.

**Representative files:**

- `src/modules/Project/useCases/dawProject/parseProjectXml.ts:31-35`

**Needed:** Move palette to a shared location; consider deterministic hashing of name → hue to reduce collisions.

### 45. `pickFiles` (browser fallback) emits `<input type="file">` `cancel` event that is not universally supported

**Problem:** `repositories/nativeFileDialog/pickFiles.ts:29-31` listens for `'cancel'` on the input element. Older browsers and some Electron-derived environments do not fire `cancel`; the Promise never resolves and the caller hangs forever. Same pattern in `helpers.ts:37`.

**Representative files:**

- `src/modules/Project/repositories/nativeFileDialog/pickFiles.ts:29-31`
- `src/modules/Project/repositories/nativeFileDialog/helpers.ts:37`

**Needed:** Add a focus/blur fallback that resolves `null` if the user dismisses without selecting (a 1-second delay after `window` regains focus is the conventional pattern).

### 46. `pickFiles` Tauri branch dynamically imports `@tauri-apps/plugin-fs` with a `/* @vite-ignore */` and a `modName` indirection variable to defeat resolver

**Problem:** `repositories/nativeFileDialog/pickFiles.ts:50-53`:
```
const modName = '@tauri-apps/plugin-fs';
const fs = (await import(/* @vite-ignore */ modName)) as { ... };
```
The intent is to prevent Vite from bundling the Tauri plugin in browser builds. The pattern relies on `vite-ignore` comment + non-literal specifier. AGENTS.md "TypeScript — soundness" treats `as` casts on dynamic imports as boundary code (allowed), but a typed import marker would be cleaner. Same trick at `repositories/nativeFileDialog/helpers.ts:51`, `:12`, and `handlers/dawProject/handleExportDawProject.ts:10-11`.

**Representative files:**

- `src/modules/Project/repositories/nativeFileDialog/pickFiles.ts:50-53`
- `src/modules/Project/repositories/nativeFileDialog/helpers.ts:51,12`
- `src/modules/Project/handlers/dawProject/handleExportDawProject.ts:10-11`

**Needed:** Centralise the Tauri plugin-fs dynamic import in one helper; document the vite-ignore reason inline.

### 47. `handleExportDawProject.ts:23-32` uses `as unknown as` to cast `window`

**Problem:**
```
const saveFilePicker = (
    window as unknown as {
        showSaveFilePicker?: (...) => ...
    }
).showSaveFilePicker;
```
AGENTS.md forbids `as unknown as`. The clean fix is a type-augmentation declaration for the global window or a feature-detect helper at `#/utils/`.

**Representative files:**

- `src/modules/Project/handlers/dawProject/handleExportDawProject.ts:23-32`
- `src/modules/Project/repositories/project/downloadProjectFile.ts:9-14` (similar `WindowWithFilePicker` shape)

**Needed:** Define `interface Window { showSaveFilePicker?: ... }` once in a `globals.d.ts` and remove the casts.

### 48. `handleExportDawProject.ts:52` casts `Uint8Array` to `BlobPart`

**Problem:** `new Blob([bytes as BlobPart], ...)`. `Uint8Array` is already a `BlobPart` per the DOM types — the cast hides a TypeScript-narrowing problem upstream rather than fixing it.

**Representative files:**

- `src/modules/Project/handlers/dawProject/handleExportDawProject.ts:52`

**Needed:** Investigate the upstream type and remove the cast.

### 49. `handlers/project/handleNewProject.ts`, `handleSaveProject.ts`, `handleExportProject.ts`, `useCases/getProjectHandlers.ts` are stubs

**Problem:** Four files in the module are stubs containing a single comment ("Failed migration stub retained because this repository forbids file deletion without explicit instruction. Do not import this file."). They are dead source code carrying maintenance cost and confuse readers searching for the project handlers.

**Representative files:**

- `src/modules/Project/handlers/project/handleNewProject.ts`
- `src/modules/Project/handlers/project/handleSaveProject.ts`
- `src/modules/Project/handlers/project/handleExportProject.ts`
- `src/modules/Project/useCases/getProjectHandlers.ts`

**Needed:** Surface this to the user for explicit deletion permission. Until then, document **where** the handlers actually live (Workspace module) so the next reader does not waste time. The current comment says "remains registered by Workspace" but does not link the file path.

### 50. `loadRecentProject.ts:23` rejects `version !== 1` but does not delegate to a shared validator

**Problem:** Yet another duplicated validator (#27 covers three; this is the fourth). Plus the function silently writes the loaded JSON to `writeProjectJson(raw)` (`:47`) — meaning loading a recent project replaces the *current* project's IDB key with the recent project's JSON, but `current` is also where the CRDT path saves derived state. Concurrent CRDT auto-save and recent-project load can interleave.

**Representative files:**

- `src/modules/Project/useCases/recentProjects/loadRecentProject.ts:23,47`

**Needed:** Use the shared validator (issue #2/#27). Drop or coordinate the `writeProjectJson(raw)` write — it muddles the storage model.

### 51. `arrangement/duplicateArrangement.ts:23` deep-clones via `JSON.parse(JSON.stringify(x))`

**Problem:** Same `Map`/`Set`/typed-array trap as `captureSnapshot` (issue #22). For arrangements that may eventually carry typed-array peak caches or audio buffers, this drops them.

**Representative files:**

- `src/modules/Project/useCases/arrangement/duplicateArrangement.ts:23`

**Needed:** A typed `cloneArrangement(snapshot): ArrangementSnapshot` helper that knows the shape.

### 52. `arrangement/createArrangement.ts:15` and `duplicateArrangement.ts:24` use truncated 8-char UUIDs for arrangement IDs

**Problem:** Same as issue #19 but for arrangements: `arr-${crypto.randomUUID().slice(0, 8)}`. With users creating dozens of arrangements over a long project lifetime, collisions are statistically negligible — but the pattern duplicates and there is no reason to truncate.

**Representative files:**

- `src/modules/Project/useCases/arrangement/createArrangement.ts:15`
- `src/modules/Project/useCases/arrangement/duplicateArrangement.ts:24`

**Needed:** Use the full UUID. Centralise ID generation (issue #31).

### 53. `RecentProjectsMenu.handleNewProject` calls `saveProject()` on the *current* project before creating a new one — but `saveProject` is fire-and-forget

**Problem:** `RecentProjectsMenu.tsx:93-97` runs `void saveProject(); newProject(); setOpen(false);`. `saveProject` is async (returns a Promise via `persistCrdtProject`) but `newProject` runs immediately, racing the CRDT persist against the new project's `createCrdtProject`. The save may persist into the new project's CRDT document or be lost.

**Representative files:**

- `src/modules/Project/presentations/views/RecentProjectsMenu.tsx:93-97`
- `src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts:7-29`
- `src/modules/Project/useCases/projectPersistence/newProject.ts:24-26`

**Needed:** Make `saveProject` return a Promise the UI can `await`. The handler should `await saveProject(); newProject();`. Same race in `handleLoad` (`:131-135`) and any other call site.

### 54. Demo `applyPreset` mutates `track.devices` (which is the live store entity)

**Problem:** `demoUtils/applyPreset.ts:6-15` writes to `track.devices` directly. The track passed in is whatever the caller has — typically a `Track` returned from `createTrack`. Mutating the array in place after the track is already in `trackStore` means subscribers may not see the change (no `set` was called) and any later `trackStore.set(...)` from the demo will overwrite the preset-applied devices.

**Representative files:**

- `src/modules/Project/useCases/demoProjects/demoUtils/applyPreset.ts:5-15`

**Needed:** Either return a new `devices` array and have callers explicitly `setTrackDevices`, or document that this is the "build phase" pattern and assume the caller is buffering pre-store.

### 55. `versionControlStore` initial `autoSaveInterval: 5` always — no respect for previous user setting on first load

**Problem:** `models/ProjectVersion.ts:84` `createDefaultState().autoSaveInterval = 5`. If localStorage is empty (first load) or `loadFromStorage` failed, the user gets auto-save every 5 minutes whether they want it or not. The first auto-save fires before the user has a chance to disable it, generating a "Auto-save HH:MM:SS" version permanently in their history (and as established in #12, immediately stripped on persist).

**Representative files:**

- `src/modules/Project/models/ProjectVersion.ts:84`
- `src/modules/Project/stores/versionControlStore.ts:9-19`

**Needed:** Default to `0` (disabled). Make auto-save opt-in. Or fold into issue #12 (snapshots that vanish on reload don't deserve to run unattended).

### 56. `getProjectDirectory` writes a hidden `.sourdaw-projects` marker file as a side effect of *reading* the path

**Problem:** `repositories/nativeProjectFiles/getProjectDirectory.ts:13-20`. Calling a "get" function performs a write. Tests that import this file run the write in CI temp dirs. Errors are swallowed.

**Representative files:**

- `src/modules/Project/repositories/nativeProjectFiles/getProjectDirectory.ts:13-20`

**Needed:** Either rename to `ensureProjectDirectory()` so the side effect is in the name, or check existence first and only create on demand.

### 57. `nativeProjectFiles/saveProjectToFile.ts` serialises bytes via `Array.from(encoder.encode(json))`

**Problem:** Encodes the file as a JSON-array-of-numbers IPC payload. For a project with embedded PCM buffers, this triples the bandwidth (Tauri serialises numbers as full JSON ints). A multi-megabyte project pays that cost.

**Representative files:**

- `src/modules/Project/repositories/nativeProjectFiles/saveProjectToFile.ts:13-15`
- `src/modules/Project/repositories/nativeProjectFiles/loadProjectFromFile.ts:12-14`

**Needed:** Use Tauri's binary IPC transport (`Channel<ArrayBuffer>` or write via fs plugin directly). At minimum, document the cost.

### 58. `parseProjectXml.parseStructure` uses BFS but indexes by global counter, breaking parent-relative ordering

**Problem:** `parseProjectXml.ts:266-278` increments `index` globally across BFS. The fallback color (issue #44) uses this index, so two siblings under different parents may not get adjacent palette entries. Minor but indicates the BFS+global-index pattern is fragile if the index is meaningful.

**Representative files:**

- `src/modules/Project/useCases/dawProject/parseProjectXml.ts:260-280`

**Needed:** Make `index` parent-local if the palette assignment is supposed to vary per sibling group; otherwise document that `index` is globally unique only.

### 59. `projectStore.loading` is redundant with `initialized`

**Problem:** `loading: true` initial value, then re-set to true
on load, then false on completion. The doc comment on
`initialized` says `initialized` is the source of truth for the
LaunchScreen.

**Representative files:**

- `src/modules/Project/stores/projectStore.ts:42-50`
- `src/modules/Project/useCases/projectPersistence/loadProject.ts:18,42`

**Needed:** Pick one flag. If `loading` is needed for an interim
state, document where it gates UI; otherwise remove.

---

## Open questions

- [ ] Is the Automerge CRDT document the single source of truth at
      runtime, with `ProjectData` as a derived export-only schema?
      Or are both expected to round-trip exactly? The answer drives
      the migration strategy (issue #2/#3).
- [ ] Where does the version-control auto-save *timer* live? The
      `autoSaveVersion` use case is just the body; the timer wiring
      was not located in this audit's reads.
- [ ] What is the policy for legacy projects in localStorage that
      exceed quota — do we migrate them on load, or do we ship a
      one-time migration tool?
- [ ] How is the DAW Project (.dawproject) round-trip validated?
      Are there fixtures? (Open — `dawProject/*` not deeply read.)
- [ ] Are demo projects supposed to be replayable / regenerable
      from a single deterministic seed? They use
      `crypto.randomUUID()` heavily; a regen would never produce
      byte-identical output.
- [ ] Should `recentProjects` survive across project deletion?
- [ ] What is the supported browser matrix? (Drives issue #31.)

---

## Risks

- **Silent data loss on the `.sourdaw` round-trip.** Issues #4,
  #6, #7, #8, #9, #29 — a user who exports a project and re-imports
  it loses MIDI, transport, tempo map, time signatures, take
  lanes, sidechain routes, alternate arrangements, mixer and
  master gain semantics, and may lose audio buffer references.
- **Schema upgrade catastrophe.** Issue #2 — the first time
  `ProjectData` adds a v2 field, every existing exported file
  ceases to load with a generic toast and no recovery path.
- **Version control feels like Git but loses everything on
  reload.** Issue #12 — the most disorienting failure mode in
  the module: feature *appears* to work, then silently fails.
- **Unbounded version history.** Issue #17 — auto-save every 5
  minutes for a year produces ~100 000 versions that are
  re-stringified on every store change.
- **Concurrent demo invocation race.** Issue #18 — double-click
  on "Load Demo" puts the project into a mixed state with no
  recovery.
- **Persistence backend split-brain.** Issues #13, #14, #15 —
  two backends, async init, sync reads, dead read paths. The
  failure modes are hard to reproduce and worse to debug.
- **DSP-style ID collisions for note/device IDs.** Issue #19 —
  32-bit truncated UUIDs in demos with thousands of notes.
- **AGENTS.md type-soundness drift.** Issues #4, #20, #23, #24,
  #28 — `as` escapes and divergent shapes for "the same" entity
  normalise the pattern.

---

## Suggested approaches

- **Define a canonical serializer.** Land a single
  `serializeProject(): ProjectData` /
  `deserializeProject(data: ProjectData): void` pair next to the
  CRDT mapper. Both export and import drive through it. All
  existing in-place hydrators delegate. Add a round-trip property
  test (random project state → serialize → deserialize →
  re-serialize → deep-equal).
- **Introduce `MIN_SUPPORTED_VERSION` and a migration table.**
  Even with the current single version, defining the table now
  costs nothing and unblocks the next schema bump. Add a Zod
  schema (or equivalent) for `ProjectData` and call it from one
  place.
- **Pick one `ProjectClip` shape.** The runtime store is the
  authority; align the file model to it. Delete the dead fields.
  Add a compile-time check that `ProjectData.ProjectArrangement.tracks`
  has the same clip shape as `arrangementStore.ProjectTrackStoreState.tracks`.
- **Move VC snapshots to IDB.** The "lightweight" localStorage
  approach is broken — fix the bug now, then design a proper
  size-aware backend. Cap version history.
- **Bracket demos in a loading transaction.** Either gate
  subscribers or build the project state offline and commit in
  one set of `*.set(...)` calls. Add an in-flight Promise guard
  to prevent concurrent demos.
- **AGENTS.md sweep.** A small mechanical pass for
  `as`-escapes (issues #23, #24), `crypto.randomUUID().slice(0, 8)`
  (issue #19), redundant tuning bootstrap (issue #35), `inject`
  consistency (issue #37). All independent and small.

---

## Recommendation

Start with **issue #1 (canonical serializer)** because it is the
keystone — issues #4, #6, #7, #8, #9, #11, #25, #28 collapse
into "make this single mapper correct". The serializer change
takes a spec; write one before coding.

In parallel, fix **issue #12 (VC snapshots stripped on persist)**
as a small standalone PR because it is silently shipping today
and the fix is local to `versionControlStore.ts`. Add a "create
version, simulate reload, restore" test.

Once those land, do a pass for the AGENTS.md type-soundness
findings (issues #23, #24, #28, #32, #34) as a single mechanical
PR.

---

## Resolved

_No issues resolved yet._
