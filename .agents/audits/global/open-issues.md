# Sourdaw — Open Issues

All issues that were fixable incrementally have been addressed. What remains
are either **infrastructure workstreams** (require building new machinery that
does not exist yet) or **architectural refactors** (require coordinated changes
across many files). None are dep-cruiser module-boundary violations.

Each item has been verified against the current codebase.

---

## Group 1 — Real-time infrastructure (SharedArrayBuffer workstreams)

These five issues share the same root cause: the audio thread communicates via
serialised messages or deprecated APIs instead of lock-free shared memory. They
should be tackled together or in dependency order.

---

### RT-1 · ScriptProcessorNode recording pipeline
**Severity:** P0 · **Verified:** ✅ confirmed

`recording.ts` uses `ctx.createScriptProcessor(BUFFER_SIZE, 1, 1)` with
`onaudioprocess`. The node runs on the main JS thread. Each callback pushes
`new Float32Array(input)` onto an unbounded `rawChunks` array. On
`stopRecording`, all chunks are concatenated synchronously on the main thread.

Consequences: recording competes with React renders for main-thread time,
causing dropouts; a 1-hour session allocates ~344k `Float32Array` objects;
stopping recording freezes the UI while the buffer assembles.

**Steps:**
1. Implement a `RecordingWorkletNode` (`AudioWorkletProcessor`) that captures raw PCM on the isolated audio thread.
2. Allocate a `SharedArrayBuffer` ring queue. The worklet writes 128-sample frames; the main thread drains it.
3. Wire a background Web Worker to consume the ring and stream PCM to OPFS, keeping memory flat.
4. On `stopRecording`, the Worker flushes and returns the OPFS file handle — no in-memory concatenation.

---

### RT-2 · MIDI note scheduling via `setTimeout`
**Severity:** P0 · **Verified:** ✅ confirmed

`scheduleMidiNotes.ts` uses `setTimeout` for all Fermenter, Levain, and Toaster
note-on/note-off events (7 call sites verified). `setTimeout` is subject to
main-thread backpressure and browser clamping — notes fire with variable jitter,
destroying groove and timing accuracy.

**Steps:**
1. Add a timestamped MIDI event queue to each Rust AudioWorklet processor. The queue holds `(sample_frame, event)` pairs.
2. Push events via `postMessage` well ahead of time inside the existing lookahead window.
3. Inside each processor's `process()` loop, drain events whose `sample_frame` falls within the current block.
4. Remove all `setTimeout` calls from `scheduleMidiNotes.ts` for these instruments.

Should be done together with RT-4 since both require new message types in the processor protocol.

---

### RT-3 · Synchronous Automerge load/merge on main thread
**Severity:** P0 · **Verified:** ✅ confirmed

`automergeRepository.loadAll()` calls `Automerge.load()` +
`Automerge.loadIncremental()` synchronously. `mergeBundle()` calls
`Automerge.load()` + `Automerge.merge()` synchronously. Loading a large project
or receiving a large collaboration patch freezes the UI until Automerge finishes
its WASM parsing.

**Steps:**
1. Move Automerge WASM initialisation into a dedicated `crdt.worker.ts`. The WASM binary must be re-initialised inside the Worker context.
2. Expose `load(binary)` and `merge(bundle)` as Worker messages; the Worker returns the hydrated plain-object state.
3. `automergeRepository` on the main thread posts to the Worker, awaits the state, then calls `notifyListeners()`.
4. `AutomergeStorage.hydrate()` already handles plain-object state correctly — no changes needed there.

This is the largest single change in the codebase. Coordinate with RT-4 since the Worker also becomes the natural owner of `changeDoc` writes.

---

### RT-4 · AudioWorklet telemetry via `postMessage`
**Severity:** P1 · **Verified:** ✅ confirmed

