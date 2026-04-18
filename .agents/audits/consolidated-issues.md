---
name: consolidated-issues-audit
description: Unified codebase audit — all open issues from engine, DSP, AI, plugins, MIDI, timeline, browser inference, and factory content. Code-verified 2026-04-18.
type: audit
status: partially-addressed
last_verified: '2026-04-18'
---

# Consolidated Codebase Audit

## Session history

- **2026-04-16 fix pass:** 13 issues fixed (I-07, I-09, I-10, I-11, I-13, I-17, I-18, I-20, I-23, I-24; Timeline §2, §3, §5). Task file: `.agents/tasks/fix-consolidated-audit-issues.md`.
- **2026-04-18 document pass:** Re-verified all claims against HEAD. Corrected stale line refs, LOC counts, retracted Fermenter singleton claim (I-03). Merged content from `audio-generation.md`, `factory-content-status.md`, and `systemic-issues-root-cause.md` into this file.

## Scope

Repo-wide audit covering: audio engine, every first-party plugin (Toaster, Proof/Dutch Oven, Levain, Knead, Grinder, Grand Boule, Fermenter, Crumbs, Crust), Faust runtime, AI runtime, browser AI inference (BrowserAi, AiGeneration), CRDT/storage, MIDI model, timeline editing, factory content, and cross-cutting concerns (design system, export, recording, Chromium fast paths). Excludes Tauri backend (daw-core, daw-io, src-tauri).

## Goal

- No RT-unsafe code in audio-thread hot paths (no allocations, no `splice`/`shift`, no locks).
- Cross-module boundaries respect `AGENTS.md` rules (no hardcoded plugin branches in shared engine code, no deep imports).
- DSP claims match reality (stereo means stereo, dither quantises, PDC reports actual latency).
- Plugin state is per-instance, not singleton.
- Persistence is correct for user data (not silently in-memory for expected-durable state).
- AI orchestration is layered: one prompt entrypoint, one backend dispatch, one context builder.
- Browser inference uses OPFS and WebGPU efficiently; no unnecessary JS-heap copies.

## Quick reference — all open issues

| ID | Summary | Severity | Subsystem | Status |
|----|---------|----------|-----------|--------|
| I-01 | NativePluginBridge per-block `tauriInvoke` | High | Engine | Deferred — needs SAB spec |
| I-02 | Parallel AI backend-dispatch layers | Medium | AI runtime | Deferred — unify `invokeLlm` |
| I-03 | Singleton plugin stores (Levain, Toaster) | Medium | Stores | Deferred — needs spec |
| I-04 | Full Automerge snapshot on each DSO commit | Medium | AI / CRDT | Deferred — needs undo strategy |
| I-05 | TrackNode hardcoded plugin branches | High | Engine | Deferred — needs DeviceNode spec |
| I-06 | PDC latency not wired to host | Medium | Engine | Deferred — needs host-wide PDC spec |
| I-08 | LR4 crossover doesn't sum flat | High | DSP | Deferred — topology redesign |
| I-12 | Crumbs pitch-up has no anti-aliasing | Medium | DSP | Deferred — per-voice LPF design |
| I-14 | Knead/action history stores not persistent | Medium | Storage | Deferred — storage-shim design |
| I-15 | Fermenter telemetry at audio-rate into store | Medium | Perf | Deferred — needs SAB telemetry |
| I-16 | Chat UI re-renders on every token | Medium | AI / Perf | Deferred — message-component split |
| I-19 | Bypass rebuilds graph for generic devices | Medium | Engine | Deferred — tied to I-05 |
| I-21 | Toaster sequencer no `sampleFrame` | Low | Engine | Deferred — transport sync |
| I-22 | Limiter O(window×N) lookahead scan | Medium | DSP / Perf | Deferred — monotonic deque |
| I-25 | Proof module duplication (Proof vs Plugin/) | Low | Architecture | Deferred — product decision |
| I-26 | Grinder params not sample-accurate | Low | Engine | Deferred — automation policy |
| I-27 | PianoRoll subscribes to whole stores | Medium | Perf | Deferred — selector design |
| I-28 | Legacy brand-CMS keys in LocalStorage | Low | Cleanup | Deferred — legal review |
| I-29 | Recording hardcoded to mono | Medium | Engine | Deferred — UI policy |
| I-30 | DSP claims needing re-verification | Mixed | DSP | Deferred — per-plugin audits |
| S-01 | Fader snap on release (write-path storm) | High | UI / Perf | Needs spec — §8.14 |
| S-02 | Multi-track selection missing | High | State | Needs spec — §8.18 |
| S-03 | Multi-track recording broken (single session) | Critical | Recording | Needs spec — §8.18/N4 |
| S-04 | Crust silent — no DSP implementation | High | Plugin | Needs spec — §8.19 |
| S-05 | Proof EQ engine-side param verification | Medium | Engine | Needs XOI run — §8.20 |
| S-06 | WebLLM model mismatch (Qwen3 tools) | Low | AI runtime | Surveillance — §8.2 |
| S-07 | SharedArrayBuffer/COEP residual failures | Medium | Dev env | Residual — §8.4 |
| S-08 | Chord helper notes hidden under fold | Medium | MIDI editor | Needs fold-contract — §8.11 |
| S-09 | Off-scale lasso miss under fold | Medium | MIDI editor | Tied to S-08 — §8.12 |
| S-10 | Delay tempo sync missing | Low | Feature gap | §8.10 |
| S-11 | TrackDevicesSection menu huge | Low | UX | §8.15 |
| S-12 | Minimap non-resizable | Low | UX | §8.16 |
| S-13 | Levain boot time (speculative) | Low | Perf | §8.17 — measure first |
| S-14 | "Improve the templates" | Low | Product | §8.6 — needs definition |
| M-01 | MidiNote.startBeat dual convention | Critical | MIDI model | Needs spec — §14/G1 |
| M-02 | PatternBrowser empty clip at playhead > 0 | High | MIDI / Timeline | Blocked on M-01 — §14/G2 |
| T-01 | Time-shift desync (deleteTimeRange, rippleDelete) | Critical | Timeline | Partially fixed |
| T-04 | MIDI drag preview "stay behind" | Major | Timeline | Deferred — preview reshape |
| T-06 | MIDI stretching not implemented | Major | Timeline | Deferred — needs spec |
| T-07 | MIDI looping visual distortion | Minor | Timeline | Deferred — preview reshape |
| T-08 | Missing preview for stretch/trim | Minor | Timeline | Partially groundwork done |
| B-01 | OPFS model load path (JS heap copy) | Medium | Browser AI | Open — perf |
| B-02 | DiffSinger inter-stage tensor residency | Medium | Browser AI | Open — perf |
| B-03 | DDSP/TFJS stub (no browser DDSP) | Medium | Browser AI | Open — blocked on ONNX port |
| N-01 | Clip drag doesn't follow cursor (dirty flag) | Critical | Timeline UX | NEW — user-reported |
| N-02 | removeClip() orphans MIDI/automation data | High | Data integrity | NEW |
| N-03 | duplicateTrack() drops CC, pitch bend, automation | High | Data integrity | NEW |
| N-04 | deleteTimeRange() orphans MIDI on split/delete | High | Data integrity | NEW |
| N-05 | KneadEditor toolbar malformed JSX | High | UI render | NEW |
| N-06 | Punch-in recording broken (early return) | High | Transport | NEW |
| N-07 | Frozen track field inconsistency | Medium | Scheduling | NEW |
| N-08 | MIDI note min duration mismatch (add vs resize) | Low | MIDI | NEW |
| N-09 | Freeze/bounce ignores mute/solo | Medium | Export | NEW |
| N-10 | IDB auto-save failures silent | High | Persistence | NEW |
| N-11 | Incremental save timestamp collisions | Medium | Persistence | NEW |
| N-12 | WaveformEditor receives audioBufferId instead of clipId | Critical | ClipView | NEW |
| N-13 | Freeze tail stored in beats, model expects seconds | Critical | Freeze/Bounce | NEW |
| N-14b | Bounce tempo hardcoded to 120 BPM | Critical | Freeze/Bounce | NEW |
| N-15 | Synth velocity→filter attack coupling inverted | High | Synth DSP | NEW |
| N-16 | Automation recording has no undo | High | Automation | NEW |
| N-17 | Sidechain routes not cleaned on track deletion | High | Routing | NEW |
| N-18 | Toaster store singleton — multi-instance collision | High | Toaster | NEW |
| N-19 | Proof param bridge incomplete — only 10 params wired | High | Proof | NEW |
| N-20 | TrackNode.dispose() leaks meterNode port + device controls | High | Engine | NEW |
| N-21 | Regex escape bug in prompt parser — grid sizes never match | High | AI Runtime | NEW |
| N-22 | Yeast worklet sync race — MIDI drops on processor add | High | Yeast | NEW |
| N-23 | Extension runEditorScript uses new Function() despite security comment | High | Extension | NEW |
| N-24 | Faust AudioWorklet registration race condition | Medium | Faust | NEW |
| N-25 | Audio loop gain uses wrong beat offset | Medium | Transport | NEW |
| N-26 | CC and pitch bend values not validated | Medium | MIDI | NEW |
| N-27 | Crumbs file drop silently fails on web | Medium | Crumbs | NEW |
| N-28 | Automation circular lane link → infinite recursion | Medium | Automation | NEW |
| N-29 | Synth offline render skips filter envelope | Medium | Synth | NEW |
| N-30 | Grinder/Bacteria/Gluten missing device lifecycle hooks | Medium | Plugins | NEW |
| N-31 | Clip boundary hit test uses inclusive end (off-by-one) | Medium | Arrangement | NEW |
| N-32 | SampleLibrary analysis creates & closes AudioContext prematurely | Medium | SampleLibrary | NEW |
| N-33 | Knead DSP analysis loses sub-cent precision | Low | Knead | NEW |
| N-34 | Scoring canvas DPI scaling incomplete | Low | Scoring | NEW |
| N-35 | 11/13 worklet processors allocate Float32Array in process() | High | Engine RT | NEW |
| N-36 | Faust param address mismatch — synth params silently fail | Critical | Faust | NEW |
| N-37 | All Faust instruments are monophonic — no chords | High | Faust | NEW |
| N-38 | MIDI import running status bleeds between tracks | High | MIDI import | NEW |
| N-39 | Sidechain routes lost on project reimport | High | Project | NEW |
| N-40 | Bounce operations have no undo | High | Freeze/Bounce | NEW |
| N-41 | Frozen buffer offline render starts at position 0 | High | Freeze/Bounce | NEW |
| N-42 | flattenTrack adds hardcoded 4-beat offset to endBeat | Medium | Freeze/Bounce | NEW |
| N-43 | Duplicate shortcut Cmd+Shift+A (deselect vs automation) | Medium | Shortcuts | NEW |
| N-44 | removeTrack doesn't clean sidechain routes | High | Arrangement | NEW |
| N-45 | Ghost clips missing loop/stretch properties in render model | Medium | Rendering | NEW |
| N-46 | ScrollY clamping uses hardcoded 200px instead of viewport | Medium | Timeline | NEW |
| N-47 | insertTime/deleteTime don't shift tempo/time-sig changes | High | Timeline | NEW |
| N-48 | Faust node setParam uses partial names, not full addresses | Medium | Faust | NEW |
| N-14 | `executeAppAction` handler map duplication | Low | Architecture | Open — clarity |
| F-01 | Legacy builtin-* devices | Low | Factory content | Open — deprecation plan |
| F-02 | Descriptor layout unification | Low | Factory content | Open — maintainability |

