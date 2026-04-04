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

### ~~RT-1 · ScriptProcessorNode recording pipeline~~ — DONE
**Severity:** P0 · **Fixed:** ✅

`ScriptProcessorNode` + `rawChunks: Float32Array[]` replaced with:

- `recordingProcessor.ts` (AudioWorkletProcessor `'recording-processor'`): Writes 128-sample input
  blocks into a SAB ring buffer via `Atomics.add`. Zero allocations and zero IPC on the hot path.
  Registered in `createWebAudioEngine.initialize()`.
- SAB layout: `[0..3] writeHead (Int32)` · `[4+] ring (Float32, 524 288 entries ≈ 10.9 s @ 48 kHz)`.
- `recordingWorker.ts` (OPFS Web Worker): Polls the SAB ring every 50 ms, drains new samples into
  an OPFS temp file (`rec-tmp-<timestamp>.pcm`). On stop: final drain → close writable → read file
  back → transfer `Float32Array` to main thread (zero-copy via `Transferable`). Removes temp file.
- `recording.ts` (main thread): Creates SAB + `AudioWorkletNode` + Worker, wires 'ready'/'pcm'
  message flow. `stopAudioRecording()` is non-blocking; `onRecordingComplete(buffer)` fires after
  the Worker finishes, unchanged for all callers. `AudioWorkletNode` is a sink (no destination
  connection needed), so no silent output is injected into the mix.

Result: zero main-thread work during capture; memory is flat regardless of session length;
stopping recording no longer freezes the UI.

---

### ~~RT-2 · MIDI note scheduling via `setTimeout`~~ — DONE
**Severity:** P0 · **Fixed:** ✅

All three processors converted from float-seconds `scheduleTime` to integer `sampleFrame`:
- `fermenterProcessor.ts`, `levainProcessor.ts`, `toasterProcessor.ts`: `_enqueue`/`_handleMessage`/`_drainQueue`/`process()` now compare `sampleFrame` (integer) against `currentFrame` (AudioWorklet global integer). Eliminated `currentFrame / sampleRate` float division on the hot path.
- `FermenterNode.ts`, `LevainNode.ts`, `ToasterNode.ts`: `noteOn`/`noteOff` parameter renamed `scheduleTime → sampleFrame`.
- `AudioEngineState.ts`: control interface types updated to `sampleFrame?: number`.
- `scheduleMidiNotes.ts`: after computing `time`, added `const sr = getAudioContext().sampleRate; const sampleFrame = Math.round(time * sr); const endSampleFrame = Math.round((time + duration) * sr)`. All 5 instrument call sites (`fermenterControls.noteOn/Off`, `levainControls.noteOn/Off`, `toasterControls.noteOn`) now pass integer `sampleFrame`/`endSampleFrame`.
- Yeast section: replaced all 5 hardcoded `44100` references with `yeastSr = getAudioContext().sampleRate`, fixing a separate correctness bug for non-48kHz contexts.

---

### ~~RT-3 · Synchronous Automerge load/merge on main thread~~ — DONE
**Severity:** P0 · **Fixed:** ✅

Created `src/modules/CrdtDocument/workers/crdtWorker.ts` with two handlers:
- `loadBundle`: loads base docs + applies incremental chunks (the heavy WASM loop), saves compacted binaries, returns them.
- `mergeBundle`: loads current docs + incoming bundle, merges, saves compacted, returns merged binaries + result metadata.

`automergeRepository.ts` changes:
- Added `getCrdtWorker()` singleton getter (lazy, Vite `new URL` pattern) + `invokeWorker()` promise wrapper with message-ID correlation.
- `loadAll()` → async: sends bundle to worker, receives compacted binaries, calls `Automerge.load()` once per doc (fast — no incremental chain), updates `this.docs`, calls `notifyListeners()`. Falls back to synchronous `_loadAllSync()` on worker failure.
- `mergeBundle()` → async: serializes current docs via `saveAll()`, sends both to worker, receives merged compacted binaries, loads each once, notifies. Falls back to `_mergeBundleSync()`.

Callers updated: `crdtProjectLifecycle.loadCrdtProject()` → `await automergeRepository.loadAll(bundle)`. `crdtMerge.importSdawFile()` + `mergeDocumentBundle()` → `await automergeRepository.mergeBundle(bundle)`. All callers were already async functions — zero signature changes upstream.

Main thread WASM work reduced from O(m·n) (repeated loadIncremental) to O(n) (single load of compacted binary).

---

### ~~RT-4 · AudioWorklet telemetry via `postMessage`~~ — DONE
**Severity:** P1 · **Fixed:** ✅

`telemetryAllocator.ts` was already in place. Connected it end-to-end:

