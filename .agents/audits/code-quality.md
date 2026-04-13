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

**React + UI bugs:**
§187.1 (Rules of Hooks violation in `GenerativeAiPanel.tsx` — two `useStore` calls hoisted above the early return),
§183.1 / §196.1 (4 `window.confirm()` callers replaced with new async `ConfirmDialog` system: `ConfirmPayload` event, `confirmUser()` helper, `ConfirmDialog` component subscribed to `'ui.confirm'` mounted in AppShell)

**Stale audit entries:** §213.1 (`src/helpers/Store/` — directory doesn't exist), §213.2 (`src/utils/` — heavily referenced, audit was wrong), §16.1 (`handlers/` is already formally documented in AGENTS.md §98–§100), §76.2 (shortcut engine already caches Object.entries + early-tag-name gate), §97.1 (cachedWasmBytes is already a const Map), §113.1 (lastInsertedDeviceId already threaded via DsoExecContext), §117.1 (Drop branch is reachable), §129.1 (zero `export let` remain in src/), §130.1 (resolved by §3.8 exportCancellation holder), §158.1 (already binary-searched in getAutomationValueAtBeat)

**Perf — scheduler / hot paths:** §3.8 (offlineRender 980-line split), §52.1 (resolveGrandBouleEngine compiler-memoized), §62.3 (getFirstToasterDeviceId identity-cache), §69.2 (getFilteredSamples fingerprint memo), §70.3 (WebGPU + PatternBrowser single-pass pitch min/max), §107.5 (updateClip targeted clone — one track instead of full project), §119.1/§119.2 (hydrate cached-incoming-JSON), §138.1 (single-doc CRDT sync fan-out via change listener hint), §142.1 (SessionView per-track pre-computed slot array), §143.1 (buildTimelineRenderModel recording overlay cache with in-place endBeat mutation), §151.1 (usePresence rewrite — ref + version counter, returns `PresenceData[]`), §154.1/§154.2/§154.3 (Toaster MIDI hot path), §155.1 (applyAutomation holder), §156.1 (Jaccard parallel typed arrays), §157.1 (drum noise buffer WeakMap cache), §159.1 (parseMidiFile → Web Worker), §159.2 (MIDI import note IDs → crypto.randomUUID)

**Bugs / cleanup:** §64.2 (Basic Pitch holder), §97.2 (Bacteria per-band telemetry wired end-to-end, Rust → SAB → TS), §109.1 (asset-request Set holder), §139.2 (sample library progress cap), §139.4 (sample id NUL delimiter instead of `:`)

**Non-reactive store reads (batch 1):** §197.1 (`gainEnvelopeStore` Map→`Store<State>`), §201.1 (RoutingGraph sidechain subscription), §202.1 (`vcaGroupStore` bare let→`Store<State>`), §211.1 (NearbyMarkerColorMenu marker subscription), §195.3 (WaveformEditor `trackStore.value?` render-time read), §198.1 (TrackNotesSection `useState(track.notes)` captured once at mount)

**§3.8 `offlineRender.ts` split:** 980-line file with `renderOffline` + `exportStems` + 10 intertwined helpers → `useCases/offlineRender/` subdirectory with one-function-per-file helpers (`constants`, `types`, `yieldToMain`, `hasToasterDevice`, `shouldCreateOfflineStrip`, `createOfflineTrackStrip`, `createOfflineBusStrip`, `schedulePendingSuspends`, `scheduleTrackClips`, `renderWithTimeout`, `exportCancellation` holder, `resolveRenderContext`). Top-level `renderOffline.ts` and `exportStems.ts` are now lean drivers. `deps:validate` baseline moved 447→452 warnings (all pre-existing cross-module `no-circular` warnings newly attributed to the split files — no new architectural violations).

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

#### §147.1 Recording session HMR reset
Mid-recording HMR resets `onRecordingComplete` to `null`; the OPFS
worker completes and silently discards the audio. Fix: save the
callback elsewhere or store the session behind a holder that survives
module replacement.

#### §70.2 `Meyda.sampleRate` / `bufferSize` — global state mutation
Meyda's module-level singleton config is written during analysis calls.
Unavoidable given Meyda's API — document or wrap in a pure helper that
saves/restores.

#### §76.2 `shortcutStore.value` read per keydown
**Resolved** — the shortcut engine already caches Object.entries via a
store subscription and gates on target tag name before any store read.

---

### Bugs — still open (low-impact unless noted)

#### §58.3 `compilerEngine.ts` side-effect module initializer at line 269
The code explicitly documents "side-effect at module load is required
because nothing imports the registry directly from the host side".
Design decision, not a bug — flagged for future revisit if the plugin
loader layer gets a bootstrap entry point.

#### §61.2 `HighEndPluginProcessor` falls back to passthrough `GainNode`
Silent degradation — caller receives `initialized: true` but gets a
no-op GainNode. Throw or log at warn level so consumers know the
worklet isn't registered.

#### §114.3 Branch `JSON.stringify` double-serialization
CRDT branch equality check serialises twice. Use a content hash once.

#### §117.1 Unreachable `Drop` classification branch
**Reviewed — stale.** Both the Drop branch (`isHigh && progress > 0.5`)
and the Chorus fallthrough (`isHigh`) are reachable given non-high and
non-last segments; the classifier is correct.

#### §104.1 `restoreLibrary` passthrough
**Decided against.** Matches the §3.3 / §19.1 rationale — the useCase
layer is load-bearing architecture regardless of whether the current
repository implementation happens to be a pure passthrough.

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
§186.1 (`stop()` doesn't stop oscillator),
§188.1 (stale closure in finally block),
§209.1 / §212.1 (`useStore(store, store.value!)` non-null assertion anti-pattern)

These appendix findings together represent roughly 40–60 additional
items. A fresh session can grind through them — most are 1-line canvas
fixes or the same holder-object pattern applied elsewhere in this file.

### Priority for the next session

All items 1–5 from the previous priority list landed this session
(§3.8, §16.1, §209.1/§212.1, §174.1, §178.1). What's left on the bug
and perf tracks is genuinely low-impact (§61.2 silent passthrough
fallback, §114.3 double-serialise branch equality, §147.1 HMR recording
reset, §70.2 Meyda global) — see the "Still open" sections above.

If picking where to resume, the high-value work is now in the
spec-level items (§10.1 infra→domain dependency, §21.1 MIDI→Arrangement
cross-store write, §8.1/§8.2 store business logic cleanup, §20.1
deviceLayoutRegistry split) and the feature-decision items (§63.1 dead
modulation system, §124.1 mock pitch data, §131.1 ONNX fake fallback,
§127.2 silent cloud LLM degrade).

The §160–§213 canvas perf cluster is still outstanding and remains a
good candidate for a parallel-agent sweep — each file is independent,
and the patterns are well-established by the work shipped this session.
