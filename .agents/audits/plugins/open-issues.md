# Plugin Open Issues

All code-verified open issues across the plugin layer. Completed and wrong-call items have been removed.
Issues are grouped by scope: targeted Rust fixes → targeted TS fixes → architectural work.

---

## Rust DSP — Targeted Fixes

### Reverb / ProofChamberEngine (`crates/daw-dsp/src/reverb/`)

**1. WASM slice API causes 4 heap allocations per audio block**

- `engine.rs` exposes `process_block(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32])` taking slice arguments.
- wasm-bindgen automatically allocates WASM heap memory, copies data in, runs the function, copies data back, and frees — 4 malloc/free per 128-sample block. This will cause audio dropouts and GC stuttering immediately.
- **Fix:** Match the standard pattern used by every other plugin. Add `input_left/right: Vec<f32>` and `output_left/right: Vec<f32>` (pre-allocated to 4096) to the `ReverbInstance` struct. Export `get_input_left_ptr / get_input_right_ptr` pointer methods. Change `process` to take `block_size: u32` only. Update `proofChamberProcessor.ts` to use the pointer pattern instead of passing `Float32Array` arguments.

**2. Pre-delay buffer underflow panic**

- `engine.rs`: `let read_idx = (self.pre_delay_idx + pd_len - pd_samples) % pd_len;`
- `pre_delay_ms` is clamped to 500ms and `pd_len` is allocated to exactly `sample_rate * 0.5`. Due to floating-point rounding in the `.floor()` conversion, `pd_samples` can exceed `pd_len` by 1, making `pd_len - pd_samples` underflow as `usize`, which panics and kills the audio thread.
- **Fix:** `(self.pre_delay_idx + pd_len - (pd_samples % pd_len)) % pd_len` or allocate the buffer with 16 extra samples as headroom.

---

### Gluten (`crates/daw-dsp/src/gluten/`)

**3. External sidechain allocation on audio thread**

- `engine.rs`: `ext_sc_left` and `ext_sc_right` are initialised with `Vec::new()` (capacity 0). `set_ext_sc` calls `extend_from_slice()` on them.
- On the first sidechain block (and every time block size changes), `extend_from_slice` triggers a heap allocation on the real-time audio thread, causing dropouts.
- **Fix:** Initialise both vecs with `vec![0.0_f32; 4096]` in `GlutenEngine::new()`. In `set_ext_sc`, copy into the existing allocation rather than extending.

**4. Broken auto-makeup gain**

- `engine.rs` `compute_auto_makeup` passes hardcoded literals to the makeup algorithm regardless of user settings:
  `Topology::Vca => auto_makeup(-18.0, 4.0)` — always calculates for threshold −18 dB / ratio 4:1.
- If the user sets threshold to −40 dB, auto-makeup is wrong by 22 dB, causing a massive unexpected volume drop.
- **Fix:** Read the actual current threshold and ratio from the active topology instance (e.g., `self.vca.threshold()`) and pass those live values into `auto_makeup`.

---

### Toaster (`crates/daw-dsp/src/toaster/`)

**5. Audible click on choke group triggers**

- `engine.rs` `note_on`: when a pad belongs to a choke group, the active voice is killed instantly:
  `voice.release(); voice.active = false;`
- Setting `active = false` drops audio output to 0.0 in one sample — an audible hard click every time a closed hi-hat chokes an open hi-hat or any other choke pair fires.
- **Fix:** Instead of setting `active = false`, trigger a very fast amplitude ramp (5–10 ms). Keep the voice in a `choking` state, decrement an envelope to 0 over those samples, then mark inactive. The voice's mix contribution should multiply by this choke envelope before the bus sum.

**6. Sample-rate dependent bus compressor**

- `engine.rs` `BusEffects::process`: attack and release use hardcoded coefficients:
  `let coeff = if abs > self.comp_env { 0.01 } else { 0.0005 };`
- At 96 kHz these attack/release times are roughly half what they are at 48 kHz.
- **Fix:** Store `sample_rate` in `BusEffects`. Compute `attack_coeff = 1.0 - (-1.0 / (attack_ms * 0.001 * sample_rate)).exp()` on init and whenever `sample_rate` changes. Apply the computed coefficients instead of the literals.

---

### Fermenter (`crates/daw-dsp/src/fermenter/`)

**7. Heap allocation on note_on for new engine types**

- `voice.rs` `Voice::set_engine`: the first time a voice triggers with an engine it hasn't used before (e.g. KarplusStrong, Granular), it allocates:
  `self.ks_engine = Some(Box::new(KarplusStrong::new(sample_rate)));`
