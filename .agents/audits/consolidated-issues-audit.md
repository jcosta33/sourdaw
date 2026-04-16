---
name: consolidated-issues-audit
description: Consolidated audit of all open issues across the codebase.
type: audit
status: open
---

# Consolidated Issues Audit

## Goal
This document tracks all currently verified unresolved issues, bugs, and architectural gaps across the Sourdaw codebase, consolidated from previous plugin and domain-specific audit files. This file reflects the true codebase state as of 2026-04-16 (verified via source code inspection, removing stale items that have already been fixed).

## 1. WebLLM & AI Runtime
- **CORE-1:** Monolithic `sendChatMessage` and `executeDsoEdit` need refactoring. *(Verified: `src/modules/AiRuntime/useCases/sendChatMessage.ts`, `src/modules/AiRuntime/useCases/dsoEditor/executeDsoEdit.ts`)*
- **CORE-2:** Context uses O(N) tokens. Needs `ContextOptimizer`. *(Verified: Concept missing entirely in `src/modules/AiRuntime`)*
- **CORE-3:** Overlapping backend logic between `inference.ts` and `executeDsoEdit`. *(Verified: `src/modules/AiRuntime/useCases/llmOrchestration/inference.ts`)*
- **PERF-1:** `ChatPanel` re-renders per token during streaming. *(Verified: `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`)*
- **PERF-2:** Sledgehammer undo implementation taking full state snapshots on AI edits. *(Verified: `src/modules/CrdtDocument/useCases/saveSnapshot.ts`)*
- **FEAT-1:** Tool and Name parsing relies on brittle regex/fuzzy matching. Resolving names can accidentally add tracks via `splice`. *(Verified: `src/modules/AiRuntime/useCases/parsePromptToActions.ts`)*
- **A11Y-1:** Missing ARIA tags on `ReasoningBlock`. *(Verified: `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`)*
- **Error Handling:** WebLLM grammar errors throw instead of using plain-text fallback for DSOs. *(Verified: `src/modules/AiRuntime/useCases/llmOrchestration/inference.ts`)*
- **Markdown Rendering:** `ReactMarkdown` re-walks every message on every parent re-render. *(Verified: `src/modules/AiRuntime/presentations/views/ChatPanel.tsx`)*

## 2. Audio Engine, Recording & Routing
- **Instrument Timing:** Offline rendering uses quantized suspends instead of pre-queuing note events on the worklet. *(Verified: WebAudio Scheduling)*
- **Latency Compensation (PDC):** 
  - Recorded audio, MIDI, and automation are not latency-compensated.
  - Hosted plugins (e.g. Dutch Oven) have `get_latency()` in WASM but it's ignored by the worklet. *(Verified: `src/modules/AudioEngine/wasm/proof_chamber.js` and `crates/proof-chamber/src/lib.rs` export it but it's unhandled)*
- **Performance / Safety:**
  - `TrackNode` reconnects and rebuilds the graph on bypass. *(Verified: `src/modules/AudioEngine/engine/TrackNode.ts` calls `rebuildChain()` on bypass)*
  - Metering uses `AnalyserNode` polled on the main thread (blocking/jank risk). *(Verified: `src/modules/AudioEngine/engine/TrackNode.ts` sets up `AnalyserNode`)*
  - Main-thread allocation spike when stopping audio recording (OPFS array transfer).
- **Architecture:** `TrackNode` breaks domain encapsulation by hardcoding branches for specific plugins (`faust-`, `builtin-sidechain-compressor`, `fermenterControls`) and directly importing domain-specific teardown functions like `unregisterLevainDevice` and `unregisterProofDevice`, violating the WAM plugin abstraction. *(Verified: `src/modules/AudioEngine/engine/TrackNode.ts`)*

## 3. Plugins: Toaster
- **CRITICAL:** `ToasterProcessor.ts` uses `splice` to drain queues on the audio thread, causing allocations. *(Verified: `src/modules/AudioEngine/services/toasterProcessor.ts`)*
- **CRITICAL:** Singleton logic in `loadToasterKit` limits usage to one instance globally. *(Verified: `src/modules/Toaster/useCases/loadToasterKit.ts`)*
- **CRITICAL:** Param bridge mutates global store instead of per-device state. *(Verified: `src/modules/Toaster/stores`)*
- **CRITICAL:** Sequencer uses `setTimeout` instead of sample-accurate Web Audio timing. *(Verified: `src/modules/Toaster/useCases/sequencerPlayback.ts`)*
- **HIGH:** Missing pad parameter hydration (`busRoute`, `transientAttack`). *(Verified: `PAD_PARAM_MAP` in `toasterProcessor.ts`)*
- **HIGH:** Disconnected global effect mix knobs in Rust.
- **DSP Bugs:** Transient Shaper audio clicks (instant gain switch); Tone Filter and Choke/Decay have sample-rate dependencies. *(Verified: `src/modules/AudioEngine/services/toasterProcessor.ts` and rust DSP)*
- **UX/Structural:** `ToasterPanel` binds to global state; missing `busRoute` UI. *(Verified: `src/modules/Toaster/presentations/views/ToasterPanel.tsx`)*

