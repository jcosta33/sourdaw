# Webdaw codebase audit (consolidated)

## Goal

Single source of truth for **verified** gaps between the repo and desired architecture: real-time safety, clean layering, collaboration completeness, plugin boundaries, maintainable undo and commands, presentation consistency, export completeness, and sensible interpretation of static analysis (Knip).

**Supersedes (removed 2026-04-11):** `deadcode.md`, `design-system-audit.md`, `export.md`, `open-issues.md`.

**Related (kept separate):** `di-migration-audit.md`, `di-events-errors-audit.md` — migration checklists; re-scan before checkbox work.

**Last updated:** 2026-04-14 — added BrowserAi module incomplete-epics entry after `agent/feature-audio-generation-browser` session. Previous: 2026-04-11 — merged from deadcode/design-system/export/open-issues audits with stale metrics dropped.

---

## Resolved / stable

### Export system — correctness bugs (addressed)

| # | Issue | Where fixed (verify in tree) |
|---|--------|-------------------------------|
| 1 | Missing audio buffers not surfaced on project export | `Project/useCases/projectPersistence/fileIO/exportProjectFile.ts` warns when IDs unresolved |
| 2 | MP3 bitrate fixed | `ExportDialog.tsx` — selectable 96 / 128 / 192 / 320 kbps, persisted |
| 3–4 | FLAC MD5 + real compression | `audioEncoders/flacEncoder.ts` — RFC 1321 MD5 on PCM; FIXED predictors + Rice |
| 5 | Zero-duration clips silent | `offlineRender.ts` — `onWarning` with clip and track names |
| 6 | Base64 encode blocking main thread | `audioBufferCache.ts` — async `float32ToBase64` with yields |
| 7 | Render timeout fixed at 5 min | `offlineRender.ts` — `max(60s, duration × 10)` for mixdown and stems |
| 8 | Tauri save errors swallowed | `downloadProjectFile.ts` — desktop path propagates errors |
| 9 | Waveform cache on buffer re-import | `importBuffers` clears waveform cache before caching |
| 10 | MIDI filename length | `exportMidiFile.ts` — sanitized name `.slice(0, 200)` |

### Accurate export entry points

| Type | Entry | Output |
|------|--------|--------|
| Mixdown | `ExportDialog.tsx` → `renderOffline()` | wav / mp3 / flac |
| Stems | `ExportDialog.tsx` → `exportStems()` | Multiple files (zip on web when needed) |
| Project | `exportProjectFile()` in `fileIO/exportProjectFile.ts` | `.sourdaw` |
| MIDI clip | `downloadMidiFile()` in `MIDI/useCases/exportMidiFile.ts` | `.mid` |

Facade: `Project/useCases/exportActions.ts` re-exports from `AudioEngine/useCases`.

### Historical removals (true dead code — do not resurrect)

Sessions 1–2 removed obsolete modules (e.g. generic SFZ sample player folder, TS modulation routing, legacy `PluginHostNode` / `kneadProcessor`, orphaned subscriber facades, redundant `commitClipDrag`, unused DAW primitives, Knead inspector duplicate). Paths listed in the old `deadcode.md` §1 remain absent.

**Correction vs old audit text:** `src/modules/AiRuntime/transformers/` is **live** (tool parsing, prompt fast paths, mix analysis helpers). What is gone is the **legacy LLM validation** layer (`validateLlmOutput`, `actionSchema`), not the whole transformers tree.

### Platform / DSP cleanup (historical)

Native-only DSP nodes and related TS glue described in prior “RB-1” notes were removed; web + WASM plugins remain. Do not reintroduce `NativeDspNode`-style paths without a new spec.

### Refactor IDs (superseded or largely done)

Examples: god context menus (facades), ExpandedChannelStrip extraction, branch split-brain superseded by session `__branches__` sync, DSO callback undo largely moved to typed undo in `executeDsoEdit`. Treat old numeric IDs as **historical**; this file’s numbered items are the **current** backlog.

---

## Findings

### Knip (`knip.json`)

