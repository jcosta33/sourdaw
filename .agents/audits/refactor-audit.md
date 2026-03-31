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
- **Related issues**: None

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
- **AUDIT-001**: Extract domain logic entirely from `ClipContextMenu` and `TrackContextMenu`.
- **AUDIT-005**: Lift volatile state (sidechains, hardware routing, pitch blobs) into the CRDT `Arrangement` schema.

### **P2 (Maintainability and Complexity)**

- **AUDIT-010**: Convert the `TrackNode` device-switch factory into a generic capability registry.
- **AUDIT-011**: Collapse the 9-crate backend workspace back into the 5-crate structure.
- **AUDIT-012**: Extract business logic out of `src-tauri` commands bridge into `daw-engine`.
- **AUDIT-007**: Separate DSP logic out of `polyphonicAudioToMidi` orchestration paths.

### **P3 (Cleanup)**

- **AUDIT-014**: Retain persistent `Tauri` v2 folder scopes using persisted-scope plugin.

---

## 4.6 Pattern Prescription Matrix

| Smell Encountered                                        | Why it's harmful here                                                           | Ideal Target Pattern                  | Simple Remediation                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Singleton Device Stores**<br/>(e.g., `fermenterStore`) | Completely breaks track multi-instancing by clobbering global state.            | **Parameterized Selectors / Context** | Extract state into `trackStore`'s `DeviceState` CRDT model. Read via `useDeviceState(deviceId)`. |
| **Anonymous Undo Closures**<br/>(`pushUndoEntry`)        | Prevents network sync and serialization. Leaves holes in the document log.      | **Command Pattern**                   | Wrap mutation in strict `AppAction` DTOs. Process via typed `ActionHandler`.                     |
| **JSON IPC Audio Loops**<br/>(`tauriInvoke`)             | Fails frame-rate guarantees; GC spikes inside the audio thread.                 | **Lock-Free Ring Buffer**             | Use `SharedArrayBuffer` bridged directly to `daw-engine`.                                        |
| **God Switches in Render**<br/>(`TrackNode.ts`)          | Violates Open/Closed principle. Hot-graph must be updated for every new plugin. | **Strategy / Registry**               | Invert dependency: Inject a `DeviceDescriptor` registry array at boot.                           |
| **Main-Thread Sequencers**<br/>(`drumSynthVoices`)       | Cedes musical timing accuracy to the JS DOM Event loop.                         | **Compiled Schedule**                 | Process events purely inside `AudioWorkletProcessor` or native Rust `ProcessTask` iterator.      |


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
