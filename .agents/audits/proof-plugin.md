# Audit: Proof Plugin (Mastering & Dutch Oven)

## Goal
The Proof mastering suite and ProofChamber (Dutch Oven reverb) must deliver zero-compromise, professional-grade audio processing. The UI must stay perfectly synchronized with the Rust DSP backend, all state updates must respect React's immutability rules, and the DSP itself must be mathematically correct for stereo imaging and effect algorithms (e.g., granular pitch shifting).

## Current State
Both plugins are functional but suffer from severe disconnects between the UI state and the audio engine. The macro controls in the React UI fail to transmit nested parameters (like EQ and Dynamics bands) to the WASM backend. In addition, the Rust DSP for the Dutch Oven reverb contains critical mathematical errors in its stereo EQ stage and granular pitch shifter, rendering key features broken.

## Priorities
1. Fix the `setProofParamWithPatch` bridge to ensure DSP actually responds to macro UI changes.
2. Fix the broken stereo EQ filtering in the Dutch Oven reverb.
3. Fix the shimmer pitch-shifter math that outputs DC instead of pitched audio.
4. Refactor direct state mutations in the React components.
5. Correct the mono input routing configuration in ProofNode.
6. Create a reliable "flush" mechanism for loading presets so the WASM engine fully syncs.

## Findings
- **Complex UI vs Flat WASM Parameters:** The React UI organizes parameters into hierarchical objects (`patch.dynBands[0].threshold`), while the WASM engine expects flat scalar keys (`dyn_band_0_threshold`). The bridging layer is incomplete, leading to "ghost" UI changes where the knobs move but the sound remains identical.
- **Component-Level Dispatching:** The individual module sections (like `ProofDynSection`) correctly send their parameters via `onSendParam`. The bugs occur exclusively when macro controls (Level 2) or presets attempt to update the whole patch at once without iterating through the individual band parameters.
- **Polling Telemetry:** `ProofNode` relies on `setInterval` to read metering data from a `SharedArrayBuffer`. This relies on an explicit `destroy()` call to prevent memory leaks in the `telemetryAllocator`.
- **DSP Math Oversights:** The Dutch Oven Rust implementation has a few "TODOs" and commented hacks (like mono-compatible approximations) that were deployed to production but result in broken stereo behavior.

## Issues

### 1. UI Macro Controls Disconnected from Audio Engine
- **Severity**: Critical
- **Files**: `src/modules/Proof/useCases/proofParamBridge/setProofParamWithPatch.ts`, `src/modules/Proof/presentations/views/ProofPanel.tsx`
- **Evidence**: `setProofParamWithPatch` only bridges scalar parameters (`inputGain`, `eqBypassed`, etc.). It completely ignores nested arrays (`eqBands`, `dynBands`, `imgBandWidth`, `excBands`). In Level 2 (Shape), adjusting the macro controls calls `setProofParamWithPatch` for these arrays. The React state updates, but no messages are sent to the `AudioWorkletNode`.
- **Needed**: Expand `setProofParamWithPatch` (or create a dedicated `syncProofPatch` helper) that translates the nested `ProofPatch` arrays into the flat parameter keys expected by the WASM engine, and dispatches them sequentially.

### 2. Direct State Mutation in React Components
- **Severity**: High
- **Files**: `src/modules/Proof/presentations/views/ProofPanel.tsx`
- **Evidence**: In `Level2Shape`, array elements are shallow-copied and then directly mutated:
  ```typescript
  const bands = [...patch.dynBands];
  bands.forEach((b) => (b.threshold = v)); // Mutates the underlying object in the store
  setProofParamWithPatch(deviceId, 'dynBands' as never, bands as never);
  ```
  This violates strict unidirectional data flow and immutability invariants.
- **Needed**: Use deep copying when modifying nested arrays: `const bands = patch.dynBands.map(b => ({ ...b, threshold: v }));`.

### 3. Right Channel Bypasses Output EQ (Dutch Oven)
- **Severity**: Critical
- **Files**: `crates/proof-chamber/src/proof_chamber.rs`
- **Evidence**: The DSP process loop filters the left channel but completely ignores the right channel before computing Mid/Side matrixing.
  ```rust
  wet_l = self.high_cut.process(wet_l);
  wet_l = self.low_cut.process(wet_l);
  // wet_r is left unfiltered!
  ```
- **Needed**: Instantiate separate `high_cut_r` and `low_cut_r` `OnePole` filters in the `ProofChamber` struct and process `wet_r` through them.