## Relevant code paths

- `src/modules/AiRuntime/` — chat, DSO editor, prompt parsing, backend resolution.
- `src/modules/AudioEngine/engine/` — `TrackNode`, `GrinderNode`, `FermenterNode`, `ProofChamberNode`, `NativePluginBridgeNode`, WAM registry.
- `src/modules/AudioEngine/services/` — worklet processors (one file per plugin).
- `src/modules/{Toaster,Proof,Levain,Knead,Grinder,GrandBoule,Fermenter,Crumbs,Crust,Plugin,Faust}/` — per-plugin UI + stores + use cases.
- `crates/proof-chamber/`, `crates/daw-dsp/` — Rust DSP.
- `src/modules/BrowserAi/` — ONNX/OPFS/WebGPU inference workers, storage manager.
- `src/modules/AiGeneration/` — MIDI generation, pattern templates.
- `src/modules/Arrangement/repositories/presets/` — factory preset banks.
- `src/infra/store/storage/` — storage adapters and LocalStorage key registry.
- `src/modules/CrdtDocument/` — Automerge repo, snapshot use cases.
- `src/modules/Workspace/presentations/views/ClipView/` — PianoRoll, KneadEditor.

---

## Open issues — Audio Engine & Plugin Architecture

### I-01. Native plugin audio path uses per-block `tauriInvoke`

**Problem:** Every audio block round-trips through Tauri IPC to reach the native plugin host.

**Representative files:**
- `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts:51` — `await tauriInvoke('process_plugin_audio', …)` inside the audio path.

**Needed:** `SharedArrayBuffer` rings between the worklet and the Rust cpal thread; param updates via separate low-rate control channel.

**Status:** Verified 2026-04-18. Deferred — architectural; requires SAB transport spec.

---

### I-05. `TrackNode` hardcodes plugin-specific branches and imports cross-module internals

**Problem:** Shared engine code has branches for specific plugins (`'builtin-sidechain-compressor'`, `'faust-'` prefix, `fermenterControls`, `toasterControls`, `levainControls`, `grandBouleControls`, `wamControls`, `nativeDspControls`, `proof` type) plus hard-imports `unregisterLevainDevice` and `unregisterProofDevice` from other modules.

**Representative files:**
- `src/modules/AudioEngine/engine/TrackNode.ts:2-3` — cross-module imports.
- `TrackNode.ts` — ~243 (`builtin-sidechain-compressor`), ~310–329 (`findWasmDescriptor`), ~336–366 (`removeDevice` cleanup), ~369–416 (`updateParam` branches), ~434 (`scheduleParam` `faust-` prefix), ~459–476 (`updateBypass`). Total: **509 LOC**. _(Line numbers approximate; verified 2026-04-18.)_

**Needed:** Uniform `DeviceNode` interface (`setParam`, `scheduleParam`, `setBypass`, `dispose`). Move per-plugin logic back into plugin modules.

**Status:** Verified 2026-04-18. Deferred — large refactor; needs DeviceNode interface spec.

---

### I-06. Hosted plugins report PDC latency but the host ignores it

**Problem:** `ProofChamberInstance::get_latency()` is implemented and exposed in JS, but the worklet never calls it.

**Representative files:**
- `crates/proof-chamber/src/lib.rs:164` — `pub fn get_latency(&self) -> u32`.
- `src/modules/AudioEngine/wasm/proof_chamber.js:17-18` — JS wrapper.
- `src/modules/AudioEngine/services/proofChamberProcessor.ts` — no `get_latency` reference.

**Needed:** Host-wide PDC bus. Query latency on plugin ready, sum across chain, compensate recording + automation.

**Status:** Verified 2026-04-18. Deferred — needs PDC spec.

---

### I-19. `TrackNode` rebuilds graph on bypass for generic devices

**Problem:** `updateBypass` falls through to `this.rebuildChain()` for Faust/WAM/factory devices.

**Representative files:**
- `src/modules/AudioEngine/engine/TrackNode.ts:459-476`.

**Needed:** Pre-built bypass gain node; bypass becomes one-param change. Related to I-05.

**Status:** Verified 2026-04-18. Deferred.

---

### I-25. Plugin module duplication: `Proof` vs `Plugin/ProofChamber`

**Problem:** Three locations for one plugin: `src/modules/Proof/`, `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx`, `src/modules/AudioEngine/engine/ProofChamberNode.ts`.

**Needed:** Product decision on which is canonical; remove the rest.

**Status:** Verified 2026-04-18. Deferred.

---

### I-26. Grinder's main parameters are not sample-accurate

**Problem:** 9 `parameterDescriptors` declared, all read via `values[frames - 1]` (block-end). ~50 other params via `postMessage`.

**Representative files:**
- `src/modules/AudioEngine/services/grinderProcessor.ts:112-123` (descriptors), `:191-196` (block-end read).

**Needed:** Policy on automatable params; per-sample reads for those.

**Status:** Verified 2026-04-18. Deferred.

---

### I-29. Recording pipeline hardcoded to one channel

**Problem:** Recording `AudioWorkletNode` uses `channelCount: 1, channelInterpretation: 'discrete'`.

