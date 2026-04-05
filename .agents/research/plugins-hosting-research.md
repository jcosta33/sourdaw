# Consolidated Plugins & Hosting Research

## 1. Plugin Hosting Architecture & Ecosystem

_Codebase Status:_ The codebase already successfully implements Tauri v2 bare windows without WebView (`src/commands/plugin_gui.rs`) and uses `rtrb` for wait-free SPSC lock-free communication in `daw-engine`.

### CLAP vs VST3 Priority

**Research:** Prioritize CLAP using `clack-host` as the primary integration path because it is feature-complete and safe. VST3 is considered raw and unsafe, recommended for Phase 2.
_Codebase Status:_ The current codebase diverges from this by relying heavily on a custom `Vst3Wrapper` using `libloading` (`src/host/vst3_wrapper.rs`) to directly load `.vst3` bundles. While `clack-host` and `clap-sys` are listed in `Cargo.toml`, VST3 seems to be the primary implemented path.
**SUPERIOR METHOD:** Original Research - Utilizing CLAP via `clack-host` is superior. Hand-rolling VST3 integration using raw C++ FFI/COM interfaces is brittle and unsafe. `clack-host` provides a robust, safe Rust abstraction that avoids this vast boilerplate, making it the better architectural choice for maintainability.

### Process Sandboxing

Bitwig runs plugins in separate processes with configurable isolation modes.
**Recommendation:** Start without sandboxing, but design the plugin interface behind a trait that can be implemented as in-process or out-of-process (IPC) using `shared_memory`, `shmem-ipc`, and `nix`.

### Audio Thread Safety

**Recommendation:** Set real-time thread priority using the `audio_thread_priority` crate.
_Codebase Status:_ `audio_thread_priority` is missing from project dependencies.

## 2. DSP Engines & Synthesis (Missing)

_Codebase Status:_ `fundsp` and `rustfft` are present in `Cargo.toml`, but several key DSP engines and samplers are missing.

### Synthesis Crates

- **`mi-plaits-dsp-rs`**: Pure Rust port of Mutable Instruments Plaits with 24 synthesis engines. Recommended for the flagship hybrid synth.
- **The FAUST→Rust pipeline**: Essential for access to 1,000+ proven DSP algorithms (reverbs, compressors, filters) compiling to pure Rust without C++ FFI.

### Sampler Engine & Disk Streaming

- **`creek` crate**: Missing. Needed for realtime-safe disk streaming with cache buffers and look-ahead.
- **SFZ Format Parsing**: No standalone SFZ parser exists in Rust. Must be written to support professional samplers. Needs OPFS on Web for memory-based storage.
- **Time-stretching**: `signalsmith-stretch` or `tdpsola` missing.

### Effects Implementation Needs

- **EQ & Dynamics**: Linear-phase EQ (requires FFT). Convolution reverb (non-uniform partitioned FFT). Lookahead limiters.
- **Pitch Correction**: Needs `pitch-detection` crate or `pyin-rs`.

## 3. Web Platform & WASM Optimization

_Codebase Status:_ The codebase successfully utilizes `Canvas 2D` rendering (`usePianoRollRenderer.ts`, etc.) and `OffscreenCanvas`. However, Web Audio offloading and UI knobs are missing.

### Web Audio Node Offloading

**Recommendation:** Use native Web Audio nodes (`ConvolverNode`, `BiquadFilterNode`, `DynamicsCompressorNode`) for standard effects to run in optimized browser C++ code at zero WASM cost.
_Codebase Status:_ Lacks extensive usage of Web Audio nodes for DSP offloading.

### SharedArrayBuffer & Cross-Thread Comms

**Recommendation:** Use SharedArrayBuffer for Audio thread <-> UI thread communication.
_Codebase Status:_ Not configured. Tauri COOP/COEP headers are missing in `tauri.conf.json`.

### UI Components

**Recommendation:** Use `react-knob-headless` or `webaudio-controls`.
_Codebase Status:_ Not present in the React UI stack.

## 4. Offline Export & Encoders

_Codebase Status:_ The codebase perfectly handles WAV export and SRC via `hound` and `rubato` natively (`src/commands/ai_audio.rs`).

### Missing Encoders

- **FLAC**: Pure-Rust `flacenc` missing for native/WASM.
- **Web Lossy**: `wasm-media-encoders` (NPM) and `libflacjs` missing for browser export.
- **Native Lossy**: `mp3lame-encoder`, `vorbis_rs`, `opus` missing for native lossy export.

### Export Features

- **Streaming**: Never buffer the entire project; stream output chunks.
- **Stem Export**: Use solo/mute approach for Stem export.
- **Signal Integrity**: TPDF dithering needed when reducing bit depth. Plugin Delay Compensation needed during offline render.
