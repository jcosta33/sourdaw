# Sourdaw — Consolidated open issues

## Goal

Track verified gaps between the current codebase and desired architecture: real-time safety, clean layering, collaboration completeness, plugin/RT boundaries, and maintainable undo/command flows.

**Supersedes (merged here; source files deleted 2026-04-07):**  
`.agents/audits/collaboration/open-issues.md`, `.agents/audits/global/open-issues.md`, `.agents/audits/global/refactor-audit.md`, `.agents/audits/plugins/open-issues.md`.

**Related (kept separate — process checklists, not duplicate open-issue lists):**  
`di-migration-audit.md`, `di-events-errors-audit.md` — summarized as item 22; full line-level checklists must be re-verified before use.

**Last verified:** 2026-04-07 — **codebase pass:** `pnpm deps:validate` (0 violations, 1553 modules) and `pnpm typecheck` (pass). **Second pass (same day):** spot-read stores + refs for items 4, 10, 19, 21 — see verification table rows marked *Recheck*.

---

## Executive summary (from broad refactor audit)

The stack (React, Web Audio, Automerge, Tauri) is ambitious; seams show as RT boundary risk, command-pattern bypasses, and store ownership drift.

**Top refactor priorities (historical list — many partially addressed; see Open issues + Appendices):**

1. Reduce async IPC / allocation pressure in the native plugin audio bridge (see RT-5 appendix).
2. **Plugin UI state vs document** — many stores are already `Record<deviceId>` (multi-instance in-session, e.g. Fermenter, Bacteria). Remaining gap: **full CRDT/project persistence** for device UI/patch state where still only in-memory — not always a literal “singleton” bug anymore.
3. Replace anonymous `pushUndoEntry` closures with typed `AppAction` / serializable undo (partial progress; see AUDIT-006).
4. Move Yeast / Synth timing-critical scheduling off the main thread where still applicable.
5. Continuous / incremental CRDT persistence vs crash-only-in-memory risk.
6. `TrackNode` — registry vs god-switch `deviceType` branching.
7. Optional consolidation of Rust workspace layout toward the documented five-crate mental model.
8. Context menus / channel strip — **AUDIT-001 / AUDIT-022 resolved** (facades / use cases); regression possible if files regrow.

**Additional observations:**

- Heavy `useStore` use in canvas surfaces — **tracked as item 21** (UI-PERF).
- Waveform / main audio buffer caches — **bounded LRU** in `audioBufferCache.ts`; original “unbounded” audit line is outdated unless a new growth path appears.

**Backend inventory note:** Root `Cargo.toml` workspace members are `daw-core`, `daw-collab`, `daw-engine`, `daw-dsp`, `daw-io`, `daw-wasm-decoder`, `daw-plugin-host`, `proof-chamber`, `scoring`, and `src-tauri` (**10** members). Older audits mentioning a `dutch-oven` workspace crate or “`daw-llm`” as a member are stale — verify against current `Cargo.toml` when planning backend work.

---

## Verification summary

