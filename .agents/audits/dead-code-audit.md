# Dead Code Audit — 2026-03-28 (Rev 5)

Produced by running `pnpm knip` against the codebase, investigating every finding, performing two rounds of cleanup, analyzing integration plans, and conducting a deep quality/utility/strategic audit of all remaining feature islands.

## Current State (post-cleanup)

| Category                                       | Unused Files | Unused Exports | Other                |
| ---------------------------------------------- | ------------ | -------------- | -------------------- |
| Feature islands (unique, unwired)              | 47           | ~140           | —                    |
| Shadcn library surface                         | 0            | 7              | —                    |
| Wire-ready (just needs UI mount)               | 1            | ~3             | —                    |
| Newly dead (from our cleanup)                  | 3            | ~3             | —                    |
| Duplicate implementation (needs consolidation) | 0            | 9              | audioWarping vs warp |
| **Totals**                                     | **51**       | **188**        | —                    |

**What was cleaned (cumulative across 2 rounds):**

- 53 dead files deleted
- ~76 dead/superseded exports removed
- 10 dead types removed
- 5 duplicate alias chains migrated
- 6 legacy Frontify files deleted
- 11 unresolved imports eliminated

---

## 1. CLEANED — Already deleted

### Round 1 (47 files, 13 exports, 3 types, 5 alias chains)

**Deleted files:** `HighEndPluginUI.tsx`, `HighEndPluginProcessor.ts`, `ParameterSAB.ts`, `ElasticAudioTypes.ts`, `SamplePlayerTypes.ts`, `merge.ts`, `TrackAutomationHeader.tsx`, `contracts.ts`, entire `effects/` directory (15 files), `CompressorGainReduction.tsx`, `VUMeterCanvas.tsx`, `BitcrusherStaircase.tsx`, `ArticulationIndicator.tsx`, `InstrumentSelector.tsx`, `LevainPresetBrowser.tsx`, `PerformancePanel.tsx`, `PadInspector.tsx`, `SequencerToolbar.tsx`, `elasticAudio/` (5 files), `samplePlayer/` (4 files), `dawProject/` (3 files + types), `DawProjectTypes.ts`, `navigateToNode.ts`, `undoTree/queries.ts`.

**Removed exports:** `getLessonsByCategory`, `getLessonsByLevel`, `gain` (preset), `NOTE_NAMES`, `PROMPT_CATEGORY_KEYS`, `setGrinderUiLevel`, `setGrinderEngineReady`, `isSequencerPlaying`, `CodeLocation` type, `AiRuntimeStatus` type, `BuildDeviceChainInput` type.

**Migrated alias chains:** `DAW_CHAT_TOOLS` → `DAW_TOOL_SCHEMAS`, `isLlamaServerRunning` → `isNativeEngineReady`, `initLlamaServer`/`stopLlamaServer` → `initNativeEngine`/`stopNativeEngine`, `getTrackState` → `getTrackStoreState`.

### Round 2 (6 files, ~49 exports, 7 types)

**Deleted files:** `createLogger.ts`, `createLogger.spec.ts`, `createEventBus.ts`, `createEventBus.spec.ts`, `DevToolsEventBus.ts`, `DevToolsEventBus.spec.ts`.

**Removed superseded exports:** `engineSetTrackMute`, `mapAllTracks`, `updateClipsOnAllTracks` (use-case wrappers), `enableLooping`, `toggleLooping`, `getTimeSignatureAtBeat` (use-case wrapper), `getAudioEngine`, `isRippleEditing`, `PROJECT_STORAGE_KEY`, `getScannedPlugins`, `getScannedPluginsByFormat`, `getMacros`, `isRecording` (macro).

**Removed dead re-exports:** `getMpeEnabled`, `getAvailableMidiInputs`, `startMidiLearnLegacy`, `stopMidiLearnLegacy`, `destroyWebMidi` from `webMidiInput.ts`. `getFactoryDrumKits` from passthrough chain.

**Removed dead filter/category functions:** `getPresetsByCategory` (3 modules), `getPresetsByLevel`, `getTemplatesByCategory`.

**Removed dead store mutators:** `setLevainUiLevel`, `updateEngineMetrics` (Levain), `updateFermenterMetrics`, `updateFermenterScope`, `setFermenterEngineReady`, `invalidateFermenterCache`, `invalidateToasterCache`, `setToasterKitParam` + `updateKitParam`, `MACRO_LABELS` (Toaster).

**Removed dead Levain stubs:** `sendCcToEngine`, `loadFactoryPreset`.

**Removed superseded component:** `ParamGrid` (replaced by `GenericDeviceLayout`).

**Removed dead UndoTree functions:** `getPathToNode`, `getCurrentPath`, `getForwardPath`, `countBranches`, `getBranchPoints`.

**Removed dead constants:** `DESTRUCTIVE_ACTIONS`, `REQUIRES_CONFIRMATION`.

**Removed dead types:** `AppEventName`, `DisabledReason`, `WaveformPeak`, `ActionHandlerMap`, `MidiEvent`, `GetPresetsByCategoryInput`, `GetPresetsByCategoryOutput`.

**Removed dead legacy helpers:** `resolveEmittedFrom`, `resolveCallerFilePath` + all internal stack-parsing helpers from `eventLogHelpers.ts`.

---

## 2. DUPLICATE IMPLEMENTATION — Needs consolidation

### Audio Warping (AudioEngine vs Arrangement)

Two parallel warp implementations exist with **different schemas, different stores, and no bridge between them**:

|                    | `AudioEngine/useCases/audioWarping/`                              | `Arrangement/useCases/warp.ts`                                          |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Store**          | `audioWarpStore` (Store)                                          | Private `Map<string, WarpState>`                                        |
| **Markers**        | `sourceSec` / `targetBeat` / `locked`                             | `originalBeat` / `warpedBeat`                                           |
| **Algorithms**     | Rich enum (élastique, Rubber Band, complex, repitch, slice, etc.) | Simple `stretchMode` (`'repitch' \| 'complex' \| 'texture' \| 'beats'`) |
| **Consumers**      | `finalFeatureHandlers.ts` (AI/command actions only)               | `WaveformEditor.tsx` (the actual UI)                                    |
| **Unused exports** | 9 (all flagged by knip)                                           | 0 (actively used)                                                       |

**Verdict:** Both model per-clip warp. The Arrangement version is the one the editor uses. The AudioEngine version is richer but not connected to the UI or audio graph. **Consolidation needed** — either migrate WaveformEditor to the richer AudioEngine model, or fold the AudioEngine model's algorithm richness into the Arrangement model. Do not delete either blindly.

---

## 3. NEWLY DEAD — Orphaned by our cleanup

These became unused as a side-effect of removing their only consumers:

| Item                                  | Type   | Cause                                                          |
| ------------------------------------- | ------ | -------------------------------------------------------------- |
| `levainPresets.ts`                    | file   | `loadFactoryPreset` (its only consumer) was removed            |
| `createModulationSource.ts`           | file   | `createFromPreset` (its only consumer) was removed             |
| `updateModulationSourceParam.ts`      | file   | `createFromPreset` (its only consumer) was removed             |
| `updateClipsOnAllTracks` (repository) | export | Use-case wrapper removed; repo version now also has no callers |

**Recommendation:** Leave these alone. They contain real implementations that will be needed when their features get UI. Deleting them would just mean reimplementing from scratch.

---

## 4. FEATURE ISLAND INVESTIGATION — Verdicts

Each remaining unused cluster was investigated for duplicates. None are duplicates of existing active features.

### Plugin module (3 clusters)

