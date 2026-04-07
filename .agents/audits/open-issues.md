# Sourdaw — Consolidated open issues

## Goal

Track verified gaps between the current codebase and desired architecture: real-time safety, clean layering, collaboration completeness, plugin/RT boundaries, and maintainable undo/command flows.

**Supersedes (content merged below, then removed):**  
`collaboration/open-issues.md`, `global/open-issues.md`, `global/refactor-audit.md`, `plugins/open-issues.md`.

**Last verified:** 2026-04-07 — spot-checked files and `pnpm deps:validate` (pass, 0 violations).

---

## Executive summary (from broad refactor audit)

The stack (React, Web Audio, Automerge, Tauri) is ambitious; seams show as RT boundary risk, command-pattern bypasses, and store ownership drift.

**Top refactor priorities (historical list — many partially addressed; see Open issues + Appendices):**

1. Reduce async IPC / allocation pressure in the native plugin audio bridge (see RT-5 appendix).
2. Eliminate global singleton **per-plugin-type** UI stores where multi-instancing is required (`fermenterStore`, `crustStore`, …) — migrate toward document-scoped state.
3. Replace anonymous `pushUndoEntry` closures with typed `AppAction` / serializable undo (partial progress; see AUDIT-006).
4. Move Yeast / Synth timing-critical scheduling off the main thread where still applicable.
5. Continuous / incremental CRDT persistence vs crash-only-in-memory risk.
6. `TrackNode` — registry vs god-switch `deviceType` branching.
7. Optional consolidation of Rust workspace layout toward the documented five-crate mental model.
8. Context menus / channel strip — **AUDIT-001 / AUDIT-022 resolved** (facades / use cases); regression possible if files regrow.

**Additional observations (no separate ticket; still relevant):**

- Heavy `useSyncExternalStore` use in canvas surfaces (e.g. PianoRoll) can pressure main-thread frame budgets under load.
- Waveform / buffer caches: watch unbounded growth in editor surfaces (called out in original audit narrative).

**Backend inventory note:** Root `Cargo.toml` workspace members include `daw-core`, `daw-collab`, `daw-engine`, `daw-dsp`, `daw-io`, `daw-wasm-decoder`, `daw-plugin-host`, `dutch-oven`, `scoring`, and `src-tauri` (10 members). Older text referring to “`daw-llm`” as a workspace crate may be stale — verify against current `Cargo.toml` when planning backend work.

---

## Verification summary

| Claim | Result |
| ----- | ------ |
| Collaboration `PeerInfo.latencyMs` never set | **Valid** — still `null` in `sessionManagement.ts`. Severity **P3** if no UI consumes it yet. |
| `RotaryKnob` imports MIDI learn store + `startMidiLearn` | **Valid** — `src/components/daw/RotaryKnob.tsx`. |
| Automerge storage adapter imports CrdtDocument | **Valid** — `src/infra/store/storage/createAutomergeStorage.ts` (replaces former `helpers/.../AutomergeStorage.ts`). `pnpm deps:validate` does **not** currently flag this; original audit cited `helpers-no-module-imports`. |
| `APP_EVENTS` plugin tab constants in shared events module | **Valid** — `src/infra/events/appEvents.ts` (includes SHOW_* tab toggles plus shared project/MIDI/zoom events). |
| `bootstrap.ts` calls Toaster subscriber init | **Valid** — `initToasterSubscribers()` in `src/app/bootstrap.ts`. |
| `LocalStorageKeys` non-DAW keys | **Valid** — ~28 keys in `src/infra/store/storage/LocalStorageKeys.ts` appear unused in app code; legal notice (Carmen Cuomo) remains. |
| Branch topology vs Automerge | **Resolved for collaboration sessions** — `__branches__` doc; `activeBranchId` intentionally local per original spec. |
| Native plugin bridge | **Mitigated** — `pendingBlock`, raw byte IPC; async round-trip and allocation profile still not “true RT zero-copy.” |
| Rust workspace | **Still drifted** vs 5-crate guideline — see workspace list above. |
| AUDIT-017 (DSO undo) | **Largely addressed** — `executeDsoEdit.ts` uses `createUndoEntry` + typed undo; original `createCallbackUndoEntry` concern largely moot for DSO path. |
| AUDIT-001 / AUDIT-022 | **Resolved** per 2026-04-05 convergence (facades / use cases). |