**Representative files:**
- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:121-127`.

**Needed:** Parameterise by track input channel count; UI toggle.

**Status:** Verified 2026-04-18. Deferred.

---

### S-03. Multi-track recording is broken (single session)

**Problem:** `recording.ts:36-63` holds a single `recordingSession`. When `toggleRecording` loops over armed tracks and calls `startAudioRecording(trackId, ...)`, each call overwrites the previous session — only the last-armed track gets audio.

**Representative files:**
- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:36-63` — single `recordingSession` via `createHmrPersistentState`.
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts:27-59` — loops over armed tracks.

**Needed:** `recordingSessions: Map<trackId, RecordingSession>`. Independent stop per track, plus `stopAllAudioRecording` convenience.

**Status:** Verified 2026-04-18. Critical — needs spec.

---

### S-04. Crust silent — no DSP implementation

**Problem:** Crust ships a complete front-end (stores, useCases, presentations, presets, param bridge) and `CRUST_DESCRIPTOR` is in `BUILTIN_PLUGINS` with `id: 'crust'`, but **no engine-side DSP exists**. No CrustNode, no worklet, no Faust module, no Rust crate.

**Concrete sequence:**
1. `addDevice(trackId, 'crust')` appends `{ type: 'crust' }` to track.devices.
2. `TrackNode.addDevice` reaches `findWasmDescriptor('crust')` fallback, gets `undefined`, hits **unlogged** `return;` (~311-312).
3. Device never inserted into `strip.deviceNodes`. Knobs move but audio is bit-identical to no device.
4. No log signal on the live path.

**Representative files:**
- `src/modules/Crust/` — full front-end stack.
- `src/modules/Arrangement/models/pluginDescriptors/crustDescriptor.ts` — descriptor in `BUILTIN_PLUGINS`.
- `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts` — `'crust'` absent from all matchers.
- `src/modules/AudioEngine/repositories/deviceStrategy/setupDeviceStrategies.ts` — no `'crust'` strategy.

**Needed:**
1. Decide DSP backend: Faust module or Rust/WASM (pure Web Audio insufficient for true-peak/lookahead/oversampling).
2. Interim: register `PluginNotImplementedError` + toast for `'crust'`, or move out of `BUILTIN_PLUGINS`.
3. Audit all other `BUILTIN_PLUGINS` descriptors against both dispatch tables — **Crumbs** (`builtin-crumbs`) is the next suspect (web-only: `createCrumbsInstance` short-circuits to no-op without Tauri).

**Status:** Verified 2026-04-18. High — needs spec.

---

### S-05. Proof (parametric EQ) engine-side verification

**Problem:** UI double-dispatch and boolean-encoding are fixed, but the `onSendParam` → `ProofNode.postMessage` → AudioWorklet setter chain has not been confirmed end-to-end under cross-origin isolation.

**Known UI quirk:** `ProofEqCurve` only drags freq (X) and gain (Y); Q via knob only.

**Needed:** Confirm under cross-origin-isolated conditions that a param change produces the matching DSP change.

**Status:** Partially verified 2026-04-18. Needs XOI runtime test.

---

## Open issues — DSP

### I-08. LR4 four-band splitter cascades crossovers — doesn't sum flat

**Problem:** `FourBandSplitter::process` feeds high output of xover1 → xover2 → xover3. Phase delay differs per band; sum is not flat.

**Representative files:**
- `crates/daw-dsp/src/proof/crossover.rs:87-92`.
- `crates/daw-dsp/src/bacteria/crossover.rs` — same pattern.

**Needed:** Parallel LR4s with allpass compensation, or Linkwitz-Riley topology that sums flat by construction.

**Status:** Verified 2026-04-18. Deferred — topology redesign.

---

### I-12. Crumbs pitch-up has no anti-aliasing

**Problem:** 4-point cubic Hermite interpolation with no lowpass pre-filter at pitch ratios > 1.0.

**Representative files:**
- `crates/daw-dsp/src/crumbs/voice.rs:218-240`.

**Needed:** Pre-resample LPF or windowed-sinc interpolator.

**Status:** Verified 2026-04-18. Deferred.

---

### I-22. Proof limiter does O(window × samples) lookahead scan

**Problem:** Per-sample `gain_buffer.iter().copied().fold(0.0_f32, f32::max)` — O(W) per sample.

**Representative files:**
- `crates/daw-dsp/src/proof/limiter.rs:84-92`.

**Needed:** Monotonic deque (Lemire algorithm) for O(1) amortised.

**Status:** Verified 2026-04-18. Deferred — perf not correctness.

---

### I-30. DSP claims requiring re-verification

Carried over from sub-audits, not re-proved this cycle:

- **Toaster:** Transient Shaper click; Tone/Choke/Decay sample-rate dependency; disconnected global effect mix in Rust.
- **Proof:** Oversampler delay-line state corruption; tape-exciter emphasis ordering; telemetry-slot leak.
- **Levain:** Tone/Attack/Release macros stubbed in Rust; true legato stubbed; human seed hardcoded to 42.
- **Knead:** Block-based PSOLA artefacts; static `shift_semitones` API; pitch data bound to track not clip; right channel ignored; UI params not sent to DSP; UI read-only.
- **Grand Boule:** Missing parameter mappings; inverted voice stealing; simplification defeated by sustain; panic button ineffective.
- **Faust:** Missing `destroy()` on teardown; monophonic synths used polyphonically; `/fm_synth` vs `/FM_Synth` mismatch; `setTimeout(20)` init race; main-thread compilation.
- **Crumbs:** Fake loop crossfading; hardcoded 44100; inefficient IPC polling; un-batched IPC for loop params.
- **Cross-cutting:** Design-system inconsistencies; export gaps; Chromium fast paths.

**Status:** Not re-verified. Deferred — belongs in per-plugin audits.

---

## Open issues — AI Runtime

### I-02. AI runtime has two parallel backend-dispatch layers

**Problem:** `sendChatMessage`, `executeDsoEdit`, and `generateToolCalls` each implement their own fallback chain. `sendChatMessage.ts` ≈ **296 LOC**; `executeDsoEdit.ts` ≈ **451 LOC** (2026-04-18).

**Representative files:**
- `src/modules/AiRuntime/useCases/sendChatMessage.ts`
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:300-409` (`invokeLlm` helper)
- `src/modules/AiRuntime/useCases/llmOrchestration/inference.ts`

**Needed:** One backend-dispatch use case owning chain, status transitions, error mapping.

**Status:** Verified 2026-04-18. Deferred — architectural.

---

### I-04. DSO edit performs full Automerge snapshot before and after each plan

**Problem:** Undo captures full binary bundle of every Automerge document twice per AI edit.

**Representative files:**
- `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts:252,258` — `saveSnapshot()` before + after inside `commitDsos`.

**Needed:** Automerge change/heads mechanism for undo, or snapshot only touched documents.

**Status:** Verified 2026-04-18. Deferred.

---

### I-16. AI chat UI re-renders on every token and re-parses markdown

**Problem:** `ChatPanel` subscribes to entire `chatStore`; every token update re-renders all messages with `ReactMarkdown`.

**Representative files:**
- `src/modules/AiRuntime/presentations/views/ChatPanel.tsx:77-82` (subscribe), `:174-219` (map + ReactMarkdown), `:215` (ReactMarkdown call).
- `src/modules/AiRuntime/useCases/sendChatMessage.ts:221,235,263` (per-token `updateChatMessage`).

**Needed:** Per-message subscribed component keyed by id; markdown parse cache.

**Status:** Verified 2026-04-18. Deferred.

---

### S-06. WebLLM model mismatch (Qwen3 tools)

**Problem:** `UnsupportedModelIdError: Qwen3-4B-q4f16_1-MLC is not supported for tools`. No MLC-bound call site attaches `tools:` today — warning may be stale build artefact.

**Representative files:**
- `src/modules/AiRuntime/repositories/webLlm/toolCalling.ts` — routes around via `parseToolCallXml`.
- `src/utils/capabilities.ts` — `supportsToolsApi(modelId)` gate.

**Close criteria:** If logs over representative usage never show `tools` in payload keys, close as stale.

**Status:** Surveillance only.

---

## Open issues — Plugin Stores & State

### I-03. Singleton plugin stores prevent multi-instance usage

**Problem:** Levain and Toaster hold one instance of state per store; multiple instances collide.

**Representative files:**
- `src/modules/Levain/stores/levainStore.ts:43-45` — one global `LevainState`.
- `src/modules/Toaster/useCases/loadToasterKit.ts:59-63` — `tracks.find(...)` returns first match.

**Note:** ~~Fermenter~~ **corrected 2026-04-18:** Fermenter store is already keyed by `deviceId`.

**Needed:** Key state by device/instance ID for Levain and Toaster.

**Status:** Verified 2026-04-18. Deferred.

---

### I-14. Volatile state that should be durable

**Problem:** Knead pitch edits and action history lost on reload (in-memory only, no persistence adapter).

**Representative files:**
- `src/modules/Knead/stores/kneadStore.ts` — no persistence.
- `src/modules/CrdtDocument/stores/actionHistoryStore.ts` — no persistence.

**Needed:** Wire through `createLocalStorage` / `createAutomergeStorage` with `toCrdt` shim.

**Status:** Verified 2026-04-18. Deferred.

---

### I-15. Fermenter telemetry updates store at audio-rate

**Problem:** Telemetry pushed into React-subscribed store per audio block; re-renders any subscriber. Morph path sends 80+ `postMessage` per tick (not re-measured).

**Representative files:**
- `src/modules/Fermenter/stores/fermenterStore.ts` (store), `useFermenterTelemetry.ts` (hook).
- `src/modules/AudioEngine/services/fermenterProcessor.ts` — block-aligned param updates.

**Needed:** SAB or event-emitter for telemetry at UI rate; batch morph messages.

**Status:** Partially verified 2026-04-18. Deferred.

---

## Open issues — UI & State Management

### S-01. Faders snap on release (write-path storm)

**Problem:** Continuous `onValueChange` commits to `trackStore` per pointer-move; store fanout blocks rendering; slider lags, catches up on release.

**Evidence chain:**
1. Radix `Slider` emits `onValueChange` continuously.
2. `TrackLevelSection.tsx:39-41` calls `setTrackGain(track.id, v/100)` synchronously.
3. `setTrackGain.ts:9-14` does four things: `updateTrack` → store fanout, `engineSetTrackGain`, `syncToasterPadParam`, `maybeRecordAutomation`.
4. Store subscribers (TimelineSurface, mixer) can take >16ms → missed pointermove events.

**Fix direction:**
1. Split fast/commit path: local ref during drag, commit on `onValueCommit` (pointer-up).
2. Decouple: selector-based subscriptions for timeline/mixer.

**Needed:** Systemic fix across faders, pan knobs, sends, device params. Not per-control.

**Status:** Verified 2026-04-18. Needs spec.

---

### S-02. Multi-track selection missing

**Problem:** `trackStore.ts:22-28` models selection as `selectedTrackId: string | null`. No multi-select.

**Needed:** `selectedTrackIds: string[]` with `primarySelectedTrackId` derived. Every consumer (Inspector, automation, deletion, sidebar) migrates simultaneously.

