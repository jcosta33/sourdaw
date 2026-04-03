# Bacteria Plugin Audit Report

Based on a code-level audit of the **Bacteria** multi-effects engine (`crates/daw-dsp/src/bacteria/`), here is the comprehensive audit report:

### 🚨 Critical Performance Bugs (Real-Time Audio Violations)

The Bacteria engine contains some of the most severe real-time DSP violations seen in the codebase, primarily related to its oversampling implementation.

1. [FIXED] **Catastrophic Per-Sample Allocation in Oversampling (`engine.rs`)**:
    - **Issue:** Inside `BandChain::process_sample`, if the `oversampling_factor` is greater than 1, the code upsamples a _single sample_, allocates a new `Vec` to hold the oversampled data (`let mut processed_l = vec![0.0_f32; up_l.len()];`), processes it, and downsamples it.
    - **Impact:** Because `process_sample` is called for every single audio sample in the block, for every active band, this triggers **thousands of heap allocations per second on the audio thread**. This is a catastrophic violation of real-time audio constraints and will instantly cause severe stuttering and CPU spikes.
    - **Fix:** Oversampling must be performed on blocks of audio rather than sample-by-sample. The upsampled buffers must be pre-allocated in the `BandChain` struct and reused during block processing.

2. [x] **Per-Block Allocation in WASM interop (`mod.rs`)**:
    - **Issue:** `BacteriaInstance::process` checks if the requested block size exceeds the current capacity and calls `.resize(size, 0.0)` on the input and output vectors.
    - **Impact:** Any change in block size during playback (or on the very first block) will trigger an allocation on the audio thread.
    - **Fix:** Pre-allocate the vectors to a known maximum block size (e.g., 4096) during initialization and clamp/panic if a larger size is requested.

### ⚠️ DSP Logic & Efficiency Issues

1. [FIXED] **Sample-Rate Dependent Metering (`engine.rs`)**:
    - **Issue:** The peak meters (`input_peak`, `output_peak`, and `peak_level` per band) decay using a hardcoded coefficient (`*= 0.9999` and `*= 0.9995`).
    - **Impact:** The visual release time of the meters will change significantly depending on the user's sample rate (falling twice as fast at 96kHz compared to 48kHz).
    - **Fix:** Calculate the decay multiplier dynamically based on the current `sample_rate`.

### 🐛 Logical Bugs

1. [OPEN — partial] **Modulation System Not Applied to Band Parameters (`engine.rs`)**:
    - **Issue:** The engine advances modulation sources and evaluates `mod_assignments` into a `param_offsets[1024]` array each sample. The global mix parameter (`param_offsets[0]`) is applied correctly. However, `BandChain::process_sample` is called without receiving any `param_offsets`, so band-level parameters (filter cutoff, drive, compressor threshold, etc.) are never modulated.
    - **Impact:** LFO/macro assignments targeting band effect parameters do nothing to the actual DSP. Only the global wet/dry mix can be modulated.
    - **Fix:** Pass the relevant `param_offsets` slice into `BandChain::process_sample` and apply offsets to each band's effect parameters using the established param ID convention.

**Summary:** The Bacteria plugin is structurally ambitious but its oversampling implementation is critically flawed, allocating memory on a per-sample basis. Additionally, its entire modulation framework is disconnected from the actual DSP logic.
logic.
