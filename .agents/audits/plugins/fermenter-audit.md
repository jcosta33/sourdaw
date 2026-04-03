# Fermenter Plugin Audit Report

Based on a code-level audit of the **Fermenter** synthesizer engine (`crates/daw-dsp/src/fermenter/`), here is the comprehensive audit report:

### 🚨 Critical Performance Bugs (Real-Time Audio Violations)
The Fermenter engine suffers from multiple severe real-time DSP violations. Memory allocations occur repeatedly on the audio thread, which will cause severe audio stuttering, dropouts, and CPU spikes.

1. **Per-Block Audio Thread Allocation in `layer.rs` (`Layer::render`)**:
   *   **Issue:** When layer panning or level changes from unity, the engine allocates new vectors every single block: `let mut scratch_l = vec![0.0f32; block_size];`.
   *   **Impact:** Since this runs 4 times (for 4 layers) every audio callback, it generates hundreds of allocations per second on the audio thread. This will inevitably cause audio engine stalls.
   *   **Fix:** Pre-allocate scratch buffers in the `Layer` struct during initialization (`Layer::new`) and reuse them, or use a fixed-size stack array (e.g., `[0.0f32; 1024]`).

2. **Box Allocation on `note_on` in `voice.rs` (`Voice::set_engine`)**:
   *   **Issue:** `Layer::note_on` calls `voice.set_engine`, which dynamically allocates memory on the heap for specific engines if they haven't been used yet: `self.ks_engine = Some(Box::new(KarplusStrong::new(sample_rate)));`. 
   *   **Impact:** Pressing a key with a new engine type selected will cause a heap allocation during the `note_on` event processing on the audio thread, leading to note-trigger latency and potential dropouts.
   *   **Fix:** Pre-allocate all possible engine types when the `Voice` is constructed, or lazily initialize them on the main thread before notes are triggered.

3. **Per-Block Allocation in WASM interop (`mod.rs`)**:
   *   **Issue:** `FermenterInstance::process` checks if the incoming buffer is larger than expected and resizes its internal vectors: `self.left_buf.resize(size, 0.0);`.
   *   **Impact:** Any changes in block size (or the first tick) will trigger an allocation on the audio thread.
   *   **Fix:** Pre-allocate the vectors to a known safe maximum block size (e.g., 4096) during `new()` and panic or clamp if a larger size is requested.

### ⚠️ DSP Logic & Efficiency Issues
1. **Sample-Rate Dependent Voice Stealing (`voice.rs`)**:
   *   **Issue:** When a voice is stolen, it fades out using a hardcoded coefficient: `self.steal_fade *= 0.995;`.
   *   **Impact:** The fade-out time will change depending on the user's sample rate. At 96kHz, the fade out will be twice as fast as at 48kHz, potentially causing clicks.
   *   **Fix:** Calculate the decay coefficient dynamically based on the current `sample_rate`.

2. **Expensive Math in Inner Loop (`voice.rs`)**:
   *   **Issue:** The voice inner loop uses `2.0f32.powf(...)` inside the sample-rate loop for pitch modulation when drift or sequence pitch mod is active.
   *   **Impact:** `powf` is computationally expensive to run per-sample. 
   *   **Fix:** Since modulation is control-rate data (LFOs/envelopes), the pitch modulation ratio should ideally be calculated once per block, or using a fast approximation for `pow2` if sample-rate pitch modulation (like audio-rate FM) is required.

**Summary:** The Fermenter plugin has a rich feature set but suffers from critical architectural flaws regarding memory allocation on the audio thread. The `vec!` allocations in the render loop must be removed immediately to make the synthesizer viable for real-time use.