| Cluster                           | Files | Verdict                        | Evidence                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginBridge/` (5 IPC repos)     | 5     | **UNIQUE**                     | Rust commands exist in `src-tauri/src/commands/plugins.rs` and `plugin_gui.rs`. These are the only TS↔Rust bridge for native CLAP/VST3 param/state I/O. `TrackNode.updateParam` doesn't route `external-plugin` types through these yet — the wiring is missing, not superseded.                                                                            |
| `modulationSystem/` (9 use cases) | 9     | **UNIQUE** (vs Automation)     | Modulation sources (LFO, envelope, macro, random) are a different concept from timeline automation lanes. Automation module handles recorded parameter curves; modulation system handles real-time mod routing. `getAllModulationRoutes` is imported by `DeviceChainSection.tsx` for a UI indicator. Store-backed but mod→AudioParam connection is unbuilt. |
| `pushIntegration/` (8 use cases)  | 8     | **UNIQUE** (vs controlSurface) | Control surface handles MCU/OSC/HUI protocol state. Push integration is Ableton Push-specific pad/encoder/display control — different device class. `connectPush`/`disconnectPush` are wired via `finalFeatureHandlers`. Pad/encoder helpers are stubs waiting for MIDI I/O bridge.                                                                         |

### Arrangement module (3 clusters)

| Cluster                           | Files | Verdict                                         | Evidence                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adjustmentLayer/` (8 use cases)  | 8     | **UNIQUE** (vs Automation)                      | Adjustment layers are stackable time-bounded effect layers with blend/fade/mix. Automation lanes are parameter curves. Different product concepts. Spec mentions them. Only `createAdjustmentLayer` is reachable via commands; the rest has no UI or engine integration.                  |
| `clipGainEnvelope/` (3 use cases) | 3     | **UNIQUE** (vs Automation, vs static clip gain) | Pre-fader dB gain envelope per clip. 5 sibling use cases ARE used by `ClipGainEnvelopeSection.tsx` in the Inspector. These 3 (`getAllClipGainEnvelopes`, `getGainAtBeat`, `moveGainEnvelopePoint`) await a canvas renderer and engine integration (envelope not applied during playback). |
| `groupComping/` (4 exports)       | 0     | **UNIQUE** (vs per-track comping)               | Multi-track group comping (lock multiple tracks to a single comp). Per-track take-lane comping is a separate, active system. Only `createCompGroup` is reachable; CRUD operations have no UI.                                                                                             |

### Toaster module (6 files)

| File                 | Verdict    | Evidence                                                                                           |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `GrooveTemplates.ts` | **UNIQUE** | 16-step micro-offset curves for swing. Transport has tempo/loop, not groove grids. No duplication. |
| `PadMixer.tsx`       | **UNIQUE** | Drum pad mixer view. No other pad-level mixer UI exists.                                           |
| `noteRepeat.ts`      | **UNIQUE** | MPC-style note repeat. No note repeat in MIDI module.                                              |
| `patternMorph.ts`    | **UNIQUE** | Probability-based pattern interpolation. No equivalent elsewhere.                                  |
| `sixteenLevels.ts`   | **UNIQUE** | MPC 16 Levels mode. No equivalent.                                                                 |
| `soundLocks.ts`      | **UNIQUE** | Elektron-style per-step engine overrides. Store-backed. No equivalent.                             |

### Full subsystems

| Subsystem                              | Verdict    | Evidence                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Collaboration**                      | **VIABLE** | Real WebSocket server in `server/collab-server.ts`. Real transport, vector clock, operation log. `CollaborationPanel` mounted in `AppShell`. `executeAppAction` broadcasts mutations. Gaps: `updateCursor`/`receiveRemoteAction` not wired, vector clock data not carried in remote actions.                                       |
| **Extension**                          | **STUB**   | `extensionStore` exists. `runEditorScript` uses `new Function()` — no sandbox/Worker. `installExtension` only appends to store, doesn't load code. No `.tsx` UI renders the store. Thin scripting API via `createDawApi()`. Not superseded by Plugin module (different axis: JS scripting vs native audio hosting).                |
| **SoundLibrary / sampleDatabase**      | **STUB**   | `sampleDatabaseStore` exists with full `SampleEntry` model. 14 CRUD/filter use cases. No `presentations/` tree — no browser UI. Store starts with `samples: []`, nothing populates it. Not a duplicate of `soundPresetLibrary` (different domain: file-based samples vs factory presets). Only `searchSamples` wired via commands. |
| **Transport / Loop Station**           | **UNIQUE** | Looper recording/playback with slots, layers, sync. No duplication.                                                                                                                                                                                                                                                                |
| **Transport / Punch Recording**        | **UNIQUE** | Background capture with pre/post-roll. No duplication.                                                                                                                                                                                                                                                                             |
| **Transport / Setlist**                | **UNIQUE** | Live performance setlist with auto-advance. No duplication.                                                                                                                                                                                                                                                                        |
| **AudioEngine / Control Room**         | **UNIQUE** | Monitor management, talkback, cue mixes, dim. No duplication.                                                                                                                                                                                                                                                                      |
| **AudioEngine / Control Surface**      | **UNIQUE** | MCU/OSC/HUI protocol handling. Separate from Push integration.                                                                                                                                                                                                                                                                     |
| **AudioEngine / RAVE**                 | **UNIQUE** | Neural audio synthesis via RAVE models. No duplication.                                                                                                                                                                                                                                                                            |
| **AudioEngine / Audio Precision**      | **UNIQUE** | F64/F32 detection for native audio.                                                                                                                                                                                                                                                                                                |
| **AudioEngine / Latency Compensation** | **UNIQUE** | Plugin latency reporting/PDC.                                                                                                                                                                                                                                                                                                      |
| **Synth / CV/Gate**                    | **UNIQUE** | Eurorack-style CV/Gate output. No duplication.                                                                                                                                                                                                                                                                                     |
| **Project / Version Control**          | **UNIQUE** | Git-like project versioning with branches and tags.                                                                                                                                                                                                                                                                                |
| **MIDI / Chord Track**                 | **UNIQUE** | Chord-aware MIDI transposition.                                                                                                                                                                                                                                                                                                    |
| **MIDI / Pattern Instance**            | **UNIQUE** | Linked MIDI clip instances (edit one, all update).                                                                                                                                                                                                                                                                                 |

### Wire-ready

| Item                    | What's needed                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MacrosPanel.tsx`       | Mount in `Sidebar.tsx` as a tab. Macro recording/playback is fully functional.                                                                                                          |
| `automationSubLanes.ts` | Use-case mutations have no callers since `TrackAutomationHeader.tsx` was deleted. Concept is valid (which automation params show inline per track). Needs new UI to call the mutations. |

---

## 5. DEEP AUDIT — Implementation quality, utility, and strategic value

Every feature island's actual source code was read and assessed for implementation depth, code quality, completeness, and strategic alignment with a next-generation DAW vision.

### The overarching pattern

The codebase follows a remarkably consistent template: **well-typed store → clean DDD use cases → zero engine/I/O connection**. Nearly every feature island is a thoughtful architectural skeleton with no muscles. The type systems and state models are often production-quality, but the audio/hardware/network layers that would make them do something are absent. This suggests the features were scaffolded systematically from a design spec rather than built incrementally from working prototypes.

This is not necessarily bad — it means the architecture is sound and the domain modeling is strong. But it means almost every feature is at most 50% done, with the remaining 50% being the hard part (DSP, I/O, rendering, real-time scheduling).

### Strategic classification

| Category | What it means | Count |
| --- | --- | --- |
| **Bleeding-edge** | Almost no DAW does this; would be a headline feature | 4 |
| **Differentiator** | Few DAWs do this well; genuine competitive advantage | 14 |
| **Table-stakes** | Every serious DAW has this; must-have for credibility | 11 |

### Full audit results

#### Bleeding-edge features

**Faust Engine** — Built-in Faust-to-WASM-to-AudioWorklet compiler

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Excellent** |
| Complete | **~75%** |

The crown jewel of the entire codebase. A real, production-grade pipeline: lazy singleton `@grame/faustwasm` compiler, per-module compilation with caching, `AudioWorkletNode` creation, and WAM registry integration. Ships 16 real Faust DSP programs — not stubs. The Hammond B3 models 9 drawbar tonewheels with adjacent leakage, key click, percussion, and Leslie simulation. The 303 uses `ve.diodeLadder` with accent envelopes. The LUFS meter implements ITU-R BS.1770-4 K-weighting. **No mainstream DAW ships a user-facing Faust compiler.** Missing: poly voice support, MIDI-to-Faust mapping, preset save/load, Faust editor UI. Best ROI of any feature to finish.

**RAVE Neural Audio** — Neural audio synthesis via latent space manipulation

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~25%** |