Each processor sends telemetry (RMS, LUFS, pitch, EQ) via
`this.port.postMessage({})` every ~4 audio blocks (~85 Hz). With 12 tracks and
4 plugins each this produces ~4 000 structured clones/second, driving continuous
GC pressure. All 8 processor files confirmed: `fermenterProcessor.ts`,
`levainProcessor.ts`, `grinderProcessor.ts`, `toasterProcessor.ts`,
`proofChamberProcessor.ts`, `scoringProcessor.ts`, `bacteriaProcessor.ts`,
`glutenProcessor.ts`.

**Steps:**
1. Allocate a single `SharedArrayBuffer` at engine init, large enough for all plugin telemetry slots (e.g. 64 plugins × N floats).
2. During `addDeviceToStrip`, assign a fixed byte offset to each plugin instance and send it via `postMessage({ type: 'init-sab', offset, buffer })`.
3. Each processor writes scalar telemetry directly into a `Float32Array` view of the SAB at its offset.
4. UI meters read from the SAB inside their `requestAnimationFrame` loops — zero allocations, zero IPC.

Do in the same sprint as RT-2 since both require a new `init-sab` message type in the processor protocol.

---

### RT-5 · NativePluginBridgeNode JSON IPC in the audio hot-path
**Severity:** P0 · **Verified:** ✅ confirmed

`NativePluginBridgeNode.ts` receives 128-sample audio blocks from the
AudioWorklet via `postMessage`, converts `Float32Array` to `Array.from(audioData)`
for JSON serialisation, calls `tauriInvoke('process_plugin_audio', { audioData })`,
awaits the Rust response, then reconstructs `new Float32Array(processed)`. This
runs on the main thread at audio rate, creating allocation cycles every 128
samples and blocking on async IPC inside what should be a real-time loop.

**Steps:**
1. Allocate a `SharedArrayBuffer` ring buffer for one stereo 128-sample block.
2. Map the SAB into Rust via the WASM bridge.
3. The AudioWorklet writes its block to the ring and signals via `Atomics.notify`. Rust reads via `Atomics.wait` in a dedicated RT thread in `daw-engine`.
4. Rust writes the processed block into a second ring; the Worklet reads it.
5. Remove `tauriInvoke('process_plugin_audio')` entirely.

---

## Group 2 — Architectural refactors

Wide-scope changes that require planning as a unit. No new infrastructure needed.

---

### AR-1 · Singleton plugin state prevents multi-instancing
**Severity:** P0 · **Verified:** ✅ confirmed — 11 singleton stores found

Every device plugin has a single global `Store<T>` instance:
`bacteriaStore`, `fermenterStore`, `glutenStore`, `grinderStore`, `proofStore`,
`toasterStore`, `levainStore`, `yeastStore`, `kneadStore`, `scoringStore`,
`crustStore`. Plugin inspector panels read directly from these globals with no
`deviceId` scoping — when two instances of the same plugin are on different
tracks they share state and visually clobber each other.

The per-instance infrastructure already exists: `Track.devices[].parameterValues`
holds generic numeric params per device. The fix is to move plugin-specific UI
state (metering, patch data, selected module) into that same model and scope
inspector panels by `deviceId`.

Note: `ProofChamber` has a `chamberStore` with an `instances: Record<string, ...>`
map that is multi-instance-ready but not yet wired up — it can serve as the
reference implementation.

**Steps:**
1. Remove all per-plugin singleton stores.
2. Move device state into `tracks[].devices[].parameterValues` (already in CRDT).
3. Inspector panels receive `deviceId` as a prop and select their slice via a `useDeviceState(deviceId)` selector.
4. Use the existing `ProofChamber` `chamberStore.instances` pattern as the template.

---

### ~~AR-2 · `compileDso.ts` bypasses the AppAction registry~~ — DONE
**Severity:** P1 · **Fixed:** ✅

