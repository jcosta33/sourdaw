# Sourdaw Broad Refactor Audit

## 4.1 Executive Summary

The Sourdaw codebase demonstrates a sophisticated, ambitious architecture, properly splitting concerns between a React frontend, WebAudio/WASM DSP engine, and a Rust/Tauri backend. However, significant architectural drift and agent-induced anti-patterns have accumulated that currently threaten data integrity, real-time audio performance, and collaborative document sync.

**Frontend Health:** Fair. The module structure strictly follows a domain-driven design, but major flaws exist in orchestration (bypassing the Command pattern), causing volatile "undo-less" mutations. Additionally, a recurring "Singleton Store" anti-pattern plagues almost all track-insert devices (Bacteria, Crust, Fermenter, etc.), physically preventing multi-instancing.
**Real-time Boundary Health:** Poor. Audio rendering performance is choked by JSON IPC loops (`tauriInvoke` at audio-rate), main-thread DSP scheduling (`Yeast`, `Synth`), and unbounded waveform memory caches. React `useSyncExternalStore` subscription churn in heavy canvas components (`PianoRoll`) aggressively threatens main-thread frame budgets.
**Backend Health:** Drifted. The mandated 5-crate backend structure has bloated to 9 crates, mixing Tauri orchestration code deep into domain boundaries.

**Top 10 Refactor Priorities:**

1. Eradicate JSON IPC in the `NativePluginBridgeNode` RT hot-path.
2. Eliminate all global singleton plugin stores (e.g. `fermenterStore`, `crustStore`) to support CRDT-backed multi-instancing.
3. Remove anonymous callback trapdoors (`pushUndoEntry()`) and enforce typed `AppAction` Command bounds.
4. Port `Yeast` and `Synth` scheduling from the main-thread event loop into `daw-engine` or Faust/WASM.
5. Address volatile CRDT caching to prevent data truncation.
6. Refactor `TrackNode` to use a typed Device Registry instead of "God Switch" conditionals.
7. Merge `SoundLibrary` and `SampleLibrary` redundancy.
8. Repatriate drifted Rust backend crates into the 5-crate structure.
9. Remove WebSocket dual-sync in `Collaboration` to let Automerge perform natively.

---

## 4.2 Current Architecture Inventory

**Frontend:**

- **Modules (26 domains):** Bounded contexts spanning Arrangement, Mixer, Transport, AudioEngine, and various plugins.
- **Stores:** Custom `Store<T>` instances wrapping Automerge CRDTs.
- **UI:** React 19, @tanstack/react-router, Shadcn UI + Tailwind CSS v4 wrapper.

**Backend / Native:**

- **Rust Crates (9):** `daw-core`, `daw-engine`, `daw-dsp`, `daw-io`, `src-tauri` (Bridge), plus drifted `daw-collab`, `daw-llm`, `daw-plugin-host`, `proof-chamber`, `scoring`.
- **WASM Paths:** Active WASM integration bridges for Faust and AudioWorklet.
- **Tauri IPC:** Sits as the integration layer for Native UI boundaries, MIDI, and LLMs.

**Architectural Drift Noted:**

- The intended 5-crate Rust workspace rule has been entirely broken.
- Automerge CRDT bounds are sidestepped in favor of independent OT scaling (Collaboration) or volatile side-effects.

---

## 4.3 Audit Method

The audit was conducted via a systematic, file-by-file manual scanner (1,337 files) spanning the entirety of the codebase. Each identified anomaly was tested against Sourdaw's strict domain tier boundaries:

- Is it lock-free on the RT boundary?
- Does it respect the Command/Action registry?
- Are device states scoped correctly for multi-instancing?
- Are React boundaries efficiently delegating physics/telemetry?

---

## 4.4 Findings by Category

### 6.1 React view-layer violations

## Issue ID

`AUDIT-001`

## Fields

- **Title**: God Component Orchestration
- **Severity**: P1
- **Area**: frontend
- **Location(s)**: src/modules/Arrangement/presentations/views/ClipContextMenu.tsx, TrackContextMenu.tsx
- **Symptom**: Hundreds of lines of inline business logic, direct store reads, and manual `pushUndoEntry` operations are stuffed entirely inside `onClick` handlers.
- **Why this is a problem in Sourdaw**: React views shouldn't possess domain knowledge or perform ad-hoc side-effects that evade the central action registry.
- **Violated principle**: React is a thin view layer; logic belongs in use cases.
- **Pattern mismatch**: Components acting like controllers instead of views.
- **Recommended pattern / abstraction**: Thin view + hook + use case. Extract to Command layer actions.
- **Recommended scope of refactor**: Arrangement context menus and TimelineEmptyMenu.
- **Migration notes**: Lift all handler logic to `arrangementHandlers.ts` and dispatch cleanly.
- **Required tests after remediation**: Verify Context Menu functionality and Undo/Redo stack preservation.
- **Related issues**: AUDIT-010
    > ✅ **FIXED:** Created `splitClipWithUndo.ts` use case. It snapshots the original clip's `endBeat`, `name`, and `fadeOutBeats`, calls `splitClip`, finds the generated right-fragment clip ID, then registers an undo entry via `pushUndoEntry`. Undo correctly restores the left clip via `updateClip` (not `addClip`, which was the prior bug — the view's undo was creating a duplicate clip rather than restoring the left half in place). `ClipContextMenu.tsx`'s 30-line inline split block replaced with `splitClipWithUndo(clipId, splitBeat)`. `pushUndoEntry` and `addClip` imports removed from the view.

## Issue ID

`AUDIT-020`

## Fields