| Claim                                                          | Result                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collaboration `PeerInfo.latencyMs` never set                   | **Valid** — `grep latencyMs` → only `latencyMs: null` assignments in `sessionManagement.ts` (3 sites).                                                                                                                                                                                                                                                                     |
| `RotaryKnob` imports MIDI learn store + `startMidiLearn`       | **Valid** — `RotaryKnob.tsx` still imports `midiLearnStore` + `startMidiLearn`. **47** presentation files import `RotaryKnob` (grep `from …RotaryKnob`), not “~42”.                                                                                                                                                                                                        |
| Automerge storage adapter imports Crdt modules                 | **Valid** — `createAutomergeStorage.ts` imports `DocId`, `automergeRepository`, `getSemanticContext`. **11** store files call `createAutomergeStorage` (+ definition file). `depcruise` does not flag it.                                                                                                                                                                  |
| Central event map for panel toggles                            | **Valid but path changed** — there is **no** `src/infra/events/appEvents.ts`. `AppEvents` + `eventBus` live in `src/app/registerDependencies.ts`; `panel.showFermenter`, `panel.showToaster`, … are typed there. Payload types come from `Workspace/events/WorkspaceEvents`. PL-3 is still “central registry owns every device panel key” — update refs when editing code. |
| `bootstrap.ts` calls Toaster subscriber init                   | **Valid** — `initToasterSubscribers()` imported and invoked at module load in `bootstrap.ts`.                                                                                                                                                                                                                                                                              |
| `LocalStorageKeys` non-DAW keys                                | **Not re-counted in this pass** — file at `src/infra/store/storage/LocalStorageKeys.ts`; spot-check before bulk delete.                                                                                                                                                                                                                                                    |
| Branch topology vs Automerge (collab sessions)                 | **Valid** — `DOC_BRANCHES = '__branches__'` in `automergeSync.ts` + `sessionManagement.ts` (grep 2026-04-07).                                                                                                                                                                                                                                                              |
| Native plugin bridge                                           | **Mitigated** — `NativePluginBridgeNode.ts`: `pendingBlock`, `process_plugin_audio` + `set_plugin_parameter` use `tauriInvoke`; payload uses bytes for audio. **AudioEngine** `tauriInvoke` grep: 3 files (bridge, web MIDI lifecycle, tauri audio decode) — not “23” on the hot path; old audit number is stale.                                                          |
| Rust workspace                                                 | **10 members** in root `Cargo.toml` — matches executive summary list.                                                                                                                                                                                                                                                                                                      |
| AUDIT-017 (DSO undo)                                           | **Grep** — no `createCallbackUndoEntry` / `pushUndoEntry` under `src/modules/AiRuntime/useCases/dsoEditor/`.                                                                                                                                                                                                                                                               |
| `pushUndoEntry` still used                                     | **Valid** — **16** files reference `pushUndoEntry` besides `Command/useCases/pushUndoEntry.ts` (automation, arrangement timeline, piano roll, mixer, etc.).                                                                                                                                                                                                                |
| AUDIT-001 / AUDIT-022                                          | **Resolved** per prior convergence notes; re-verify if context menus / channel strip regrow.                                                                                                                                                                                                                                                                               |
| Refactor audit §4.5 backlog                                    | **Partially stale** — see prior note on resolved IDs / AUDIT-015.                                                                                                                                                                                                                                                                                                          |
| Historic plugin open-issues doc (deleted)                      | Was stale under DONE — queue mitigated in code; ceiling = items **1** + **20**.                                                                                                                                                                                                                                                                                            |
| Waveform cache                                                 | **Bounded** — `MAX_AUDIO_BUFFER_ENTRIES` / `MAX_WAVEFORM_CACHE_ENTRIES` in `audioBufferCache.ts`.                                                                                                                                                                                                                                                                          |
| `offlineRender.ts` size                                        | **`wc -l` → 901 lines** — refactor audit “~533” is outdated.                                                                                                                                                                                                                                                                                                               |
| Cross-module `export type { … } from '../models'` in use cases | **Grep** finds at least: `audioEngineQueries.ts`, `loadToasterKit.ts`, `crdtDocumentTypes.ts`, `workspaceQueries.ts`, `aiRuntimeQueries.ts`, `bacteriaParamBridge.ts` — `midi.ts` not in list (examples in item 18 updated).                                                                                                                                               |
| *Recheck* · Item 10 (volatile routing/CV)                      | **Partially outdated** — `sidechainStore` and `cvGateStore` use **`createAutomergeStorage`** (`sidechainRoutes`, `cvGate` keys on root doc). Still **legit** for **`kneadStore`** (no storage) and **`actionHistoryStore`** (no storage).                                                                                                                                   |
| *Recheck* · Item 4 (singleton stores)                            | **Nuance** — `fermenterStore` / `bacteriaStore` are **`Record<deviceId>`**, not single global rows. Item stays as **document persistence / CRDT** alignment for plugin state, not “two Fermenters clobber one store” in the old sense.                                                                                                                                      |
| *Recheck* · Item 19 (SampleLibrary path)                       | **`connectFolderTauri`** is a **nested function** in `src/modules/SampleLibrary/useCases/connectFolder.ts`, not a standalone `connectFolderTauri.ts` file — fix refs.                                                                                                                                                                                                       |
| *Recheck* · Item 21 (PianoRoll)                                | **`PianoRoll.tsx`** uses **`useStore`** from `#/infra/store/useStore` for store subscriptions — same perf concern, wording fixed in item 21.                                                                                                                                                                        |

---

## Open issues (actionable)

Priorities ordered roughly by impact; severities indicative (P0 highest).

### P0 — Real-time / data