### 4. Shimmer Pitch Shifter Math Outputs DC
- **Severity**: Critical
- **Files**: `crates/proof-chamber/src/proof_chamber.rs`
- **Evidence**: The granular pitch shifter calculates the read pointer using:
  ```rust
  self.phase1 += (self.pitch_ratio - 1.0) / gs;
  let read1 = self.write_pos as f64 - gs * self.phase1 + j1;
  ```
  Because `phase` is incrementing, the read delay *increases*, which shifts the pitch *down*. For an octave up (`pitch_ratio = 2.0`), the delay increases by 1 sample per sample, causing the read pointer to stand completely still, resulting in 0 Hz (DC) output.
- **Needed**: Correct the phase increment to `(1.0 - self.pitch_ratio) / gs` (and handle wrapping appropriately) so the read pointer advances faster than the write pointer, creating the required upward pitch shift.

### 5. Potential Leak in Telemetry Slot Allocation
- **Severity**: Medium
- **Files**: `src/modules/AudioEngine/engine/ProofNode.ts`
- **Evidence**: `sabSlot` is claimed from `telemetryAllocator` when the node is created and relies entirely on the `destroy()` method to be released. If the React component crashes or the AudioNode is unceremoniously garbage collected without `destroy()` being invoked, the slot is permanently leaked.
- **Needed**: Implement a `FinalizationRegistry` in the AudioEngine to guarantee that orphaned `sabSlot`s are released if the wrapper object is garbage collected.

### 6. Streaming Normalization Warning Logic Flaw
- **Severity**: Low
- **Files**: `src/modules/Proof/presentations/views/ProofPanel.tsx`
- **Evidence**: In `Level5Lab`, the streaming normalization warning is triggered if `delta > 1`. However, it does not check if `state.integratedLufs > -100` before warning. If the state initializes to `0` or another value before audio is processed, the warning may spuriously render or show incorrect delta values.
- **Needed**: Add an explicit `state.integratedLufs > -100` check to the Level 5 warning condition, matching the logic used in Level 1.

### 7. Limiter Lookahead Performance (O(N) per sample)
- **Severity**: High (Performance)
- **Files**: `crates/daw-dsp/src/proof/limiter.rs`
- **Evidence**: The limiter's lookahead buffer iterates over the entire `gain_buffer` array (e.g., 220 samples for 5ms at 44.1kHz) on every single audio sample to find the `future_peak`. This adds roughly 10 million operations per second per channel, making it extremely inefficient and CPU-heavy on the audio thread.
- **Needed**: Replace the `O(N)` linear scan with an `O(1)` sliding window maximum algorithm (e.g., using a monotonic double-ended queue) to track the peak in the lookahead window without iterating.

### 8. Tape Exciter Pre/De-Emphasis Filter Logic is Broken
- **Severity**: High
- **Files**: `crates/daw-dsp/src/proof/exciter.rs`
- **Evidence**: In `SaturationType::Tape`, the pre-emphasis (`pre_emph_l`) and de-emphasis (`de_emph_l`) filters are applied back-to-back *after* the signal has already been saturated and downsampled.
  ```rust
  let pre_l = self.pre_emph_l.process(wet_l, &self.pre_coeffs);
  let de_l = self.de_emph_l.process(pre_l, &self.de_coeffs);
  ```
  Since they are inverses (+6dB then -6dB), they cancel each other out entirely on the saturated signal. Pre-emphasis must occur *before* saturation to drive high frequencies into the non-linear transfer function.
- **Needed**: Move the pre-emphasis filter processing to the input signal *before* the 2x oversampling/upsampling block, leaving the de-emphasis filter after the downsampling.

### 9. Imager Widening Destroys Center Channel (Mono Incompatibility)
- **Severity**: High
- **Files**: `crates/daw-dsp/src/proof/imager.rs`
- **Evidence**: The `apply_width` function scales the Mid channel using `m_scaled = m * (2.0 - width).max(0.0)`. For a `width` of 2.0 (maximum widening), `m_scaled` becomes `0.0`. This means widening the stereo image completely deletes the mono/center channel, drastically dropping the mix volume and removing vocals, kick, and bass entirely.
- **Needed**: Change the width algorithm. Standard widening keeps the Mid channel at `1.0` (or uses a constant power curve) while boosting the Side channel up to `2.0` or higher, rather than aggressively ducking Mid. For example: `let m_scaled = m; let s_scaled = s * width;`.