**Status:** Verified 2026-04-18. Needs spec.

---

### S-11. `TrackDevicesSection` menu huge

**Problem:** Three categorised flat lists (effect/utility/analyzer) plus external plugins; no search filter, no accordion.

**Representative files:**
- `src/modules/Workspace/presentations/views/Inspector/TrackDevicesSection.tsx`.

**Needed:** Accordions by category, search input, virtualise external list.

**Status:** Verified 2026-04-18. UX scope — not a regression.

---

### S-12. Timeline minimap non-resizable

**Problem:** `MINIMAP_HEIGHT = 28px`, fixed, no drag handle.

**Representative files:**
- `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx`.

**Needed:** Top-edge `DragResizeHandle` writing to `preferencesStore`.

**Status:** Verified 2026-04-18. Feature gap.

---

### I-27. PianoRoll subscribes to whole midiStore + trackStore

**Problem:** Two `useStore` subscriptions at `PianoRoll.tsx:98-99`; any note change on any clip re-renders.

**Needed:** Selector isolating active clip's notes; or split canvas into own component.

**Status:** Verified 2026-04-18. Deferred.

---

### N-14. `executeAppAction` handler map duplication

**Problem:** `executeAppAction` merges handlers from both `handlers/` directory and `useCases/*Handlers.ts` files — two maps built independently. Makes handler ownership unclear and is a recurring footgun when adding new commands.

**Needed:** Single handler registration point.

**Status:** Verified 2026-04-18. Low priority — architectural.

---

### I-28. `LocalStorageKeys.ts` still carries legacy brand-CMS keys

**Problem:** ~80% of keys are from a different product (brand nav, marketplace, font cache). DAW keys start at line 95.

**Representative files:**
- `src/infra/store/storage/LocalStorageKeys.ts:14-94`.

**Needed:** Legal review before removal per file header.

**Status:** Verified 2026-04-18. Deferred.

---

## Open issues — MIDI Model & Coordinate Convention

### M-01. `MidiNote.startBeat` has two incompatible conventions (§14/G1)

**Problem:** `MidiNote.startBeat` is **clip-relative** in some paths and **timeline-absolute** in others:

| Path | Convention | Evidence |
|------|-----------|----------|
| `clipDrawing.ts:386` | Expects absolute (subtracts `clip.startBeat` in `relStart`) | `relStart = (note.startBeat - midiOffset) - clip.startBeat + loopOffset` |
| `renderOffline.ts:96` | Expects clip-relative | `noteStart = (clip.startBeat - startBeat + note.startBeat) / tempo * 60` |
| `duplicateClipCore.ts:42` | Treats as absolute (shifts by `beatDelta`) | `startBeat: note.startBeat + beatDelta` |
| `usePianoRollRenderer.ts:526` | Treats as clip-relative | `x = note.startBeat * beatWidth` (no clip.startBeat subtraction) |
| `usePianoRollInteractions.ts:435-469,581+` | Creates clip-relative | `beat = snap(x / beatWidth)` |
| `applyMelodyToTrack.ts:42` | Stores absolute | `startBeat: startBeat + note.startBeat` |
| `applyChordProgressionToTrack.ts:44` | Stores absolute | `startBeat: startBeat + note.startBeat` |
| `PatternBrowser.tsx:297-305` | Stores clip-relative | `batchAddMidiNotes` with template-local `startBeat` |
| `importMidiFile.ts:42` | Masks issue | Forces `clip.startBeat = 0` |

**Impact:** When `clip.startBeat > 0`, timeline preview and piano roll disagree. Pattern insert → "empty timeline clip". AI insert → "empty piano roll".

**Secondary:** `generateChordProgression` defaults to `rhythm = 'whole'` (one downbeat per bar, `algorithm.ts:158-160`). Combined with the coordinate bug, a 4-bar progression can produce only 12 notes that are all hidden. The one-note-per-bar default is worth revisiting as a UX choice once M-01 lands.

**Needed:** Pick one convention, align all paths, add test: clip at `startBeat = 8` with notes visible in both views. Touches: `clipDrawing.ts`, `createWebGpuRenderer.ts`, `renderOffline.ts`, `duplicateClipCore.ts`, both AI apply functions, migration + tests.

**Status:** Verified 2026-04-18. Critical — needs its own spec.

---

### M-02. PatternBrowser empty clip when playhead > 0 (§14/G2)

**Problem:** `handleInsertTemplate` stores clip-relative `startBeat` via `batchAddMidiNotes`. Timeline `clipDrawing` `relStart` math assumes absolute notes → clip preview blank when `clip.startBeat > 0`.

**Blocked on:** M-01.

**Status:** Verified 2026-04-18.

---

### S-08. Chord helper notes hidden under fold (§8.11)

**Problem:** Off-scale chord helper notes (3rd/5th outside current scale) disappear from renderer AND hit-test under fold. User can't interact without toggling fold off.

**Options:**
1. Include every pitch that has a note in visible-pitch set.
2. Render off-scale at nearest scale row with off-scale glyph.
3. Auto-disable fold when off-scale notes exist.

**Needed:** Fold-contract UX decision; linked to M-01 coordinate spec.

**Status:** Verified 2026-04-18. Deferred — multi-file, UX-reviewed change.

---

### S-09. Off-scale lasso miss under fold (§8.12)

Tied to S-08 — same `visiblePitches.indexOf(note.pitch) === -1` filter. Resolving S-08 resolves this.

---

## Open issues — Timeline Editing

### T-01. Widespread time-shift desync and data loss

**Problem:** `deleteTimeRange` and `rippleDeleteClips` shift clips without shifting MIDI notes/automation, causing data loss.

**Representative files:**
- `src/modules/Arrangement/useCases/clipEditing/deleteTimeRange.ts`
- `src/modules/Arrangement/useCases/rippleDelete/rippleDeleteClips.ts`

**Fixed portions:** `nudgeClip` and `insertTime` now shift MIDI + automation (2026-04-16).

**Remaining:** Three-way partition per clip (notes before/inside/after deleted range).

**Status:** Partially fixed 2026-04-16. Deferred remaining paths.

---

### T-04. MIDI drag preview "stay behind" bug

**Problem:** Clip boundary moves during drag but MIDI note previews stay at original positions.

**Representative files:**
- `src/modules/Arrangement/presentations/renderers/clipDrawing.ts` (`drawMidiNotePreview`).

**Needed:** `visualShift` in `ClipRenderModel` populated during preview phase.

**Status:** Deferred — preview-layer reshape.

---

### T-06. MIDI stretching not implemented

**Problem:** Stretch tool only changes `endBeat`; doesn't scale note positions/durations.

**Needed:** `scaleClipMidiNotes(clipId, ratio)` use case; spec for anchor point and interplay with audio `stretchRatio`.

**Status:** Deferred — needs spec.

---

### T-07. MIDI looping visual distortion

**Problem:** `drawMidiNotePreview` stretches notes to fit duration instead of repeating at `loopLength`.

**Status:** Deferred — bundled with T-04/T-08 preview reshape.

---

### T-08. Missing preview for stretch/trim

**Problem:** Stretch/trim only update clip boundary in preview; MIDI/waveform don't update until release.

**Groundwork:** `ClipRenderModel` now carries `audioOffsetBeats` and `stretchRatio`.

**Remaining:** Wire preview phase to update these during drag.

**Status:** Partially done. Deferred with T-04/T-07.

---

## Open issues — New findings (2026-04-18 code walk)

### N-01. Clip drag doesn't follow cursor — canvas dirty flag not set during preview

**Problem:** During clip drag, `clipDragPreviewRef` is updated every mousemove (useTimelineInteractions.ts:441-467) but it's a plain ref, not a store. The render loop in TimelineSurface.tsx:267-279 only sets `dirty = true` on store subscriptions (transportStore, trackStore, etc.). Since no store changes during drag, `dirty` may stay false and the canvas skips re-rendering. Clips appear to "teleport" on release instead of following the cursor.

**Representative files:**
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:267-279` — dirty only from store subscriptions.
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:313` — render only if `dirty`.
- `src/modules/Arrangement/presentations/hooks/useTimelineInteractions.ts:441-467` — preview ref mutation without marking dirty.

**Needed:** Either subscribe to preview ref changes, or call `markDirty()` after each preview update. The preview mechanism is well-designed — it just needs to trigger a repaint.

**Status:** NEW. Critical UX — user-reported.

---

### N-02. removeClip() doesn't clean up MIDI notes or automation

**Problem:** `removeClip.ts` (5 lines) only filters the clip from `track.clips`. It never deletes corresponding MIDI notes from `midiStore` (notesByClipId, ccByClipId, pitchBendByClipId) or automation from `automationStore`. Data persists as orphaned entries.

**Representative files:**
- `src/modules/Arrangement/useCases/clip/removeClip.ts:3-5` — only `clips.filter()`.

**Needed:** After removing the clip, clean up `midiStore` entries keyed by the removed clipId, and automation lanes/points.

**Status:** NEW. Data leak — grows with every clip deletion.

---

### N-03. duplicateTrack() drops CC, pitch bend, and automation

**Problem:** When duplicating a MIDI track, `duplicateTrack.ts:37-38` explicitly sets `ccByClipId` and `pitchBendByClipId` to `currentMidi?.ccByClipId ?? {}` (the GLOBAL state, not the per-clip data). CC and pitch bend for the duplicated clips are never copied. Automation is not duplicated at all — no call to any automation copy function.

