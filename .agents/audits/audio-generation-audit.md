---
name: audio-generation-audit
description: Comprehensive critique, analysis, and status report of Sourdaw's AI generation capabilities, evaluated through a bleeding-edge, pure-client architectural lens.
type: audit
status: open
---

# Audit: AI Generation Features (BrowserAi & AiGeneration)

## Goal
To evaluate Sourdaw's AI generation capabilities (`AiGeneration` and `BrowserAi`) based on the project's aggressive "pure client, bleeding-edge" philosophy. Resource consumption is not a concern; the objective is to maximize capability, leverage the absolute limits of the modern browser (WebGPU, OPFS, Web Workers), and execute heavy inference pipelines entirely locally. This audit assesses whether the current implementation executes this ambitious vision optimally.

## Current State
Sourdaw splits its AI generation responsibilities across two modules:

1. **`AiGeneration` (MIDI & Analysis)**: Acts as the command center for generative MIDI and analytical processing, seamlessly falling back to static algorithmic templates (`PATTERN_TEMPLATES`) when LLM prompting fails. It provides excellent integration with the DAW's undo history and state management.
2. **`BrowserAi` (Audio Synthesis)**: Represents an absolute technical marvel by running the massive 6-stage DiffSinger Singing Voice Synthesis (SVS) pipeline and Kokoro TTS entirely client-side using `onnxruntime-web`, WebGPU, and OPFS. It completely abandons native Rust/Tauri execution in favor of pushing the browser to its breaking point.

## Findings: The "Bleeding-Edge" Evaluation

The architecture correctly embraces the web platform's most powerful APIs, but its implementation of those APIs leaves massive performance and stability on the table. If Sourdaw intends to push consumer browsers to their limits without caring about resource constraints, it must use the APIs optimally to avoid killing the browser tab unnecessarily.

- **OPFS Implementation is Sub-Optimal**: `storageManager.ts` reads multi-hundred-megabyte models using `fileHandle.getFile().then(f => f.arrayBuffer())`. This allocates the entire file in the browser process before copying it to the worker's V8 heap, causing massive memory pressure. The bleeding-edge standard for Web Workers is `createSyncAccessHandle()`, which allows synchronous, zero-copy reads directly into WASM memory.
- **WebGPU Pipeline Thrashing (Missing IO Binding)**: `onnxInferenceWorker.ts` executes 6 models sequentially for DiffSinger. Currently, the tensor output of one model (e.g., Acoustic) is pulled back to the CPU, serialized into JS, and sent back to the GPU for the next model (Vocoder). This CPU-GPU ping-pong destroys rendering speed. `onnxruntime-web` supports WebGPU IO Binding (`preferredOutputLocation: 'gpu-buffer'`), which keeps intermediate tensors completely on the VRAM.
- **DDSP Pipeline is Dead Code**: `tfjsInferenceWorker.ts` is stubbed out because TensorFlow.js cannot be statically bundled via Rolldown under the strict COOP/COEP headers required for `SharedArrayBuffer` support. Any DDSP instrument synthesis currently fails instantly at runtime.

## Issues

### 1. Critical Performance & Architecture Gaps

**CRITICAL: OPFS Memory Spikes (Missing Sync Handles)**
- **Evidence:** `storageManager.ts` uses asynchronous `getFile()` instead of `createSyncAccessHandle()`.
- **Impact:** Loading a 400MB model creates an 800MB+ memory spike during the JS ArrayBuffer copy phase, increasing the likelihood of an Out-Of-Memory (OOM) tab crash before inference even begins.
- **Needed:** Refactor `storageManager.ts` to use `createSyncAccessHandle()` inside the Web Worker. This allows `read()` to stream bytes directly into the `onnxruntime-web` instance, bypassing the JS heap entirely.

**CRITICAL: WebGPU VRAM Thrashing**
- **Evidence:** `onnxInferenceWorker.ts` does not utilize tensor IO Binding between DiffSinger pipeline stages.
- **Impact:** Massive latency overhead due to copying megabytes of Mel-Spectrogram data from GPU to CPU and back to GPU every frame.
- **Needed:** Implement `ort.Tensor` pre-allocation with `'gpu-buffer'` locations so the Acoustic model writes directly to VRAM that the Vocoder reads from, keeping the entire pipeline on the GPU.

**CRITICAL: TF.js Worker Stubbed (DDSP Failure)**
- **Evidence:** `tfjsInferenceWorker.ts` immediately returns an error string. `renderDdspInstrument.ts` relies on this worker to process `GraphModel` assets.
- **Impact:** Any attempt to synthesize DDSP instruments fails at runtime.
- **Needed:** Strip out TensorFlow.js entirely. Export the DDSP models to ONNX and run them through the unified `onnxInferenceWorker.ts`.

### 2. Functional Issues

**MEDIUM: Monolithic Cache Key Generation**
- **Evidence:** `renderDiffSingerPhrase.ts` uses `JSON.stringify(notes)` to build the cache key.
- **Impact:** Negligible floating-point imprecision in MIDI note durations (e.g., `0.3333333333` vs `0.3333333334`) busts the cache, forcing an expensive 10-second re-render for mathematically identical phrases.
- **Needed:** Quantize numeric values (e.g., to the nearest millisecond) before hashing the buffer.

## Summary & Suggested Approaches

The agent's decision to build a pure-browser DiffSinger pipeline is audacious and perfectly aligned with a bleeding-edge product philosophy. It forces the user's browser to execute tasks previously reserved for native desktop apps or cloud APIs. 

To ensure this actually functions at the cutting edge rather than just crashing:
1. **Unify around ONNX**: Abandon TensorFlow.js. Convert DDSP models to ONNX. Everything runs through `onnxruntime-web`.
2. **Optimize Data Pipelines**: Implement OPFS `createSyncAccessHandle` for zero-copy loading, and WebGPU IO Binding to keep intermediate tensors out of CPU memory.

## Resolved

- _(None yet.)_