---

## Open issues (actionable)

Priorities ordered roughly by impact; severities indicative (P0 highest).

### P0 — Real-time / data

1. **RT-NATIVE · Native plugin audio path**  
   **Needed:** Move toward bounded, low-allocation, optionally zero-copy bridge (e.g. shared ring / platform-supported bulk IPC). Current code drops blocks under backpressure and sends bytes — still async Tauri per quantum.  
   **Refs:** `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts`, `public/audio/worklets/native-plugin-bridge-processor.js`.  
   **Note:** Original audit also cited **23 `tauriInvoke` bindings** on RT-adjacent paths — verify periodically.

2. **AUDIT-004 · CRDT / IDB crash safety**  
   **Needed:** Incremental Automerge sync to IDB beyond rAF-batched writes + explicit save; validate kill-browser recovery. `saveAllToIdb()` / chunk strategy per original audit.  
   **Refs:** `createAutomergeStorage.ts`, `automergeRepository`, IDB persistence.

3. **AUDIT-009 · Main-thread DSP / sequencing**  
   **Needed:** Yeast / Synth sequencing toward worklet or compiled schedule.  
   **Refs:** `src/modules/Yeast/useCases/yeastSchedulingBridge.ts`, `src/modules/Synth/engine/drumSynthVoices.ts`.

4. **AUDIT-003 · Singleton per-plugin stores vs multi-instancing**  
   **Needed:** Parameterize by `deviceId` / document slice (`tracks[].devices[].state` migration per original audit).  
   **Refs:** plugin module `stores/` (Fermenter, Crust, Bacteria, …).

### P1 — Architecture / commands / collaboration

5. **PL-1 · `RotaryKnob` + MIDI learn**  
   **Severity:** P2 in source audit.  
   **Needed:** Optional props `isMidiLearning`, `isMidiMapped`, `onMidiLearn`; remove internal `midiLearnStore` + `startMidiLearn`. **~42 callers** (Fermenter, Yeast, Crust, Bacteria, Gluten, Proof, Levain, Scoring, DutchOven, Toaster, Workspace, …) — **platform changes knob + all callers in one ship**; step 1 alone breaks MIDI learn.  
   **Ref:** `src/components/daw/RotaryKnob.tsx`.

6. **PL-2 · `createAutomergeStorage` layering**  
   **Needed:** Inject `automergeRepository` + `getSemanticContext` (or ports) so infra does not hard-import CrdtDocument; **~12 store call sites** must update together with factory signature.  
   **Ref:** `src/infra/store/storage/createAutomergeStorage.ts`.

7. **PL-3 · Plugin tab events in `APP_EVENTS`**  
   **Needed:** Move `SHOW_*_TAB` usage to module-local or Workspace constants; trim `APP_EVENTS` after migration. Module owners relocate callers first.  
   **Ref:** `src/infra/events/appEvents.ts`.

8. **PL-4 · Toaster in bootstrap**  
   **Needed:** Self-init inside Toaster module; **then** remove `initToasterSubscribers()` from `src/app/bootstrap.ts`.  
   **Refs:** `bootstrap.ts`, `src/modules/Toaster/useCases/toasterSubscriber`.

9. **AUDIT-006 · `pushUndoEntry` / callback undo**  
   **Status:** Partial — `restoreTrack` / `restoreClip` inverse actions landed; `pushUndoEntry` removed from some handlers.  
   **Remaining:** Many live-gesture sites (piano roll, timeline, automation, clip resize). Needs **snapshot-commit `AppAction` pattern**, new action types, and **sessionStorage undo size** story for snapshot payloads.  
   **Refs:** grep `pushUndoEntry` under `src/`.