- **Entry** is only `src/routes/**/*.tsx`; **project** covers `src/**/*` with spec exclusions. Most implementation code is reached via `#/` and deep imports — **unused file counts are not a deletion quota**.
- **`ignore` / `ignoreDependencies`** deliberately silence known false positives and tooling deps (e.g. `@typescript-eslint/eslint-plugin`). Do not remove deps from `package.json` just because Knip complained before `ignoreDependencies` was set.
- **Metrics drift:** raw unused-file counts change every refactor; use Knip output as **hygiene signal**, not a backlog size.

### Incomplete epics (domain present — integration often missing)

Do **not** delete these just because Knip flags them:

| Area | Notes |
|------|--------|
| **Adjustment layers** | Handlers wired via `Arrangement/useCases/getArrangementHandlers.ts` (`createAdjustmentLayer`, …). Timeline visualization for regions still thin. |
| **Node-based plugin view** | `getFinalFeatureHandlers.ts` → `handleToggleNodeView`; no full graph UI. |
| **Ableton Push** | `connectPush` / `disconnectPush` in final handlers; pad/encoder path not fully in the live MIDI dispatch story. |
| **Extensions** | Model + `Extension/services/scripting.ts` + stores; thin product surface. |
| **Toaster MPC extras** | `noteRepeat`, `sixteenLevels`, `soundLocks`, `setMorphPosition` — domain/tests exist; product wiring partial vs PadMixer. |
| **CRDT merge / `.sdaw`** | `MergeResultDialog` + `crdtMerge` + `sdawFileFormat/*` — merge dialog not mounted in app shell; binary format not on main save/load path. |
| **Native project helpers** | `listProjectFiles`, `getProjectDirectory`, `isNativeFileSystemAvailable` exist for future browse/recent UX. |
| **Plugin bridge preset/state** | `getPluginState` / `setPluginState` (and related) present under `Plugin/repositories/pluginBridge/` — not wired end-to-end to preset UI. |
| **DAWproject export** | `handleExportDawProject.ts` is a **notifyUser stub**; implementation directory removed. |
| **Browser AI (BrowserAi module)** | Full domain module at `src/modules/BrowserAi/` implemented (session `agent/feature-audio-generation-browser`): DDSP/TF.js worker, ONNX worker (Kokoro + DiffSinger), OPFS storage, capability detection, model download manager, 9 use cases, 4 stores, 4 event types, 4 views. Wired: `bootstrap.ts` → `initBrowserAi()`, ClipMidiAiSection (4-section inspector panel), StatusBar AI render counter, AiSection in preferences, stale detection via `midiStore.subscribe`. **Pending runtime verification**: DDSP model URLs unconfirmed against live CDN; DiffSinger session key naming unverified against real voicebank downloads; phonemizer replaced with production G2P engine: 794-entry exception dictionary + 77 context-sensitive ordered rewrite rules covering all major English spelling patterns; handles arbitrary OOV words at ~85 % phoneme accuracy; COEP/COOP headers confirmed already set in `vite.config.ts` and `tauri.conf.json` — SharedArrayBuffer is available. |

### Stubs and wiring

- **`bootstrap.ts`** calls `initToasterSubscribers()` at load — Toaster is not fully self-contained at bootstrap boundary yet.

### Extension scripting (frozen — security)

The Extension module has types and a permissions model, but **runtime execution is not sandboxed** (`Extension/services/scripting.ts` — `createDawApi` can reach the full `executeAppAction` surface; manifest permissions are not enforced). Extension-related **palette commands were removed** (`Command/models/commands/miscCommands.ts` notes) until a **Worker-based** sandbox and permission checks exist. Do not expand user-facing surface without that work.

---

## Open issues (actionable)

Priorities are ordered by typical impact; severities are indicative.

### P0 — Real-time / data

1. **Native plugin audio path** — Prefer bounded allocation and optionally zero-copy or bulk IPC. Today: `NativePluginBridgeNode.ts` uses `pendingBlock` and async `tauriInvoke` per block; worklet: `public/audio/worklets/native-plugin-bridge-processor.js`. `tauriInvoke` appears in multiple AudioEngine-adjacent modules (decode, MIDI lifecycle, bridge) — treat “hot path” as the bridge + scheduling cost, not a single file count.

2. **CRDT / IDB crash safety** — Incremental Automerge persistence beyond rAF-batched writes + explicit save; validate kill-browser recovery (`createAutomergeStorage.ts`, `automergeRepository`).