1. **RT-NATIVE · Native plugin audio path**  
   **Needed:** Move toward bounded, low-allocation, optionally zero-copy bridge (e.g. shared ring / platform-supported bulk IPC). Current code drops blocks under backpressure and sends bytes — still async Tauri per quantum.  
   **Refs:** `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts`, `public/audio/worklets/native-plugin-bridge-processor.js`.  
   **Note:** Old “23 `tauriInvoke`” figure is outdated; **AudioEngine** currently has **3** files using `tauriInvoke` (bridge + MIDI lifecycle + decode). Hot path remains async IPC per block.

2. **AUDIT-004 · CRDT / IDB crash safety**  
   **Needed:** Incremental Automerge sync to IDB beyond rAF-batched writes + explicit save; validate kill-browser recovery. `saveAllToIdb()` / chunk strategy per original audit.  
   **Refs:** `createAutomergeStorage.ts`, `automergeRepository`, IDB persistence.

3. **AUDIT-009 · Main-thread DSP / sequencing**  
   **Needed:** Yeast / Synth sequencing toward worklet or compiled schedule.  
   **Refs:** `src/modules/Yeast/useCases/yeastSchedulingBridge.ts`, `src/modules/Synth/engine/drumSynthVoices.ts`.

4. **AUDIT-003 · Plugin device state vs document / CRDT**  
   **Needed:** Ensure plugin patch + UI state that must survive reload lives in the **project CRDT** (or equivalent), not only in in-memory `createStore` maps. Many stores are already keyed by **`deviceId`** (`fermenterStore`, `bacteriaStore`, …) — the gap is often **persistence**, not same-key clobbering.  
   **Refs:** plugin module `stores/` (audit each for `storage:` / Automerge vs ephemeral).

### P1 — Architecture / commands / collaboration

5. **PL-1 · `RotaryKnob` + MIDI learn**  
   **Severity:** P2 in source audit.  
   **Needed:** Optional props `isMidiLearning`, `isMidiMapped`, `onMidiLearn`; remove internal `midiLearnStore` + `startMidiLearn`. **47 files** import `RotaryKnob` (grep, 2026-04-07) — **platform changes knob + all callers in one ship**; step 1 alone breaks MIDI learn.  
   **Ref:** `src/components/daw/RotaryKnob.tsx`.

6. **PL-2 · `createAutomergeStorage` layering**  
   **Needed:** Inject `automergeRepository` + `getSemanticContext` (or ports) so infra does not hard-import CRDT modules; **11** store call sites use the factory today — all must update with the signature.  
   **Ref:** `src/infra/store/storage/createAutomergeStorage.ts`.

7. **PL-3 · Central `AppEvents` map (device panel toggles)**  
   **Needed:** `panel.show*` keys for every device live in **`src/app/registerDependencies.ts`** (`AppEvents`); payloads from `Workspace/events/WorkspaceEvents`. Same design tension as old “APP_EVENTS” audit: app shell owns names for all modules. Optional follow-up: module-scoped registration — **refs are not** `infra/events/appEvents.ts` (file does not exist).  
   **Refs:** `src/app/registerDependencies.ts`, `src/modules/Workspace/events/WorkspaceEvents.ts`.

8. **PL-4 · Toaster in bootstrap**  
   **Needed:** Self-init inside Toaster module; **then** remove `initToasterSubscribers()` from `src/app/bootstrap.ts`.  
   **Refs:** `bootstrap.ts`, `src/modules/Toaster/useCases/toasterSubscriber`.

9. **AUDIT-006 · `pushUndoEntry` / callback undo**  
   **Status:** Partial — `restoreTrack` / `restoreClip` inverse actions landed; `pushUndoEntry` removed from some handlers.  
   **Remaining:** **16** files still call `pushUndoEntry` (excluding `Command/useCases/pushUndoEntry.ts`) — piano roll, timeline, automation lanes, mixer, etc. Needs **snapshot-commit `AppAction` pattern**, new action types, and **sessionStorage undo size** story for snapshot payloads.  
   **Refs:** grep `pushUndoEntry` under `src/`.

10. **AUDIT-005 / AUDIT-016 · Volatile state that should be durable**  
    **Needed:** **`sidechainStore`** and **`cvGateStore`** are already **`createAutomergeStorage`**-backed (verified). **Remaining:** `kneadStore` has no storage adapter (in-memory only). **`actionHistoryStore`** has no persistence — AI/manual history lost on reload.  
    **Refs:** `src/modules/Knead/stores/kneadStore.ts`, `src/modules/CrdtDocument/stores/actionHistoryStore.ts` (primary); `sidechainStore.ts` / `cvGate.ts` kept for context only — **not** volatile today.