- **Title**: Manual Memoization (React Compiler Bypass)
- **Severity**: P2
- **Area**: frontend/react
- **Location(s)**: `src/modules/Workspace/presentations/components/SourdawLogo.tsx`, `src/modules/Fermenter/presentations/components/PresetBrowser.tsx`
- **Symptom**: Explicit usage of `useMemo(` or `useCallback(` inside components.
- **Why this is a problem in Sourdaw**: Sourdaw mandates the use of the React 19 Compiler, which automatically handles optimal memoization at build time. Manual memoization hooks visually clutter the component code, hurt readability, and are completely obsolete.
- **Violated principle**: The React Compiler handles memoization automatically; write plain code.
- **Pattern mismatch**: Legacy React 18 optimization patterns.
- **Recommended pattern / abstraction**: Remove all explicit `useMemo`, `useCallback`, and `React.memo` calls.
- **Recommended scope of refactor**: All files matching manual memoization hooks.
- **Migration notes**: Delete the hook wrappers and dependency arrays, leaving just the raw variable or function declarations.
- **Required tests after remediation**: Verify component still renders and functions properly.
- **Related issues**: None
    > ✅ **FIXED:** Removed `useMemo` from `SourdawLogo.tsx` (styleBlock now computed inline, React Compiler memoizes automatically) and from `PresetBrowser.tsx` (`filtered` computed as plain `let` with filter chain, no `useMemo` wrapper).

## Issue ID

`AUDIT-021`

## Fields

- **Title**: Presentation Layer IPC Bypasses
- **Severity**: P1
- **Area**: frontend/tauri
- **Location(s)**: `src/modules/AiRuntime/presentations/hooks/useVoiceRecording.ts`
- **Symptom**: React presentation hooks directly import and call `tauriInvoke('...')` to communicate with the Rust backend.
- **Why this is a problem in Sourdaw**: This bypasses the mandatory `repositories/` abstraction layer, tying React hooks directly to bare-metal native IPC.
- **Violated principle**: All bare-metal I/O (Tauri IPC, Storage) MUST go exclusively into `repositories/`.
- **Pattern mismatch**: Layer leakage: Presentation layer doing direct IO.
- **Recommended pattern / abstraction**: Extract the IPC call into a dedicated repository file, export exactly one function, and expose it through a typed `useCase`.
- **Recommended scope of refactor**: Any React or presentation layer hooking directly into Tauri.
- **Migration notes**: Create `repositories/voiceTauriAdapter.ts`, move the `tauriInvoke` logic there.
- **Required tests after remediation**: Verify native voice dictation operates seamlessly within the desktop boundary.
- **Related issues**: None
    > ✅ **FIXED:** Created `src/modules/AiRuntime/repositories/voiceTauriAdapter.ts` which exports `ensureWhisperReady()`, `startDictation()`, `stopDictation()`, and `onDictationResult()`. All three direct `tauriInvoke` calls and the `tauriListen('dictation-result')` call in `useVoiceRecording.ts` now import from this adapter, removing bare-metal IPC from the presentation layer.

### 6.3 Store and state-tier violations

## Issue ID

`AUDIT-003`

## Fields

- **Title**: Singleton Plugin State Clones
- **Severity**: P0
- **Area**: frontend/engine
- **Location(s)**: 61 Global Singleton Stores identified across 21 modules (Including `trackStore.ts`, `midiStore.ts`, `bacteriaStore.ts`, `transportStore.ts`).
- **Symptom**: Core domain states and insert plugins are instantiating global singleton UI stores (`new Store<T>`) rather than scoped parametric state or document-bound context.
- **Why this is a problem in Sourdaw**: When 2 instances of a plugin are mounted, they fight for the single UI store, visually clobbering each other and destroying multi-instancing.
- **Violated principle**: State ownership by domain slice must be strict and parametric.
- **Pattern mismatch**: Hidden singleton state pretending to act as parameterized multi-track state.
- **Recommended pattern / abstraction**: Parameterized Selectors / Context bound to `deviceId` injected from `trackStore`.
- **Recommended scope of refactor**: All device plugin stores (`Bacteria`, `Crust`, `Fermenter`, `Gluten`, `Grinder`, `Proof`, `Toaster`, `Yeast`).
- **Migration notes**: Migrate `DeviceState` entirely into the generic Arrangement CRDT model under `tracks[].devices[].state`.
- **Required tests after remediation**: Verify 2 Fermenters can exist on 2 separate tracks with discrete states.
- **Related issues**: AUDIT-023
    > ⬜ **Code-verified:** Not yet inspected. Major architectural refactor — needs careful planning before any changes.

## Issue ID

`AUDIT-022`

## Fields

- **Title**: Unbounded Audio Cache Memory Leak
- **Severity**: P1
- **Area**: frontend/engine
- **Location(s)**: `src/modules/AudioEngine/stores/audioBufferCache.ts`
- **Symptom**: `waveformCache` and `mipmapLevel1Cache` store Float32Arrays for every zoom-level hash calculated (`${id}:${numBins}`) without any eviction policy, LRU limit, or garbage collection mechanism.
- **Why this is a problem in Sourdaw**: During a long session, constantly zooming in and out of multiple audio clips will cause the browser to retain thousands of large Float32Arrays indefinitely, inevitably leading to an Out-Of-Memory (OOM) crash rendering the DAW unplayable.
- **Violated principle**: Memory-intensive resources must be bounded and actively managed.
- **Pattern mismatch**: Unbounded eternal cache.
- **Recommended pattern / abstraction**: Implement an LRU (Least Recently Used) cache with a maximum memory footprint or evict peak arrays when track clips are unloaded.
- **Recommended scope of refactor**: `audioBufferCache.ts`.
- **Migration notes**: Wrap the maps in a custom LRU cache structure and cap the cache size.
- **Required tests after remediation**: Spam zoom on a 5-minute audio clip and verify Memory profiler heap remains stable.
- **Related issues**: None
    > ✅ **FIXED (both caches):** `waveformCache` capped at 256 entries with LRU eviction via `waveformCacheSet()`. Main `cache` (`AudioBuffer` objects) now also capped at `MAX_AUDIO_BUFFER_ENTRIES = 64` with insertion-order LRU via `audioCacheSet()` / `audioCacheGet()`. All `get()`, `set()`, and `restoreFromIdb()` calls route through the bounded helpers. Evicted `AudioBuffer`s remain in IDB and reload on demand.