3. **Main-thread sequencing** — Yeast / drum synth scheduling: move critical timing toward worklet or compiled schedule (`Yeast/useCases/yeastSchedulingBridge/*`, `Synth/engine/drumSynthVoices.ts`).

4. **Plugin device state vs document** — Patch/UI state that must survive reload should live in project CRDT (or equivalent), not only in-memory `createStore` maps keyed by `deviceId` (`fermenterStore`, `bacteriaStore`, …).

### P1 — Architecture / commands / collaboration

5. **`RotaryKnob` + MIDI learn** — Knob currently imports `midiLearnStore` and `startMidiLearn` (`src/components/daw/RotaryKnob.tsx`). Refactor needs optional props and **all** call sites updated in one ship.

6. **`createAutomergeStorage` layering** — Infra still hard-imports `automergeRepository` + `getSemanticContext`; inject ports so `infra` does not depend on CRDT modules directly. All stores using the factory must move together.

7. **Central `AppEvents`** — Panel toggles and shell events live in `src/app/registerDependencies.ts` (`AppEvents`); payloads from `Workspace/events/WorkspaceEvents.ts`. There is no `infra/events/appEvents.ts`.

8. **Toaster bootstrap** — Self-init inside Toaster module; then remove `initToasterSubscribers()` from `bootstrap.ts`.

9. **Callback undo (`pushUndoEntry`)** — Still used across many files (timeline, automation, piano roll, mixer, …). Direction: typed `AppAction` / serializable undo and snapshot story.

10. **Volatile state that should be durable** — `sidechainStore` and `cvGate` use `createAutomergeStorage`. **`kneadStore`** and **`actionHistoryStore`** remain memory-only.

11. **Collaboration `latencyMs`** — Remains `null` in `sessionManagement.ts`; no RTT/ping path yet (`CollaborationTypes.ts`).

### P2 — Maintainability / platform

12. **`LocalStorageKeys`** — Legacy brand keys need legal/product sign-off before deletion.

13. **Tauri commands** — Keep commands thin; `src-tauri/src/commands/plugin_gui.rs` exists for GUI lifecycle. Domain logic belongs in crates.

14. **`TrackNode` device branching** — Still uses `deviceType` switches; long-term: registry / `DeviceDescriptor` factory (`TrackNode.ts`).

15. **Rust workspace** — Optional consolidation (e.g. toward fewer crates); current root `Cargo.toml` has **10** members (`daw-core`, `daw-collab`, `daw-engine`, `daw-dsp`, `daw-io`, `daw-wasm-decoder`, `daw-plugin-host`, `proof-chamber`, `scoring`, `src-tauri`). No `dutch-oven` workspace crate.

16. **Bridge “business logic”** — Prefer services in Rust crates over fat command handlers; old `llm.rs`-style paths retired.

17. **Cross-module type re-exports from use cases** — Prefer models living in module `models/` without `export type { … } from '../models/...'` in query bridges (examples drift — grep when refactoring).

18. **Sample library folder scope** — Tauri persisted scope / rehydrate on boot; align with IDB paths (`SampleLibrary/useCases/connectFolder/connectFolder.ts` — `connectFolderTauri` is a nested function).

### P3 — Follow-up

19. **Plugin hosting target** — Long-term: SAB ring / dedicated RT reader; aligns with P0 bridge work.

20. **UI perf — dense canvases** — e.g. `PianoRoll.tsx` uses `useStore` for `midiStore` + `trackStore`; profile and narrow subscriptions.

21. **DI + EventBus + domain errors** — `inject({` is used broadly in production modules now; backlog is **consistent** DI boundaries, `eventBus` over DOM shortcuts, and `createAppError` where appropriate. Re-scan `di-migration-audit.md` / `di-events-errors-audit.md` before using line numbers.

---

## Design system (unresolved)

Must stay consistent with `.agents/specs/look-and-feel.md` (understated shell, tactile surfaces, calm hierarchy, plugin flair where appropriate).

**Priorities:** (1) readouts, meters, utilities (2) plugin rail (3) browser/chooser/card grammar (4) form/control families off raw HTML.