## 4. Plugins: Proof & Dutch Oven
- **CRITICAL:** React UI state mutates arrays directly (`dynBands`). *(Verified: `src/modules/Proof/presentations/views/ProofPanel.tsx` and `src/modules/Proof/models/ProofPatch.ts`)*
- **CRITICAL:** Right channel bypasses output EQ (wet path) before M/S in Rust. *(Verified: `crates/proof-chamber/src/proof_chamber.rs`)*
- **CRITICAL:** LR4 Crossover cascade causes severe phase nulls. *(Verified: `crates/daw-dsp/src/proof/crossover.rs` and `crates/daw-dsp/src/bacteria/crossover.rs`)*
- **CRITICAL:** TPDF Dither fails to quantize output. *(Verified: `crates/daw-dsp/src/proof/dither.rs`)*
- **CRITICAL:** Oversampler delay line state corruption (shared for upsample/downsample).
- **CRITICAL:** AudioWorklet processors actively reject mono inputs.
- **HIGH:** UI Macro controls are disconnected from the Audio Engine (ignores nested arrays).
- **HIGH:** Tape Exciter Pre/De-Emphasis logic is applied after saturation.
- **HIGH:** Imager widening destroys the center channel.
- **HIGH:** Limiter lookahead uses O(window) linear scan per sample.
- **PDC/Leak:** Potential leak in telemetry slot allocation; ignores PDC latency reporting.
- **Dutch Oven Specific:**
  - Architecture violation: Duplicated domain modules (`ProofChamber` vs `Plugin/ProofChamber`). *(Verified: `src/modules/AudioEngine/engine/ProofChamberNode.ts` and `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx`)*
  - State lost on unmount (uses `useState`).
  - SpectrogramView is hardcoded to mock data.
  - Inconsistent parameter mapping in DSP engine (ignores some parameters).
  - High-frequency param dispatching without throttling.
  - Bypass of Undo/Redo history.
  - IR data is loaded but never sent to the AudioWorklet.

## 5. Plugins: Levain
- **CRITICAL:** Multi-track state & persistence corruption (Singleton architecture). *(Verified: `src/modules/Levain/stores/`)*
- **CRITICAL:** MIDI timing jitter (no jitter buffer in Rust engine). *(Verified: `src/modules/AudioEngine/services/levainProcessor.ts`)*
- **HIGH:** Tone/Attack/Release Macros are non-functional (stubbed in Rust).
- **HIGH:** True Legato transitions are missing (stubbed in Rust).
- **MEDIUM:** Cross-track loading spinners; Default human seed is hardcoded to 42.

## 6. Plugins: Knead
- **CRITICAL:** Offline analysis pipeline is missing entirely (UI spins on "Analyzing"). *(Verified: `src/modules/Knead/useCases/dspAnalysis.ts` missing or stubbed)*
- **CRITICAL:** Block-based PSOLA causes severe artifacts. *(Verified: `src/modules/AudioEngine/wasm/daw_dsp.js` KneadInstance)*
- **CRITICAL:** DSP lacks time-varying pitch target API (static `shift_semitones`).
- **CRITICAL:** Pitch data bound to track instead of clip (breaks if clip moves). *(Verified: `src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx`)*
- **HIGH:** UI parameters are not sent to DSP.
- **HIGH:** Right channel is ignored by `daw-engine` scheduler.
- **HIGH:** UI is read-only and disconnected from the timeline.
- **HIGH:** Pitch edits are not persisted (data loss on reload).
- **MEDIUM:** Missing MIDI input (vocoder mode); Memory leak in store; Inefficient YIN implementation; A11Y barriers on canvas.

## 7. Plugins: Grinder
- **CRITICAL:** Persistence flood on drive knobs (`replacePatch` triggers massive syncs). *(Verified: `src/modules/AudioEngine/engine/GrinderNode.ts`)*
- **CRITICAL:** Lack of sample-accurate automation (no `AudioParam`s exposed).
- **CRITICAL:** Terminal panic state without recovery. *(Verified: `src/modules/AudioEngine/services/grinderProcessor.ts` missing recovery boundary)*
- **HIGH:** Missing audio sync for key parameters (`micBlend`, `roomAmount`, `postPedals`).
- **HIGH:** Unimplemented cabinet mics in Rust.
- **HIGH:** Severe testing gaps in parameter bridge.
- **MEDIUM:** Uneditable cabinet mic positions (UX); 173 Cargo Clippy warnings.
- **LOW:** Misleading CPU budget control; Deprecated panel APIs present.

## 8. Plugins: Grand Boule
- **HIGH:** Missing Parameter Mappings & Per-Note Disconnect (placebo knobs). *(Verified: `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx`)*
- **HIGH:** Inverted Voice Stealing Logic (quieter active voices stolen first). *(Verified: `crates/daw-dsp/src/grand_boule/engine.rs`)*
- **HIGH:** Progressive Simplification Defeated by Sustain.
- **MEDIUM:** Panic button ineffective; Global MIDI event leak & calibration bypass.