11. **AUDIT-023 · Monolithic offline render**  
    **Needed:** `OfflineScheduleCompiler` + `WebAudioRenderer` split; **~901 lines** (`wc -l`, 2026-04-07), procedural loop with `isRenderingActive` lock — refactor audit “~533” is stale.  
    **Ref:** `src/modules/AudioEngine/useCases/offlineRender.ts`.

12. **CG-1 · Collaboration `latencyMs`**  
    **Severity:** P3 — no UI shows it.  
    **Needed:** Lightweight clock ping / RTT → `PeerInfo.latencyMs` if CollaborationPanel (or peers) needs latency. `TransportSync` ping/pong removed with that subsystem.  
    **Refs:** `CollaborationTypes.ts`, `sessionManagement.ts`.

### P2 — Maintainability / platform

13. **PL-6 · `LocalStorageKeys` legacy keys**  
    **Needed:** Legal sign-off (Carmen Cuomo or successor) before deleting unused brand-style keys.  
    **Ref:** `src/infra/store/storage/LocalStorageKeys.ts`.

14. **RB-2 · Tauri commands**  
    **State:** `llm.rs` removed; `native_llm.rs` supersedes sidecar; `get_model_dir` migrated.  
    **`plugin_gui.rs`:** Original audit (~225 lines) — window creation + CLAP GUI lifecycle; **review conclusion:** appropriately Tauri-shaped; CLAP work delegated to `instance.open_gui()` — **no mandatory split** unless scope grows.  
    **Other commands:** Keep thin; push domain logic to `daw-engine` / `daw-io` when it swells.

15. **AUDIT-010 · `TrackNode` device branching**  
    **Needed:** `DeviceDescriptor` registry / `registry.create(device.kind)` style.  
    **Ref:** `src/modules/AudioEngine/engine/TrackNode.ts`.

16. **AUDIT-011 · Rust workspace**  
    **Needed:** Optional collapse toward five-crate guideline; e.g. fold `proof-chamber` / `scoring` into `daw-dsp` wasm cfg — original suggestion (current workspace: 10 members; no `dutch-oven` crate).

17. **AUDIT-012 · Bridge “business logic”**  
    **Needed:** New fat commands → services in crates; **llm.rs** path retired.

18. **AUDIT-018 · Cross-module model re-exports**  
    **Needed:** Duplicate DTOs per module; remove `export type { X } from '../models/...'` from use cases. **Verified examples (grep):** `audioEngineQueries.ts`, `loadToasterKit.ts`, `crdtDocumentTypes.ts`, `workspaceQueries.ts`, `aiRuntimeQueries.ts`, `bacteriaParamBridge.ts`.

19. **AUDIT-014 · Sample library folder scope**  
    **Needed:** `tauri-plugin-persisted-scope` or equivalent; rehydrate scope on boot; align IDB path strings.  
    **Ref:** `src/modules/SampleLibrary/useCases/connectFolder.ts` (includes `connectFolderTauri()` for native).

### P3 — Follow-up

20. **Plugin hosting — target architecture**  
    **Needed:** Long-term SAB ring + dedicated processing path / zero main-thread audio for native plugins — coordinate with RT-NATIVE item. Original plugin audit sequence: **(1)** native async path / **(2)** align with global RT work.

21. **UI-PERF · Dense canvas surfaces + external store subscriptions**  
    **Severity:** P2 — refactor audit §4.1 / §4.6 (main-thread frame budget).  
    **Needed:** Profile under load; consider narrowing subscription surface (selectors), batching, or moving hot paths off per-frame store churn. Example: `PianoRoll.tsx` uses **`useStore`** from `#/infra/store/useStore` for `midiStore` + `trackStore`.  
    **Ref:** `src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx`, `src/infra/store/useStore.ts`.