**Open themes (representative paths — design review, not auto-verified):**

1. **DAW header / shell stragglers** — `ArrangementBar.tsx`, `ArrangeView.tsx`, `AutomationBottomPanel.tsx`, `ClipView.tsx`.
2. **Rich context menus** — `PianoRollContextMenu.tsx`, `TrackContextMenu.tsx`, `ClipContextMenu.tsx`, `TimelineEmptyMenu.tsx`.
3. **Duplicated readout/meter clusters** — `StatusBar.tsx`, `Mixer/ExpandedChannelStrip.tsx`, `AiRuntime/.../MixAnalysisSections.tsx`.
4. **Inspector card/well inconsistency** — `ClipInspector.tsx`, `TrackLevelSection.tsx`, `TrackRoutingSection.tsx`, `DeviceInspector.tsx`.
5. **Mixer strip sub-language** — `ExpandedChannelStrip.tsx`, `DeviceChainSection.tsx`, `SendsSection.tsx`, `IOSection.tsx`.
6. **Proto-primitives** — `Workspace/presentations/components/Inspector/*`, sidebar helpers, plugin-local islands — decide promotion vs stay local.

---

## Export — remaining feature gaps

Not bugs; product gaps.

| Gap | Impact |
|-----|--------|
| No bus/submix stem export | Stems are per eligible track only |
| No loudness normalisation | Level follows project gain staging |
| No embedded metadata (ID3/Vorbis) | No title/artist in exported audio files |
| No incremental stem cache | Full re-render each export |
| ZIP packaging | Web path often zips multi-file exports; limited opt-out for “loose” files |

**File roles:** `ExportDialog.tsx`, `exportActions.ts`, `offlineRender.ts`, `wavEncoder.ts` / `mp3Encoder.ts` / `flacEncoder.ts`, `exportProjectFile.ts`, `downloadProjectFile.ts`, `exportMidiFile.ts`, `audioBufferCache.ts`, `ProjectData.ts`.

---

## Collaboration — stable facts

- **`__branches__`:** `DOC_BRANCHES` in `crdtDocumentTypes.ts`; session management seeds and mirrors branch state; `activeBranchId` intentionally not synced per peer.
- **ICE / assets / presence:** Prior collaboration audit items (ICE gathering, asset transfer, presence overlay, stale peer cleanup) are implemented — regressions should be caught by tests and manual session smoke.

## Native bridge — mitigations vs ceiling

- **Mitigated:** Single-flight IPC (`pendingBlock`), float payloads as bytes, no JSON float arrays on the hot path.
- **Ceiling:** Async JS↔Rust round-trip remains scheduler-bound; next step is bulk IPC or shared memory if glitches persist.

---

## Risks if left open

- **P0:** Glitches, data loss on crash, timing drift, broken multi-instance plugin state.
- **P1:** Boundary erosion, non-network-serializable undo, collaboration UX gaps.
- **P2/P3:** Key hygiene, sample-folder scope surprises after Tauri restart, DI inconsistency.

---

## Suggested approaches (non-spec)

- Ship RotaryKnob + `createAutomergeStorage` refactors as **atomic** vertical slices with full caller updates.
- Run **`pnpm typecheck`** and **`pnpm deps:validate`** after cross-module batches (see `AGENTS.md`).
- Treat RT bridge + CRDT persistence as measurable programs (glitch rate, recovery tests).

---

## Verification (merge metadata)

- **2026-04-11:** Content merged from the four superseded audits; **removed** stale Knip counts, stale “false positive” evidence rows that no longer matched imports (e.g. levain preset file usage, GrooveTemplates → Yeast wiring, Sidebar `SectionHeader` vs registry `SectionHeader`), and outdated file names (`batchFeatureHandlers`, `fileIO.ts` monolith, `finalFeatureHandlers.ts` filename-only references).
- **Checks run at merge:** `pnpm typecheck` passed. `pnpm deps:validate` reports warnings (circular dependency warnings — see depcruise output). `pnpm exec knip` still exits non-zero with hundreds of unused-file hits — **expected** given entry graph.

When updating this file after major work: refresh **metrics** (line counts, file counts) only if they drive decisions; prefer **behavioral** descriptions tied to paths.
