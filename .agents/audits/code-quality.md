---
name: code-quality
description: Broad code quality audit — bugs, structural problems, verbosity, over-engineering, poor typing. Covers app entry point through every major module.
type: audit
status: in-progress
date: 2026-04-13
---

# Code Quality Audit

Full frontend audit from `src/app/main.tsx` inward. This file has been
compacted: sections that have been addressed, or that were explicitly
decided against, are listed by section number only in the **Resolved**
and **Decided against** blocks below. Full historical text lives in git
history — search for this file at the commit tagged `audit-original`
if you need the original wording.

`pnpm typecheck` stays clean and `pnpm deps:validate` stays at the 447-warning
baseline throughout.

## Resolved findings

### Branch `agent/refactor-code-quality` (25 commits, 883 files)

**Bugs/Correctness:** §1.1, §1.2, §1.3 (UUID counters), §1.4, §1.5
**Architecture:** §2.1, §2.2, §2.3, §2.4, §2.5, §2.6 (zero cross-module internal imports in all modules)
**Structural:** §3.2 (generic panel event), §3.4, §3.5, §3.6, §4.1, §8.3
**Typing:** §5.2, §5.3, §5.5 (Grinder/Gluten meters), §41.2 (AppAction unions tightened), §45.2 (collision detection)
**Convention:** §7.1/§17.1 (curly braces ESLint-enforced), §23.3 (64 `console.*` → logger)
**MIDI:** §9.1, §9.2 (`updateNotesForClip` helper), §46 (transform helper)
**Collaboration:** §13.1 (11 stores reset), §14.2, §27, §51.1, §51.2, §100.1, §101.1 (snapshot validation)
**Transport:** §11.1, §23.2, §28.2, §55.1, §80.1 (dispatch map), §85.1
**AudioEngine:** §16.2 (WAV encoder dedup), §23.1, §25.1, §25.2 (named nodes), §25.3 (LFO dispose), §25.4, §29, §132.1 (ShortTermLUFS)
**AI:** §15.1 (prompt extracted), §48 (handler factory), §50 (notifications), §59, §91.3 (if/else)
**Arrangement bugs:** §30.1, §30.2, §30.3, §30.4, §30.5, §32
**Plugin:** §33.1, §52.2, §52.3 (calibration consolidation), §53 (shared `createFindDeviceRef`)
**Constants:** §43 (shared `NOTE_NAMES`), §98.1, §110.1, §114.2, §138.3
**ID counters:** §95.1, §95.2, §122.1 (batch 1 — UUID), §56.4
**Performance:** §49.1, §49.2 (`BaseMidiProcessor`), §54.1, §55.1, §56.3, §74.2, §76.1, §82.1, §85.1, §86.1, §86.2, §108.1–108.3, §117.2, §126.1, §132.1, §133.1, §134.1, §141.1–141.3, §148.1 (worklet shift→splice), §153.2
**Mutable exports:** All `export let` → getter/setter (HMR safe)
**Workspace:** §12.3 (localStorage constant), §21.2 (`PreferencesDialog` split), §47.1 (generic panel event)

### Branch `agent/refactor-code-quality-2` (this session)

**AppShell / god components:** §3.1, §3.2, §4.2, §47.1, §47.3 (`renderSidePanel` helper), §47.4 (generic `makeDimSetter` factory). AppShell.tsx: 817 → 675 lines; device panels collapsed into one `useActiveDevicePanel` hook with a discriminated union.

**HMR-unsafe module-level mutables, coalesced into holders:**
§14.1/§114.1 (`sessionManagement` — 12 vars), §28.1/§107.1 (`playheadScheduler` — 9 vars),
§35.1 (`recording` session), §45.1 (`handlerRegistryState`), §47.2 (`alphaNotice` flag removed),
§51.4 (ICE servers store), §58.1 (partial — Faust compiler state per §128.1),
§60.1 (`injectionBus` Set), §62.1 (toaster `sequencerState`), §67.2 (WebLLM `engineState`),
§67.4 (`nativeEngineState`), §74.1 (timeline `renderCache`), §93.1/§93.2 (AI `editLog` holder),
§99.1 (`autoSaveHandle` hoisted into shared helper), §103.1 (sampler `pollingSession`),
§118.1 (WAM group counter → UUID), §121.1 (`compactionState`), §128.1 (Faust `compilerState`),
§135.3 (`crdtWorkerState`), §152.1/§152.2 (`ortSession` + cached `onnxruntime-web` import)