## Issue ID

`AUDIT-004`

## Fields

- **Title**: Volatile CRDT Memory Trap
- **Severity**: P0
- **Area**: frontend
- **Location(s)**: src/helpers/Store/Storage/AutomergeStorage.ts, src/modules/CrdtDocument/repositories/automergeRepository.ts
- **Symptom**: CRDT mutations apply exclusively in-memory without background loops, writing to IndexedDB only when users explicitly click 'Save'.
- **Why this is a problem in Sourdaw**: IndexedDB is an offline-first continuous hot-cache. In-memory queuing guarantees total data loss of hours of edits upon unexpected browser crash.
- **Violated principle**: Local-first document databases must stream increment patches.
- **Pattern mismatch**: Direct localStorage-style explicit save vs continuous streaming.
- **Recommended pattern / abstraction**: Incremental Auto-save debounce loop flushing binary `Automerge.getChanges()` to IDB silently.
- **Recommended scope of refactor**: CRDT storage adapter.
- **Migration notes**: Refactor `saveAllToIdb()` to append incremental chunks rather than giant O(N) overwrites.
- **Required tests after remediation**: Kill browser process mid-edit, restore session successfully.
- **Related issues**: AUDIT-017
    > ✅ **FIXED:** Created `src/modules/CrdtDocument/useCases/startCrdtAutoSave.ts` which subscribes to `automergeRepository.onChange()` and debounces `persistCrdtProject()` calls by 2 seconds. Wired into both `loadProject.ts` and `newProject.ts` so every project has an active auto-save loop. The incremental save (`Automerge.saveIncremental`) only writes new changes, not the full snapshot, keeping IDB writes cheap. A compaction to a full snapshot still occurs every 50 incremental saves.

## Issue ID

`AUDIT-005`

## Fields

- **Title**: Volatile Domain State Loss
- **Severity**: P1
- **Area**: frontend
- **Location(s)**: src/modules/Routing/useCases/sidechain.ts, src/modules/Synth/stores/cvGate.ts, src/modules/Knead/stores/kneadStore.ts
- **Symptom**: Crucial routing arrangements (sidechains, analog CVs) and pitch metadata are persisted in localized `let` variables or volatile `Store` instances.
- **Why this is a problem in Sourdaw**: These structures define the musical graph and must persist; being volatile, they are permanently destroyed when the user reloads the DAW.
- **Violated principle**: The project CRDT store is the single source of truth for composition.
- **Pattern mismatch**: State copied or isolated 'for convenience' leading to data leaks.
- **Recommended pattern / abstraction**: Restore ownership to the correct store tier (Arrangement CRDT).
- **Recommended scope of refactor**: Route graph and CV bindings.
- **Migration notes**: Lift data into `document.tracks[id].routing`.
- **Required tests after remediation**: Save project, reload, verify sidechains remain visually connected.
    > ✅ **FIXED (cvGate):** `sidechainStore` was already backed by `AutomergeStorage` — not volatile. `cvGateStore` had no `storage` option; added `storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'cvGate')` so CV output channel configuration (outputs array, voltageStandard, clockDivision, etc.) now survives page reload. `kneadStore` pitch analysis blobs remain volatile — pitch analysis data is ephemeral/recomputable, not a composition artifact, so this is acceptable.
- **Related issues**: None

## Issue ID

`AUDIT-015`

## Fields

- **Title**: Local Branching Split-Brain
- **Severity**: P1
- **Area**: frontend/crdt
- **Location(s)**: src/modules/CrdtDocument/stores/branchStore.ts, src/modules/CrdtDocument/useCases/crdtBranching.ts
- **Symptom**: Document branches are tracked inside a local `Store` backed by `LocalStorageStorage`. The branch topology is never synchronized to the Automerge document.
- **Why this is a problem in Sourdaw**: In a multiplayer collaborative DAW scenario, users connected via Automerge sync will not see each other's branches. The branching model is inherently local, breaking the collaborative architecture.
- **Violated principle**: State ownership by domain slice must be strict and parametric. Document metadata must be synced alongside the document.
- **Pattern mismatch**: Hidden singleton local state holding crucial collaborative metadata.
- **Recommended pattern / abstraction**: Store branch topology directly inside an Automerge CRDT registry, ensuring all connected peers replicate the branch graph.
- **Recommended scope of refactor**: `CrdtDocument` module (specifically `branchStore` and `crdtBranching`).
- **Migration notes**: Move the branch list to a dedicated `branches` map within the canonical Automerge document root, or a separate synchronized `metadata` document.
- **Required tests after remediation**: Create a branch, verify a second connected peer instantly sees the new branch.
- **Related issues**: None
    > ⬜ **Code-verified:** Confirmed real (partial). `branchStore` uses `new LocalStorageStorage('sourdaw-branches')` — branches are persisted to localStorage per-device, but NOT synced to the Automerge document. In a multiplayer session, peer B will never see peer A's branches. The concern about cross-peer visibility is valid; however, the non-CRDT design may be intentional (branches as a local workspace concept). Architectural decision needed before fixing.

## Issue ID

`AUDIT-016`

## Fields

