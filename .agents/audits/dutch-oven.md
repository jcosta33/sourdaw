# SKILL: write-audit

## Goal
The goal of the Dutch Oven (ProofChamber) plugin is to provide a flagship, real-time-safe, high-quality Dattorro plate reverb with robust parameter management, accurate stereo DSP, and a unified, state-driven UI that integrates seamlessly with the DAW's plugin host, undo history, and parameter automation.

## Current State
The Dutch Oven plugin is in a heavily fragmented and severely broken state. The domain is split across two completely isolated module directories (`src/modules/ProofChamber` and `src/modules/Plugin/ProofChamber`). The WASM audio worklet contains a fatal memory-access bug, rendering audio output effectively random or silent. The DSP implementation has a broken stereo EQ implementation. The UI state is entirely disconnected from global store state in the primary panel, meaning parameter tweaks are lost on unmount.

## Priorities
1. Fix the catastrophic memory access bug in `ProofChamberProcessor` so the plugin actually outputs audio.
2. Fix the stereo output EQ bug in the Rust DSP engine.
3. Resolve the massive architecture violation by merging `src/modules/ProofChamber` and `src/modules/Plugin/ProofChamber`.
4. Connect the primary UI panel to the shared plugin state store so parameter changes persist across unmounts.
5. Integrate parameter changes with the DAW's undo/redo command system.

## Findings

- The domain is split into two disjoint modules (`ProofChamber` and `Plugin/ProofChamber`).
- There are two separate UI components (`ProofChamberPanel.tsx` and `ProofChamber.tsx`), two different state models (`ProofChamberPatch.ts` and `ProofChamberState.ts`), and overlapping responsibilities.
- The `ProofChamberPanel` relies entirely on local React state (`useState`) for all parameters. Closing and reopening the panel resets all parameters to defaults.

### 1. Critical Bugs
**1.1. AudioWorklet reads random memory instead of audio**
- **Evidence:** `src/modules/AudioEngine/services/proofChamberProcessor.ts`
  ```javascript
  const leftPtr = this._instance.process(input[0], input[1] ?? input[0], frames);
  const rightPtr = this._instance.get_right_ptr();
  const mem = this._memory.buffer;
  output[0].set(new Float32Array(mem, leftPtr, frames));
  ```
  `crates/proof-chamber/src/proof_chamber.rs`
  ```rust
  pub fn process(&mut self, left: &mut [f32], right: &mut [f32])
  ```
- **Why it matters:** The Rust `process` function has no return type (returns void/undefined in JS). The JS worklet assigns `undefined` to `leftPtr` and attempts to create a `Float32Array` view from `undefined` offset in WASM memory (which defaults to 0). This causes the worklet to output random WASM memory garbage instead of the processed audio buffer.
- **Needed:** Rewrite the Rust `process` method to explicitly return a pointer to an internal output buffer, or expose `get_left_ptr()` and `get_right_ptr()` correctly, avoiding relying on implicit `wasm-bindgen` array slicing in real-time contexts.

**1.2. Right channel EQ bypassed in Rust DSP**
- **Evidence:** `crates/proof-chamber/src/proof_chamber.rs` lines 442-443.
  ```rust
  wet_l = self.high_cut.process(wet_l);
  wet_l = self.low_cut.process(wet_l);
  // Note: sharing the same filter state for L and R is incorrect...
  ```
- **Why it matters:** Despite the comment claiming it shares filter state for L and R as an approximation, `wet_r` is completely ignored and left unprocessed. This creates severe phase and frequency response imbalances between the left and right channels.
- **Needed:** Instantiate separate `HighCut` and `LowCut` filters for both the left and right channels in the `ProofChamber` struct, and apply them correctly to `wet_l` and `wet_r`.

**1.3. FDN parameter naming mismatch and ignored parameters**
- **Evidence:** `src/modules/AudioEngine/wasm/proof_chamber.js` `get_param_names` returns `["mix", "rt60", "damping", "predelay", "size", "mod_depth", "early_late", "matrix", "saturation"]`. The UI sends `decay` and `diffusion`. FDN ignores `diffusion`.
- **Why it matters:** Parameters tweaked in the UI are ignored depending on the selected algorithm because the rust implementation doesn't consistently map or respond to the UI's generic parameters.
- **Needed:** Ensure a consistent parameter mapping API across all internal engine algorithms in Rust, so they all respond intuitively to the UI's dial adjustments.