The most intellectually ambitious island. Latent-space math is production-ready: correct interpolation, weighted timbre transfer, deterministic seeded randomization (clever for undo/redo). But the core value proposition is entirely faked — `encodeAudio` uses a sin-weighted accumulator through `tanh` instead of ONNX inference; `loadModel` just flips a boolean. The factory model catalog has realistic specs (latent dims 8/16/32, sizes 28–60MB). **Worth keeping the latent-space math layer; the encode/decode simulation should be clearly marked as placeholder until ONNX Runtime integration happens.**

**Tempo Mapping** — AI-based tempo detection from audio onsets

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~30%** |

Contains a genuine working algorithm: IOI calculation, musical-range filtering, BPM histogram binning, moving-average smoothing, confidence scoring. Fed real onset data, this would produce reasonable BPM estimates. But the onset source is fake — `estimateOnsetsFromClips` generates synthetic beats from clip positions, not audio analysis. Results don't persist to `tempoMapStore`. Also violates one-function-per-file rule (5 exports). **The algorithm is real math waiting for real input data.** Needs onset detection via `AnalyserNode` or Essentia.js.

**CV/Gate** — Eurorack-style voltage output for hardware synths

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~25%** |

Correct music math: `midiNoteToCv` properly implements both 1V/oct (`(note-24)/12`) and Hz/V (`440 * 2^((note-69)/12)`) standards. Well-typed output channel model with 6 types (cv-pitch, cv-velocity, cv-modulation, gate, trigger, clock). But no actual audio output — no `ConstantSourceNode`, no DC-coupled interface detection, no MIDI-to-CV pipeline. **Impressive domain knowledge, zero runtime functionality. Only relevant if targeting hardware synth users.** Niche but passionate audience.

#### Differentiator features

**Chord Track** — Chord-aware MIDI transposition

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Excellent** — best code quality of all islands |
| Complete | **~55%** |

17 chord types with correct interval arrays. The transposer is the crown jewel: `transposeNoteToChord` distinguishes chord tones from non-chord tones, mapping chord tones index-to-index while shifting passing tones chromatically. This is musically correct and non-trivial — most implementations get it wrong. Full CRUD with persistence to localStorage. `ChordTrackLane` already exists in the arrangement view. **Could ship as a real feature with ~2–3 weeks of integration work** (connect transposer to playback pipeline). Highest code quality of any island.

**Pattern Instance** — Figma-style linked MIDI clips

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~50%** |

Creates linked clips with proper parent resolution (prevents instance-of-instance chains), clones notes with offset adjustment, propagates parent edits to instances while respecting per-instance overrides. The override mechanism is a smart Figma-inspired pattern. **Core create/detach/propagate cycle works correctly.** Missing: automatic propagation trigger (must be called manually), UI differentiation of linked clips, fragile ID counter (`nextInstanceId = 5000`). Would resonate strongly with electronic producers working with motif variations.

**Modulation System** — LFO/envelope/macro modulation routing

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~45%** |

CRUD for sources/routes is complete. LFO waveforms (sine, saw, square, triangle) are real math, not stubs. But only 3 of 6 source types produce output (missing: envelope, MIDI CC, step-seq). Explicitly UI-rate only — audio-rate modulation via AudioWorklet is deferred. The `bipolar` flag is stored but ignored in computation. **Right architecture for a Bitwig/Serum-style mod matrix, but the hard part (audio-rate) is untouched.**

**Collaboration** — Real-time multi-user session editing

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~45%** |

The most complete full-stack island. Working Node.js WebSocket server (~250 LoC) with session management, host migration, action relay. Textbook-correct vector clock primitives. Working `CollaborationPanel.tsx` with peer list, session join, status indicators. `executeAppAction` already broadcasts mutations. **Fatal flaw: no OT/CRDT conflict resolution.** Actions replay via `executeAppAction` — first writer wins. Two users editing the same clip will silently diverge. Also no initial state sync for late joiners. **Compelling demo, not shippable without conflict resolution.**

**Project Version Control** — Git-like project versioning with branches

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~50%** |

Genuinely works: `captureSnapshot` serializes real project stores to JSON, `restoreSnapshot` writes them back. Branch create/switch/delete with snapshot restore on switch. Tag management. Auto-save with configurable interval. **Fatal flaw: full JSON dumps per version (no delta compression), and localStorage persistence intentionally strips snapshot data** (to avoid exceeding limits). Restored versions from page refresh have empty snapshots. **Real functionality wrapped in an unscalable storage model.** Needs IndexedDB + deltas.

**Macros Panel** — Action recording and replay

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~70%** |

Full record/stop/play/rename/delete lifecycle. Recording captures `AppAction` objects with smart exclusion set for meta-actions. Polished UI with recording indicator, inline rename, hover-reveal buttons, proper `useSyncExternalStore` + aria-labels. **Most ship-ready island** — just needs persistence (macros vanish on reload) and undo grouping (playing a macro should be a single undo step). Architecture is clean: recording/playback/management as separate use cases. Uncommon in browser DAWs.

**Pattern Morph** — Probability-based pattern interpolation

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~70%** |

Genuinely clever algorithm: interpolates velocity, probability, microTiming linearly; activates steps probabilistically at the morph boundary; snaps discrete values (retrigger, conditions, param locks) at midpoint. Handles mismatched step counts. **Musically thoughtful — the probabilistic step activation is exactly how you'd want this to feel in live performance.** Pure, side-effect-free, testable. Needs a crossfader/knob UI and integration into the sequencer tick loop.

**Sound Locks** — Elektron-style per-step engine overrides

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~40%** |

Stores `_soundLock` into step param locks, but `sequencerPlayback.ts` explicitly skips keys starting with `_` during playback — **so sound locks are never applied**. The `engineType as unknown as number` cast is a type escape hatch. **Data persists but is actively ignored by the execution layer.** Needs: proper typed slot in `Step` model, engine-swap logic at trigger time, removal of the `_` prefix skip in the sequencer.

**Loop Station** — Session-style loop grid

| Metric | Rating |
| --- | --- |
| Depth | **Stub** |
| Quality | **Good** |
| Complete | **~15%** |

Well-typed state: grid-based slots with correct state machine (empty → recording → playing → overdubbing → stopped), overdub layers, scene triggering. But 100% UI state, 0% audio. `toggleRecord` creates a `LoopLayer` with a timestamp and nothing else — no `AudioBuffer`, no `MediaStreamSource`, no worklet. `lengthBeats` is hardcoded to 4 rather than measured. **Clean data scaffold, entirely simulated.**

**Adjustment Layers** — Photoshop-style stackable effect layers

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~25%** |

9 effect types with realistic parameter presets (compressor has threshold/ratio/attack/release/makeup). Region system with "no regions = always active" semantics. `getActiveLayersAtBeat` is correct. **Genuinely novel concept — no major DAW maps the Photoshop adjustment layer metaphor to audio.** But 0% engine routing, 0% UI. This is a concept sketch that would require significant audio graph work (how do you insert a time-bounded effect into a mix signal chain?).

**Node View** — Signal flow graph editor

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~35%** |

10-type node taxonomy (input, output, effect, instrument, mixer, splitter, merger, send, return, sidechain). `buildFromDeviceChain` converts linear chains into graph with auto-layout. Duplicate and self-connection prevention. Node colors use perceptually uniform oklch. **But it only produces linear chains** — the point of a node editor is non-linear routing, and that topology logic doesn't exist. No renderer, no hit-testing, no cable dragging. A backend data layer for a feature whose hard part hasn't started.

**Push Integration** — Ableton Push hardware controller

| Metric | Rating |
| --- | --- |
| Depth | **Stub** |
| Quality | **Acceptable** |
| Complete | **~15%** |

Surprisingly accurate state model (64 pads from MIDI note 36, 68-char display lines, Push 2/3 distinction). But every use case is a pure state setter — `connectPush` sets `connected: true` and doesn't connect to anything. Zero WebMIDI I/O, zero SysEx, zero device discovery. **A state management demo wearing hardware integration clothing.** The 15% that exists is the easy 15%.

**Extension System** — User scripting and plugin API

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~30%** |