### 10. LR4 Crossover Cascade Causes Severe Phase Nulls
- **Severity**: Critical
- **Files**: `crates/daw-dsp/src/proof/crossover.rs`
- **Evidence**: The `FourBandSplitter` cascades three `Lr4Crossover` blocks (`f1`, `f2`, `f3`). The `low` band only passes through `xover1`. The `high` band passes through all three. Because LR4 filters introduce frequency-dependent phase shifts (acting as all-pass filters when summed), the four output bands have mismatched phase relationships. When they are summed back together in the Multiband, Imager, or Exciter modules, the unmatched phase shifts cause severe comb-filtering and deep nulls across the frequency spectrum. 
- **Needed**: The lower bands must be passed through matching all-pass filters to compensate for the phase shifts introduced by the higher crossovers. The `low` band needs all-pass filters tuned to `f2` and `f3`. The `low_mid` band needs an all-pass filter tuned to `f3`.

### 11. TPDF Dither Fails to Quantize Output
- **Severity**: Critical
- **Files**: `crates/daw-dsp/src/proof/dither.rs`
- **Evidence**: `TpdfDither::process_sample` calculates the noise floor and adds it to the signal, but never actually rounds/quantizes the float to the target bit-depth (unlike `NoiseShapedDither` which does).
  ```rust
  let lsb = 2.0_f32.powi(-(self.bit_depth as i32 - 1));
  let r1 = self.next_random();
  let r2 = self.next_random();
  x + (r1 + r2) * lsb // Returns float with noise, NO quantization!
  ```
  If a user selects TPDF dither, they simply get hiss added to their 32-bit floating-point audio, defeating the entire purpose of dithering for bit-depth reduction.
- **Needed**: Add a quantization step to `TpdfDither::process_sample`: `let x_dithered = x + (r1 + r2) * lsb; (x_dithered / lsb).round() * lsb`.

### 12. Oversampler Delay Line State Corruption (Harmonic Exciter)
- **Severity**: Critical
- **Files**: `crates/daw-dsp/src/proof/oversample.rs`, `crates/daw-dsp/src/proof/exciter.rs`
- **Evidence**: In `exciter.rs`, the `BandExciter` calls `self.os_l.upsample()` and then `self.os_l.downsample()` sequentially on the *exact same* `Oversampler2x` instance.
  ```rust
  let (up_l0, up_l1) = self.os_l.upsample(l);
  // ... saturation ...
  let wet_l = self.os_l.downsample(sat_l0, sat_l1);
  ```
  However, `Oversampler2x` only has a single `delay_line` array. `upsample` pushes the 1x-rate input sample into it, and `downsample` pushes the 2x-rate saturated output samples into the *same array*. The filter is convolving across a completely mangled buffer containing a mix of different sample rates and both pre- and post-saturation audio. Furthermore, the polyphase math in `upsample` is mathematically incorrect as it doesn't zero-stuff or decompose correctly.
- **Needed**: The `Oversampler2x` must use separate, dedicated delay lines and state variables for the upsampling FIR and the downsampling FIR. The polyphase upsampling math must also be corrected to properly separate the even (pure delay) and odd (FIR filter) taps.

### 13. ProofNode Missing Channel Upmix Configuration
- **Severity**: Critical
- **Files**: `src/modules/AudioEngine/engine/ProofNode.ts`
- **Evidence**: The `AudioWorkletNode` constructor for `ProofNode` does not specify `channelCount: 2` or `channelCountMode: 'explicit'` (unlike `ProofChamberNode.ts`). When connected to a mono track or source, the Web Audio API defaults to `channelCountMode: 'max'`, sending only a 1-channel array to the underlying Worklet Processor.
- **Needed**: Add `channelCount: 2, channelCountMode: 'explicit'` to the node's options object to guarantee the browser upmixes mono sources to stereo before hitting the DSP.

### 14. AudioWorkletProcessors Actively Reject Mono Inputs
- **Severity**: Critical
- **Files**: `src/modules/AudioEngine/services/proofProcessor.ts`, `src/modules/AudioEngine/services/proofChamberProcessor.ts`
- **Evidence**: Both worklet processors contain the guard clause: `if (!input || input.length < 2 || !output || output.length < 2) {return true;}`. This immediately skips processing and returns silence/bypass if the input is mono (`input.length === 1`). The irony is that the code below the guard explicitly handles mono fallbacks (`input[1] ?? input[0]`), but it is rendered dead code by the overly aggressive guard.
- **Needed**: Change the guard to `if (!input || input.length < 1 || !output || output.length < 1) {return true;}` to allow 1-channel inputs to correctly trigger the `input[1] ?? input[0]` fallback logic.