**Representative files:**
- `src/modules/Arrangement/useCases/duplicateTrack.ts:37-38` — CC/pitchBend overwritten with global state.
- `src/modules/Arrangement/useCases/duplicateTrack.ts:72-90` — no automation duplication.
- `src/modules/Arrangement/useCases/duplicateTrack.ts:78-81` — devices shallow-copied but no engine nodes created.

**Needed:** Copy per-clip CC and pitch bend to new clip IDs. Duplicate automation lanes. Create engine-side device nodes for the new track.

**Status:** NEW. Data loss on core workflow.

---

### N-04. deleteTimeRange() orphans MIDI data for split and deleted clips

**Problem:** `deleteTimeRange.ts` creates a new right clip (line 24-30) with a UUID but never migrates MIDI notes to the new clip ID. Fully deleted clips (line 20-21) are removed from `track.clips` but their MIDI data persists in `midiStore`. Same issue as T-01 but specifically for deleteTimeRange's split behavior.

**Representative files:**
- `src/modules/Arrangement/useCases/clipEditing/deleteTimeRange.ts:20-31`.

**Needed:** When splitting, call `splitMidiNotesAtBeat` (as splitClip already does). When deleting, clean up midiStore entries.

**Status:** NEW. Data loss — MIDI notes orphaned or lost on time-range delete.

---

### N-05. KneadEditor toolbar has malformed JSX — broken rendering

**Problem:** Lines 415-451 of KneadEditor.tsx use escaped quotes (`className=\"...\"`) while the rest of the file uses normal quotes. Lines 453-454 have orphaned `}` and `/>` closing tags that don't match any opening element. This creates a rendering break in the Knead pitch editor toolbar (Retune, Scale, Human controls).

**Representative files:**
- `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx:415-454`.

**Needed:** Replace escaped quotes with normal JSX quotes and fix the orphaned closing tags.

**Status:** NEW. Build/render error — Knead toolbar broken.

---

### N-06. Punch-in recording is broken — sets isRecording false and returns

**Problem:** When `punchInEnabled` is true and the user presses record, `toggleRecording.ts:77-82` immediately sets `isRecording: false` and returns early. It never starts actual recording. Punch-in functionality is completely non-functional.

**Representative files:**
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts:77-82`.

**Needed:** Remove the `isRecording: false` assignment and early return. Let the flow continue to `beginActualRecording()` (with punch-in-specific scheduling).

**Status:** NEW. Feature completely broken.

---

### N-07. Frozen track field inconsistency between schedulers

**Problem:** `scheduleMidiNotes.ts:181` checks `track.frozen && track.frozenBufferId` while `scheduleAudioClips.ts:80` checks `track.freezeState?.status === 'frozen'`. The Track model has BOTH `frozen: boolean` (line 46) AND `freezeState` (line 18). These can desync — a track could have `frozen: false` but `freezeState.status === 'frozen'`, causing MIDI notes to play on a frozen track or vice versa.

**Representative files:**
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:181` — uses `track.frozen`.
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:80` — uses `track.freezeState?.status`.
- `src/modules/Arrangement/models/Track.ts:18,46` — both fields exist.

**Needed:** Unify on one freeze mechanism. Remove the redundant field.

**Status:** NEW. Potential playback inconsistency.

---

### N-08. MIDI note minimum duration inconsistency

**Problem:** `addMidiNote.ts:20` clamps minimum duration to `0.0625` (64th note), but `resizeMidiNote.ts:12` clamps to `0.125` (32nd note). A note can be created at duration 0.0625 but cannot be resized back to that duration after any edit.

**Representative files:**
- `src/modules/MIDI/useCases/midiNoteCrud/addMidiNote.ts:20` — `Math.max(0.0625, duration)`.
- `src/modules/MIDI/useCases/midiNoteCrud/resizeMidiNote.ts:12` — `Math.max(0.125, newDuration)`.

**Needed:** Use the same minimum in both paths.

**Status:** NEW. Minor — UX inconsistency.

---

### N-09. Offline freeze/bounce ignores mute and solo state

**Problem:** `renderOffline.ts` renders all tracks at full gain regardless of whether they are muted or soloed. Bounced output doesn't match what the user hears.

**Representative files:**
- `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts:54` — uses hardcoded gain, no mute/solo check.

**Needed:** Apply the current solo/mute routing when building the offline render graph.

**Status:** NEW. Incorrect output — bounce doesn't match session.

---

### N-10. IDB auto-save failures are silent — data loss on quota

**Problem:** `startCrdtAutoSave.ts:28` catch block only logs a warning. If IndexedDB quota is exceeded, autoSave silently fails every 2 seconds. No user feedback. Browser restart loses all unsaved work.

**Representative files:**
- `src/modules/CrdtDocument/useCases/startCrdtAutoSave.ts:28`.

**Needed:** Surface save failures to the user (toast or status bar indicator). Implement a retry or fallback strategy.

**Status:** NEW. Data loss risk.

---

### N-11. Incremental save timestamp collisions can lose edits

**Problem:** `saveIncrementalToIdb.ts:14` uses `Date.now()` for chunk keys. Two saves within the same millisecond overwrite each other. Under rapid AI batch actions, chunks are silently lost.

**Representative files:**
- `src/modules/CrdtDocument/repositories/crdtPersistence/saveIncrementalToIdb.ts:14`.

**Needed:** Use a monotonic counter or append a random suffix to the timestamp key.

**Status:** NEW. Data loss risk under rapid edits.

---

### N-12. WaveformEditor receives audioBufferId instead of clipId

**Problem:** `ClipView.tsx:134` passes `selectedClip.audioBufferId ?? selectedClip.id` as the `clipId` prop to `WaveformEditor`. All downstream operations (warp markers, `replaceClipAudioBuffer`, `setStretchMode`) target the wrong entity — an audio buffer ID, not a clip ID.

**Representative files:**
- `src/modules/Workspace/presentations/views/ClipView.tsx:134`.

**Status:** NEW. Critical — corrupts audio clip editing operations.

---

### N-13. Freeze tail length stored in beats, model expects seconds

**Problem:** `freezeTrack.ts:80` stores `tailLengthSeconds: tailBeats` — a value in beats assigned to a seconds field. At 120 BPM, 8 beats of tail becomes 8 "seconds" instead of 4, doubling the frozen clip length.

**Representative files:**
- `src/modules/Arrangement/useCases/freezeBounce/freezeTrack.ts:80`.

**Status:** NEW. Critical — frozen clips have wrong duration.

---

### N-14b. Bounce tempo hardcoded to 120 BPM

**Problem:** `bounceOperations.ts:36` has `const tempo = 120; // TODO: get actual tempo`. All bounce/export operations ignore the session's actual tempo.

**Representative files:**
- `src/modules/Arrangement/useCases/freezeBounce/bounceOperations.ts:36`.

**Status:** NEW. Critical — bounce output at wrong tempo.

---

### N-15. Synth velocity→filter attack coupling is inverted

**Problem:** `builtinSynth.ts:107` computes `velAttack = params.attack * (1.5 - velocity / 127)`. Harder hits (higher velocity) produce LONGER attack — the opposite of physical expectation and every other synth.

**Representative files:**
- `src/modules/Synth/useCases/builtinSynth.ts:107`.

**Status:** NEW. DSP — sounds wrong.

---

### N-16. Automation recording has no undo

**Problem:** `stopAutomationRecording.ts` calls `batchAddAutomationPoints()` which does not register an undo entry. Users cannot undo recorded automation — it's permanent once committed.

**Representative files:**
- `src/modules/Automation/useCases/automationRecording/stopAutomationRecording.ts`.

**Status:** NEW. Data loss — no undo for recorded automation.

---

### N-17. Sidechain routes not cleaned on track deletion

**Problem:** When a track is deleted, no listener in the Routing module cleans up sidechain routes where `sourceTrackId` or `targetTrackId` matches the deleted track. Dangling route references persist in `sidechainStore`.

**Representative files:**
- `src/modules/Routing/` — no cleanup listener for track deletion.

**Status:** NEW. Data corruption — stale routes cause engine errors.

---

### N-18. Toaster store is a singleton — multi-instance collision

**Problem:** `toasterStore.ts:38-40` is a singleton, not keyed by deviceId (unlike Fermenter which is correctly per-device). Loading a kit in one Toaster instance overwrites state for ALL Toaster instances.

**Representative files:**
- `src/modules/Toaster/stores/toasterStore.ts:38-40`.

**Status:** NEW. Multi-instance bug — same class as I-03.

---

### N-19. Proof param bridge incomplete — only 10 params connected to audio

**Problem:** `setProofParamWithPatch.ts:6-43` only bridges 10 patch parameters to the audio engine. Missing: `target`, `targetLufs`, `eqBands[]`, `dynBands[]`, `excBands[]`, `imgBandWidth[]`, `dynCrossoverFreqs[]`, and `chainOrder`. These parameters show in UI but don't affect DSP.

**Representative files:**
- `src/modules/Proof/useCases/setProofParamWithPatch.ts:6-43`.

**Status:** NEW. UI-DSP desync — most Proof parameters are display-only.

---

### N-20. TrackNode.dispose() leaks meterNode port and device controls

