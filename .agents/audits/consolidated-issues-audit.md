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
- **ARCH-1:** `AiRuntime/index.ts` is missing. Modules bypass contract boundaries by importing stores/useCases directly.
- **CORE-1:** Monolithic `sendChatMessage` and `executeDsoEdit` need refactoring.
- **CORE-2:** Context uses O(N) tokens. Needs `ContextOptimizer`.
- **CORE-3:** Overlapping backend logic between `inference.ts` and `executeDsoEdit`.
- **PERF-1:** `ChatPanel` re-renders per token during streaming.
- **PERF-2:** Sledgehammer undo implementation taking full state snapshots on AI edits.
- **FEAT-1:** Tool and Name parsing relies on brittle regex/fuzzy matching. Resolving names can accidentally add tracks via `splice`.
- **A11Y-1:** Missing ARIA tags on `ReasoningBlock`.
- **Error Handling:** WebLLM grammar errors throw instead of using plain-text fallback for DSOs.
- **Markdown Rendering:** `ReactMarkdown` re-walks every message on every parent re-render.

## 2. Audio Engine, Recording & Routing
- **Instrument Timing:** Offline rendering uses quantized suspends instead of pre-queuing note events on the worklet.
- **Latency Compensation (PDC):** 
  - Recorded audio, MIDI, and automation are not latency-compensated.
  - Hosted plugins (e.g. Dutch Oven) have `get_latency()` in WASM but it's ignored by the worklet.
- **Performance / Safety:**
  - `TrackNode` reconnects and rebuilds the graph on bypass.
  - Metering uses `AnalyserNode` polled on the main thread (blocking/jank risk).
  - Main-thread allocation spike when stopping audio recording (OPFS array transfer).
- **Architecture:** `TrackNode` has hardcoded branches for specific plugins (e.g., `faust-`), violating the WAM abstraction.

## 3. Plugins: Toaster
- **CRITICAL:** `ToasterProcessor.ts` uses `splice` to drain queues on the audio thread, causing allocations.
- **CRITICAL:** Singleton logic in `loadToasterKit` limits usage to one instance globally.
- **CRITICAL:** Param bridge mutates global store instead of per-device state.
- **CRITICAL:** Sequencer uses `setTimeout` instead of sample-accurate Web Audio timing.
- **HIGH:** Missing pad parameter hydration (`busRoute`, `transientAttack`).
- **HIGH:** Disconnected global effect mix knobs in Rust.
- **DSP Bugs:** Transient Shaper audio clicks (instant gain switch); Tone Filter and Choke/Decay have sample-rate dependencies.
- **UX/Structural:** `ToasterPanel` binds to global state; missing `busRoute` UI.

## 4. Plugins: Proof & Dutch Oven
- **CRITICAL:** React UI state mutates arrays directly (`dynBands`).
- **CRITICAL:** Right channel bypasses output EQ (wet path) before M/S in Rust.
- **CRITICAL:** LR4 Crossover cascade causes severe phase nulls.
- **CRITICAL:** TPDF Dither fails to quantize output.
- **CRITICAL:** Oversampler delay line state corruption (shared for upsample/downsample).
- **CRITICAL:** AudioWorklet processors actively reject mono inputs.
- **HIGH:** UI Macro controls are disconnected from the Audio Engine (ignores nested arrays).
- **HIGH:** Tape Exciter Pre/De-Emphasis logic is applied after saturation.
- **HIGH:** Imager widening destroys the center channel.
- **HIGH:** Limiter lookahead uses O(window) linear scan per sample.
- **PDC/Leak:** Potential leak in telemetry slot allocation; ignores PDC latency reporting.
- **Dutch Oven Specific:**
  - Architecture violation: Duplicated domain modules (`ProofChamber` vs `Plugin/ProofChamber`).
  - State lost on unmount (uses `useState`).
  - SpectrogramView is hardcoded to mock data.
  - Inconsistent parameter mapping in DSP engine (ignores some parameters).
  - High-frequency param dispatching without throttling.
  - Bypass of Undo/Redo history.
  - IR data is loaded but never sent to the AudioWorklet.

## 5. Plugins: Levain
- **CRITICAL:** Multi-track state & persistence corruption (Singleton architecture).
- **CRITICAL:** MIDI timing jitter (no jitter buffer in Rust engine).
- **HIGH:** Tone/Attack/Release Macros are non-functional (stubbed in Rust).
- **HIGH:** True Legato transitions are missing (stubbed in Rust).
- **MEDIUM:** Cross-track loading spinners; Default human seed is hardcoded to 42.

## 6. Plugins: Knead
- **CRITICAL:** Offline analysis pipeline is missing entirely (UI spins on "Analyzing").
- **CRITICAL:** Block-based PSOLA causes severe artifacts.
- **CRITICAL:** DSP lacks time-varying pitch target API (static `shift_semitones`).
- **CRITICAL:** Pitch data bound to track instead of clip (breaks if clip moves).
- **HIGH:** UI parameters are not sent to DSP.
- **HIGH:** Right channel is ignored by `daw-engine` scheduler.
- **HIGH:** UI is read-only and disconnected from the timeline.
- **HIGH:** Pitch edits are not persisted (data loss on reload).
- **MEDIUM:** Missing MIDI input (vocoder mode); Memory leak in store; Inefficient YIN implementation; A11Y barriers on canvas.