- This allocation happens on the audio thread during `note_on`, causing note-trigger latency and potential dropout.
- **Fix:** Pre-allocate all engine variants (`KarplusStrong`, `GranularVoice`, etc.) inside `Voice::new()`, storing them as `Option<Box<T>>` initialised to `Some(...)`. `set_engine` then only switches the active variant pointer, no allocation at runtime.

**8. `powf` per sample in pitch modulation inner loop**

- `voice.rs`: when pitch modulation (LFO drift or sequence pitch mod) is active, the inner sample loop calls `2.0f32.powf(semitones / 12.0)` every sample.
- `powf` involves a logarithm and exponentiation. Since LFO/sequence mod is inherently control-rate (changes at most once per block), recalculating per-sample wastes significant CPU.
- **Fix:** Move the pitch ratio calculation outside the `for i in 0..len` loop. Recompute it at the start of each block from the current modulation value, then use the cached `f32` ratio inside the loop.

---

### Proof (`crates/daw-dsp/src/proof/`)

**9. Per-block allocation in WASM interop**

- `mod.rs` `ProofInstance::process` resizes its four I/O buffers if the block size changes:
  `self.input_left.resize(size, 0.0);` (and right, output left, output right).
- The very first block and any block-size change during export/rendering triggers four allocations on the audio thread.
- **Fix:** Pre-allocate all four buffers to 4096 in `ProofInstance::new()`. Clamp `size` to `self.input_left.len()` instead of resizing.

---

### Knead (`crates/daw-dsp/src/knead/`)

**10. PSOLA module never wired up — plugin produces no output**

- `engine.rs` runs YIN pitch analysis only. The `psola.rs` module exists but is never imported or called anywhere in the engine.
- The plugin currently detects pitch (unreliably — see below) but performs zero pitch manipulation. It is functionally silent.
- **Fix:** Import `psola` in `engine.rs`. After `process_analysis_frame` returns a detected `f0`, feed the buffered input signal through the PSOLA processor with the target pitch ratio derived from `f0` and the user's `pitch_shift` parameter.
- **Note:** This is an incomplete feature, not just a bug. The full implementation needs: accumulating input into a ring buffer of sufficient size (~2048 samples) so YIN has enough history, then running PSOLA on that buffer with the detected period.

---

## TypeScript — Targeted Fixes

### Levain (`src/modules/AudioEngine/services/levainProcessor.ts`)

**11. Buffer over-read: JS reads past Rust's clamped output**

- `mod.rs` clamps processing to 1024: `let size = size.min(1024);`
- `levainProcessor.ts` ignores this and reads `output[0].length` floats from the pointer — which can be 128 to 4096+ depending on browser/context.
- During `OfflineAudioContext` export or on some Safari/Bluetooth setups, block size exceeds 1024. The JS reads past the valid Rust allocation into random WASM memory, producing harsh digital noise.
- **Fix (easiest):** Change the Rust buffer to 4096 (matching every other plugin) and remove the 1024 clamp.
  **Fix (minimal):** Change the JS read to `Math.min(frames, 1024)` and `Math.min(frames, 1024)` for both channels.

### ~~Toaster param bridge (`src/modules/Toaster/useCases/toasterParamBridge.ts`)~~ — DONE

**~~12. Live knob changes silently ignored — bridge searches for `grinder` instead of `toaster`~~**

Fixed. No `grinder` references remain in Toaster useCases — bridge correctly uses `toaster` / `toasterControls`.

### ~~Groove Creator export (`src/modules/Toaster/useCases/exportPatternToTimeline.ts`)~~ — DONE

**~~13. "To Timeline" creates empty clips — absolute beats passed where clip-relative expected~~**

Fixed. `exportPatternToTimeline.ts` line 54 uses `s * stepDurationBeats` (clip-relative). `insertAt` is only used for the clip's absolute position, not note positions within the clip.

---

## Architectural — Larger Scope

### External VST3/CLAP hosting (`src/modules/Plugin/`, `crates/daw-plugin-host/`)

**14. Async audio processing guarantees permanent dropouts**

- `PluginHostNode.ts` sends audio out of the worklet via `postMessage`, awaits an async Tauri IPC call, then posts audio back to the worklet.
- The Web Audio clock is synchronous. The async round-trip never completes within the 2.6 ms render quantum. The existing `if (this.isProcessing) return` guard silently drops every block that arrives while IPC is in flight — the result is heavily stuttering audio whenever the UI renders or mouse moves.
- **Required architecture:** Allocate a `SharedArrayBuffer` ring buffer at plugin init. The `AudioWorkletProcessor` writes input blocks directly into SAB slots and signals via `Atomics.notify`. A dedicated Rust thread (not the IPC thread) reads from the SAB, processes the VST3 DSP, and writes output back. The worklet reads output from SAB on the next quantum. Zero async promises, zero JSON, zero main-thread involvement in the audio path.

**15. Native GUI windows unparented from DAW**