22. **DI · `inject()` rollout + EventBus + domain errors (backlog)**  
    **Severity:** P2 — engineering hygiene; not duplicate P0 product bugs.  
    **State:** `di-migration-audit.md` claims near-zero `inject()` in use cases/repositories — **`grep` of `inject({` in `src/` hits only infra tests** (2026-04-07), so migration is largely pending. `di-events-errors-audit.md` lists `Container.get` / DOM events / `throw new Error` sites — **line numbers and several paths are stale** (e.g. store files refactored).  
    **Needed:** When scheduled: (1) re-scan repo and regenerate or curate checklists; (2) migrate use cases/repositories per `docs/01-dependency-injection.md`; (3) replace remaining DOM/custom-event shortcuts with `eventBus` + use cases; (4) replace generic errors with `createAppError` where appropriate.  
    **Refs:** `.agents/audits/di-migration-audit.md`, `.agents/audits/di-events-errors-audit.md`.

---

## Risks if left open

- **P0:** Glitches, crash data loss, timing drift, broken multi-instance plugins.
- **P1:** Boundary erosion, non-serializable undo, collab UX gaps.
- **P2/P3:** Legal/key hygiene, sample folder surprises after Tauri restart.

---

## Suggested approaches (non-spec)

- Ship **PL-1** only with all caller updates; same for **PL-2** factory injection.
- Run **`pnpm deps:validate` after each ~10-file batch** on cross-module refactors (AGENTS.md).
- Treat RT bridge + AUDIT-004 as measurable programs (glitch rate, recovery tests).

---

## Priorities (next sessions)

1. P0: RT bridge + CRDT persistence + main-thread sequencing.
2. P1: RotaryKnob, bootstrap, `registerDependencies` / panel events, pushUndoEntry / snapshot actions.
3. P2: LocalStorageKeys legal pass, TrackNode registry, AUDIT-018, AUDIT-014, UI-PERF canvas subscriptions, DI backlog (item 22).
4. Backend consolidation when scheduled.

---

## Appendix A — Collaboration module: completed work (detail)

Preserves the old collaboration audit “done” list.

- **ICE:** `waitForIceGathering()` (10 s timeout, `icegatheringstatechange`) before SDP.
- **QR:** `CompressionStream` deflate-raw, `z:` prefix; fallback copy if still too large.
- **Peer matching:** `pendingPeerId` in offer/answer.
- **Colors:** `pickPeerColor(excludeColors)` vs positional collisions.
- **Removed dead code:** ICE candidate handlers, join approval API, `transferLeadership` / tempo playback sync, `AssetRef` / `asset.complete`, `approvalRequired`.
- **Robustness:** try/catch in asset transfer, transport sync, permissions, `automergeSync.receiveSync`.
- **Assets:** `addLocalAsset` stores `{ blob, name }`; `sendCrdtSyncBuffered()` backpressure on chunks.
- **Removed:** LAN discovery (`lanDiscovery`, `NearbyPanel`).
- **Integration (were gaps; now done):** ghost playheads (`playheadBeat`, 4 Hz broadcast, `PresenceOverlay`), presence from `useTimelineInteractions` (~10 Hz), `grantRole` editor on connect, asset transfer wired (`importAudioFile`, `scheduleAudioClips`, `joinSession` `onAssetAvailable`).
- **CG-2 / CG-3:** 15 s stale-peer cleanup; invite-slot hint in UI.
- **DD-1 / SP-1:** branch list synced in session via `__branches__` (see Appendix B).

---

## Appendix B — RT-5 / native bridge: mitigations and remaining ceiling

Preserves global “RT-5 DONE” narrative.

- **Bug 1 — unbounded queue:** Fixed with `pendingBlock` in `NativePluginBridgeNode.ts` — drop new blocks while IPC in flight; Rust ring (e.g. 8 blocks) absorbs jitter.
- **Bug 2 — JSON floats:** Replaced with raw IEEE 754 bytes (`Uint8Array` / `Vec<u8>` / `f32::from_le_bytes`).
- **SabBridge removed:** Cross-platform SAB address sharing unviable; `sab_bridge.rs`, register/unregister bridge commands, `process_bridges()` removed.
- **Remaining ceiling:** Async JS→Rust→JS round-trip still scheduler-bound. **Next optimization** if glitches persist: Tauri bulk / raw body IPC (e.g. `ipc://localhost/` with `ArrayBuffer`) or equivalent zero-copy story.