**Problem:** `TrackNode.ts:480-508` `dispose()` disconnects analyserNode but never closes `meterNode.port`. It also doesn't clean up `grandBouleControls`, `kneadControls`, or `proofControls` (compare with `removeDevice()` at lines 338-369 which does). Leaks WorkerThread/WASM state.

**Representative files:**
- `src/modules/AudioEngine/engine/TrackNode.ts:480-508` vs `:338-369`.

**Status:** NEW. Memory leak on track removal.

---

### N-21. Regex escape bug in prompt parser — grid sizes never match

**Problem:** `parsing.ts:139` uses `\\d+` (double backslash) inside a regex literal, creating a pattern that matches literal backslash-d instead of digits. Quantization grid size parsing always fails.

**Representative files:**
- `src/modules/AiRuntime/transformers/promptParser/parsing.ts:139`.

**Status:** NEW. AI feature broken — grid size prompts never parse.

---

### N-22. Yeast worklet sync race — MIDI drops on processor add

**Problem:** `addYeastProcessor.ts:10` calls `getWorkletNodeSync()` immediately after registering a processor type. If the worklet hasn't initialized, returns null. The processor only exists on the main-thread rack; the worklet silently drops MIDI for that processor.

**Representative files:**
- `src/modules/Yeast/useCases/addYeastProcessor.ts:10`.

**Status:** NEW. MIDI drop on processor add.

---

### N-23. Extension runEditorScript uses `new Function()` despite security warning

**Problem:** `runEditorScript.ts:26` uses `new Function()` to execute user scripts. Line 5 has a `// SECURITY` comment explicitly warning against this. Scripts from CRDT sync or imported projects execute with full page privileges.

**Representative files:**
- `src/modules/Extension/useCases/extension/runEditorScript.ts:5,26`.

**Status:** NEW. Security — arbitrary code execution from project files.

---

### N-24. Faust AudioWorklet registration race condition

**Problem:** `compilerEngine.ts:222,236,249,267` uses `resolveReg!()` with non-null assertion. If the Promise constructor fails and `resolveReg` is undefined, concurrent registration requests hang indefinitely.

**Representative files:**
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:222-267`.

**Status:** NEW. Potential hang on Faust plugin load.

---

### N-25. Audio loop gain uses wrong beat offset

**Problem:** `scheduleAudioClips.ts:169` calls `getGainAtBeat(clip.id, iterOffsetBeats)` with a relative offset when an absolute clip-time beat is needed (`clip.startBeat + iterOffsetBeats`). Loop iterations apply gain from the wrong position.

**Representative files:**
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts:169`.

**Status:** NEW. Audio playback — wrong gain in loops.

---

### N-26. CC and pitch bend values not validated on add

**Problem:** `addMidiCC.ts:11` and `addPitchBend.ts:11` accept raw values without bounds checking. CC should be 0-127, pitch bend ±8192. Invalid values pass through to playback/export.

**Representative files:**
- `src/modules/MIDI/useCases/midiNoteCrud/addMidiCC.ts:11`.
- `src/modules/MIDI/useCases/midiNoteCrud/addPitchBend.ts:11`.

**Status:** NEW. Data integrity.

---

### N-27. Crumbs file drop silently fails on web

**Problem:** `handleFileDrop.ts:55-75` gates the entire file drop path behind `if (isTauri())`. On web, file drops are silently ignored — no error, no toast, no fallback.

**Representative files:**
- `src/modules/Crumbs/useCases/handleFileDrop.ts:55-75`.

**Status:** NEW. Web platform — silent failure.

---

### N-28. Automation circular lane link causes infinite recursion

**Problem:** `getAutomationValueAtBeat.ts:43` adds `laneId` to visited set but should add `lane.linkedLaneId`. A→B→A cycles aren't detected — stack overflow.

**Representative files:**
- `src/modules/Automation/useCases/automation/getAutomationValueAtBeat.ts:43`.

**Status:** NEW. Crash on circular automation links.

---

### N-29. Builtin synth offline render skips filter envelope modulation

**Problem:** `builtinSynth.ts:375-380` `scheduleNoteOffline()` hardcodes filter cutoff without envelope. Offline bounces sound different from real-time playback.

**Representative files:**
- `src/modules/Synth/useCases/builtinSynth.ts:375-380`.

**Status:** NEW. Bounce fidelity — offline ≠ realtime.

---

### N-30. Grinder, Bacteria, and Gluten have no device lifecycle hooks

**Problem:** These three plugin modules have no `registerDevice`/`unregisterDevice` pattern (unlike Fermenter, Proof, Levain). When devices are removed, store entries and param batchers leak indefinitely.

**Status:** NEW. Memory leak across three plugins.

---

### N-31. Clip boundary hit test uses inclusive end — off-by-one

**Problem:** `hitTestClip.ts:43` uses `beat <= clip.endBeat` (inclusive). When clicking at exactly a clip's end boundary, the adjacent clip at the same position also matches, causing wrong clip selection.

**Representative files:**
- `src/modules/Arrangement/useCases/timelineInteractions/hitTestClip/hitTestClip.ts:43`.

**Status:** NEW. UX — wrong clip selected at boundaries.

---

### N-32. SampleLibrary analysis creates AudioContext per call, closes prematurely

**Problem:** `analyzeSample.ts:20-31` creates a new AudioContext on every call and closes it in a `finally` block that runs before async analysis completes. May close context while analysis is in progress.

**Representative files:**
- `src/modules/SampleLibrary/useCases/analyzeSample.ts:20-31`.

**Status:** NEW. Potential crash during sample analysis.

---

### N-33. Knead DSP analysis loses sub-cent precision

**Problem:** `dspAnalysis.ts:66` computes MIDI note as `69 + 12 * Math.log2(f0 / 440)` (continuous cents) but stores in `pitchCenterCents` as an integer, losing vibrato/drift analysis precision.

**Representative files:**
- `src/modules/Knead/useCases/dspAnalysis.ts:66`.

**Status:** NEW. Low — precision loss in pitch analysis.

---

### N-34. Scoring canvas DPI scaling incomplete

**Problem:** `ScoringPanel.tsx:391-396` applies DPI scaling to StrobeDisplay canvas but not to PolyDisplay, causing inconsistent rendering across display modes.

**Representative files:**
- `src/modules/Scoring/presentations/views/ScoringPanel.tsx:391-396`.

**Status:** NEW. Low — visual inconsistency.

---

### N-35. 11/13 worklet processors allocate Float32Array on the audio thread

**Problem:** All worklet processors except `grandBouleProcessor`, `recordingProcessor`, and `meteringProcessor` call `new Float32Array()` inside their `process()` method. This allocates on the audio thread and can cause GC pauses → audio glitches. Same files also call `postMessage` in error catch handlers inside `process()`.

**Representative files (all in `src/modules/AudioEngine/services/`):**
- `toasterProcessor.ts:165,167` — `new Float32Array()`
- `levainProcessor.ts:208,210`
- `fermenterProcessor.ts:151,156,172`
- `grinderProcessor.ts:206,207,216,218`
- `proofChamberProcessor.ts:85,86`
- `bacteriaProcessor.ts:109,110,115,116,129`
- `glutenProcessor.ts:123,124,131,132,138,139`
- `proofProcessor.ts:91,92,97,98`
- `kneadProcessor.ts:119,120,129`
- `scoringProcessor.ts:89,90`

**Needed:** Pre-allocate typed arrays in the constructor; reuse them in `process()`.

**Status:** NEW. RT safety — systemic across all worklets.

---

### N-36. Faust parameter address mismatch — synth params silently fail

**Problem:** Faust DSP files expose params with full addresses like `/FM_Synth/algorithm`, but `faustDeviceFactory.ts:46-73` routes params with bare names (`algorithm`). Additionally, processor name sanitization (`'FM Synth'` → `'FM_Synth'`) doesn't match the lowercase addresses registered by the Faust compiler (`/fm_synth/algorithm`). Params set via `node.setParamValue(name, value)` silently fail because the address doesn't match.

**Representative files:**
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:145` — name sanitization.
- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts:46-73` — bare name routing.

**Status:** NEW. Critical — ALL Faust synth parameters are broken.

---

### N-37. All Faust instruments compile as monophonic — no chords

**Problem:** `compilerEngine.ts:143` uses `FaustMonoDspGenerator` for ALL instruments (FM Synth, Rhodes, Hammond B3, Minimoog, Acid Bass, etc.). Only one note can sound at a time per Faust instrument. Overlapping notes interfere with envelope/gate state. Users cannot play chords on any Faust synth.

**Representative files:**
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:143`.
- `src/modules/Synth/useCases/faustInstrumentScheduler/startFaustNote.ts:3-20` — single gate per device.

**Status:** NEW. High — fundamental instrument limitation.

---

### N-38. MIDI import running status bleeds between tracks

**Problem:** `midiImportWorker.ts:116` doesn't reset `runningStatus` when parsing starts a new track. If the previous track's last event uses running status (e.g., 0x90 note-on), the stale status applies to the next track's first events, corrupting note data in multi-track MIDI files.

**Representative files:**
- `src/modules/MIDI/workers/midiImportWorker.ts:116`.

**Status:** NEW. High — corrupts multi-track MIDI import.

---

### N-39. Sidechain routes lost on project reimport

**Problem:** `exportProjectFile.ts:94` correctly includes `sidechainRoutes: getAllSidechainRoutes()` in the export, but `applyImportedProjectData.ts` never reads or applies these routes on import. All sidechain connections are silently lost.

**Representative files:**
- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:94`.
- `src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts` — no sidechain restore.