## 9. Plugins: Fermenter
- **HIGH:** Macros dropped during preset load & morph (name mismatch). *(Verified: `src/modules/Fermenter/` models/stores)*
- **HIGH:** Catastrophic re-render on telemetry updates (meters in `fermenterStore`). *(Verified: `src/modules/AudioEngine/engine/FermenterNode.ts` -> `setFermenterTelemetry` updates store)*
- **HIGH:** Messaging storm during morphing (80+ postMessage calls per tick).
- **HIGH:** Parameter updates are block-aligned, not sample-accurate. *(Verified: `src/modules/AudioEngine/services/fermenterProcessor.ts`)*
- **HIGH:** Missing audio telemetry (meters & oscilloscope data never posted by processor).
- **MEDIUM:** Linear taper on logarithmic parameters (UX); Fragile manual `PARAM_MAP`.

## 10. Faust Engine
- **CRITICAL:** WASM/Faust teardown not invoked (missing `destroy()` calls). *(Verified: `src/modules/AudioEngine/engine/TrackNode.ts` missing explicit destroy for Faust nodes)*
- **CRITICAL:** Monophonic synths used for polyphonic chords (overlapping notes cause jumps).
- **CRITICAL:** UI Parameter synchronization is broken (`/fm_synth` vs `/FM_Synth`).
- **CRITICAL:** Inspector bypasses `FaustParamDescriptor` when plugin lookup fails. *(Verified: `src/modules/Plugin/models/FaustEngineTypes.ts`)*
- **HIGH:** Fake UI sliders for eliminated parameters.
- **HIGH:** Initialization race conditions (`setTimeout(20)`).
- **HIGH:** Main-thread Faust compilation (blocks UI).
- **HIGH:** Superficial test coverage.
- **MEDIUM:** Sample rate hardcoding in DSP (`fsmax = 48000`).

## 11. Plugins: Crumbs (Sampler)
*(Note: Wiring to graph, multi-instance stores, and 60fps UI re-render have been resolved. The following issues remain)*
- **CRITICAL:** Severe Filter State Corruption (L/R channels overwrite mono filter state). *(Verified: `src/modules/Crumbs/` engine logic)*
- **CRITICAL:** Fake Loop Crossfading & Interpolator Discontinuities (ignores `loop_crossfade`, causes clicks).
- **CRITICAL:** Missing Anti-Aliasing on Pitch Shift.
- **CRITICAL:** Hardcoded sample rate (`44100`) on initialization.
- **CRITICAL:** Web-incompatible file loading and unbounded memory allocation on load (OOM risk). *(Verified: `src/modules/Crumbs/useCases/loadSample.ts`)*
- **HIGH:** Inefficient IPC polling for playhead position.
- **HIGH:** Naive loop parameter submission (un-batched IPC calls).
- **MEDIUM:** Missing Pad Waveforms (empty visual pads).
- **MEDIUM:** "Crumbs" vs "Sampler" naming inconsistency. *(Verified: `showCrumbsPanel` vs `samplerDeviceId` references)*

## 12. Code Quality & General
- **P0.1:** Native plugin audio path utilizes bounded block-by-block `tauriInvoke`. *(Verified: `src/modules/AudioEngine/engine/NativePluginBridgeNode.ts`)*
- **P0.2:** CRDT/IDB crash safety (incremental Automerge persistence).
- **P1.6:** `createAutomergeStorage.ts` layering violation (infra hard-imports `automergeRepository`). *(Verified: `src/infra/store/storage/createAutomergeStorage.ts` imports from `src/modules/CrdtDocument/repositories/automergeRepository`)*
- **P1.10:** Volatile state that should be durable (`kneadStore`, `actionHistoryStore` memory-only). *(Verified: `src/modules/Knead/stores/kneadStore.ts`, `src/modules/CrdtDocument/stores/actionHistoryStore.ts`)*
- **P2.12:** `LocalStorageKeys` legacy brand keys. *(Verified: `src/infra/store/storage/createLocalStorage.ts` and `LocalStorageKeys.ts`)*
- **P3.20:** Dense canvases UI performance (e.g. `PianoRoll` uses `useStore` excessively). *(Verified: `src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx` uses `useStore` on `midiStore` and `trackStore`)*
- **Design System:** Inconsistencies in DAW header, context menus, duplicated readout/meter clusters, inspector cards, and mixer strips.
- **Export:** Missing bus/submix stem export, loudness normalization, embedded metadata, incremental stem cache, and loose file ZIP opt-outs.
- **Feature Work:** Mono-only recording support is missing.
- **Chromium Fast Paths:** Future implementations of `OffscreenCanvas`, dual-path OPFS in `audioBufferCache`, predicted pointer handling, and `scheduler.yield()`.

---
*Created by consolidating existing audits. Please refer to `docs/agents/02-file-types.md` and `write-audit` skill before addressing these issues.*