Rich manifest type with 14 permission scopes, versioning, licensing. Command registry with async execution. Script runner uses `new Function('console', 'daw', code)`. **Critical flaw: the sandbox is trivially escapable** — `new Function` runs in the main context with full access to `window`, `document`, `globalThis`. Permissions are declared but never enforced. `installExtension` takes a manifest object but nothing loads code from files. **Design document expressed as TypeScript** — the type system is thorough but the runtime is unsafe.

**Link Bridge** — Ableton Link tempo/beat sync

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~30%** |

Clean Tauri IPC with correct `isTauri()` guards. Covers full Link lifecycle: enable/disable, tempo sync, status query, start/stop. But no transport integration — the bridge doesn't connect to the Transport module. No continuous polling for beat sync. **A phone with no one to call.** Would work immediately if the Rust side implements the expected commands.

#### Table-stakes features

**Latency Compensation** — Plugin delay compensation

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~55%** |

The most functional island overall. Actually crosses module boundaries to read live track state. `getCompensationDelay` correctly computes `(maxTrackLatency - thisTrackLatency)`. Queries `AudioContext.baseLatency` and `outputLatency` with proper feature detection. The sidechain compressor correctly calculates latency from `WORKLET_BLOCK_SIZE / sampleRate`. **The PDC calculation logic is correct and ready to drive actual delay insertion.** Missing: the apply step (inserting `DelayNode`s per track).

**Sequencer Playback** (Toaster core) — AudioContext-scheduled step sequencer

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~75%** |

AudioContext-corrected scheduling, conditional triggers (fill/not-fill/first/not-first), probability, swing, micro-timing, ratcheting with velocity decay, param locks, polymetric track lengths. **The scheduling approach is correct and the feature coverage is above average.** Main gap: runs its own clock independent of the main DAW transport, and doesn't integrate with groove templates, sound locks, or pattern morph sitting inert nearby.

**Clip Gain Envelope** — Per-clip gain automation

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~40%** |

Has a working inspector panel (`ClipGainEnvelopeSection.tsx`) and correct linear interpolation in `getGainAtBeat`. But uses a raw `Map` instead of the project's `Store<T>` (no reactivity, no persistence), and a `useState` counter hack to force re-renders. **The interpolation math is ready to call from the playback scheduler.** Needs: `Store<T>` migration, engine integration, graphical envelope editor on waveform.

**Sound Preset Library** — Factory preset browser

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** |
| Quality | **Good** |
| Complete | **~75%** |

**The only island that is genuinely shipped and working.** Platform-aware filtering (web vs native/Tauri), consumed by both `InstrumentsTab` and `EffectsTab`. Simple but does its job correctly.

**Audio Warping** — Per-clip warp markers and algorithms

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~30%** |

Richest type model: 9 `WarpAlgorithm` variants (élastique, Rubber Band, Complex, Re-Pitch, Slice) with quality/CPU metadata. Per-clip markers with lock-aware moves. `getStretchRateBetweenMarkers` correctly derives playback rate. **But zero DSP** — selecting "élastique Pro" changes a string in state, nothing else. Also the acknowledged duplicate of `Arrangement/useCases/warp.ts`.

**Control Room** — Monitor management, talkback, cue mixes

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~35%** |

15 use cases, all pure state toggles. `getEffectiveVolume` correctly composes dim + calibration + mute. Cue mix design (per-track levels + pan overrides + master level) shows genuine studio understanding. **But zero audio routing — a flight simulator with no engines.**

**Control Surface** — MCU/OSC/HUI protocol handling

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~30%** |

MCU model correctly specified: 9 faders with 10-bit positions, V-Pot rings, 8-channel bank paging. `processOscMessage` does genuine mapping resolution with value normalization. **But no MIDI sysex, no UDP socket, HUI is zero-implemented.** The OSC processing function is the most useful piece — it could work with a real UDP listener.

**Time Signature Changes** — Per-beat time signature map

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~40%** |

`getBarBeatAtPosition` is a real algorithm that walks sorted changes and accumulates bars at 480 PPQ. **But intentionally discards the denominator** — 6/8 and 6/4 produce identical results. This is mathematically wrong for compound meters. Fine for 4/4 and 3/4, breaks for 6/8, 12/8, and alla breve.

**Punch Recording** — Background capture with retrospective punch regions

| Metric | Rating |
| --- | --- |
| Depth | **Stub** |
| Quality | **Good** |
| Complete | **~10%** |

Thoughtful concept: continuous capture with retrospective region carving. But `startBackgroundCapture` creates metadata only — no `MediaRecorder`, no ring buffer, no audio capture. `commitPunchRegion` sets `committed: true` and stops — never splices audio into timeline. **Metadata skeleton, zero audio I/O.**

**Group Comping** — Multi-track take management

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~20%** |

Region swipe with overlap-cleaning and crossfade beats is the right approach. But no recording integration, no flatten, no visual comping lane, no audio switching logic. 5 functions in one file (violates project convention). **Well-designed skeleton for a must-have feature.**

**Sound Library** — Tagged/rated sample database

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~35%** |

Comprehensive `SampleEntry` model (19 fields). Robust filtering with text search + tag intersection + sorting. Jaccard similarity search. Regex-based auto-tagging covering 17 categories. **But no file I/O, no audio analysis, no persistence, no UI.** Fingerprint is a string hash of name+path, not perceptual.

**Groove Templates** — Micro-timing offset curves for swing

| Metric | Rating |
| --- | --- |
| Depth | **Substantial** (data) |
| Quality | **Good** |
| Complete | **~60%** |

8 musically authentic templates including SP-1200 asymmetric timing from Z80 clock jitter. **But never consumed** — the sequencer reads `kit.swing` and per-step `microTiming`, not these templates. Needs a `applyGrooveTemplate` use case.

**Note Repeat** — MPC-style rapid-fire pad triggering

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~45%** |

6 rate options, tempo-to-ms conversion. **But uses `setInterval` instead of AudioContext scheduling** — will drift at high rates. A non-starter for a DAW claiming audio precision. Needs AudioContext clock integration.

**Sixteen Levels** — MPC velocity-level pad mapping

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Acceptable** |
| Complete | **~35%** |

Velocity path works. **But 3 of 4 targets are fake** — tune, decay, and filter all just vary velocity. Comment says "For now, just vary velocity as the simplest implementation." Looks complete in the type signature, isn't complete in the implementation.

**Plugin Bridge** — Native CLAP/VST3 param/state IPC

| Metric | Rating |
| --- | --- |
| Depth | **Stub** |
| Quality | **Good** |
| Complete | **~25%** |

Clean one-function-per-file `tauriInvoke` wrappers with typed empty fallbacks. **But `processAudioIPC` serializes Float32Array into JSON** — catastrophically slow for real-time audio. The TS-side "envelope" is done; blocked on Rust-side CLAP/VST3 host implementation.

**WAM Plugin Host** — Web Audio Module 2.0 hosting

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~40%** |

The Faust plugin loading path (dynamic import → compile → create node) is genuinely functional. But the 10 non-Faust built-in plugins create `context.createGain()` — they're placeholders producing silent passthrough. WAM naming is aspirational — doesn't implement the actual WAM API protocol.

**Audio Precision** — F64/F32 processing toggle

| Metric | Rating |
| --- | --- |
| Depth | **Stub** |
| Quality | **Acceptable** |
| Complete | **~15%** |

A 70-line settings toggle with no downstream effect. Nothing consumes the preference. Also violates one-function-per-file. **Should either be wired to the native engine or deleted** to avoid giving users a toggle that does nothing.

**Automation Sub-Lanes** — Per-track automation lane management