18 direct `trackStore.set()`/`transportStore.set()` mutations in `executeSingleDso()`
replaced with `executeAppAction(action, { skipUndo: true, source: 'ai' })` calls.
Covered: `renameTrack`, `setTrackGain`, `setTrackPan`, `muteTrack`, `soloTrack`,
`armTrack`, `setTrackColor`, `reorderTrack`, `removeClip`, `renameClip`, `moveClip`,
`splitClip`, `removeDevice`, `bypassDevice`, `setDeviceParameter`, `setClipGain`,
`setTempo`, `transposeNotes`.
`skipUndo: true` added to `ExecuteOptions` in `executeAppAction.ts` so individual
per-DSO undo entries are not pushed (batch undo is managed by `executeDsoEdit`).
`setDeviceParameter` now also fires `updateDeviceParam` to the audio engine — previously
missing with the direct store mutation.
Remaining as direct calls (no matching AppAction type): `set_time_signature`,
`add_midi_notes`, `humanize_midi`, `create_send`, `generate_*`.

---

### ~~AR-3 · Anonymous undo closures (`createCallbackUndoEntry`)~~ — DONE
**Severity:** P1 · **Fixed:** ✅

Added `{ type: 'restoreDsoSnapshot'; payload: { bundle: DocumentBundle } }` to
`AppAction.ts` with a handler in `executeAppAction.ts` that calls
`automergeRepository.restoreSnapshot(bundle)`.
`executeDsoEdit.ts` `commitDsos()` now uses `createUndoEntry(label, afterAction,
beforeAction, 'ai')` instead of `createCallbackUndoEntry`. The Automerge bundle
snapshots (Map<string, Uint8Array>) are stored as data, not closures — enabling
future collaborative undo serialization.
Note: `createCallbackUndoEntry` still used elsewhere (import functions, AI MIDI
generation) — those are separate closures outside the DSO batch path.

---

### ~~AR-4 · TrackNode device-initialization branching~~ — DONE
**Severity:** P2 · **Fixed:** ✅

Created `wasmDeviceRegistry.ts` with `WasmDeviceDescriptor` interface and 10 descriptors
(NativeDsp, Fermenter, Toaster, Levain, ProofChamber, Gluten, Bacteria, Grinder, Proof, Scoring).
Each descriptor encapsulates the full async load sequence (loading bypass, pending-params queue,
WASM init, swap-in, side effects). `TrackNode.addDevice()` replaced the 10 branches with a single
`findWasmDescriptor(deviceType)?.create(deps)` lookup. Adding a new WASM plugin no longer
requires editing `TrackNode.ts`.

---

### AR-5 · Yeast sequencer on main thread
**Severity:** P1 · **Verified:** ✅ confirmed — no YeastWorkletProcessor exists

`yeastSchedulingBridge.ts`'s `rack.processBlock(events, ...)` is called from
the transport scheduler tick (`scheduleMidiNotes.ts` line 172) on the main thread.
Arpeggiator, Euclidean, and Markov processors all run synchronously during the
tick. Under dense MIDI and heavy processing this competes with React renders and
CRDT writes.

**Steps:**
1. Implement a `YeastWorkletProcessor` (`AudioWorkletProcessor`).
2. Push scheduling parameters and incoming MIDI into the worklet via `postMessage` during the lookahead window.
3. The worklet generates and fires events at the correct sample frame.

---

## Group 3 — Code quality

---

### ~~CQ-1 · Multi-export use-case files~~ — DONE
**Severity:** P2 · **Fixed:** ✅

`taskManagement.ts` split into `toggleAiPanel.ts`, `addTask.ts`, `updateTask.ts`, `removeTask.ts`.
`audioProcessing.ts` split into `handleAiDenoiseClip.ts`, `handleStemSeparationPreview.ts`, `handleGenerateAudioFallback.ts`.
All importers updated. Old files deleted.

---

### ~~CQ-2 · `polyphonicAudioToMidi` — architectural boundary violation~~ — DONE
**Severity:** P2 · **Fixed:** ✅

