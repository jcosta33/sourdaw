# Proof Plugin Audit Report

Based on a code-level audit of the **Proof** mastering suite engine (`crates/daw-dsp/src/proof/`), here is the comprehensive audit report:

### 🚨 Critical Performance Bugs (Real-Time Audio Violations)
1. **Per-Block Allocation in WASM interop (`mod.rs`)**:
   *   **Issue:** `ProofInstance::process` checks if the requested block size exceeds the current buffer length and calls `.resize(size, 0.0)` on `input_left`, `input_right`, `output_left`, and `output_right`.
   *   **Impact:** Any change in block size during playback or upon the first initialization will trigger memory allocation on the audio thread.
   *   **Fix:** Pre-allocate all buffers to a safe maximum size (e.g., 4096) during initialization and clamp the processing size instead of resizing on the fly.

### 🐛 Logical Bugs
1. **Feedback Loop in A/B Gain Matching (`chain.rs`)**:
   *   **Issue:** When `ab_bypass` is engaged, the engine attempts to match the bypassed (dry) signal's loudness to the processed (wet) signal's loudness. It does this by dynamically updating `ab_gain_offset = out_lufs - in_lufs` on every block. However, when bypassed, the plugin skips the actual DSP modules and feeds the *gain-compensated dry signal* into the `output_lufs` meter.
   *   **Impact:** Because the `output_lufs` meter is now measuring the bypassed signal, the `out_lufs` value will drift toward the `in_lufs` value. This creates a feedback loop where the `ab_gain_offset` slowly collapses to `0.0 dB`, completely defeating the purpose of gain-matched A/B comparison.
   *   **Fix:** When entering `ab_bypass` mode, the `ab_gain_offset` must be **frozen** at its last known value, and should not be dynamically recalculated while the DSP chain is skipped. Alternatively, the DSP chain must continue processing silently in the background to keep the `output_lufs` meter accurate.

2. **Unvalidated Module Reordering (`chain.rs`)**:
   *   **Issue:** The `reorder` function accepts an array of 5 integers (`[u8; 5]`) and maps them to `ModuleId` without checking for duplicates. 
   *   **Impact:** If the UI (or an API call) sends an array like `[0, 0, 0, 0, 0]`, the engine will happily run the EQ module 5 times in a row and completely skip the Limiter, Exciter, and Imager. 
   *   **Fix:** Validate that the incoming `new_order` array is a strict permutation of `[0, 1, 2, 3, 4]`. If duplicates are detected, reject the change or fall back to the default order.

**Summary:** Proof's core processing chain is generally well-structured, but its A/B bypass logic contains a critical flaw that renders the gain-matching feature useless. Fixing the A/B gain calculation and addressing the standard WASM buffer allocation issue will make this mastering suite robust.