**Status:** NEW. High — sidechain routing lost on every project save/load cycle.

---

### N-40. Bounce operations have no undo

**Problem:** `bounceOperations.ts:15-111` — `bounceTrack()`, `bounceInPlace()`, `bounceToNewTrack()`, and `bounceSelection()` mutate track state directly without creating undo entries. Destructive operations that cannot be reversed.

**Representative files:**
- `src/modules/Arrangement/useCases/freezeBounce/bounceOperations.ts:15-111`.

**Status:** NEW. High — no undo for destructive operations.

---

### N-41. Frozen buffer offline render always starts at position 0

**Problem:** `renderOffline.ts:86` calls `source.start(0)` for frozen tracks, ignoring the clip's actual `startBeat`. Frozen audio plays at the wrong time offset during bounce/export.

**Representative files:**
- `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts:86`.

**Status:** NEW. High — export timing wrong for frozen tracks.

---

### N-42. flattenTrack adds hardcoded 4-beat offset

**Problem:** `flattenTrack.ts:29` sets `endBeat: endBeat + 4` regardless of actual frozen buffer duration. Creates visual length mismatch.

**Representative files:**
- `src/modules/Arrangement/useCases/freezeBounce/flattenTrack.ts:29`.

**Status:** NEW. Medium.

---

### N-43. Duplicate keyboard shortcut Cmd+Shift+A

**Problem:** `editCommands.ts:74` binds "Deselect All" to `⌘⇧A` and `viewCommands.ts:101` binds "Toggle Automation Panel" to the same combo. Only the automation toggle fires; deselect-all is unreachable via keyboard.

**Representative files:**
- `src/modules/Command/models/commands/editCommands.ts:74`.
- `src/modules/Command/models/commands/viewCommands.ts:101`.

**Status:** NEW. Medium — shortcut collision.

---

### N-44. removeTrack doesn't clean up sidechain routes

**Problem:** `removeTrack.ts:10-63` deletes the track and its clips/devices/automation but never removes sidechain routes where the deleted track is `sourceTrackId` or `targetTrackId`. Orphaned routes persist and can crash the audio graph.

**Representative files:**
- `src/modules/Arrangement/useCases/removeTrack.ts:10-63`.

**Status:** NEW. High — orphaned routes after track deletion.

---

### N-45. Ghost clips missing loop/stretch properties in render model

**Problem:** `buildTimelineRenderModel.ts:200-218` constructs ghost clip objects without `loopEnabled`, `loopLength`, `stretchRatio`, or `midiOffsetBeats`. Renderers can't draw loops or stretch indicators on ghost clips.

**Representative files:**
- `src/modules/Arrangement/useCases/buildTimelineRenderModel.ts:200-218`.

**Status:** NEW. Medium — visual issue.

---

### N-46. ScrollY clamping uses hardcoded 200px instead of viewport height

**Problem:** `timelineViewStore.ts:69` clamps max scrollY with `Math.max(0, totalHeight - 200)`. The 200px constant doesn't match the actual viewport height, preventing users from scrolling to see the last tracks when the panel is taller or shorter than 200px.

**Representative files:**
- `src/modules/Arrangement/stores/timelineViewStore.ts:69`.

**Status:** NEW. Medium — scroll limit wrong.

---

### N-47. insertTime and deleteTime don't shift tempo/time-signature changes

**Problem:** `insertTime()` and `deleteTime()` shift clips, markers, and automation but never touch `tempoMapStore` or `timeSignatureMapStore`. Tempo changes and time signature changes in the affected region become misaligned with the arrangement.

**Representative files:**
- `src/modules/Arrangement/useCases/timeOperations/` (insertTime, deleteTime, duplicateTimeRange).

**Status:** NEW. High — tempo/time-sig desync after time operations.

---

### N-48. Faust node setParam uses partial names instead of full addresses

**Problem:** `faustDeviceFactory.ts:46-73` calls `node.setParamValue(name, value)` with just the param name (e.g., `algorithm`) but `@grame/faustwasm` expects full addresses (e.g., `/FM_Synth/algorithm`). Partial names may silently fail to set parameters.

