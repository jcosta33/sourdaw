# Architectural Audit: Latency, Performance & Recording

**Date:** March 30, 2026
**Scope:** Browser AudioEngine limits, Tauri Native Bridge, React Render Cycles, Canvas/WebGPU Rendering, and MediaRecorder architecture.

---

## 1. The Audio Recording Pipeline (Critical Latency & Fidelity Flaw)

### 🚨 Current Implementation
The `src/modules/AudioEngine/repositories/audioRecorder/recording.ts` module uses the native browser `MediaRecorder` API (`audio/webm;codecs=opus`).

### 🔬 Analysis & Consequences
- **Lossy Compression:** `MediaRecorder` automatically encodes incoming PCM streams from `getUserMedia` into heavily compressed, lossy Opus/WebM formats in real-time. This is fundamentally unacceptable for a professional DAW, as it destroys transient detail and introduces significant unrecoverable phase distortion.
- **Micro-Jitter & Algorithm Latency:** The WebM encoder processes data in opaque chunks (`mediaRecorder.start(100)`). The timestamps for these chunks fluctuate wildly based on main-thread CPU scheduling, decoupling the recorded audio completely from Sourdaw’s precise 48kHz `AudioContext` transport clock.
- **Asynchronous Decoherence:** Stopping the recording relies on an asynchronous `Blob` decode (`ctx.decodeAudioData()`), making exact sample-accurate placement to the Arranger playhead physically impossible. 

### 🛠️ Proposed Solution
- **Native PCM Bypassing:** Rip out `MediaRecorder` completely.
- **Direct RecordingNode:** Build a dedicated `RecordingWorkletNode`. This connects directly to `createMediaStreamSource()` and captures raw `Float32Array` interleaved PCM buffers array by array (128 samples per block).
- **Synchronous Write:** Stream these buffers from the worklet into a lock-free `SharedArrayBuffer` Ring Queue. The main thread pulls raw PCM out and commits it directly to disk (using `@tauri-apps/plugin-fs` on Desktop) or into memory (Web), perfectly stamped to the playhead tick.

---

## 2. AudioEngine Telemetry (Critical Main-Thread Bottleneck)

### 🚨 Current Implementation
Reviewing any of the core effect processors (e.g., `scoringProcessor.ts`, `levainProcessor.ts`, `grinderProcessor.ts`), telemetry is dispatched back to the UI via `this.port.postMessage({})` every `~10-12ms` (4 audio blocks).

### 🔬 Analysis & Consequences
- **Garbage Collection Avalanche:** For a single plugin, `postMessage` creates an object clone 85 times per second. In a standard project with 12 tracks and 4 plugins per track, that equates to **~4,000 structured clones per second**. 
- **Main Thread Starvation:** The JavaScript main thread is forced to spend massive amounts of time collecting these dead telemetry objects. As project size scales up, React reconcile cycles will be starved of CPU time, inducing UI stuttering, freezing playheads, and eventual Web Audio dropped frames (xruns/crackling).

### 🛠️ Proposed Solution
- **Zero-Copy IPC (SharedArrayBuffer):** Transition all real-time visualization telemetry to a globally tracked `SharedArrayBuffer`. 
- **Atomic Mapping:** During `init`, assign a specific memory offset to each `AudioWorkletNode`. The worklet writes its RMS, LUFS, pitches, or EQ curve metrics directly into typed indices (`Float32Array`) at 85Hz.
- **Main Thread Reads:** The React UI natively reads from the `SharedArrayBuffer` using zero-cost memory indexing within `requestAnimationFrame()`, obliterating thousands of object allocations entirely.

---

## 3. UI Meter Math & Canvas Calculations (Major Bottleneck)

### 🚨 Current Implementation
Modules like `LUFSMeter.tsx` use `requestAnimationFrame` to poll `analyser.getFloatTimeDomainData`, then run heavy recursive DSP functions across the entire array (`computeMomentaryLUFS` running K-Weighting and RMS over 2048+ samples).

### 🔬 Analysis & Consequences
- **High-Refresh Display Hazard:** Browsers running on 120Hz/144Hz monitors will fire `requestAnimationFrame` 120-144 times a second. Doing heavy spectral filtering and summation across thousands of floats in JS on the main UI paint loop brutally degrades layout and repainting performance.
- The UI thread should *never* calculate audio math.

### 🛠️ Proposed Solution
- **Offload Math:** `getFloatTimeDomainData()` should only be used for drawing direct waveforms. For LUFS, RMS, True Peak, or Phase Correlation, the math should execute within the C++/Rust WASM modules in the `AudioWorklet`. 
- The worklet writes the final scalar value (e.g., `-14.3 dBFS`) to the `SharedArrayBuffer`. React's `LUFSMeter.tsx` reads a single float each frame and renders the color.

---

## 4. React Component Render Tearing (Optimal)

### 🟢 Current Implementation
`PlayheadDisplay.tsx` and the `TimelineRenderer` heavily utilize `useRef` and `requestAnimationFrame` to manually update `textContent` and `Box Coordinates` bypassing React state logic completely while playback is active.

### 🔬 Analysis 
- **State-Free UI Hooks:** Using `useSyncExternalStore` combined with raw `DOM` manipulation handles the continuous transport updates impeccably. This enforces the project requirement of not locking up the React 19 compiler with 100hz updates.

### 🛠️ Recommendations
Deploy this exact DOM ref-bypass paradigm outward to components that still use `useState` for live audio readouts (like volume faders or fast envelopes), moving them fully outside the traditional React lifecycle.

---

## 5. WebGPU Usage & Render Scaling (Optimal)

### 🟢 Current Implementation
Heavy density views (Spectrograms, Timeline Arranger grids) correctly use `createWebGpuRenderer.ts` using native WGSL compute dispatching, alongside on-browser AI execution `onnxruntime-web` for stem separation.

### 🔬 Analysis
The renderer architecture correctly decouples the audio orchestration tree from graphical pipelines. WebGPU provides immediate sub-millisecond drawing of millions of waveform peaks.

### 🛠️ Recommendations
Ensure that as tracks zoom/pan wildly, the waveform peak caches are mapped dynamically to avoid starving out VRAM, particularly critical on mobile safari/iOS webview instances.