**Plugin audit alignment:** CLAP/VST3 path shares this bridge; “unbounded queue” **bug** addressed; **ideal** architecture remains SAB ring + Atomics / dedicated RT reader (see Open issue #20).

---

## Appendix C — SP-1 / `__branches__` (completed)

- `DOC_BRANCHES` / `__branches__` Automerge doc holds `BranchRecord[]` for the session.
- `AutomergeSync` syncs `root`, `__branches__`, `branch_*` with per-peer-per-doc `SyncState`.
- `sessionManagement`: seed on `createSession`, mirror `branchStore` → doc, project peer changes → `branchStore`, remove doc on `leaveSession` and restore pre-session snapshot.
- **`activeBranchId` not synced** — intentional per peer.

---

## Appendix D — RB-1: platform / DSP cleanup (completed)

Preserves global audit bullet list (paths may be historical; verify in tree).

- Removed: `daw-dsp` reverb tree, `effects/proof_chamber.rs`, whole `effects/` native DSP set, `pub mod reverb`.
- Removed TS/native: `NativeDspNode`, `nativeDspProcessor`, `audioCoreProcessor`, `audio_core.*` wasm, `NativeEffectLayouts`, seven `native-*` descriptors from `nativeDspDescriptors`, `NATIVE_DSP_PRESETS` / factory preset helpers.
- `builtinEffectDescriptors` → `platform: 'both'`; `getPlatformPlugins` simplified; `NativeDspDeviceStrategy` premium-only; `isNativeDspDevice` removed; `dutchOvenParamBridge` native-dutch-oven branch removed.
- **Landscape:** Web builtins everywhere + premium WASM plugins (Dutch Oven, Fermenter, Toaster, …).

---

## Appendix E — Broad refactor: resolved or superseded issue IDs

| ID        | Title                               | Disposition                                                                                                                                                |
| --------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUDIT-001 | God context menus                   | Resolved 2026-04-05 — `runAiActionWithToast`, `duplicateTrack`, `importAudioClipToTrack`, etc.                                                             |
| AUDIT-007 | polyphonicAudioToMidi orchestration | Resolved — returns DTO; caller orchestrates.                                                                                                               |
| AUDIT-015 | Branch split-brain                  | Superseded by `__branches__` session sync (Appendix C). `branchStore` still uses local storage for offline; collaborative branch list mirrored in session. |
| AUDIT-022 | ExpandedChannelStrip                | Resolved — `useChannelStripActions`, extracted use cases.                                                                                                  |
| AUDIT-017 | DSO callback undo                   | Largely addressed — typed `createUndoEntry` in `executeDsoEdit.ts`.                                                                                        |

---

## Appendix F — Pattern prescription matrix (refactor audit §4.6)

| Smell                                     | Harm                         | Target                                      | Remediation                                          |
| ----------------------------------------- | ---------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Singleton device stores                   | Multi-instance clobber       | Parameterized selectors / CRDT device state | `useDeviceState(deviceId)`                           |
| `pushUndoEntry` closures                  | No network-serializable undo | Command pattern                             | Typed `AppAction` + `ActionHandler`                  |
| IPC audio loops                           | GC / jank in worklet         | Lock-free ring / bulk IPC                   | `SharedArrayBuffer` or platform bulk channel         |
| God components                            | Brittle mixers               | Facade hooks                                | Already directionally done for channel strip / menus |
| God switch in `TrackNode`                 | Every plugin touches engine  | Strategy registry                           | `DeviceDescriptor` map                               |
| Main-thread sequencers                    | Timing vs UI                 | Compiled schedule                           | AudioWorklet / Rust `ProcessTask`                    |
| Cross-module `export type` from use cases | Coupling                     | Model duplication                           | Local `models/` per module                           |

---

## Appendix G — Refactor sequencing (phases 1–6, abbreviated)

1. **Guard RT/data:** Ring or bulk IPC; volatile state into CRDT where needed; incremental IDB.
2. **Store ownership:** Document-scoped plugin state.
3. **Thin React:** Menus/strips → use cases (largely done).
4. **AppAction registry:** Remove closure undo; typed automation/MIDI/transport.
5. **Registries:** `TrackNode` factory.
6. **Backend:** Collapse crates optionally; thin `src-tauri`.

---

## Appendix H — Source files removed

**Deleted 2026-04-07** (content folded into this file + appendices; **git history** retains originals):

| Removed path                                  |
| --------------------------------------------- |
| `.agents/audits/collaboration/open-issues.md` |
| `.agents/audits/global/open-issues.md`        |
| `.agents/audits/plugins/open-issues.md`       |
| `.agents/audits/global/refactor-audit.md`     |

**Not deleted:** `di-migration-audit.md`, `di-events-errors-audit.md` — kept as working migration references; see open issue **22** (must be re-verified before checkbox work).
