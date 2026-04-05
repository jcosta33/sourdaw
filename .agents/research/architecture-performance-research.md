# Architecture & Performance Research (Consolidated)

> **Codebase Annotation:** Sourdaw's architecture successfully employs Tauri v2, `rtrb` ring buffers, `cpal` for native audio, and `wasm-bindgen` for the web. WebWorker audio isolation and standard lock-free paradigms are **Implemented**. However, advanced optimizations like `simd_support` via `std::simd`, strict `audio_thread_priority`, `mimalloc` custom allocators, and hardware-accelerated FFTs (`rustfft` vs platform specific) need further auditing against the codebase as they are likely **Missing**.

This document consolidates research from `native-apis.md`, `performance-native.md`, `performance-web.md`, `web-apis.md`, and `opendaw-comparison.md`.

The following sections detail the concepts and features from the research that are **missing, incomplete, or implemented differently** in the current WebDAW codebase.

---

## 1. Plugin Hosting (VST3 / CLAP / AU)

No browser API can load native audio plugins. The entire plugin hosting stack must live in Rust.

- **CLAP hosting**: Use `clack` (clack-host).
- **VST3 hosting**: Prefer `vst3` (coupler-rs) due to MIT/Apache-2.0 licensing.
- **Sandboxing**: Professional DAWs use out-of-process plugin hosting via shared memory for crash isolation.

> **Codebase Finding:** The `crates/daw-plugin-host/` crate is currently empty. `crates/daw-engine/src/scheduler.rs` contains basic stubs/placeholders for `NativePlugin` processing, but actual CLAP/VST3 instantiation, GUI hosting via separate native windows, and out-of-process sandboxing are **missing**.

## 2. Audio File I/O, Stems Export, and Offline Bounce

- **Audio I/O**: `decodeAudioData` is insufficient for format coverage on WebKit. Rust should handle decoding (`symphonia`) and encoding (`hound` for WAV, `fdk-aac`, etc.).
- **Offline Bounce**: `OfflineAudioContext` has limits on WebKit (44.1kHz min, 10ch max). Since the audio graph is in Rust, stem bouncing should be parallelized in Rust using `rayon` and `hound`.

> **Codebase Finding:** Rust-native audio file decoding/encoding and parallel stem export are **missing**. The frontend currently relies heavily on Web APIs like `OfflineAudioContext` for bouncing and exporting (e.g., `ExportDialog.tsx`, `handleAiDenoiseClip.ts`), which violates the principle of keeping audio file I/O strictly in Rust for reliability. **SUPERIOR METHOD:** Original Research - Handling Audio I/O and offline bounce strictly in Rust ensures deterministic rendering, bit-perfect exports, and parallel processing via 'rayon', bypassing WebKit's limitations (e.g., 44.1kHz min, 10ch max) and maintaining true native DAW capabilities.

## 3. Recording (Multi-track, Step, and Count-in)

- **Multi-track limits**: `getUserMedia` on WebKit limits capture to stereo. A DAW must use CoreAudio/JACK/PipeWire via Rust for professional multi-channel recording, writing directly to disk via lock-free ring buffers (`rtrb` + `hound`).
- **Workflow**: Needs Step recording (entering notes one at a time without real-time performance) and Count-in features.

> **Codebase Finding:** True multi-track native recording directly to disk in Rust is **missing**. Currently, audio capture is routed through a `RecordingWorkletProcessor` in JS. Step recording and count-in workflows are also unimplemented. **SUPERIOR METHOD:** Original Research - Recording directly via Rust native APIs bypassing the browser's 'getUserMedia' enables true professional multi-track recording without browser-imposed channel limits or Web Audio API latency jitter.

## 4. MIDI Effects Pipeline, MPE, and Clock

- **MIDI Effects**: A distinct pipeline before the instrument to handle Arpeggiators, Velocity scaling, and Groove quantization (e.g., openDAW's "Zeitgeist" groove tool).
- **Probability Sequencing**: Allowing each MIDI note to have a percentage chance of playing.
- **MPE & Clock**: A custom ~200-line module for MPE channel allocation and sample-accurate MIDI clock output (`0xF8` ticks) driven by the audio callback.

> **Codebase Finding:** `midir` handles basic I/O, but the advanced MIDI features are **missing**. There is no MIDI effects pipeline, no probability-based note triggering in the sequencer, no MPE channel allocator, and no explicit MIDI clock output generator on the audio thread.

## 5. Waveform Rendering Peak Data

Peak/RMS computation is O(n) and belongs in Rust. Pre-compute `PeakPair { min, max }` at standard zoom levels (mipmaps) and stream to the WebGPU/WebGL frontend via Tauri IPC (`tauri::ipc::Response` returning raw `ArrayBuffer`).

> **Codebase Finding:** Multi-resolution peak caching and binary transfer via `tauri::ipc::Response` are **missing**.

## 6. Metering (VU / LUFS / true-peak)

`AnalyserNode` lacks true-peak detection and LUFS measurement. For broadcast-compliant metering, `ebur128` (pure Rust port) should be used, streaming data at ~30 fps via Tauri's Channel API.

> **Codebase Finding:** The `ebur128` crate and native true-peak/LUFS metering are **missing** from the Rust backend.

## 7. DAWproject Format and Project Bundling

openDAW supports bitwig's `DAWproject` XML/ZIP format for interoperability and `.odaw` ZIP bundles for single-file project storage containing audio assets.

> **Codebase Finding:** While `daw-collab` provides a robust document store, single-file bundle export (ZIP containing samples) and cross-DAW `DAWproject` interoperability are **missing**.

## 8. Neural Amp Modeling (NAM)

openDAW uses WASM for real-time Neural Amp Modeler (NAM) captures. This is a killer feature for guitarists.

> **Codebase Finding:** WebDAW has `Grinder` (an amp simulator in `daw-dsp`), but actual integration with Neural Amp Modeling (NAM) network inference is **missing**.

## 9. Controller Learning and Routing Visualization

- **Controller Learning**: Infrastructure to map hardware MIDI CC knobs to automatable parameters.
- **Routing Visualization**: A force-directed node graph (like `d3-force`) visualizing track/bus/device routing.

> **Codebase Finding:** Both features are currently **missing**.

## 10. Ableton Link (BPM sync)

Requires UDP multicast. Implement using `rusty_link` (note: GPL-2.0+ license constraints) to expose beat/tempo/phase to the WebView.

> **Codebase Finding:** Completely **missing**.

## 11. Built-in Synthesis (SoundFonts)

> **Codebase Finding:** WebDAW's custom DSP suite is impressive, but `.sf2` SoundFont playback (e.g., via `rustysynth`) is currently **missing**, limiting access to generic GM instruments.