| Metric | Rating |
| --- | --- |
| Depth | **N/A** (file doesn't exist, math lives elsewhere) |
| Quality | **Excellent** (math in `automationTransformers.ts`) |
| Complete | **0%** (lanes) |

No sub-lane management code exists. But `automationTransformers.ts` contains genuinely impressive math: RDP curve simplification, multi-mode interpolation (linear, step, exponential with tension, S-curve with Hermite, Catmull-Rom spline), shape generators, virgin territory detection. **A sports car engine sitting on the workshop floor with no chassis.** The math is differentiator-quality; the management layer is completely absent.

**Setlist** — Performance setlist with navigation

| Metric | Rating |
| --- | --- |
| Depth | **Partial** |
| Quality | **Good** |
| Complete | **~35%** |

Most complete Transport island. Navigation works. `goToItem` dispatches real MIDI program changes. Rich `SetlistItem` type. But `autoAdvance` is a stored boolean with no timer, BPM per item is never applied to transport, `projectPath` loading is unbuilt. **A musician could manually navigate and get MIDI PCs sent**, but the headline feature (auto-advance) is unfulfilled.

**PadMixer** — Per-pad volume/pan mixer view

| Metric | Rating |
| --- | --- |
| Depth | **Does not exist** |
| Quality | **N/A** |
| Complete | **0%** |

File not found. Per-pad controls exist for the selected pad only in `ToasterPanel.tsx` (3×3 knob grid). No 16-pad overview mixer.

### The "next-gen DAW" lens

A next-generation DAW needs to clear three bars simultaneously:

1. **Table-stakes parity** — It must do everything Logic/Ableton/Reaper do at a baseline (plugin hosting, PDC, comping, clip gain, etc.) or users won't take it seriously.
2. **Differentiating workflows** — It must offer at least 2–3 things that are genuinely better or different (modulation system, macros, collaboration, linked clips, pattern morph, version control).
3. **Headline features** — It must have 1–2 "you can't do this anywhere else" capabilities that generate excitement (Faust compiler, RAVE neural audio, AI tempo detection, adjustment layers).

**Current state against these bars:**

**Bar 1 (table-stakes):** Most table-stakes features are 15–40% done. Plugin hosting, PDC, warping, comping, clip gain, control room, control surfaces — all have the right state model but none have working audio/I/O integration. **This is the biggest risk.** A DAW with differentiating features but broken basics will be dismissed. The latency compensation and sequencer playback modules are the closest to functional.

**Bar 2 (differentiators):** The strongest area. Chord track (55%, excellent quality), pattern instance (50%, good), macros (70%, ship-ready), collaboration (45%, demo-ready), version control (50%, real snapshots), and pattern morph (70%, clever algorithm) represent genuine competitive advantages. **The chord track and macros are closest to shippable.** Collaboration needs CRDT work. Version control needs storage migration.

**Bar 3 (headline features):** The Faust engine (75%, excellent) is the clear standout — a built-in Faust-to-WASM compiler with 16 acoustically grounded DSP programs is genuinely unprecedented in any DAW. RAVE and AI tempo detection are ambitious but too far from functional. Adjustment layers are a novel concept but need both engine architecture and UI. **The Faust engine alone could be the product's identity** if finished and showcased properly.

### Strategic recommendations

**Finish before anything else:**
1. **Faust Engine** (75% → 100%) — The single most defensible competitive advantage. Add poly voice support and ship it as the flagship feature.
2. **Macros Panel** (70% → 100%) — Just needs persistence + undo grouping + sidebar mount. Highest ROI.
3. **Chord Track** (55% → 100%) — Best code quality. Wire transposer to playback. Lane already exists.

**Prioritize for credibility:**
4. **Latency Compensation** (55% → 100%) — Apply the existing correct calculations. Proves the engine is serious.
5. **Clip Gain Envelope** (40% → 100%) — Wire `getGainAtBeat` to playback. Migrate to `Store<T>`.
6. **Plugin Bridge** (25% → TBD) — Blocked on Rust, but essential for any professional use.

**High-value differentiators to invest in:**
7. **Pattern Morph** (70%) — Wire to sequencer tick loop. Unique in browser DAWs.
8. **Pattern Instance** (50%) — Add visual chrome + auto-propagation trigger.
9. **Collaboration** (45%) — Needs CRDT. Compelling differentiator once conflict resolution works.

**Park until engine architecture matures:**
- RAVE Neural Audio — Core is simulated. Wait for ONNX Runtime.
- Control Room — Needs real audio routing infrastructure.
- Loop Station — Needs audio capture infrastructure.
- Punch Recording — Needs audio capture infrastructure.
- Adjustment Layers — Needs engine architecture decisions.
- Node View — Needs WebGPU renderer.

**Reconsider existence:**
- Audio Precision — 15%, no downstream effect. Delete or wire to native engine.
- Push Integration — 15%, no hardware I/O. Park until WebMIDI bridge exists.
- Extension System — Unsafe sandbox, no file loading. Redesign before building more.

---

## 6. FEATURE ISLAND INTEGRATION PLANS

Each feature island was analyzed against the current UI structure (AppShell layout zones, sidebar tabs, inspector sections, bottom dock tabs, transport bar, command palette, preferences dialog) to determine how and where it should be wired.

### Tier 1 — Quick wins (Low complexity, high value)

#### MacrosPanel → Sidebar tab

**Where:** Fourth tab in `Sidebar.tsx` alongside Library / Instruments / Effects.
**How:** Add `'macros'` to `activeTab` union, add a tab button, render `<MacrosPanel />` in the scroll area. The panel is fully implemented with macro list, rename, delete, recording controls. `macroStore` is already wired to `executeAppAction` for recording and playback.
**Why:** Unlocks the entire macro system for end users with a single import + branch. Macro recording already works via command handlers — users just can't see or manage their macros.
**Effort:** ~30 minutes.

#### Audio Precision → Preferences dialog

**Where:** Preferences → Audio section (already has sample rate, buffer size).
**How:** Add a "Processing Precision" subsection: Auto / 32-bit float / 64-bit float radio group bound to `audioPrecisionStore`. Disable 64-bit when `nativeF64Supported` is false. Show current effective mode as read-only text in the export dialog.
**Why:** Simple form control, small store, clear placement.
**Effort:** ~1 hour.

#### Ableton Link → Transport bar popover + Preferences

**Where:** Small Link icon/toggle in `TransportControls` (near tempo). Detailed settings (quantum, tempo ownership) in Preferences → MIDI/Sync section.
**How:** Transport: toggle `enableLink`/`disableLink`, show peer count from `getLinkStatus`. Preferences: quantum, auto-follow tempo. Hide entirely when not running in Tauri (`isNativePlatform()`).
**Why:** Link is a "connect and go" feature. Other apps (Live, KORG) expose it as a simple toggle with peer count.
**Effort:** ~2 hours.

#### Latency Compensation → Inspector + Status bar

**Where:** Read-only "Latency" row in `TrackInspector` (below routing). Optional total PDC in `StatusBar`.
**How:** Call `getCompensationDelay(trackId)` for the inspector line. Show `getLatencyReport().totalCompensationMs` in the status bar. Both are pure reads from the compensation module.
**Why:** Zero-interaction feature — just surfaces existing calculations.
**Effort:** ~1 hour.

### Tier 2 — Medium complexity, clear placement

#### Control Room → Mixer footer / collapsible panel

**Where:** Collapsible "Monitoring" strip at the bottom of the mixer (bottom dock), or a dedicated bottom-dock tab.
**How:** Monitor A/B selector, master volume knob, Dim/Mute/Mono/Reference toggles, talkback button, cue mix section with per-track send levels. All bound to `controlRoomStore` use cases. Pattern matches the Fermenter/Toaster/Levain instrument strips.
**Why:** Essential for professional monitoring workflows. Store + use cases are complete.
**Prerequisites:** Engine must actually route audio through monitor selection and cue buses.
**Effort:** ~1–2 days.

#### Control Surface → Preferences → MIDI section

**Where:** New "Control Surfaces" subsection in Preferences → MIDI.
**How:** Protocol picker (MCU/OSC/HUI), connection status, OSC endpoint table (add/remove), mapping table for OSC addresses. MCU config (bank size, display mode). "Learn" button for OSC.
**Why:** Configuration-only UI that doesn't need a permanent panel.
**Prerequisites:** Real MIDI/OSC transport for runtime; UI can be built as offline config first.
**Effort:** ~1–2 days.

#### Push Integration → Preferences subsection + optional status

**Where:** Preferences → MIDI → "Ableton Push" subsection. Optional connection status dot in the status bar.
**How:** Model selector (Push 2/3), MIDI port pair selection, pad layout/scale picker. Most runtime behavior is hardware-facing and needs no on-screen UI.
**Why:** Push hardware users need setup; actual pad/encoder behavior happens on the controller itself.
**Prerequisites:** Real MIDI device I/O bridge.
**Effort:** ~1 day.

#### Setlist → Bottom dock tab or sidebar

**Where:** New bottom-dock tab "Setlist" (alongside Mixer / Session / Routing / Analysis), or a sidebar panel.
**How:** Sortable list of setlist items with name, BPM, time sig, estimated duration, notes, color. "Now playing" highlight, next/previous buttons, auto-advance toggle. Count-in per item. Compact transport-bar strip showing current/next item during performance.
**Why:** Completes the live performance workflow. Store + use cases are fully implemented.
**Effort:** ~2–3 days.

#### Time Signature Changes → TempoEditor extension

**Where:** Extend the existing `TempoEditor` popover (transport bar) with a "Time Signatures" tab/section.
**How:** List of time signature changes (beat position + numerator/denominator). Add/remove/edit. The `timeSignatureMapStore` already feeds the canvas grid for bar lines — this just adds an editor for that data.
**Why:** Data is already consumed by the renderer; users just need a way to add changes.
**Effort:** ~1 day.

#### Chord Track → Already partially wired

**Where:** `ChordTrackLane` in `ArrangeView.tsx` already renders when chords exist. The lane has add/move/remove, context menu, power toggle.
**How:** Extend to piano roll (show current chord for reference). Add transposition toggle per MIDI track in the inspector ("Follow chord track"). Wire `transposeForChordTrack` into the MIDI scheduling path.
**Why:** The lane exists; what's missing is the MIDI-follows-chord integration.
**Effort:** ~1–2 days for chord-follow; piano roll overlay is medium.

#### Pattern Instance → Arrangement renderer + Inspector

**Where:** Clip chrome in the arrangement canvas (distinct border/badge for linked clips). Inspector section showing parent link, "Make Unique" button.
**How:** Renderer reads `parentClipId` on `Clip` (field already exists) and draws a link icon or dashed border. Inspector shows parent clip name, "Detach" button calling `detachPatternInstance`. "Make Unique" = detach + copy notes.
**Why:** Linked clips exist in the model but are invisible to users. Visual distinction prevents accidental edits.
**Effort:** ~2 days.

#### Plugin Bridge params → Device Inspector

**Where:** Inspector → Device section for `external-plugin` type devices.
**How:** When a device is `external-plugin`, fetch params via `getPluginParameters(instanceId)` and render them as `DeviceParameterControl` rows (same pattern as built-in devices). Use `setPluginParameter` for writes. Add preset save/restore via `getPluginState`/`setPluginState`.
**Why:** Users can currently open the native GUI but not see/automate params from within the DAW.
**Prerequisites:** Engine must route `updateDeviceParam` for `external-plugin` through the bridge.
**Effort:** ~2–3 days.

#### Toaster extras → ToasterPanel sections

**Where:** Within the existing `ToasterPanel` layout:

- **GrooveTemplates**: Dropdown picker in the top bar next to Euclidean controls. Apply groove to current pattern via `applyGrooveTemplate`.
- **noteRepeat**: Toggle button + rate selector near transport controls in the Toaster header.
- **sixteenLevels**: Mode toggle in the pad grid area. When active, pads map to velocity levels of the selected sound.
- **soundLocks**: Per-step popup or modifier-click in `StepSequencer` cells. Long-press a step to assign per-step engine overrides.
- **patternMorph**: A/B pattern selector + blend slider, possibly in a collapsible section below the sequencer.
- **PadMixer**: Collapsible vertical strip to the left/right of the pad grid showing per-pad volume/pan.
  **Why:** These are standard MPC/Elektron features that complete the drum machine workflow.
  **Effort:** ~1 day each for groove/noteRepeat/sixteenLevels; ~2 days each for soundLocks/patternMorph/PadMixer.

### Tier 3 — High complexity, significant scope

#### Loop Station → SessionView (bottom dock)

**Where:** The existing `SessionView` in the bottom dock (`bottomTab === 'session'`).
**How:** Replace current local React state with `loopStationStore` subscription. Render slot grid (trackId × row/column), scene launch column, per-slot state (empty/recording/playing/overdubbing), arm toggle, sync toggle, fixed loop length. Wire `toggleRecord`, `triggerScene`, `stopSlot`, `undoLastLayer`.
**Why:** SessionView already exists as a placeholder; `loopStationStore` has the complete data model.
**Prerequisites:** Audio engine path for actual loop recording/playback.
**Effort:** ~3–5 days for UI; engine work is separate.

#### Punch Recording → Transport + Timeline

**Where:** Transport bar: punch mode toggle (extends existing punch-in button to full capture mode), pre/post roll indicators. Timeline: punch region visualization (colored overlay on the arrangement surface), region boundary drag handles.
**How:** Transport UI reads `punchRecordingStore`. Timeline surface draws punch regions as semi-transparent overlays. Inspector or popover shows capture list with commit/discard actions.
**Why:** Background capture with punch regions is a professional recording workflow. The store is complete.
**Prerequisites:** Audio recording pipeline integration for `startBackgroundCapture`/`stopBackgroundCapture`.
**Effort:** ~3–5 days.

#### Modulation System → Inspector matrix

**Where:** New "Modulation" tab or collapsible section in the Device Inspector, below the parameter grid.
**How:** Source list (LFO, envelope, macro) with per-source controls (rate, shape, depth). Modulation routing matrix: source → parameter with amount slider and bipolar toggle. Visual feedback on modulated params (ring around knobs). Reuse `DeviceParameterControl` for the target column.
**Why:** Modulation routing is a core synthesis/mixing feature. Store + use cases exist.
**Prerequisites:** AudioWorklet integration for real-time modulation application.
**Effort:** ~3–5 days for UI; audio integration is separate.

#### Collaboration → Polish existing panel

**Where:** Already mounted in `AppShell` as `CollaborationPanel`.
**How:** Add display name field for "Create session". Wire `updateCursor` to send cursor position from timeline interaction. Display peer cursors as colored overlays on the arrangement surface. Surface operation log / conflict indicators. Add `VITE_COLLAB_WS_URL` configuration.
**Why:** Panel exists but is incomplete. Cursor sync and identity are the main UX gaps.
**Prerequisites:** Running collab server (`server/collab-server.ts`).
**Effort:** ~2–3 days for cursor + identity; conflict resolution is open-ended.

#### Extension System → Bottom dock panel

**Where:** New bottom-dock tab "Scripts" (alongside Mixer / Session / Routing).
**How:** Split view: code editor (textarea or CodeMirror) on top, console log below. Run button calls `runEditorScript`. Extension list sidebar with enable/disable toggles. Wire `extensionStore.editorOpen` to show/hide the panel. Commands from extensions appear in the command palette.
**Why:** Scripting unlocks power-user workflows. Store + runtime exist.
**Effort:** ~3–4 days.

#### SoundLibrary / Sample Database → Sidebar Library sub-tab

**Where:** New sub-tab "Catalog" under the Library tab in the sidebar (alongside "My Samples" / "Find Samples").
**How:** Search bar, tag cloud/chips for filtering, category/favorites/sort controls, sample list with BPM/key/duration metadata, star ratings, "Similar" button calling `findSimilarSamples`. Drag-to-track for sample insertion.
**Why:** Completes the sample management workflow separate from factory presets.
**Prerequisites:** Ingestion pipeline to populate `SampleEntry` (Tauri FS scan or import dialog).
**Effort:** ~3–5 days for UI; ingestion pipeline is separate.

#### Project Version Control → Project menu modal

**Where:** Project menu dropdown (alongside New / Save / Import / Export) → "Version History" item opening a modal dialog.
**How:** Version list with timestamps, labels, tags, branch indicators. "Restore" button per version. Branch creation/switching. Tag management. Optional diff summary between versions.
**Why:** Git-like project history is a differentiating feature. Store + use cases exist.
**Prerequisites:** Reliable snapshot storage (currently localStorage with snapshots stripped).
**Effort:** ~3–4 days for UI; storage architecture is the real prerequisite.

#### RAVE Neural Audio → Device panel

**Where:** Device-style panel in the instrument strip area (like Fermenter/Levain), or a device in the track chain.
**How:** Model catalog browser, load button, blend/temperature/real-time sliders, encode/decode triggers, latent space visualizer (optional). Activated when a RAVE device is added to a track.
**Why:** Neural audio is a headline feature but currently invisible.
**Prerequisites:** ONNX runtime integration; factory models registered at startup.
**Effort:** ~3–5 days for UI shell; inference pipeline is the real blocker.

#### Node View (Signal Flow Graph) → Bottom dock or main tab

**Where:** New bottom-dock tab "Node View", or an overlay mode in the main area when `nodeViewStore.visible` is true.
**How:** Canvas/WebGPU surface rendering nodes (devices) and connections (audio routing). Drag to reorder, connect/disconnect, bypass toggle per node. `buildFromDeviceChain` syncs with the track's device list. Pan/zoom viewport.
**Why:** Visual signal flow editing is a pro feature (Bitwig, Reason rack).
**Prerequisites:** WebGPU/Canvas renderer with hit-testing; real-time sync with device chain mutations.
**Effort:** ~5–10 days.

#### Adjustment Layers → Timeline special lanes

**Where:** Colored horizontal strips above or between track lanes in the arrangement view, similar to marker regions.
**How:** Each adjustment layer renders as a translucent overlay with beat-bounded regions. Click to select, drag edges to resize, right-click for effect type / mix / blend. Inspector shows layer parameters when selected. Engine applies layer effects during playback.
**Why:** Unique feature that differentiates from standard automation.
**Prerequisites:** Audio engine must consume `adjustmentLayerStore` for DSP routing.
**Effort:** ~5–7 days.

#### Clip Gain Envelope → Inspector curve + clip overlay

**Where:** Mini SVG curve in `ClipGainEnvelopeSection` (inspector). Optional overlay on clip waveform in the arrangement canvas.
**How:** Inspector: interactive SVG with draggable breakpoints calling `moveGainEnvelopePoint`. Arrangement: translucent gain curve drawn over the clip waveform (similar to Pro Tools clip gain). Wire `getGainAtBeat` into the audio scheduling path for playback.
**Why:** Visual gain editing per clip is a standard pro workflow.
**Prerequisites:** Engine integration for `getGainAtBeat` during clip playback.
**Effort:** ~3–4 days.

#### Group Comping → Inspector + Timeline

**Where:** Group comp header in `TrackInspector` (when tracks are grouped). Timeline: swipe-to-comp gesture across multiple take lanes simultaneously.
**How:** Inspector: group name, take pass list, "Swipe" mode toggle. Timeline: when swipe mode is active, clicking a region on any grouped track selects that take pass for all grouped tracks in that time range. "Flatten" commits the comp.
**Why:** Multi-track comping is essential for professional recording (drums, orchestral sessions).
**Prerequisites:** Timeline rendering of group comp regions; multi-track selection gestures.
**Effort:** ~5–7 days.

#### Tempo Mapping (AI detection) → Analysis panel

**Where:** Result panel after "Detect Tempo" command (already wired via `batchFeatureHandlers.detectTempo`). Could be a modal or a bottom-dock analysis tab.
**How:** Table of detected tempo points (beat, BPM, confidence). Edit cells to call `adjustTempoPoint`. "Apply" button to merge into `tempoMapStore`. Optionally visualize as a tempo graph.
**Why:** Bridges AI analysis to the tempo map. Store + detection logic exist.
**Prerequisites:** Product decision on how AI tempo points merge with manual `TempoChange[]`.
**Effort:** ~2–3 days.

### Integration priority matrix

| Feature                  | Complexity   | Prerequisites         | Value                         | Suggested order |
| ------------------------ | ------------ | --------------------- | ----------------------------- | --------------- |
| MacrosPanel              | Low          | None                  | High (unlocks macro system)   | 1               |
| Audio Precision          | Low          | Tauri native layer    | Medium                        | 2               |
| Latency Compensation     | Low          | None                  | Medium (read-only)            | 3               |
| Ableton Link             | Low–Med      | Tauri + Rust Link     | Medium                        | 4               |
| Time Signature editor    | Medium       | None                  | Medium                        | 5               |
| Chord Track follow       | Medium       | Scheduler integration | High                          | 6               |
| Toaster extras           | Low–Med each | None                  | High (completes drum machine) | 7               |
| Control Room             | Medium       | Engine routing        | High (pro monitoring)         | 8               |
| Control Surface          | Medium       | MIDI/OSC transport    | Medium                        | 9               |
| Plugin Bridge params     | Medium       | Engine bridge wiring  | High (native plugin UX)       | 10              |
| Pattern Instance visuals | Medium       | None                  | Medium                        | 11              |
| Setlist                  | Medium       | None                  | Medium (live performance)     | 12              |
| Punch Recording          | Med–High     | Recording pipeline    | High (pro recording)          | 13              |
| Modulation System        | High         | AudioWorklet path     | High (synthesis core)         | 14              |
| Clip Gain Envelope       | Medium       | Engine integration    | Medium                        | 15              |
| Tempo Mapping            | Medium       | Product decision      | Medium                        | 16              |
| Loop Station             | High         | Engine audio path     | High (session workflow)       | 17              |
| Collaboration            | Medium       | Server infrastructure | Medium                        | 18              |
| Extension System         | Medium       | None                  | Medium (power users)          | 19              |
| SoundLibrary             | Med–High     | Ingestion pipeline    | Medium                        | 20              |
| Version Control          | Medium       | Storage architecture  | Medium                        | 21              |
| RAVE Neural Audio        | High         | ONNX runtime          | High (headline feature)       | 22              |
| Node View                | High         | WebGPU renderer       | Medium (pro feature)          | 23              |
| Adjustment Layers        | High         | Engine DSP routing    | Medium                        | 24              |
| Group Comping            | High         | Multi-track UX        | Medium (pro recording)        | 25              |

---

## 7. REMAINING KNIP OUTPUT EXPLAINED

### Shadcn UI library surface (7 exports) — Keep

`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `DropdownMenuGroup`, `DropdownMenuPortal`, `DropdownMenuSub`, `DropdownMenuRadioGroup` — standard component API surface from Shadcn UI. Will be consumed as UI develops.

### Knip false positive (1 file)

`automationSubLanes.ts` is flagged as unused because its mutations are no longer called after the `TrackAutomationHeader.tsx` deletion. The concept is valid — see Wire-ready above.

---

## 8. SPECIAL NOTES

### Unresolved imports: Eliminated

All 11 unresolved imports from legacy Frontify files have been resolved by deleting the files (`createLogger.ts`, `createEventBus.ts`, `DevToolsEventBus.ts` + their specs).

### Architecture violations: Pre-existing

`pnpm deps:validate` reports 59 violations — all pre-existing. No new violations were introduced by cleanup.

### Audio Warping consolidation (priority)

The AudioEngine/Arrangement warp duplication (Section 2) is the highest-priority remaining architectural issue. Both systems model the same product concern with incompatible schemas. The recommended path is to adopt the AudioEngine model's richer algorithm set into the Arrangement model (which owns the WaveformEditor integration), then delete the AudioEngine version.

---

## 9. INTEGRATION LOG — Completed integrations

### Crown jewels (completed)

1. **Macros Panel** — Mounted as sidebar tab, persistence via localStorage, undo grouping for macro playback.
2. **Chord Track** — `followChordTrack` on Track model, real-time transposition in `scheduleMidiNotes`, toggle in Inspector.
3. **Faust Engine** — 12 effect descriptors in `BUILTIN_PLUGINS`, category groups updated, instruments already discoverable via factory presets.

### Credibility tier (completed)

4. **Latency Compensation** — `TrackLatencySection` component in Track Inspector showing device chain latency and PDC delay.
5. **Clip Gain Envelope** — `getGainAtBeat` wired into `scheduleAudioClips.ts` via a per-clip envelope GainNode (dB→linear conversion).

### Differentiator tier (completed)

6. **Pattern Morph** — `MorphState` added to `ToasterState`, `morphPatterns()` called in sequencer tick loop when morph is active, use cases for setting target/position/toggle.
7. **Pattern Instance** — `isLinkedInstance` field on `ClipRenderModel`, populated from `clip.parentClipId` in `buildTimelineRenderModel`, dashed blue border + ⧉ badge in clip drawing.

---

## 10. DEEP INVESTIGATION — Concerning items (fine-tooth comb audit)

Each concerning item was investigated by reading all source code, searching the entire codebase for all references, and tracing execution paths end-to-end.

### Audio Precision — VERDICT: Dead toggle / future scaffolding

**What it claims to do:** Toggle between F32 and F64 audio processing precision.

**What actually happens:**
- `audioPrecisionStore` can be updated via command palette → `setProcessingMode`.
- **NOTHING reads the store value.** No audio code, engine, worklet, export path, or Rust backend consults `getCurrentPrecision()`.
- `AudioContext` is created with no precision options (Web Audio API doesn't support F64 in the real-time graph anyway).
- `nativeF64Supported` is hardcoded `false` — `setNativeF64Support()` is never called.
- The `void defaultDenominator` pattern in the function explicitly discards the parameter.
- Rust backend has no precision toggle — just normal `f32`/`f64` usage in algorithms.

**Conclusion:** This is **aspirational infrastructure** for a future where the Tauri native engine might support F64 processing. Today it's a command palette toggle that changes a store value nobody reads. **Not broken — simply unfinished.** Safe to leave as-is or delete; wiring it would require actual native engine work. **Should not be exposed to users** as it would be a non-functional toggle.

### Sound Locks — VERDICT: Broken by design at three levels

**What it claims to do:** Elektron-style per-step engine overrides — each step can specify a different drum engine.

**Level 1 — Data is actively ignored:** `sequencerPlayback.ts` line 83: `if (key.startsWith('_')) { continue; }` — the `_soundLock` key in `paramLocks` is explicitly skipped during playback.

**Level 2 — Wrong param name:** Even if the `_` skip were removed, `_soundLock` is not a key in `PAD_PARAM_MAP`. The engine recognizes `engine_type`, not `_soundLock`. The value would be silently dropped.

**Level 3 — Wrong value type:** `setSoundLock` casts `DrumEngineType` (a string like `'kick-808'`) to `number` via `as unknown as number`. The engine expects a numeric index (0-5 from `TOASTER_ENGINE_MAP`), not a string. The value is fundamentally wrong.

**Additional:** `soundLocks.ts` is **never imported** by any code in `src/`. The use cases are completely disconnected.

**Conclusion:** Sound locks are **broken at every layer of the stack** — data layer, naming layer, and type layer. The `_` prefix convention was intentionally chosen to store metadata in `paramLocks` without affecting playback, but the design was never completed. A real implementation would need: a typed `soundLock` field on `Step` (not a `paramLocks` hack), engine-swap logic at trigger time using `TOASTER_ENGINE_MAP`, and restoration of the pad's default engine after the step. **This is not missing wiring — it's an incomplete design sketch masquerading as an implementation.**

### Sixteen Levels — VERDICT: 3/4 targets are stubs, but fixable

**What it claims to do:** MPC-style mode where 16 pads trigger the same sound at 16 different levels of a chosen parameter (velocity, tune, decay, or filter).

**What actually happens:**
- `velocity` target works correctly — maps grid index 0-15 to velocity 0.0625-1.0.
- `tune`, `decay`, and `filter` targets all **fall through to the same velocity mapping** with an explicit comment: *"For now, just vary velocity as the simplest implementation."*
- The underlying pad parameters ARE real and functional — `tune`, `decay`, `filterCutoff` all drive the Rust DSP engine via `setToasterPadParam` → `PAD_PARAM_MAP` → worklet → Rust `set_param`.
- **No code imports** `sixteenLevels.ts` — the module is completely disconnected from the UI.

**Conclusion:** The pad engine **can** handle tune/decay/filter parameter changes. The fix is straightforward: replace the stub branches with `setToasterPadParam(targetPad, 'tune' | 'decay' | 'filterCutoff', mappedValue)` before triggering, plus appropriate range mapping (tune: -24 to +24, decay: 0-1, filterCutoff: 20-20000 Hz). **Incomplete but genuinely fixable in ~30 minutes once wired to UI.**

### Note Repeat — VERDICT: Not redundant with ratcheting, but has timing flaw

**What it claims to do:** MPC-style note repeat — hold a pad and it fires repeatedly at a chosen musical rate.

**What actually happens:**
- Confirmed: uses `setInterval(callback, durationMs)` — no AudioContext clock correction.
- Completely disconnected from UI — no imports from any component or panel.

**Ratcheting comparison:**
| Aspect | Ratcheting (`retriggerCount`) | Note Repeat |
| --- | --- | --- |
| Trigger | Programmed per step in pattern | Live performance hold |
| Duration | Subdivisions within one step | Musical note values (1/4, 1/8, 1/16, triplets) |
| Count | Fixed N extra hits | Open-ended until release |
| Velocity | Decaying per retrigger | Constant |
| Timing | AudioContext-corrected via `setTimeout` chain | Raw `setInterval` — will drift |

**Conclusion:** Note repeat and ratcheting are **genuinely different features** serving different workflows (live performance vs. programmed patterns). The `setInterval` timing is the only real problem — the sequencer already demonstrates the correct pattern (chained `setTimeout` with `getAudioTime()` correction). **Fixable timing issue, not redundant code.** Keep the feature but fix the scheduler before wiring to UI.

### Time Signature — VERDICT: Intentionally simplified, mathematically wrong for compound meters

**What it claims to do:** Support time signature changes throughout a project with correct bar/beat display.

**What actually happens:**
- `getBarBeatAtPosition` receives both `defaultNumerator` and `defaultDenominator` as parameters.
- The denominator is **explicitly discarded**: `void defaultDenominator;` on the last line.
- Bar counting uses only the numerator: `bar += Math.floor(beatsInSegment / currentNumerator)`.
- Per-change entries also only read `change.numerator`, ignoring `change.denominator`.

**Impact:**
- **Works correctly for:** 4/4, 3/4, 5/4, 7/4 — any meter where the denominator is 4 (quarter note = one beat).
- **Breaks for:** 6/8 (counted as 6 beats per bar instead of 2 dotted-quarter beats), 12/8, alla breve (2/2). The denominator determines what note value gets one beat, which changes how many "beats" fit in a bar when the DAW's internal beat unit is the quarter note.
- The store IS consumed by timeline rendering (bar lines, beat ruler) and transport display.

**Fix complexity:** Medium. Would need to convert beats by the ratio `4/denominator` when walking through segments, so that in 6/8, a "beat" is an eighth note (half a quarter) and 6 of them make a bar. The sorted-change-walking algorithm is already correct in structure — just needs the denominator factor applied.

**Conclusion:** **Intentional simplification that works for the vast majority of western music** (4/4, 3/4, 5/4). Not "broken" for common use — broken for compound meters. Worth fixing eventually but not blocking. **Not dead code — actively consumed by renderers and transport.**

### Extension System — VERDICT: Security concern, mostly scaffolding

**What it claims to do:** User scripting and plugin API with permission-scoped access.

**What actually happens:**
- `runEditorScript` uses `new Function('console', 'daw', code)` — **no sandbox.** Scripts run in the main renderer context with full access to `window`, `document`, `globalThis`, `fetch`, `localStorage`.
- Comments say "sandboxed execution" but the `Function` constructor doesn't create an isolated realm.
- **Permissions are decorative:** 14 scopes declared in `ExtensionPermission` type but **never checked** at any call site. No import of `manifest.permissions` outside the type definition.
- `installExtension` only appends to in-memory store — never called by any code, doesn't load entry points.
- `createDawApi()` exposes `executeAction` which **dispatches to the full `executeAppAction` registry** — tracks, clips, transport, plugins, AI handlers, everything. Cast with `as any`, no validation.
- **No Worker**, no iframe, no CSP restriction.
- No extensions installed, no commands registered, no UI renders the store.
- The editor content is a hardcoded hello-world string that can only be changed via command palette `runScript` (which runs the default content).

**Conclusion:** The type system is thorough (manifest, permissions, lifecycle) but the runtime is **fundamentally unsafe**. The "sandbox" label is misleading. Today's exposure is limited because: (a) no UI exists to edit scripts, (b) `installExtension` is never called, (c) the default script is harmless. But if any path ever lets users supply custom code, the entire application state is exposed. **This needs a Worker-based sandbox before any further development.** The current implementation is a design document expressed as TypeScript — keep the types, but the runtime needs a complete rewrite before it's safe to expose.