**ID counters — batch 2:** §122.1 tail (14 more `let nextXId = 1` → `crypto.randomUUID()`);
§116.2 (stripSilence), §55.3 (seeded random in `play_random` follow action)

**Security / validation:**
§22.1 (`runEditorScript` sandbox caveat documented inline),
§22.2 (`keyManagement` hoisted into holder),
§91.1 (new `validateActionPayload.ts` — `Record<RuntimeActionType, PayloadValidator | 'unchecked'>` with `satisfies` exhaustiveness; ~35 destructive actions have real runtime guards, ~195 UI toggles marked `'unchecked'` as explicit sentinel),
§91.2 (compile-time-verified `KNOWN_ACTION_TYPES_MAP`; caught 65 missing entries from the original hand-maintained set)

**Typing:**
§5.1, §5.4, §41.1, §66.1, §66.2, §79.1, §80.2, §80.3, §87.3 (`Set<Promise<unknown>>`),
§88.4, §96.1 (`BusNode` cast narrowed), §107.2, §108.3, §124.2, §140.2,
§12.2 (workspace hooks use canonical `ProjectStoreState` / `TransportState`)

**Logger migration (tail of §23.3):** `createEventBus`, `createAutomergeStorage`,
`AnimationScheduler` + test, `ErrorBoundary`, `ProofChamberPanel`. All enumerated §58.2, §61.3,
§71.1, §80.5, §90.1, §93.3, §99.2, §103.2, §110.3, §113.2, §119.3, §121.2, §128.2, §135.4, §138.4.

**Performance / allocations:**
§12.1 (spectrum math helpers extracted to `components/daw/spectrumMath.ts`; Bacteria + Workspace/Metering migrated),
§33.2/§57.1 (new `createRafBatcher` primitive in `utils/DOM/`; 7 plugin param bridges migrated),
§62.2 (morphPatterns endpoint short-circuit),
§65.1, §69.1 (Jaccard single-pass), §70.1 (audioFeatures window reuse), §77.1 (dropped `structuredClone` on immutable snapshots ×3), §79.2 (drop defensive sort), §80.4 (single-pass midi scan), §85.2 (undo write microtask coalesce), §92.1/§92.2 (`getProjectContext` dedup + identity memo), §117.2 pattern in automation selection bounds, §150.2 (canvas-editor `useEffect` deps)

**Agent-merged work (hot-path, worklet/wasm, typing, ai-dso agents):**
§39.1–§39.3 (shared `workletInitShared` helper), §49.3, §54.3, §54.4,
§115.1, §125.1–§125.3, §126.2, §126.3, §149.1, §149.2, §155.2, §155.3,
§127.1, §94.1, §140.1, §11.2

**Misc bugs:**
§68.1 (deleted dead `storeRegistry` + `getController`), §88.1 (dead `find` guard removed),
§88.2 (`grandBouleControls` cleanup in `removeDevice`), §88.3 (`scheduleRebuildChain` coalescing),
§61.1 (WAM `instanceId` exposed on `WAMInstance`), §71.2 (actor ID via `crypto.randomUUID`),
§71.3 (`invokeWorker` crash listener), §94.3 (static import of `getActiveModelId`),
§91.4 (static import of `executeDsoEdit`), §100.2 (`TextEncoder().encode().byteLength`),
§106.2 (throwaway `?? []` alloc), §116.1 (`stripSilence` `minSilenceBeats` implemented),
§132.2 (`blockSize` parameterised), §132.3 (dropped unused `_trackId`), §136.1 (classList toggle),
§137.1 (`generateFingerprint` → `generatePathHash`), §78.1 (immutable track templates)