**Representative files:**
- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts:46-73`.

**Status:** NEW. Medium — compounds N-36.

---

## Open issues — Browser AI Inference

### B-01. OPFS model load path duplicates full model in JS heap

**Problem:** `storageManager.ts:100-101` loads models via `fileHandle.getFile()` then `arrayBuffer()`, duplicating full model bytes in JS heap before worker consumption.

**Representative files:**
- `src/modules/BrowserAi/repositories/storageManager.ts:100-101`.

**Needed:** Worker-side `createSyncAccessHandle()` (where supported) to read into WASM-backed buffers with less intermediate allocation.

**Status:** Verified 2026-04-18. Open — performance.

---

### B-02. DiffSinger inter-stage tensor residency (no WebGPU IO binding)

**Problem:** `onnxInferenceWorker.ts` implements six-stage pipeline (linguistic → duration → pitch → variance → acoustic → vocoder) via `runDiffSingerPipeline`. Each stage `await`s `session.run(...)` feeding outputs to next. No `preferredOutputLocation: 'gpu-buffer'` / IO binding, so intermediate activations may round-trip through CPU between stages.

**Representative files:**
- `src/modules/BrowserAi/workers/onnxInferenceWorker.ts:130-137` (`DiffSingerSessions`), `:155+` (`runDiffSingerPipeline`).

**Needed:** ORT-Web GPU tensor outputs feeding next stage without CPU copies. Evaluate `preferredOutputLocation` hints.

**Status:** Verified 2026-04-18. Open — performance risk, no profiling data in-repo.

---

### B-03. DDSP / TensorFlow.js stub

**Problem:** `tfjsInferenceWorker.ts` is an intentional stub (Rolldown + COOP/COEP vs cross-origin TF.js CDNs). `renderDdspInstrument` cannot succeed.

**Representative files:**
- `src/modules/BrowserAi/workers/tfjsInferenceWorker.ts:16-40` — fixed error message.

**Needed:** Port DDSP models to ONNX and run through `onnxInferenceWorker`.

**Status:** Verified 2026-04-18. Open — blocked on model conversion.

---

## Open issues — Dev Environment & Cross-Origin

### S-07. SharedArrayBuffer / COEP residual failures (§8.4)

**Problem:** COOP/COEP headers configured in both `vite.config.ts` and `tauri.conf.json`, but errors still recur from: (1) stale Vite build cache, (2) third-party CDN resources without CORP headers, (3) webview header delivery issues.

**Remaining work:**
1. Ensure WebLLM model shards are same-origin or CORP-enabled.
2. Debug header delivery to Tauri webview if SAB remains unavailable.

**Status:** Verified 2026-04-18. Residual.

---

## Open issues — Feature Gaps & UX

### S-10. Delay tempo sync (§8.10)

No code for note-division sync in delay effects. Needs product scope + DSP design.

### S-13. Levain boot time (§8.17)

Speculative: transferable-buffer `postMessage` may queue dozens of MBs without ack flow. Measure before acting.

### S-14. "Improve the templates" (§8.6)

Pure product note. Needs definition: project-level vs track-preset vs plugin-patch templates.

---

## Open issues — Factory Content

### F-01. Legacy Web Audio `builtin-*` devices

**Still present:** `builtin-synth`, `builtin-reverb`, `builtin-drum-kit`, etc. in `builtinInstrumentDescriptors.ts` and `builtinEffectDescriptors.ts`.

**Recommendation:** Deprecate redundant `builtin-*` effects where Faust equivalents exist. Label `builtin-synth` as "basic" if retained. The `builtin-drum-kit` is rudimentary; a full drum machine spec exists at `.agents/specs/missing/drum-machine.md` with research at `.agents/research/factory/advanced-instruments.md` and `.agents/research/factory/active/drum-machine-realism.md`.

---

### F-02. Descriptor layout unification

Device descriptors live in separate modules (`faustEffectDescriptors.ts`, `builtinEffectDescriptors.ts`). A single registry shape for automation + UI remains a maintainability win.

---

## Factory content notes (verified 2026-04-18)

- **FACTORY_PRESETS** in `factoryPresets.ts` aggregates **200+** presets: 41 Faust instrument, 9 Faust effect, 60 expanded, 126 Fermenter, plus category files (bass, lead, pad, keys, strings, drum kits).
- **Morphing Synth** (`faust-morphing-synth`, DSP `morphing-synth.dsp`): `/wt/morph` is a **crossfade across four static waveforms** — not a wavetable position/scan. True wavetable remains future work.
- **Hammond drawbars:** Already render **vertical** sliders (`orientation="vertical"` in `HammondB3Layout.tsx`). Remaining polish is cosmetic.
- **`DeviceFactoryRegistry`** uses flexible matchers via `AudioDeviceStrategy` — not only string prefix matching.

---

## Open questions

- [ ] Is `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx` live code, draft, or abandoned? Same for `SpectrogramView.tsx`, `SignalFlowDiagram.tsx`, `DecayEqOverlay.tsx`.
- [ ] Mono vs stereo recording policy — I-29 documents single-channel; product decision needed.
- [ ] WebLLM role in MIDI completion — product decision: parse plain text or tool-supported model?
- [ ] Crust DSP backend — Faust or Rust/WASM?
- [ ] Crumbs on web — `createCrumbsInstance` short-circuits to no-op without Tauri. Tag as `platform: 'native'` or build web fallback?
- [ ] "Improve the templates" — what templates? Where?

## Risks

- **DSP debt** — LR4 topology (I-08), limiter scan (I-22), Crumbs AA (I-12), §I-30 carryovers: wrong or expensive DSP not obvious in casual listening.
- **Every new plugin widens I-05** — more TrackNode branches until DeviceNode contract lands.
- **Parallel AI dispatch (I-02)** — behavior diverges; fixes must be replicated.
- **Persistence gaps (I-14)** — in-memory stores lose edits on reload.
- **Singletons (I-03)** — multi-instance collisions.
- **MIDI coordinate split (M-01)** — every new generator or edit path must guess the convention.
- **Crust (S-04)** — user-facing plugin that silently does nothing.
- **Multi-track recording (S-03)** — core DAW feature broken under "arm multiple tracks".

## Reproduction quick-reference

| Issue | Minimal steps | Expected vs Actual |
|-------|--------------|-------------------|
| S-01 Faders | Drag a track gain fader slowly | Value tracks pointer. Actually: stair-steps; catches up on release |
| S-03 Multi-track rec | Arm 2 audio tracks → record | Both buffers captured. Actually: only last-armed track gets audio |
| S-04 Crust silent | Add Crust to a track → play | Audio processed by Crust. Actually: bit-identical to no device; no log |
| M-01 / G1 | Create a clip at `startBeat = 8`, insert notes via Patterns tab | Notes visible in both timeline and piano roll. Actually: empty in one view |
| T-01 deleteTimeRange | Select a time range containing a MIDI clip → delete | MIDI notes shift with clip. Actually: notes stay, clip moves → desync |

## Priorities (open issues only)

### Tier 1 — Blocks core DAW workflow / data loss
1. **N-36 / N-48** — Faust param address mismatch — ALL Faust synth knobs broken.
2. **N-01** — Clip drag doesn't follow cursor (user-reported, core UX broken).
3. **N-37** — All Faust instruments monophonic — users can't play chords.
4. **N-05** — KneadEditor malformed JSX (toolbar render broken).
5. **N-12** — WaveformEditor receives wrong ID (audio editing corrupted).
6. **N-13 / N-14b** — Freeze tail unit mismatch + bounce hardcoded 120 BPM.
7. **N-06** — Punch-in recording broken (feature non-functional).
8. **N-02 / N-04** — removeClip and deleteTimeRange orphan MIDI data.
9. **N-03** — duplicateTrack drops CC/pitchBend/automation.
10. **N-38** — MIDI import running status bleeds between tracks.

### Tier 2 — Significant workflow bugs
11. **N-39** — Sidechain routes lost on project reimport.
12. **N-40** — Bounce operations have no undo.
13. **N-41** — Frozen buffer offline render starts at position 0.
14. **N-47** — insertTime/deleteTime don't shift tempo/time-sig changes.
15. **N-44** — removeTrack doesn't clean sidechain routes.
16. **M-01** — MidiNote.startBeat convention (blocks M-02, T-01, S-08, S-09).
17. **S-03** — Multi-track recording (critical DAW feature).
18. **N-10** — IDB auto-save silent failure (data loss on quota).
19. **N-16** — Automation recording has no undo.
20. **N-35** — 11/13 worklet processors allocate in process() (RT safety).
21. **N-15** — Synth velocity→attack inverted (wrong sound).
22. **N-19** — Proof param bridge incomplete (most params display-only).
23. **N-21** — Prompt parser regex escape bug (AI grid sizes never parse).
24. **S-04** — Crust silent (user-facing breakage).
25. **N-09** — Freeze/bounce ignores mute/solo (incorrect export).
26. **N-29** — Synth offline render skips filter envelope (bounce ≠ realtime).

### Tier 3 — Important but not blocking
27. **T-01** — Timeline desync remaining paths.
28. **N-17 / N-44** — Sidechain/send routes not cleaned on track deletion.
29. **N-18** — Toaster store singleton.
30. **N-20** — TrackNode.dispose() memory leaks.
31. **N-22** — Yeast worklet sync race.
32. **N-25** — Audio loop gain wrong beat offset.
33. **N-43** — Duplicate shortcut Cmd+Shift+A.
34. **N-46** — ScrollY clamping uses hardcoded 200px.
35. **S-01** — Fader write-path storm.
36. **I-05 / I-19** — TrackNode / DeviceNode contract.
37. **I-08** — LR4 crossover (DSP correctness).
38. **N-23** — Extension script security bypass.

## Suggested approaches

- **M-01 first:** Pick one `MidiNote.startBeat` convention and align all paths. Write a unit test: clip at `startBeat = 8`, note visible in both timeline and roll.
- **S-03 independently:** Refactor `recording.ts` to `Map<trackId, RecordingSession>`. Does not depend on S-02 (selection model).
- **S-04 interim:** Register `PluginNotImplementedError` for Crust + toast. Then audit `BUILTIN_PLUGINS` for other silent-add descriptors.
- **I-05 / I-19 together:** Define `DeviceNode` interface spec, migrate incrementally.
- **I-02 before I-04:** Unify AI dispatch before redesigning DSO undo.
- **S-01 systemically:** Split fast/commit path as pilot on one fader, then generalise.
- **Plugin instantiation hardening:** SAB-missing is handled (`PluginRequiresIsolationError`). Generalise to a `createPluginNodeSafely` wrapper catching WASM fetch failures, AudioWorklet registration errors, and handshake timeouts — each as a typed error with toast mapping.

## Resolved

- **I-07** — Dutch Oven stereo EQ struct mismatch: FIXED 2026-04-16.
- **I-09** — TPDF dither quantisation: FIXED 2026-04-16.
- **I-10** — Stereo imager centre channel at max width: FIXED 2026-04-16.
- **I-11** — Crumbs filter shared L/R state: FIXED 2026-04-16.
- **I-13** — `createAutomergeStorage` deep import: FIXED 2026-04-16.
- **I-17** — ReasoningBlock ARIA: FIXED 2026-04-16.
- **I-18** — DSO schema fallback: FIXED 2026-04-16.
- **I-20** — Toaster/Levain worklet queue splice: FIXED 2026-04-16 (read-head index).
- **I-23** — ProofChamber mono input drop: FIXED 2026-04-16.
- **I-24** — ProofPanel dynBands mutation: FIXED 2026-04-16.
- **Timeline §2** — MIDI split data loss: FIXED 2026-04-16 (`splitMidiNotesAtBeat`).
- **Timeline §3** — MIDI duplication data loss: FIXED 2026-04-16 (`duplicateClipCore` now copies notes).
- **Timeline §5** — Audio waveform squash: FIXED 2026-04-16 (windowed `getWaveformPeaks`).
- **DiffSinger cache key** — ms-quantized hash confirmed correct.
- Transport `setTimeout` → Web Worker scheduler.
- CRDT ID generation → `crypto.randomUUID()`.
- `scheduleAudioClips` GainNode allocation → reusable pool.
- AudioWorklet message queues → allocation-free circular queue.
- Toaster `busRoute`/`transientAttack` hydration.
- Knead offline analysis pipeline exists (not stubbed).
- AiRuntime name resolution (no splice mutation).
- Levain jitter buffer (sorted sample-frame queue exists; block-end granularity reframed).

---

## Detailed root-cause analysis appendix

The following deep analyses are preserved for context. Issue IDs above are the canonical references.

### §8.14 — Fader write-path storm (→ S-01)

Full evidence chain in S-01 above. Key insight: `trackStore.set(...)` triggers re-render of every subscriber per pointermove; some subscribers take >16ms; main thread misses subsequent pointer events.

### §8.18 — Multi-track selection + recording (→ S-02, S-03)

Full evidence in S-02 and S-03 above. Key insight: scalar `selectedTrackId` and single `RecordingSession` are independent problems that can be fixed separately.

### §8.19 — Crust silent (→ S-04)

Full evidence in S-04 above. Key insight: no DSP implementation exists anywhere; the engine silently returns when `findWasmDescriptor('crust')` is undefined.

### §14 — MidiNote.startBeat coordinate conventions (→ M-01, M-02)

Full evidence table in M-01. Key insight: freeze path assumes clip-relative; duplicate/AI paths assume timeline-absolute; `importMidiFile` masks the issue by forcing `startBeat = 0`.

### Instrumentation recommendations (from systemic audit)

- **Recording-lifecycle inspector.** Dev-only overlay: `activeRecordingRef`, `transportStore.isRecording`, clip `endBeat` in real time.
- **Write-path profiler.** Wrap `trackStore.set` to track time-to-next-frame and downstream re-render count.
- **Coordinate hit-test debugger.** Dev flag for bounding boxes in MIDI editor overlay — validates fold fixes (S-08/S-09).

---

_Merged from `audio-generation.md`, `factory-content-status.md`, `systemic-issues-root-cause.md`, and original `consolidated-issues.md` on 2026-04-18. All claims re-verified against HEAD._