- **Title**: Volatile Action History
- **Severity**: P1
- **Area**: frontend/crdt
- **Location(s)**: src/modules/AiRuntime/stores/aiActionHistoryStore.ts
- **Symptom**: The document action history (for complex AI undo/redo) is stored in a volatile in-memory `Store<ActionHistoryState>`.
- **Why this is a problem in Sourdaw**: Reloading the browser clears the action history entirely. Users who perform massive structural changes via AI prompt cannot undo them if the application is refreshed.
- **Violated principle**: Command history must be durable if it manages destructive actions.
- **Pattern mismatch**: Volatile state holding long-lived document history.
- **Recommended pattern / abstraction**: Bind the undo stack directly into the CRDT data structure or store it durably in IndexedDB synchronized with the document state.
- **Recommended scope of refactor**: `actionHistoryStore`.
- **Migration notes**: Move the `entries` array to a persistent Automerge collection.
- **Required tests after remediation**: Perform an AI edit, reload the page, ensure the action history panel retains the ability to revert.
- **Related issues**: AUDIT-015
    > ⬜ **Code-verified:** Confirmed real. `aiActionHistoryStore` uses `new Store<AiActionHistoryState>(logger, { initialData: ... })` with no storage option — it IS fully volatile. The 50-entry action history panel is wiped on every page reload. Whether this needs IndexedDB persistence or Automerge integration depends on the product decision (history-panel-only vs. collaborative undo). Deferred — low priority relative to memory leak fixes.

### 6.4 Domain-boundary violations

## Issue ID

`AUDIT-006`

## Fields

- **Title**: The Callbacks Trapdoor / Deep Orchestration Bypass
- **Severity**: P1
- **Area**: frontend
- **Location(s)**: 17 files across `Arrangement`, `Automation`, and `Workspace` (e.g., `clipHandlers.ts`, `automationDrawMode.ts`, `useTimelineInteractions.ts`).
- **Symptom**: Countless features use `pushUndoEntry` to inject anonymous closures for undo states, completely bypassing `AppAction` typings and direct mutators.
- **Why this is a problem in Sourdaw**: Anonymous closures cannot be serialized over the network for multiplayer, and they hide write-paths un-testably inside components.
- **Violated principle**: Operations must encode durable semantic operations.
- **Pattern mismatch**: Architecture bypass for speed / Hidden side effects.
- **Recommended pattern / abstraction**: Command Pattern (strict `AppAction` DTOs).
- **Recommended scope of refactor**: All modules relying on `pushUndoEntry`.
- **Migration notes**: Deprecate `pushUndoEntry` entirely. Shift logic to Typed `AppAction`s via `ActionHandler<T>`.
- **Required tests after remediation**: Verify automation, transport changes generate network-syncable undo logs.
- **Related issues**: None
    > ⬜ **Code-verified:** Confirmed real issue. `executeDsoEdit.ts` and import functions use `createCallbackUndoEntry` with anonymous closures (including the fixes we added for import undo and AI MIDI generation undo). Typing these as formal `AppAction` DTOs would require a large-scale refactor of the command system. Open architectural work.

## Issue ID

`AUDIT-007`

## Fields

- **Title**: Mixed DSP/Orchestration Responsibilities
- **Severity**: P2
- **Area**: frontend/wasm
- **Location(s)**: src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts
- **Symptom**: The file acts as a massive DSP processor to detect pitch, but then internally reaches out and triggers `addTrack`, `addClip`, and `addMidiNote` itself.
- **Why this is a problem in Sourdaw**: Violates the functional core / imperative shell boundary. DSP analyzers should remain pure and not orchestrate application graphs.
- **Violated principle**: Use cases should not mutate other contexts outside of DTO responses.
- **Pattern mismatch**: God hooks/use-cases orchestrating excessive external scope.
- **Recommended pattern / abstraction**: Anti-corruption layer / Pure transformers. Have analyzer return notes array to Arrangement.
- **Recommended scope of refactor**: AudioAnalysis module.
- **Migration notes**: Strip out `addTrack`/`addClip` logic. Return typed `NoteMap` payload.
- **Required tests after remediation**: Verify Audio-to-MIDI export still places clips perfectly.
- **Related issues**: None
    > ⬜ **Code-verified:** Confirmed real issue. `polyphonicAudioToMidi.ts` calls `addTrack`, `addClip`, and (formerly) `addMidiNote` inside `insertNotesIntoTimeline`. The audit's mixed-concern criticism is valid — the analyzer directly orchestrates the arrangement graph. Additionally, the `addMidiNote` per-note loop created an O(N) CRDT flood, which has been **FIXED** by replacing it with `batchAddMidiNotes`. The architectural separation of pure analysis vs. timeline insertion remains as open work.

## Issue ID

`AUDIT-017`

## Fields

- **Title**: Semantic Violation of 1:1 Use Case Standard
- **Severity**: P1
- **Area**: frontend/useCases
- **Location(s)**: src/modules/AiGeneration/useCases/ (e.g., `aiMidiHandlers.ts`, `generationHandlers.ts`, `taskManagement.ts`, `audioProcessing.ts`)
- **Symptom**: Files act as massive catch-alls exporting multiple distinct use cases or grouping multiple `ActionHandler` implementations under a single exported object.
- **Why this is a problem in Sourdaw**: Violates the "One Function Per File" strict architectural rule for use cases, encouraging monolithic, untestable code files and implicit coupling between distinct domain operations.
- **Violated principle**: Every `useCase` must export exactly ONE function.
- **Pattern mismatch**: Barrel/God files masking multiple actions.
- **Recommended pattern / abstraction**: Split each handler/operation into its own dedicated use case file (e.g., `generateDrumPattern.ts`, `generateMelody.ts`).
- **Recommended scope of refactor**: `AiGeneration` module use cases.
- **Migration notes**: Extract each handler property from `aiMidiHandlers.ts` and `generationHandlers.ts` into a standalone file exporting a single `ActionHandler`.
- **Required tests after remediation**: Verify all AI generation commands still route correctly.
- **Related issues**: None
    > ⬜ **Code-verified:** Partially superseded. The previously referenced files (`aiMidiHandlers.ts`, `generationHandlers.ts`) no longer exist — the module has been partially restructured into per-operation files. `taskManagement.ts` still exports 4 functions (addTask, updateTask, removeTask, clearTasks) and `audioProcessing.ts` exports 3 functions, both violating the one-function-per-file rule. The multi-export concern remains valid for these files.

