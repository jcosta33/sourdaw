# Knead Plugin Audit Report

Based on a code-level audit of the **Knead** real-time pitch manipulation engine (`crates/daw-dsp/src/knead/`), here is the comprehensive audit report:

### 🚨 Critical Performance Bugs (Real-Time Audio Violations)
1. **Per-Block Allocation in WASM interop (`mod.rs`)**:
   *   **Issue:** `KneadInstance::process` checks if the requested block size exceeds the current buffer length and calls `.resize(size, 0.0)` on `left_buf`.
   *   **Impact:** A change in block size during playback or upon the first initialization will trigger memory allocation on the audio thread.
   *   **Fix:** Pre-allocate `left_buf` to a safe maximum size (e.g., 4096) during initialization and clamp the processing size instead of resizing on the fly.

### 🐛 Logical Bugs & Incomplete Implementation
1. **Missing Audio Input Binding (`mod.rs`)**:
   *   **Issue:** The `KneadInstance` WASM struct lacks a getter method for the input buffer (e.g., `get_input_left_ptr`). In the AudioWorklet, JS needs a pointer to write the incoming audio data into WASM linear memory before calling `process()`.
   *   **Impact:** Because JS has no way to inject audio into the engine, Knead processes a buffer entirely filled with zeros on every frame. It is effectively a silent, dead plugin.
   *   **Fix:** Export a `get_input_left_ptr(&mut self) -> *mut f32` method in the WASM bindings.

2. **Block-Size vs. Pitch Tracking Window Mismatch (`yin.rs` & `engine.rs`)**:
   *   **Issue:** The engine passes the raw 128-sample WASM audio block directly into the YIN pitch tracking algorithm (`yin_frame(input, ...)`). However, detecting a 50Hz fundamental frequency at 44.1kHz requires an autocorrelation window (`tau_max`) of at least 882 samples. The `yin_frame` function explicitly checks `if n <= tau_max` and aborts if the buffer is too small.
   *   **Impact:** Because the input buffer is only 128 samples long, the YIN algorithm instantly fails on every block, returning `None` for pitch. Pitch detection is completely broken.
   *   **Fix:** `KneadEngine` must implement a sliding window or internal ring buffer (e.g., size 2048 or 4096). The incoming 128-sample blocks should be pushed into this ring buffer, and the YIN algorithm must be executed over the accumulated history rather than the raw 128-sample chunk.

3. [x] **Missing DSP implementation (`engine.rs`)**:
   *   **Issue:** The plugin is described as a "Real-time pitch manipulation" engine, and there is a `psola.rs` module in the directory. However, `engine.rs` only runs the YIN pitch *analysis*. It never imports, instantiates, or executes any pitch-shifting or PSOLA code.
   *   **Impact:** The plugin currently only acts as a broken pitch detector and does no actual pitch manipulation or audio output processing.
   *   **Fix:** Wire up the PSOLA module within `KneadEngine::process_analysis_frame` to actually apply pitch-shifting to the signal based on the detected `f0`.

**Summary:** Knead is currently an incomplete, non-functional plugin. Its WASM bindings are missing crucial I/O pointers, and its core pitch-detection algorithm fundamentally misinterprets how real-time audio block processing interacts with necessary analysis window sizes.
es.