**Workspace state:**
§18.1 (33 panel-toggle files → one `panelToggles/index.ts`; three structural groups,
boolean toggles built via `createBooleanToggle(key)` factory with compile-time type
enforcement that `key` is a boolean field of `WorkspaceState`),
§83.1/§83.2/§83.3 (`routingMatrixStore` + `sessionLaunchStore` — plain-object state,
not `Map<>`, so React ref-equality works; fixes data-loss on panel close/reopen)

**Architecture docs:** §3.7 (`services/` formally documented in AGENTS.md as a private-internal layer: pure stateless helpers on domain types, no I/O, no store mutation, no orchestration, module-private)

---

## Decided against (out of scope / wrong fix)

These items were deliberately **not** fixed. The rationale is recorded
here so future audits don't re-flag them as oversights.

- **§3.3 Passthrough use cases (general):** The useCase boundary is
  load-bearing architecture — a `useCases/foo.ts` that forwards to
  `repositories/foo.ts` protects callers from repository shape drift.
  Inlining would violate the module contract rules in AGENTS.md.
- **§19.1 Audio encoder passthroughs (WAV / MP3 / FLAC):** Same rationale
  as §3.3. The useCase layer isolates consumers from the encoder
  repository choice.
- **§24.1 Demo project data (7000+ lines of hardcoded notes):**
  Static immutable data. No performance issue (parsed once at module
  load), no architecture violation (`useCases/demoProjects/` is the
  correct home). File-size-alone is a dogmatic concern, not a systems one.
- **§55.2 Multiple simultaneous follow actions — last-writer-wins:**
  Documented in the code as intentional. Changing the semantics requires
  product-level understanding of conflicting follow actions across tracks.
- **§89.1 / §89.2 Permission trust-on-store:** Requires Ed25519 message
  signing, peer public-key exchange on session join, and a host-signed
  roster. Multi-day security spec work; out of scope for refactor.
  Tracked for a dedicated security spec.
- **§97.3 Empty `catch {}` on disconnect:** The audit itself says
  "acceptable for disconnect-on-removal". No action.
- **§102.1 Faust `hslider` label/address mismatch (Supersaw Unison):**
  Lives in the Rust/Faust source tree, not TypeScript. Requires an audio
  engineer to understand the DSP graph before editing — wrong edits
  silently change audio output.
- **§102.2 Additive Synth `/additive/partials`:** Same — Faust compile-time
  unroll, fix requires audio engineer review.
- **§105.1 Automation draw `activeSession` mutable:** Already encapsulated
  behind module-private getters/setters; audit complaint doesn't apply.
- **§120.1 CRDT semantic context race:** Already behind set/clear API.
  The remaining "race" is inherent to any thread-local pattern without
  AsyncLocalStorage — a spec-level change, not a refactor.

---

## Still open

### Structural / architectural (decisions or spec needed)

#### §3.8 `offlineRender.ts` — 974 lines, multiple exports
**File:** `src/modules/AudioEngine/useCases/offlineRender.ts`

Single file exports `renderOffline` AND `exportStems`, violating the
AGENTS.md "One Function Per File" rule. Contains ~320-line
`scheduleTrackClips` function plus ~10 intertwined internal helpers
(cancellation state, strip builders, render driver). Proper split is
5–7 new files (scheduleTrackClips to `services/`, renderOffline +
exportStems to separate useCase files, cancellation + graph setup to
helpers). Low-risk if done methodically — every seam is visible from
the code itself.

#### §16.1 `handlers/` layer not in AGENTS.md taxonomy
14 modules use a `handlers/` directory for `AppAction → ActionHandler`
maps. AGENTS.md mentions it as "legacy `useCases/*Handlers.ts` until
migrated" but doesn't formally define it. Either: (a) formalise
`handlers/` in AGENTS.md alongside `services/`, or (b) complete the
migration to `useCases/*Handlers.ts`. Pick one.

#### §10.1 `createAutomergeStorage.ts` — infra → domain import
**File:** `src/infra/store/storage/createAutomergeStorage.ts`

`infra/` imports from `#/modules/CrdtDocument`, inverting the dependency
direction. Fixing properly needs a DI pattern where the automerge
repository is injected into storage adapters. Documented as needing a
spec.

