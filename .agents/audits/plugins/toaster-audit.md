# Toaster Plugin Audit Report

Based on a code-level audit of the **Toaster** drum machine DSP engine (`crates/daw-dsp/src/toaster/`), here is the comprehensive audit report:

### 🌟 Architectural Positives

Unlike the Fermenter and Bacteria plugins, the Toaster engine correctly handles internal routing buffers.

- **Zero Audio-Thread Allocations for Routing:** The author successfully avoided per-block allocations for the internal mix buses by pre-allocating them to a maximum size of 4096 samples during engine initialization: `let bus_buffers_l = std::array::from_fn(|_| vec![0.0; max_block]);`. This is a great practice for real-time safety.

### 🚨 Critical Bugs

1. [x] **Audio Clicks/Pops on Choke Groups (`engine.rs`)**:
    - **Issue:** In `ToasterEngine::note_on`, when a pad belongs to a choke group (e.g., closed hi-hat choking an open hi-hat), it finds the active voice and immediately kills it:
        ```rust
        voice.release();
        voice.active = false;
        ```
    - **Impact:** Setting `active = false` instantaneously drops the audio output of that voice to `0.0`. This causes a harsh digital click/pop artifact every time a choke occurs.
    - **Fix:** Choking should trigger a very fast envelope release (e.g., 5-10ms fade out) rather than instantly zeroing the voice. The voice should only be marked inactive once its envelope has fully released.

2. [FIXED] **Per-Block Allocation in WASM interop (`mod.rs`)**:
    - **Issue:** `ToasterInstance::process` defensively resizes the `left_buf` and `right_buf` vectors if the block size changes: `self.left_buf.resize(size, 0.0);`.
    - **Impact:** A change in block size or the first block execution will trigger an allocation on the audio thread, risking a dropout.
    - **Fix:** Use the same pre-allocation pattern (e.g., maximum 4096 samples) used for the `bus_buffers`, and clamp the requested processing size to that maximum.

### ⚠️ DSP Logic & Efficiency Issues

1. [x] **Sample-Rate Dependent Compressor (`engine.rs`)**:
    - **Issue:** The envelope follower in `BusEffects::process` uses hardcoded smoothing coefficients: `let coeff = if abs > self.comp_env { 0.01 } else { 0.0005 };`.
    - **Impact:** The attack and release times of the bus compressors will change dramatically depending on the user's sample rate (they will compress much faster at 96kHz than at 44.1kHz).
    - **Fix:** Calculate the attack and release coefficients dynamically using `sample_rate`.

2. [FIXED] **Expensive Math in Inner Loop (`engine.rs`)**:
    - **Issue:** In the per-sample inner loop (`for i in 0..len`), the engine calculates the constant-power panning using square roots for every active voice:
        ```rust
        let l_gain = ((1.0_f32 - pad.pan) * 0.5_f32).sqrt();
        let r_gain = ((1.0_f32 + pad.pan) * 0.5_f32).sqrt();
        ```
    - **Impact:** `sqrt()` is computationally expensive. Because `pad.pan` does not change per-sample (it's control rate), evaluating two square roots per sample per active voice wastes significant CPU cycles.
    - **Fix:** Calculate `l_gain` and `r_gain` once per block (outside the `i` loop) or cache them whenever a pad's pan parameter is updated.

**Summary:** Toaster's memory architecture is much closer to being real-time safe than the other plugins, as it correctly pre-allocates its internal mix buses. However, the abrupt voice choking logic must be fixed immediately as it will cause audible clicks during drum performances.