### 2. Functional Issues
**2.1. Parameter state is lost on unmount**
- **Evidence:** `src/modules/ProofChamber/presentations/views/ProofChamberPanel.tsx` uses `useState<ProofChamberParams>({ ...DEFAULT_PARAMS })`.
- **Why it matters:** Users will lose their reverb settings simply by switching tabs or closing the plugin window.
- **Needed:** Bind the `ProofChamberPanel` to the global `chamberStore` or the DAW's active patch state.

### 3. UX/UI Issues
**3.1. SpectrogramView is hardcoded to mock data**
- **Evidence:** `src/modules/Plugin/ProofChamber/presentations/views/ProofChamber.tsx` uses `<SpectrogramView isMocking={true} />`.
- **Why it matters:** The visualizer does not reflect actual audio passing through the engine.
- **Needed:** Connect the spectrogram to a real analyser node or remove the mock flag.

### 4. Structural/Code Health Issues
**4.1. Duplicated domain modules (Architecture Violation)**
- **Evidence:** `src/modules/ProofChamber` vs `src/modules/Plugin/ProofChamber`.
- **Why it matters:** Violates the codebase architecture by having two parallel implementations for the same feature. Creates confusion on which components, models, and stores are authoritative.
- **Needed:** Consolidate all code into `src/modules/Plugin/ProofChamber`. Delete the redundant components and models. Ensure a single source of truth for the plugin state.

**4.2. Inconsistent Parameter Mapping in DSP Engine**
- **Evidence:** `crates/proof-chamber/src/lib.rs` `ProofChamberInstance::set_param` handles parameters by forwarding them directly to the active `ReverbEngine` via string matching.
- **Why it matters:** Each algorithm (Plate, FDN, Spring, Convolution, etc.) has its own specific string-based parameter schema and ignores parameters it doesn't recognize. The front-end UI (`ProofChamberPatch.ts`) is hardcoded to send a single set of generic parameters. When the user switches algorithms, the UI keeps sending `decay` and `diffusion`, but algorithms like `Spring` or `Convolution` might expect `ir_stretch` or completely ignore them. This breaks the UX and creates a disconnected plugin where knobs stop working.
- **Needed:** Enforce a unified parameter schema mapping in the Rust `ProofChamberInstance` that translates generic "macro" parameters from the UI (like `size`, `decay`, `color`) into the specific DSP parameters for the currently active algorithm.

### 5. Performance Concerns
**5.1. High-frequency param dispatching without throttling**
- **Evidence:** `ProofChamberPanel.tsx` calls `updateProofChamberParam` synchronously on every knob tick.
- **Why it matters:** Floods the message port to the audio thread and can cause UI thread jank.
- **Needed:** Implement debouncing/throttling on the parameter bridge, or ensure the underlying DAW command system batches rapid UI events.

### 6. Missing features or unfinished integrations
**6.1. Direct bridge calls bypass Undo/Redo history**
- **Evidence:** `ProofChamberPanel.tsx` imports `updateProofChamberParam` and fires it directly.
- **Why it matters:** Parameter changes cannot be undone and are not recorded in the global state projection.
- **Needed:** Dispatch standard DAW parameter change commands instead of direct bridge calls.

**6.2. IR Data loaded but never sent to the AudioWorklet**
- **Evidence:** `src/modules/ProofChamber/presentations/components/IrBrowser.tsx` exposes `onIrLoaded(data, channels, sampleRate)`. In `ProofChamberPanel.tsx` this is only logged: `logger.info('[ProofChamber] IR loaded...');`
- **Why it matters:** The Convolution and Hybrid algorithms are completely non-functional. Users can drag and drop IRs, but the data never actually reaches the WASM engine.
- **Needed:** Pass the decoded IR `Float32Array` buffer down to the `ProofChamberProcessor` via `postMessage`, and call the WASM `load_ir` method.

**6.3. Plugin delay compensation (PDC) latency reporting is ignored**
- **Evidence:** `crates/proof-chamber/src/lib.rs` and `proof_chamber.js` expose a `get_latency()` method. However, `ProofChamberProcessor.ts` never calls this or reports it to the main thread.
- **Why it matters:** Algorithms like Convolution introduce an internal delay (128 samples head size). Without reporting this latency to the DAW engine, tracks using this reverb will be out of sync with the rest of the project.
- **Needed:** Add a mechanism in `ProofChamberProcessor` to query `get_latency()` on initialization or algorithm change, and send a `latency` message to `ProofChamberNode` so the DAW's PDC graph can compensate.

## Risks
If the worklet memory bug is not fixed immediately, the plugin will produce noise or crash the audio thread. If the architecture violation is allowed to remain, further development will split the codebase, resulting in unmaintainable parallel logic. If the local state issue is not resolved, the plugin is functionally unusable for real-world mixing as settings cannot be saved or recalled reliably.

## Resolved
*(None yet)*