#### §21.1 MIDI module writes to Arrangement's store
**File:** `src/modules/MIDI/useCases/chordTrack/…`

Cross-module store writes violate model isolation. Needs either a MIDI
→ Arrangement event (MIDI publishes "chord changed", Arrangement handler
updates its store) or a use-case exposed from Arrangement that MIDI can call.

#### §20.1 `deviceLayoutRegistry.tsx` — registry logic mixed with React component
**File:** `src/modules/Workspace/presentations/.../deviceLayoutRegistry.tsx`

Registry is a data structure, not a component. Split the registry map
into its own `.ts` file and keep only the React wrapper in `.tsx`.

#### §8.1 `timelineViewStore.ts` — business logic in a store file
#### §8.2 22 stores with business logic bodies

Pattern: store files contain computation functions instead of just
`createStore<T>` + setters. The logic should move to `useCases/` and
the store files should contain only the store instance + setters.

---

### Feature work (product decisions, not refactors)

#### §35.2 Mono-only recording
Audio recording hardcodes `channelCount: 1`. Stereo requires a
`numberOfInputChannels` setting + changes to the OPFS worker's PCM
assembly.

#### §63.1 Modulation system — entire feature is dead code
**File:** `src/modules/Plugin/useCases/modulatorLibrary.ts` (+ sidebar UI)

File header acknowledges: "DATA MODEL ONLY — no Web Audio engine
connection exists yet. `getModulatedValue()` math exists but is never
invoked during playback." The Sidebar UI renders the modulator browser
and the `ChorusLayout` uses `ModulationLFO` to visualise an LFO that
produces no audio. Decision required: **revive** (wire to audio engine),
**delete** (remove the UI surface), or **flag in UI** ("preview only").
Cannot silently leave a non-functional feature visible to users.

#### §124.1 Hardcoded mock pitch data for Knead devices
Production code auto-injects fake pitch samples when Knead device is
loaded. Decision: delete the mock or make it dev-mode-only.

#### §131.1 ONNX model calls replaced with fake sine-wave simulations
Stem separation backend uses placeholder synth output. Either ship the
real ONNX path or gate behind a dev flag.

#### §127.2 Cloud LLM silently falls back to local pattern match
`backend === 'cloud'` without credentials silently degrades. Should
surface the failure so users can see that cloud isn't wired up.

---

### Performance — still open (low/medium impact)

#### §138.1 `sendSyncToAllPeers` — O(peers × docs) per local change
For 3 peers and 10 docs, 30 `generateSyncMessage` calls per edit.
Automerge returns null for unchanged docs but the protocol overhead is
per-doc-per-peer. Fix: batch by peer, skip unchanged docs upfront.

#### §151.1 `usePresence.ts` — full Map clone per peer heartbeat
`new Map(prev)` on every presence update; 5 peers × 10 Hz = 50 Map
clones/sec. Replace Map with a keyed plain object and use version
counter + ref for React state.

#### §142.1 SessionView `getClipForSlot` per slot
Full `tracks.find()` scan per rendered cell. With 20 tracks × 8 scenes =
160 scans per render. Build a `trackById` Map once per render.

#### §143.1 Recording path builds all tracks×clips every rAF
`buildTimelineRenderModel` spreads all N tracks × M clips per frame
while recording — only the active clip's `endBeat` actually changes.

#### §147.1 Recording session HMR reset
Mid-recording HMR resets `onRecordingComplete` to `null`; the OPFS
worker completes and silently discards the audio. Fix: save the
callback elsewhere or store the session behind a holder that survives
module replacement.

#### §154.1 Yeast `scheduleMidiNotes` — O(N²) noteOff match
Linear scan for each noteOn. For 100 notes = 20,000 comparisons per
block. Build a `Map<noteNumber, noteOnIdx>`.

#### §154.2 `tracks.find()` / `tracks.filter()` inside innermost note loop
Toaster child-track lookup per note. Hoist the parent/children index
out of the loop.