`insertNotesIntoTimeline` extracted to `insertPolyphonicMidiNotes.ts`.
`polyphonicAudioToMidi` now returns `{ notes, sourceClip }` — no timeline imports.
`ClipAudioAiSection` calls `insertPolyphonicMidiNotes` after getting the note result.

---

### ~~CQ-3 · Cross-module model aliasing~~ — REMOVED, NOT A REAL ISSUE
**Verified:** ❌ audit claim was inaccurate

The original audit described "cross-module model aliasing" but code inspection
shows these are **intra-module barrel exports** — e.g. `MIDI/useCases/midi.ts`
re-exporting from `MIDI/models/`. This is a standard and intentional pattern for
providing a single public API entry point per bounded context. There is no
cross-module coupling violation here. 24 files use this pattern consistently;
removing it would break the module's public API contract, not fix it.

---

## Group 4 — State persistence correctness

---

### SP-1 · Branch topology not synced to CRDT
**Severity:** P1 · **Verified:** ✅ confirmed — feature is actively used

`branchStore` uses `new LocalStorageStorage('sourdaw-branches')`. Branch
documents themselves ARE stored in Automerge (via `automergeRepository.insertDoc`),
but branch topology metadata (the list of `BranchRecord` objects with IDs,
names, sourceIds) is stored only in localStorage. In a collaborative session,
peer B never sees peer A's branches.

The `BranchManagerDialog` UI is active and exposes fork, switch, merge, and
delete. This is not dead code.

Requires a product decision: are branches a local workspace concept (intentional)
or should they sync across collaborators?

**If synced:** Move the `BranchStoreState` into a dedicated Automerge metadata
document synced alongside the project doc.

---

### ~~SP-2 · AI action history volatile~~ — DONE
**Severity:** P1 · **Fixed:** ✅

Added `storage: new LocalStorageStorage('sourdaw-ai-history')` to `aiActionHistoryStore`.
Key registered in `LocalStorageKeys.ts`. History now survives page reloads.

---

## Group 5 — Rust backend

---

### RB-1 · Crate workspace sprawl
**Severity:** P2 · **Verified:** ✅ confirmed — 9 crates in Cargo.toml

Root `Cargo.toml` workspace members: `daw-core`, `daw-collab`, `daw-engine`,
`daw-dsp`, `daw-io`, `daw-plugin-host`, `proof-chamber`, `scoring`, `src-tauri`.
The intended boundary was 5 (`daw-core`, `daw-engine`, `daw-dsp`, `daw-io`,
`src-tauri`). `proof-chamber` and `scoring` are standalone WASM crates
(`crate-type = ["cdylib", "rlib"]`) that should live under `daw-dsp` behind
`#[cfg(target_arch = "wasm32")]`.

**First step:** Run `cargo tree` and map cross-crate dependencies before
consolidating.

---

### RB-2 · Business logic in Tauri command handlers
**Severity:** P2 · **Verified:** ✅ confirmed

`llm.rs` (339 lines): spawns the llama-server sidecar process, manages TCP port
binding and health checks, orchestrates HTTP client calls to the external service,
and parses SSE streams — all directly inside Tauri command functions. This is
orchestration that should live in `daw-engine` service traits.

`plugin_gui.rs` (225 lines): handles window creation, native window handle
extraction, platform-specific conversion, and CLAP GUI lifecycle calls. Closer
to a bridge than `llm.rs` but still beyond thin DTO unwrapping.

**Fix:** Extract orchestration logic into `daw-engine` or `daw-io` service
traits. Tauri commands become thin DTO unwrappers that delegate to those traits.

---

### ~~RB-3 · Tauri v2 folder scope not persisted~~ — DONE
**Severity:** P3 · **Fixed:** ✅

Added `tauri-plugin-persisted-scope = "2"` to `src-tauri/Cargo.toml`.
Registered `.plugin(tauri_plugin_persisted_scope::init())` in `src-tauri/src/lib.rs`.
The plugin auto-intercepts scope grants and restores them on next app launch — no JS changes required.
