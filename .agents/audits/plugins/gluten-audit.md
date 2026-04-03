# Gluten Plugin Audit Report

Based on a code-level audit of the **Gluten** bus compressor engine (`crates/daw-dsp/src/gluten/`), here is the comprehensive audit report:

### 🚨 Critical Performance Bugs (Real-Time Audio Violations)
The Gluten engine suffers from memory allocation issues on the audio thread, primarily when utilizing the external sidechain feature.

1. **External Sidechain Allocation (`engine.rs`)**:
   *   **Issue:** In `GlutenEngine::new`, the `ext_sc_left` and `ext_sc_right` vectors are initialized with `Vec::new()`, which gives them a capacity of 0. When the DAW passes sidechain audio via `set_ext_sc`, the code calls `extend_from_slice()`.
   *   **Impact:** Because the vectors have no pre-allocated capacity, `extend_from_slice()` will force a heap allocation directly on the real-time audio thread during the first block (and whenever the block size increases). This will cause audio dropouts and stuttering.
   *   **Fix:** Pre-allocate the sidechain vectors in `GlutenEngine::new()` using `Vec::with_capacity(4096)` or pre-fill them with zeros to a known maximum block size.

2. **Per-Block Allocation in WASM interop (`mod.rs`)**:
   *   **Issue:** `GlutenInstance::process` defensively resizes its I/O and sidechain vectors (`self.input_left.resize(size, 0.0);`) if the requested block size exceeds the current length.
   *   **Impact:** Any changes in block size during playback will trigger memory allocation on the audio thread.
   *   **Fix:** Use a pre-allocation pattern (e.g., maximum 4096 samples) during initialization and clamp the processing size.

### 🐛 Logical Bugs
1. **Broken Auto-Makeup Gain (`engine.rs`)**:
   *   **Issue:** The `compute_auto_makeup` function attempts to calculate makeup gain to match the perceived volume post-compression. However, it passes **hardcoded** threshold and ratio values to the `auto_makeup` algorithm depending on the topology:
     ```rust
     Topology::Vca => auto_makeup(-18.0, 4.0),
     ```
   *   **Impact:** The auto-makeup gain will only be correct if the user leaves the compressor at its exact default preset settings. If the user lowers the threshold to `-40dB` or increases the ratio, the auto-makeup will remain stuck calculating gain for `-18dB`, resulting in massive volume drops.
   *   **Fix:** The `compute_auto_makeup` method must read the *actual current* threshold and ratio parameters from the active topology instance (e.g., `self.vca.get_threshold()`) instead of using hardcoded literals.

2. **Destructive Mid/Side Mode (`engine.rs`)**:
   *   **Issue:** When `stereo_mode` is set to `StereoMode::Mid`, the M/S decoder forcefully zeroes out the Side channel: `decode_ms(mixed_l, 0.0)`. 
   *   **Impact:** While this allows compressing only the Mid channel, it entirely deletes the Side channel from the output, instantly collapsing the stereo mix to mono. Usually, M/S processing compresses the target channel but passes the uncompressed channel through to preserve the stereo image.
   *   **Fix:** When operating in Mid mode, the uncompressed delayed Side channel (`delayed_r`) should be passed into the decoder instead of `0.0`, ensuring the stereo image is maintained.

**Summary:** Gluten's DSP architecture correctly handles lookahead and metering without breaking real-time constraints, but its sidechain buffer implementation triggers dangerous allocations. Additionally, the auto-makeup logic is fundamentally flawed and needs to be tied to dynamic user parameters rather than static presets.