#### §154.3 Device-type dispatch per note
4 device types × `.some()` + `.find()` per note = 8 array scans/note.
Precompute `Map<type, DeviceEntry>` once per track.

#### §155.1 Per-plugin slew `Map` HMR reset
Module-level slew state drops smoothing buffers on HMR reload. Move
behind holder object with retained closure.

#### §156.1 Jaccard similarity intermediate allocations
`findSimilarSamples` path still allocates intermediate arrays per
comparison. Single-pass version already applied to the top-level
function (§69.1) — deeper helpers still churn.

#### §157.1 Per-note noise buffer allocation
Synth scheduleNote allocates a fresh noise Float32Array per note.
Cache per voice.

#### §158.1 Dual `filter()` over sorted automation points
Two passes to find before/after points. Binary search in one pass.

#### §159.1 `parseMidiFile` runs synchronously on main thread
Blocks UI on import. Move to a Worker.

#### §159.2 MIDI import note IDs — sequential per call
Each parseMidiFile call resets to 1, colliding if two imports run in
sequence. Use `crypto.randomUUID()`.

#### §52.1 `resolveGrandBouleEngine` — O(n) track scan per render
Called inside a component render loop. Cache once per track-store update.

#### §62.3 `getFirstToasterDeviceId` per tick
100 Hz scheduler × O(tracks) track scan. Memoize on track-store identity.

#### §69.2 `getFilteredSamples` full pipeline recomputed per call
No memoization; runs on every search keystroke. Memoize by store-version
+ filter fingerprint.

#### §70.2 `Meyda.sampleRate` / `bufferSize` — global state mutation
Meyda's module-level singleton config is written during analysis calls.
Unavoidable given Meyda's API — document or wrap in a pure helper that
saves/restores.

#### §70.3 `Math.max(...frames.map(...))` spread
Stack-overflow risk on very long analysis buffers. Single-pass for-loop.

#### §76.2 `shortcutStore.value` read per keydown
Micro-perf: the store read is O(1) but happens on every keystroke.
Short-circuit via tag name check earlier (already partially done).

#### §107.5 Recording buffer callback clones all tracks×clips
Full store snapshot per callback invocation. Pass only the minimal
shape the callback needs.