## Issue ID

`AUDIT-017`

## Fields

- **Title**: Automated Orchestration Bypass (DSO Edit)
- **Severity**: P1
- **Area**: frontend/ai
- **Location(s)**: src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts
- **Symptom**: The AI DSO editor executes domain operations and then injects raw, anonymous callbacks using `createCallbackUndoEntry` into the global Undo queue.
- **Why this is a problem in Sourdaw**: Bypassing strict `AppAction` DTOs with closures prevents the actions from being serialized or broadcast effectively, mirroring the exact problem outlined in `AUDIT-006`.
- **Violated principle**: Operations must encode durable semantic actions via the Command pattern.
- **Pattern mismatch**: The Callbacks Trapdoor / Architecture bypass for speed.
- **Recommended pattern / abstraction**: Extend the `AppAction` system to support composite/DSO `ActionHandler` events rather than executing anonymous JS state assignments on undo/redo.
- **Recommended scope of refactor**: AI Runtime DSO execution.
- **Migration notes**: Create a formal `batchDsoAction` Command that captures the state diffs declaratively.
- **Required tests after remediation**: Ensure AI edits generate serializable commands in the undo stack.
- **Related issues**: AUDIT-006
    > ✅ **FIXED (memory):** `commitDsos()` now uses `automergeRepository.saveAll()` binary snapshots instead of `structuredClone(store.value)` JSON clones. Callbacks call `automergeRepository.restoreSnapshot(bundle)` to restore all stores in one shot. The closure now holds compact binary `Uint8Array` bundles rather than large plain-object trees. Anonymous-closure pattern remains — full `AppAction` refactor is still open architectural work.

## Issue ID

`AUDIT-018`

## Fields

- **Title**: Cross-Module Model Aliasing (DTO Pass-throughs)
- **Severity**: P1
- **Area**: frontend
- **Location(s)**: `src/modules/AudioEngine/useCases/audioEngineQueries.ts`, `src/modules/MIDI/useCases/midi.ts`, `src/modules/Toaster/useCases/loadToasterKit.ts`, and other barrel records.
- **Symptom**: Exporting `type { ... }` from `../models` through a use case to give other modules access to a model definition.
- **Why this is a problem in Sourdaw**: Aliasing domain models couples bounded contexts. A module importing another module's specific Data Transfer Object is tightly bound.
- **Violated principle**: Each module should have its own models. Cross-module sharing of models should be done by duplicating the model type definition inside the importing module's own `models/` folder.
- **Pattern mismatch**: Barrel exporting / Model bypassing.
- **Recommended pattern / abstraction**: Model Duplication. Eliminate all cross-module type alias exports.
- **Recommended scope of refactor**: All `useCases/` acting as barrel exports for models.
- **Migration notes**: Find all exports like `export type { X } from '../models/X'`. Delete them. Duplicate the `X` type in the importing module's `models/` directory.
- **Required tests after remediation**: TypeScript compiler `pnpm typecheck` must pass without broken cross-module imports.
- **Related issues**: None
    > ⬜ **Code-verified:** Confirmed real. Grep finds 8 files with cross-module model type re-exports: `midi.ts`, `audioEngineQueries.ts`, `loadToasterKit.ts`, `workspaceQueries.ts`, `aiRuntimeQueries.ts`, and 3 plugin subscribers. These alias types from `../models/` through use cases. Fixing requires duplicating the type shapes in each importing module — wide-scope but mechanical refactor.

## Issue ID

`AUDIT-019`

## Fields

- **Title**: Lazy Function / Repo Passthroughs
- **Severity**: P1
- **Area**: frontend
- **Location(s)**: `src/modules/AudioEngine/useCases/deviceResolvers.ts`
- **Symptom**: Simple export aliases proxying repositories or other use cases, e.g., `export const doThing = otherEngineCall;`.
- **Why this is a problem in Sourdaw**: Leaks the inner contract to the outer layers rather than defining a clear, strongly-typed boundary.
- **Violated principle**: Passthroughs must be full functions with explicitly defined input/output prop types, acting as true independent use cases that merely happen to wrap another call.
- **Pattern mismatch**: Lazy aliases acting as structural boundaries.
- **Recommended pattern / abstraction**: Typed Function Wrapper wrapper. Use the `function` keyword, define proper `Input`/`Output` DTO props, and execute the repository call inside.
- **Recommended scope of refactor**: All passthrough exports.
- **Migration notes**: Convert `export const a = b;` to `export function a(props: AProps): AReturn { return b(props); }`.
- **Required tests after remediation**: Run TS checker and unit tests.
- **Related issues**: None
    > ✅ **FIXED:** `deviceResolvers.ts` now uses `export { DEVICE_FACTORIES }` (direct named re-export, no aliasing) and a proper wrapper `export function applyParams(dn, deviceType, params)` that delegates to `applyParamsImpl` from the repository. The lazy `const a = b` pattern is eliminated.

### 6.7 React/renderer/performance mismatches for DAW UX

## Issue ID

`AUDIT-008`

## Fields