10. **AUDIT-005 / AUDIT-016 · Volatile routing / CV / Knead + action history**  
    **Needed:** Durable graph/history where required (`sidechain` routing, `cvGate`, `kneadStore`, `actionHistoryStore`). Original audit: sidechains/CVs in volatile stores — re-verify against current CRDT-backed stores.  
    **Refs:** `src/modules/Routing/stores/sidechainStore.ts`, `src/modules/Synth/stores/cvGate.ts`, `src/modules/Knead/stores/kneadStore.ts`, `src/modules/CrdtDocument/stores/actionHistoryStore.ts`.

11. **AUDIT-023 · Monolithic offline render**  
    **Needed:** `OfflineScheduleCompiler` + `WebAudioRenderer` split; ~533+ line procedural loop with `isRenderingActive` lock.  
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
    **Needed:** Optional collapse toward five-crate guideline; e.g. fold `dutch-oven` / `scoring` into `daw-dsp` wasm cfg — original suggestion.

17. **AUDIT-012 · Bridge “business logic”**  
    **Needed:** New fat commands → services in crates; **llm.rs** path retired.

18. **AUDIT-018 · Cross-module model re-exports**  
    **Needed:** Duplicate DTOs per module; remove `export type { X } from '../models/...'` from use cases. Example sites from audit: `audioEngineQueries.ts`, `midi.ts`, `loadToasterKit.ts`.

19. **AUDIT-014 · Sample library folder scope**  
    **Needed:** `tauri-plugin-persisted-scope` or equivalent; rehydrate scope on boot; align IDB path strings.  
    **Ref:** `src/modules/SampleLibrary/services/connectFolderTauri.ts`.

### P3 — Follow-up

20. **Plugin hosting — target architecture**  
    **Needed:** Long-term SAB ring + dedicated processing path / zero main-thread audio for native plugins — coordinate with RT-NATIVE item. Original plugin audit sequence: **(1)** native async path / **(2)** align with global RT work.

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
2. P1: RotaryKnob, bootstrap, APP_EVENTS, pushUndoEntry / snapshot actions.  
3. P2: LocalStorageKeys legal pass, TrackNode registry, AUDIT-018, AUDIT-014.  
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

| ID | Title | Disposition |
| -- | ----- | ----------- |
| AUDIT-001 | God context menus | Resolved 2026-04-05 — `runAiActionWithToast`, `duplicateTrack`, `importAudioClipToTrack`, etc. |
| AUDIT-007 | polyphonicAudioToMidi orchestration | Resolved — returns DTO; caller orchestrates. |
| AUDIT-015 | Branch split-brain | Superseded by `__branches__` session sync (Appendix C). `branchStore` still uses local storage for offline; collaborative branch list mirrored in session. |
| AUDIT-022 | ExpandedChannelStrip | Resolved — `useChannelStripActions`, extracted use cases. |
| AUDIT-017 | DSO callback undo | Largely addressed — typed `createUndoEntry` in `executeDsoEdit.ts`. |

---

## Appendix F — Pattern prescription matrix (refactor audit §4.6)

| Smell | Harm | Target | Remediation |
| ----- | ---- | ------ | ----------- |
| Singleton device stores | Multi-instance clobber | Parameterized selectors / CRDT device state | `useDeviceState(deviceId)` |
| `pushUndoEntry` closures | No network-serializable undo | Command pattern | Typed `AppAction` + `ActionHandler` |
| IPC audio loops | GC / jank in worklet | Lock-free ring / bulk IPC | `SharedArrayBuffer` or platform bulk channel |
| God components | Brittle mixers | Facade hooks | Already directionally done for channel strip / menus |
| God switch in `TrackNode` | Every plugin touches engine | Strategy registry | `DeviceDescriptor` map |
| Main-thread sequencers | Timing vs UI | Compiled schedule | AudioWorklet / Rust `ProcessTask` |
| Cross-module `export type` from use cases | Coupling | Model duplication | Local `models/` per module |

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

The four predecessor audit files were merged into this document and deleted from `.agents/audits/` subfolders to avoid drift. **Git history** retains full originals if line-by-line recovery is needed.