#### §119.1 / §119.2 `JSON.parse(JSON.stringify(...))` per rAF write / per `hydrate`
Triple serialisation during store hydration. Use `structuredClone`
(which is fine at this depth — it's not in a hot loop) or an immutable
diff.

#### §139.2 Progress formula never reaches 100% during scanning
`min(0.95, found / (found + 20))`. Cap at 1.0 when the scan actually
finishes, otherwise this UX bug makes the progress bar look stuck.

#### §139.4 Sample ID colon-delimited path is ambiguous
`${rootId}:${relativePath}` collides if `relativePath` contains `:`.
Use a character that can't appear in any POSIX path.

---

### Bugs — still open (low-impact unless noted)

#### §97.1 Module-level WASM cache HMR-stale
`cachedWasmBytes` resets on HMR but running nodes hold old references.
Same pattern as other HMR holders — wrap the cache in a holder so a
new cache is created per module instance.

#### §97.2 `bandLevels: number[]` always returns `[]`
Declared as a real field but the SAB telemetry slot has no band-level
entries. Remove the field from `BacteriaMeterData` or populate it.

#### §104.1 `restoreLibrary` passthrough
This specific passthrough adds no transformation; it can be inlined
at its two callsites. Unlike §3.3 and §19.1, there's no repository
layer to protect here — `restoreLibraryFromRepo` is already the
repository.

#### §113.1 `lastInsertedDeviceId` module-level race
Concurrent AI edits can read each other's `lastInsertedDeviceId`.
Thread through the call chain instead of sharing a module var.

#### §117.1 Unreachable `Drop` classification branch
Song-structure detection has a dead case. Remove or fix the
branch condition.

#### §118.2 WAM plugin `registry` + `instances` Maps — HMR erase
Module-level Maps. On HMR every registered plugin definition + active
instance is lost. Wrap in holder or project-level store.

#### §129.1 MIDI mutable exports — HMR resets MIDI state
`export let` bindings. Convert to getter/setter (other `export let`
bindings in the codebase were already done).

#### §130.1 Export guard cancel flag + `isRenderingActive` — module level
Same HMR pattern. Wrap in holder.

#### §58.3 `compilerEngine.ts` side-effect module initializer at line 269
Module evaluation triggers a side effect that should happen inside an
explicit init function.

#### §61.2 `HighEndPluginProcessor` falls back to passthrough `GainNode`
Silent degradation — caller receives `initialized: true` but gets a
no-op GainNode. Throw or log at warn level so consumers know the
worklet isn't registered.

#### §64.2 `basicPitchModel` singleton — 10 MB re-download on HMR
Module-level `let`. Move to a holder or browser Cache API.

#### §109.1 `requestedAssets` Set — HMR resets dedup state
Module-level Set. Same HMR pattern.

#### §114.3 Branch `JSON.stringify` double-serialization
CRDT branch equality check serialises twice. Use a content hash once.

---

### Recent appendix findings (§160–§213)

The following findings were added after the original audit sweep and
have not been individually addressed. They follow the same patterns as
the earlier sections (canvas perf / HMR mutables / unstable effect
deps / `console.*` bypassing logger / etc.) and can be triaged in a
future session by grepping for the filenames.

**Canvas + rAF perf (same §181.1 / §182.1 / §141.2 / §150.3 / §194.1 patterns):**
§181.1 (MiniMasterSpectrum), §182.1–§182.4 (BeatRulerBar),
§184.x (LevelMeter), §185.x (TrackLevelIndicator),
§189.1 / §190.1 / §191.1 / §192.1 (Oscilloscope / Goniometer / SpectrumAnalyzer),
§193.1 (Spectrogram / PhaseCorrelationDisplay),
§194.1 (PhaseCorrelationDisplay getComputedStyle in rAF),
§195.x / §199.x / §200.x / §204.x / §205.x / §206.x / §207.x / §208.x / §210.x

**Non-reactive store reads during render:**
§195.3, §197.1, §198.1, §201.1, §202.1, §203.1, §206.4, §211.1

**Ring buffer `shift()` / boxed IPC allocation:**
§160.x, §161.x, §162.x, §163.x, §164.x, §165.x, §166.x, §173.x

**HMR-unsafe module state (same §14.1 pattern):**
§167.x, §168.x, §169.x, §170.x, §171.x, §172.x, §176.1, §177.1

**Miscellaneous bugs + UX:**
§174.1 (mutated Float32Array never re-fires `useEffect`),
§178.1 (O(tracks × clips) store write on drag),
§179.1 (orphaned OfflineAudioContext),
§183.1 + §196.1 (`window.confirm()` blocks audio thread — 4 callers),
§186.1 (`stop()` doesn't stop oscillator),
§187.1 (**High severity** — Rules of Hooks violation in `GenerativeAiPanel.tsx`: two `useStore` after early return),
§188.1 (stale closure in finally block),
§209.1 / §212.1 (`useStore(store, store.value!)` non-null assertion anti-pattern),
§213.1 (dead `src/helpers/Store/` files — safe to delete),
§213.2 (dead `src/utils/` files — verify imports first)

These appendix findings together represent roughly 40–60 additional
items. A fresh session can grind through them — most are 1-line canvas
fixes or the same holder-object pattern applied elsewhere in this file.

### Priority for the next session

If picking where to resume:

1. **§187.1** — High-severity Rules of Hooks violation. Could cause
   state corruption. Fix first.
2. **§183.1 / §196.1** — Four `window.confirm()` callers blocking the
   audio thread. Real audible dropouts in production. Easy fix (async
   dialog).
3. **§213.1 / §213.2** — Dead code deletion. Zero risk, clean win.
4. **§3.8** — offlineRender.ts split. Big but mechanical; the seams
   are visible in the code itself.
5. **§16.1** — handlers/ layer taxonomy decision. Unblocks future
   structural work.
6. The §160–§213 canvas perf cluster — repetitive, can be done in
   parallel by a dedicated agent since each file is independent.