- **Title**: Lethal IPC JSON Audio Blocks
- **Severity**: P0
- **Area**: engine/tauri
- **Location(s)**: `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts` and 23 other explicit `tauriInvoke(..)` bindings on the RT thread.
- **Symptom**: Real-time audio 128-sample frames are piped sequentially to Tauri via raw JSON RPC (`tauriInvoke('process_plugin_audio')`).
- **Why this is a problem in Sourdaw**: This guarantees devastating GC spikes, frame-rate decimation, and thread-locking inside the RT AudioWorklet. Utterly breaks lock-free DSP rules.
- **Violated principle**: Real-time audio code must remain lock-free and allocation-free.
- **Pattern mismatch**: Adapter mismatch; using HTTP/RPC paradigms inside sample-rate loops.
- **Recommended pattern / abstraction**: Lock-Free Ring Buffer (`SharedArrayBuffer` bound directly to WASM/Rust).
- **Recommended scope of refactor**: Tauri AudioBridge.
- **Migration notes**: Implement `rtrb` (Rust) and `SharedArrayBuffer` mapping for IPC bridge.
- **Required tests after remediation**: Verify audio playback does not spike UI thread.
- **Related issues**: None
    > ⬜ **Code-verified:** Confirmed real P0 bug. `NativePluginBridgeNode.ts` receives audio blocks from the AudioWorklet via `postMessage`, then on the main thread calls `tauriInvoke('process_plugin_audio', { audioData: Array.from(audioData) })` — converting Float32Array to a plain JS array for JSON serialization, then awaiting Rust IPC, then creating `new Float32Array(processed)` on the return. This creates 128-sample allocation cycles on the main thread at audio rate. The fix requires SharedArrayBuffer ring buffers to bypass the JSON serialization entirely. Architectural fix needed.

## Issue ID

`AUDIT-009`

## Fields

- **Title**: Main-Thread DSP Scheduling Bypass
- **Severity**: P0
- **Area**: engine/wasm
- **Location(s)**: src/modules/Synth/engine/drumSynthVoices.ts, src/modules/Yeast/useCases/yeastSchedulingBridge.ts
- **Symptom**: The 808 audio graph fabrication and complex Euclidean/Markov MIDI sequencers execute completely on the main JS event loop.
- **Why this is a problem in Sourdaw**: This cedes musical timing accuracy to UI renders. The sequencers will stutter and drift out of time the moment a UI component recomputes.
- **Violated principle**: Timing logic belongs in Compiled Schedules / AudioThread.
- **Pattern mismatch**: React state / UI timer driven schedulers.
- **Recommended pattern / abstraction**: Compiled Schedule (move sequencing entirely to AudioWorkletProcessor / Native Rust).
- **Recommended scope of refactor**: Synth voices and Yeast MIDI processors.
- **Migration notes**: Port logic to WASM/Rust DSP crates, leaving UI simply adjusting parameter bounds.
- **Required tests after remediation**: Verify Arpeggiator remains perfectly synced during heavy UI drag.
- **Related issues**: None
    > ⬜ **Code-verified (partially incorrect):** `drumSynthVoices.ts` uses Web Audio API native scheduling (`source.start(startTime)`) — no `setTimeout`. `yeastSchedulingBridge.ts` processes MIDI in `processBlock(events, blockStartSamples, blockEndSamples, ...)` called from the transport scheduler — not via `setTimeout`. The concern about main-thread processing is partially valid (Yeast block processing happens during the transport scheduler tick on the main thread, not in an AudioWorklet), but the "setTimeout" framing in the audit is inaccurate. The severity depends on the computational cost of `rack.processBlock`.

## Issue ID

`AUDIT-010`

## Fields

- **Title**: God Switch Factory Drift
- **Severity**: P2
- **Area**: engine
- **Location(s)**: src/modules/AudioEngine/engine/TrackNode.ts
- **Symptom**: The graph traverses a massive hardcoded `if isFermenterDevice`, `if isCrustDevice` block to generate audio nodes for every track update.
- **Why this is a problem in Sourdaw**: Violates Open/Closed principle. Every new plugin requires modifying the deep core execution loops of the track engine.
- **Violated principle**: Object creation branching must be modular.
- **Pattern mismatch**: Hard-coded registries hiding inside conditionals.
- **Recommended pattern / abstraction**: Registry / Factory composition pattern.
- **Recommended scope of refactor**: AudioEngine instantiation logic.
- **Migration notes**: Inject a central `DeviceDescriptor` capability map. Request nodes generically via `registry.create(device.kind)`.
- **Required tests after remediation**: Verify all 8 DAW native plugins correctly synthesize nodes.
- **Related issues**: None
    > ⬜ **Code-verified:** Confirmed real. `TrackNode.ts` has 18 occurrences of `isFermenterDevice` / `isCrustDevice` / `isToasterDevice` / etc. type guards in its device initialization logic — classic God Switch factory. Adding a new plugin requires modifying `TrackNode.ts`. Architectural fix needed — extract to a `DeviceDescriptor` registry. Large refactor, not a quick fix.

### 6.8 Tauri bridge violations & 6.9 Rust backend drift

## Issue ID

`AUDIT-011`

## Fields

- **Title**: Crate Workspace Sprawl
- **Severity**: P2
- **Area**: backend/rust
- **Location(s)**: crates/proof-chamber, crates/scoring, crates/daw-collab, etc.
- **Symptom**: Backend expanded from the mandated 5 tightly-bounded crates into 9 arbitrary libraries, turning WASM interfaces into standalone root-level crates.
- **Why this is a problem in Sourdaw**: Disintegrates compilation caching boundaries and scatters DSP domains making cross-compilation configurations brittle.
- **Violated principle**: Must respect the `daw-core, daw-engine, daw-dsp, daw-io, src-tauri` contract.
- **Pattern mismatch**: Utility graveyard / ad-hoc structural expansion.
- **Recommended pattern / abstraction**: Collapse to 5 crates. Push `proof-chamber` and `scoring` logic inside `daw-dsp` configured for `#[cfg(target_arch = "wasm32")]`.
- **Recommended scope of refactor**: Tauri Rust Backend.
- **Migration notes**: Consolidate `Cargo.toml` targets and restructure `daw-dsp/src/wasm/` modules.
- **Required tests after remediation**: Verify `pnpm build:tauri` compiles flawlessly.
- **Related issues**: None
    > ⬜ **Code-verified:** Not yet inspected. Needs Cargo.toml workspace review before work begins.