## 7. Plugins: Grinder
- **CRITICAL:** Persistence flood on drive knobs (`replacePatch` triggers massive syncs).
- **CRITICAL:** Lack of sample-accurate automation (no `AudioParam`s exposed).
- **CRITICAL:** Terminal panic state without recovery.
- **HIGH:** Missing audio sync for key parameters (`micBlend`, `roomAmount`, `postPedals`).
- **HIGH:** Unimplemented cabinet mics in Rust.
- **HIGH:** Severe testing gaps in parameter bridge.
- **MEDIUM:** Uneditable cabinet mic positions (UX); 173 Cargo Clippy warnings.
- **LOW:** Misleading CPU budget control; Deprecated panel APIs present.

## 8. Plugins: Grand Boule
- **HIGH:** Missing Parameter Mappings & Per-Note Disconnect (placebo knobs).
- **HIGH:** Inverted Voice Stealing Logic (quieter active voices stolen first).
- **HIGH:** Progressive Simplification Defeated by Sustain.
- **MEDIUM:** Panic button ineffective; Global MIDI event leak & calibration bypass.

## 9. Plugins: Fermenter
- **HIGH:** Macros dropped during preset load & morph (name mismatch).
- **HIGH:** Catastrophic re-render on telemetry updates (meters in `fermenterStore`).
- **HIGH:** Messaging storm during morphing (80+ postMessage calls per tick).
- **HIGH:** Parameter updates are block-aligned, not sample-accurate.
- **HIGH:** Missing audio telemetry (meters & oscilloscope data never posted by processor).
- **MEDIUM:** Linear taper on logarithmic parameters (UX); Fragile manual `PARAM_MAP`.

## 10. Faust Engine
- **CRITICAL:** WASM/Faust teardown not invoked (missing `destroy()` calls).
- **CRITICAL:** Monophonic synths used for polyphonic chords (overlapping notes cause jumps).
- **CRITICAL:** UI Parameter synchronization is broken (`/fm_synth` vs `/FM_Synth`).
- **CRITICAL:** Inspector bypasses `FaustParamDescriptor` when plugin lookup fails.
- **HIGH:** Fake UI sliders for eliminated parameters.
- **HIGH:** Initialization race conditions (`setTimeout(20)`).
- **HIGH:** Main-thread Faust compilation (blocks UI).
- **HIGH:** Superficial test coverage.
- **MEDIUM:** Sample rate hardcoding in DSP (`fsmax = 48000`).

## 11. Plugins: Crumbs (Sampler)
*(Note: Wiring to graph, multi-instance stores, and 60fps UI re-render have been resolved. The following issues remain)*
- **CRITICAL:** Severe Filter State Corruption (L/R channels overwrite mono filter state).
- **CRITICAL:** Fake Loop Crossfading & Interpolator Discontinuities (ignores `loop_crossfade`, causes clicks).
- **CRITICAL:** Missing Anti-Aliasing on Pitch Shift.
- **CRITICAL:** Hardcoded sample rate (`44100`) on initialization.
- **CRITICAL:** Web-incompatible file loading and unbounded memory allocation on load (OOM risk).
- **HIGH:** Inefficient IPC polling for playhead position.
- **HIGH:** Naive loop parameter submission (un-batched IPC calls).
- **MEDIUM:** Missing Pad Waveforms (empty visual pads).
- **MEDIUM:** "Crumbs" vs "Sampler" naming inconsistency.

## 12. Code Quality & General
- **P0.1:** Native plugin audio path utilizes bounded block-by-block `tauriInvoke`.
- **P0.2:** CRDT/IDB crash safety (incremental Automerge persistence).
- **P1.6:** `createAutomergeStorage.ts` layering violation (infra hard-imports `automergeRepository`).
- **P1.10:** Volatile state that should be durable (`kneadStore`, `actionHistoryStore` memory-only).
- **P2.12:** `LocalStorageKeys` legacy brand keys.
- **P3.20:** Dense canvases UI performance (e.g. `PianoRoll` uses `useStore` excessively).
- **Design System:** Inconsistencies in DAW header, context menus, duplicated readout/meter clusters, inspector cards, and mixer strips.
- **Export:** Missing bus/submix stem export, loudness normalization, embedded metadata, incremental stem cache, and loose file ZIP opt-outs.
- **Feature Work:** Mono-only recording support is missing.
- **Chromium Fast Paths:** Future implementations of `OffscreenCanvas`, dual-path OPFS in `audioBufferCache`, predicted pointer handling, and `scheduler.yield()`.

---
*Created by consolidating existing audits. Please refer to `docs/agents/02-file-types.md` and `write-audit` skill before addressing these issues.*