- `grinderProcessor.ts`, `bacteriaProcessor.ts`, `glutenProcessor.ts`, `scoringProcessor.ts`: added `_sabView = null` field; handle `init-sab` message to set `new Float32Array(msg.sab, msg.byteOffset, 32)`; replace `this.port.postMessage({ type: 'meters'/'telemetry', ... })` with indexed writes into `_sabView` (only when SAB is available). Index order matches `GRINDER_IDX` / `BACTERIA_IDX` / `GLUTEN_IDX` / `SCORING_IDX` in `telemetryAllocator.ts`.
- `GrinderNode.ts`, `BacteriaNode.ts`, `GlutenNode.ts`, `ScoringNode.ts`: allocate a SAB slot via `telemetryAllocator.allocateSlot()` immediately after node creation; post `{ type: 'init-sab', sab, byteOffset }` before `init`; replace `port.onmessage meters/telemetry` handler with rAF polling of slot view; `onMeterData`/`onTelemetry` starts the rAF loop, `destroy()` cancels it and calls `releaseSlot()`.
- `ScoringNode.ts`: `noteName` re-derived from `view[SCORING_IDX.noteIndex]` using `NOTE_NAMES` array on the main thread — the string is never transferred.

Result: zero structured clones per audio block for meter data; rAF reads are plain array-index loads; slot memory is reused across device lifetimes.

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

### ~~AR-1 · Singleton plugin state prevents multi-instancing~~ — DONE
**Severity:** P0 · **Fixed:** ✅

Converted 5 telemetry stores from `Store<State>` singletons to `Store<Record<deviceId, State>>`
instance maps: `bacteriaStore`, `glutenStore`, `grinderStore`, `proofStore`, `scoringStore`.
All store update/getter functions now take `deviceId` as first argument.

`AppShell.tsx` changed 5 `useState(false)` panel flags to `useState<string | null>(null)`.
Device-open events upgraded from `new Event(...)` to `new CustomEvent(..., { detail: { deviceId } })`.
AppShell extracts `deviceId` from event detail and passes it as a prop to each panel.

All param bridges updated to use `findDeviceRef(deviceId)` (scoped to one device) instead of
`getActiveDevices()` (broadcast to all instances of the type). Pending-update maps use
`${deviceId}:${key}` composite keys to prevent cross-instance collisions.

`ProofParamBridge` changed from singleton `let bridge` to `Map<string, ProofAudioBridge>`.

Panels updated to accept `deviceId: string` prop and read instance state via
`allInstances?.[deviceId] ?? getDefaultState(deviceId)`:
- `GlutenPanel.tsx` — inner `Knob` sub-component receives `deviceId` prop
- `BacteriaPanel.tsx` — `setGlobalParam`, `K` component, all sub-components threaded
- `GrinderPanel.tsx` — `GrinderKnob`, `SectionTabs`, `ControlDeck` threaded
- `ProofPanel.tsx` + all `ProofEqSection`/`ProofDynSection`/`ProofImagerSection`/`ProofExciterSection`/`ProofLimiterSection`/`ProofEqCurve` components threaded
- `ScoringPanel.tsx` — already updated in previous session

`RT-4` SharedArrayBuffer telemetry polling already uses `deviceId` scoping in the SAB allocator
(slot-per-device), so telemetry data routes correctly to the right instance store.

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

### ~~AR-5 · Yeast sequencer on main thread~~ — DONE
**Severity:** P1 · **Fixed:** ✅

Created `src/modules/Yeast/services/yeastWorkletProcessor.ts` — AudioWorkletProcessor hosting `MidiRack` + all processors in the audio thread. Handles `addProcessor`, `removeProcessor`, `setParam`, `setBypass`, `processBlock` messages; sends `{ type: 'processed', requestId, events }` responses.

Created `src/modules/Yeast/engine/YeastWorkletNode.ts` — wrapper with `processBlock(): Promise<MidiEvent[]>` using per-request ID correlation and a lazy `ensureWorkletRegistered` WeakMap.

`yeastStore.ts` changes:
- Added `processorTypeMap: Map<id, ProcessorType>` — explicit type tracking (replaces brittle `inferType` heuristic for worklet sync).
- `addYeastProcessor` now generates an explicit `id`, creates processor with that ID on both main-thread rack and worklet.
- `removeProcessor`, `setParam`, `setBypass` all mirror to `_workletNode` if set.
- `getYeastWorkletNodeAsync(ctx)` — lazy singleton that creates the node on first call and syncs any processors added before init.

`scheduleMidiNotes.ts` changes:
- Function signature: `function → async function`, returns `Promise<void>`.
- Yeast block: `const workletNode = await getYeastWorkletNodeAsync(ctx)` → `workletNode ? await workletNode.processBlock(...) : rack.processBlock(...)`.

`playheadScheduler.ts`: `tick` converted to `async` arrow const; `await scheduleMidiNotes(...)`.

`yeastSchedulingBridge.ts`: fixed hardcoded `44100` → `getAudioContext().sampleRate` (live MIDI path still uses main-thread rack for low-latency response; scheduled clip path uses worklet).

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