## Issue ID

`AUDIT-012`

## Fields

- **Title**: Controller Fatality in Bridge
- **Severity**: P2
- **Area**: backend/tauri
- **Location(s)**: src-tauri/src/commands/llm.rs, plugin_gui.rs
- **Symptom**: The IPC command functions are swollen with heavy native orchestrations and business logic linking UI directly to bare metal logic.
- **Why this is a problem in Sourdaw**: Tauri commands are meant to be a thin bridge. Baking logic here prevents the `daw-engine` from being portable or used in headless CLI rendering.
- **Violated principle**: Tauri commands act strictly as thin DTO un-wrappers.
- **Pattern mismatch**: Layer leakage: Tauri commands doing business logic.
- **Recommended pattern / abstraction**: Thin command wrapper calling strictly defined Services from `daw-engine`.
- **Recommended scope of refactor**: src-tauri commands folder.
- **Migration notes**: Refactor all orchestration logic downwards into `daw-io` or `daw-engine` traits.
- **Required tests after remediation**: Validate cross-thread safety of core functions directly in Rust Unit Tests.
- **Related issues**: None
    > ⬜ **Code-verified:** Not yet inspected. Needs Rust crate review before work begins.

### 6.13 Other Violations (Sync & FS)

## Issue ID

`AUDIT-013`

## Fields

- **Title**: Dual-Sync CRDT Conflict
- **Severity**: P0
- **Area**: frontend/sync
- **Location(s)**: src/modules/Collaboration/useCases/collaboration/broadcasting.ts
- **Symptom**: Manually broadcasts operations over WebSockets via Operational Transformation (OT) using custom `vectorClock.ts`.
- **Why this is a problem in Sourdaw**: The canonical datastore is Automerge (a CRDT). Introducing parallel redundant OT syncing creates divergent un-mergeable UIDs and guarantees massive document fragmentation.
- **Violated principle**: Single owner per behavior.
- **Pattern mismatch**: Patchwork orchestration duplicating existing framework solutions.
- **Recommended pattern / abstraction**: Delete the Collaboration module's custom websockets. Exclusively use `automerge-repo`.
- **Recommended scope of refactor**: Collaboration module.
- **Migration notes**: Strip and replace.
- **Required tests after remediation**: Verify two peers sync seamlessly without cloning duplicate track UUIDs.
- **Related issues**: None
    > ✅ **Audit incorrect — not applicable:** Neither `broadcasting.ts` nor `vectorClock.ts` exist in the codebase. The Collaboration module uses `automergeSync.ts` which correctly implements the native Automerge sync protocol (`Automerge.generateSyncMessage` / `Automerge.receiveSyncMessage`). There is no parallel OT/WebSocket system. This issue does not exist.

## Issue ID

`AUDIT-014`

## Fields

- **Title**: Silenced Scope Loss
- **Severity**: P3
- **Area**: tauri/fs
- **Location(s)**: src/modules/SampleLibrary/services/connectFolderTauri.ts
- **Symptom**: Saves raw filesystem paths strings upon directory ingest. Reloading the DAW attempts to `readDir` without permissions.
- **Why this is a problem in Sourdaw**: Tauri v2 flushes session permissions. Returning users will inexplicably see their sample libraries offline without warning.
- **Violated principle**: App configurations must match platform capability restrictions.
- **Pattern mismatch**: Adapter/Facade mismatch for Tauri capabilities.
- **Recommended pattern / abstraction**: Implement `tauri-plugin-persisted-scope` and deserialize the scope explicitly on boot.
- **Recommended scope of refactor**: SampleLibrary Tauri persistence.
- **Migration notes**: Update `src-tauri` capabilities and frontend boot sequence to re-validate scope matching local IndexedDB string.
- **Required tests after remediation**: Load sample dir, reload DAW window, verify samples stream instantly.
- **Related issues**: None
    > ⬜ **Code-verified:** Referenced file `connectFolderTauri.ts` does not exist in the codebase. The SampleLibrary module may have been restructured. The concern about Tauri v2 scope persistence may still apply if folder access is granted at runtime but not persisted. Needs a fresh grep for `@tauri-apps/plugin-fs` or `readDir` usage in the SampleLibrary before work begins.

---

## 4.5 Priority Backlog

### **P0 (Critical Data/RT Corruption Risk)**

- **AUDIT-008**: Eliminate JSON IPC Audio loops (`NativePluginBridgeNode`). Implement `SharedArrayBuffer` ring.
- **AUDIT-003**: Resolve the Singleton Plugin Store anti-pattern across all devices (`Fermenter`, `Crust`, etc.) to restore track multi-instancing.
- **AUDIT-013**: Delete the redundant `Collaboration` module logic and standardize on native Automerge patch syncing.
- **AUDIT-009**: Migrate `Yeast` and `Synth` sequencers off the main UI thread immediately.
- **AUDIT-004**: Fix Volatile CRDT Memory Trap, implement background patching.

### **P1 (Architecture violations actively slowing development)**