- `openPluginGui.ts` invokes `open_plugin_gui` with only `instanceId`. No OS window handle is passed to Rust.
- VST3 plugin UIs open as floating top-level windows, independent of the DAW. They don't stay on top, don't minimise with the DAW, and feel like separate applications.
- **Required fix:** In the Tauri backend, extract the native handle from the Webview (`NSView*` on macOS, `HWND` on Windows). Pass it down to the vst3 host library's `IPlugView::attached()` call so the plugin GUI is parented as a child window of the DAW webview.

### All premium native plugins (Fermenter, Toaster, Levain, Bacteria, Gluten, Proof, Grinder)

**~~16. postMessage telemetry causes GC avalanche at 85 Hz~~ — DONE**

Fixed as RT-4. `telemetryAllocator.ts` manages 64 SAB slots (32 floats × 4 bytes each). `grinderProcessor`, `bacteriaProcessor`, `glutenProcessor`, `scoringProcessor` handle `init-sab` and write scalars directly into their slot. `GrinderNode`, `BacteriaNode`, `GlutenNode`, `ScoringNode` allocate a slot on creation, post `init-sab`, and poll via `requestAnimationFrame` instead of `port.onmessage`. Zero structured clones per audio block for meter data.

**17. Zipper noise on parameter automation**

- Automation playback calls `setParam` on native plugins at ~100 Hz via `postMessage`. Each call applies the new value instantaneously on the next audio block.
- Stepping filter cutoff, gain, or reverb mix in discrete 10 ms jumps causes audible zipper noise / clicks, especially audible at slow automation rates.
- **Required fix:** Add `SmoothedParam` wrappers (already used in some engines, e.g. Bacteria's `mix`) to all continuous parameters in each plugin's Rust DSP. The 1-pole lowpass smoothing (5–20 ms time constant) eliminates zipper noise transparently without UI changes.
- **Scope:** Each plugin needs its own audit of which params already use `SmoothedParam` vs raw `f32`. Fermenter, Grinder, and Gluten have the most continuous params and are the highest priority.

### Bacteria modulation matrix (`crates/daw-dsp/src/bacteria/`)

**18. Mod matrix fully disconnected — no WASM binding and no band-param wiring**

- `param_offsets[1024]` is computed correctly each sample from LFOs, macros, and the envelope follower. `param_offsets[0]` is applied to the global wet/dry mix.
- However: (a) `BandChain::process_sample` receives no offsets at all, so modulating filter cutoff, drive, or gain on any band does nothing. (b) `add_mod_assignment` and `add_macro_mapping` have no `#[wasm_bindgen]` attribute in `mod.rs`, so TypeScript cannot configure the mod matrix at all — even the global mix modulation is unreachable from the UI.
- **Required steps to fix end-to-end:**
    1. Expose `add_mod_assignment(source_id, target_param, amount)` and `add_macro_mapping(macro_index, target_param, min, max)` via `#[wasm_bindgen]` in `mod.rs`.
    2. Define a `target_param` ID convention for band params (e.g. `band_idx * 100 + slot` where slot 0 = filter cutoff, 1 = drive, 2 = gain offset).
    3. Store base param values in `BandChain` (current cutoff, current drive) so per-sample offsets can be added without re-parsing param names.
    4. Pass the relevant `param_offsets` slice into `BandChain::process_sample` and apply offsets to the live filter/drive values. Be careful with filter coefficient recalculation — `SvfFilter::set_cutoff` recomputes trig each call; consider a fast approximation or a "dirty" flag that skips recalculation when the offset is negligible.
    5. Update `bacteriaDescriptor.ts` and the bacteria TypeScript layer to call `add_mod_assignment` when the user wires a mod source.

---

## Recommended Sequence

**Do first (self-contained Rust fixes, clear impact):**

- #5 Toaster choke click — audible on every hi-hat use
- #1 + #2 Reverb WASM slice pattern + pre-delay panic — audio thread crash risk
- #9 Proof per-block resize — every export/offline render triggers allocations
- #3 Gluten sidechain allocation — triggered on first use with sidechain
- #4 Gluten auto-makeup — wrong by many dB if user moves threshold
- #11 Levain buffer over-read — silent corruption during export

**Do second (less urgent Rust quality):**

- #6 Toaster bus compressor sample-rate dependency
- #7 Fermenter note_on allocation
- #8 Fermenter powf in inner loop
- #17 Zipper noise (SmoothedParam sweep across plugins)

**Design tasks (need planning before touching code):**

- #18 Bacteria mod matrix (needs param ID convention agreed first)
- #14 VST3 async audio → SAB ring buffer (large, needs Rust threading design)
- #15 VST3 native window parenting (platform-specific, macOS vs Windows diverge)
- #10 Knead PSOLA completion (incomplete feature, needs product decision on scope)