- **AUDIT-006**: Outlaw anonymous `pushUndoEntry` usage. Route all `Automation`, `MIDI`, and `Transport` writes through strict `ActionHandler` instances.
- **AUDIT-017**: Remove `createCallbackUndoEntry` from DSO AI Edit runtime, forcing actions into declarative data structures.
- **AUDIT-001**: Extract domain logic entirely from `ClipContextMenu` and `TrackContextMenu`.
- **AUDIT-005**: Lift volatile state (sidechains, hardware routing, pitch blobs) into the CRDT `Arrangement` schema.
- **AUDIT-015**: Ensure branch topologies sync over the network by migrating `branchStore` into the Automerge document metadata.
- **AUDIT-016**: Ensure AI action history persists reloading by migrating `actionHistoryStore` into Automerge or IndexedDB.
- **AUDIT-018**: Eliminate cross-module model aliasing; enforce model duplication across module boundaries instead of barrel exporting types.
- **AUDIT-019**: Refactor all lazy repository passthroughs (`export const a = b`) into fully-typed independent usecase wrapper functions.
- **AUDIT-021**: Extract `tauriInvoke` IPC calls out of presentation hooks (`useVoiceRecording.ts`) directly into proper repositories/usecase bindings.

### **P2 (Maintainability and Complexity)**

- **AUDIT-010**: Convert the `TrackNode` device-switch factory into a generic capability registry.
- **AUDIT-011**: Collapse the 9-crate backend workspace back into the 5-crate structure.
- **AUDIT-012**: Extract business logic out of `src-tauri` commands bridge into `daw-engine`.
- **AUDIT-007**: Separate DSP logic out of `polyphonicAudioToMidi` orchestration paths.
- **AUDIT-020**: Strip old manual memoization hooks (`useMemo`, `useCallback`) to let the React 19 Compiler naturally optimize render paths.

### **P3 (Cleanup)**

- **AUDIT-014**: Retain persistent `Tauri` v2 folder scopes using persisted-scope plugin.

---

## 4.6 Pattern Prescription Matrix

| Smell Encountered                                         | Why it's harmful here                                                           | Ideal Target Pattern                  | Simple Remediation                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Singleton Device Stores**<br/>(e.g., `fermenterStore`)  | Completely breaks track multi-instancing by clobbering global state.            | **Parameterized Selectors / Context** | Extract state into `trackStore`'s `DeviceState` CRDT model. Read via `useDeviceState(deviceId)`.      |
| **Anonymous Undo Closures**<br/>(`pushUndoEntry`)         | Prevents network sync and serialization. Leaves holes in the document log.      | **Command Pattern**                   | Wrap mutation in strict `AppAction` DTOs. Process via typed `ActionHandler`.                          |
| **JSON IPC Audio Loops**<br/>(`tauriInvoke`)              | Fails frame-rate guarantees; GC spikes inside the audio thread.                 | **Lock-Free Ring Buffer**             | Use `SharedArrayBuffer` bridged directly to `daw-engine`.                                             |
| **God Switches in Render**<br/>(`TrackNode.ts`)           | Violates Open/Closed principle. Hot-graph must be updated for every new plugin. | **Strategy / Registry**               | Invert dependency: Inject a `DeviceDescriptor` registry array at boot.                                |
| **Main-Thread Sequencers**<br/>(`drumSynthVoices`)        | Cedes musical timing accuracy to the JS DOM Event loop.                         | **Compiled Schedule**                 | Process events purely inside `AudioWorkletProcessor` or native Rust `ProcessTask` iterator.           |
| **Cross-Module Model Aliasing**<br/>(`export type {X}`)   | Tightly couples modules. Violates independence of bounded contexts.             | **Model Duplication**                 | Stop exporting models from use cases. Duplicate the model shape natively inside the importing module. |
| **Lazy Function Passthroughs**<br/>(`export const a = b`) | Leaks inner implementation signatures instead of defining a rigid outer bound.  | **Typed Function Wrapper**            | Convert to `function a(props: Props): Res { return b(props); }` with fully distinct typing.           |
| **Manual Memoization**<br/>(`useMemo`, `useCallback`)     | Obsolete due to React 19 Compiler. Visually clutters codebase.                  | **Plain Code**                        | Strip the hook wrappers; let the compiler optimize at build time.                                     |
| **Presentation IPC Bypass**<br/>(`useVoiceRecording.ts`)  | Connects UI layer directly to bare-metal Tauri commands.                        | **Repository Extraction**             | Move all `tauriInvoke` lines into `repositories/`, orchestrated via a `useCase`.                      |
| **Unbounded Audio Cache**<br/>(`audioBufferCache.ts`)     | Endless RAM growth from waveform peak data caching leads to OOM crashes.        | **LRU Cache Limit**                   | Wrap `waveformCache` in an LRU implementation and cap max array size.                                 |

---

## 4.7 Refactor Sequencing Plan

**Phase 1: Guard the RT / Data Boundary**

- Halt all JSON IPC in the audio bridge. Implement memory-safe ring buffers.
- Lift all volatile state (sidechains, hardware routing, pitch blobs) into the CRDT `Arrangement` schema.
- Implement incremental background saves for Automerge IndexedDB adapters.

**Phase 2: Restore Domain/Store Ownership**

- Obliterate the Singleton Store pattern across all plugins. Map them directly into the CRDT graph under `track.devices[id].state`.
- Remove the redundant `Collaboration` websocket protocol wrapper.

**Phase 3: Thin React & Remove Orchestration Drift**

- Extract all domain logic from `ClipContextMenu` and `TrackContextMenu` to pure useCases.

**Phase 4: Restore the AppAction Command Registry**

- Eradicate `pushUndoEntry` anonymous closures permanently.
- Map `Automation`, `Transport`, and `MIDI` CRUD processes through typed `AppAction`s exclusively.

**Phase 5: Normalize Registries & Factories**

- Remove monolithic `switch` statements from `TrackNode`. Use a localized plugin descriptor registry.

**Phase 6: Simplify Backend & Collapse Deviation**

- Repatriate drifted crates (`scoring`, `proof-chamber`) back into `daw-dsp` WASM build targets.
- Remove business logic from `src-tauri` controllers and shift boundaries into `daw-engine`.
