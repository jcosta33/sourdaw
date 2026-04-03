# Reverb (ProofChamberEngine) Plugin Audit Report

Based on a code-level audit of the **Reverb** (also known as Dutch Oven / ProofChamberEngine) plugin (`crates/daw-dsp/src/reverb/`), here is the comprehensive audit report:

### 🚨 Critical Performance Bugs (Real-Time Audio Violations)
1. **Implicit WASM Bindgen Heap Allocations (`engine.rs`)**:
   *   **Issue:** Unlike the other plugins which maintain internal `Vec<f32>` buffers and expose raw pointers to JS (`get_input_left_ptr`), this plugin's AudioWorklet interface exposes a method that takes slices directly:
       ```rust
       pub fn process_block(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32])
       ```
   *   **Impact:** When JS calls this function with `Float32Array` arguments, `wasm-bindgen` automatically injects glue code that performs `malloc` to allocate memory in the WASM heap, copies the JS array data into it, runs the Rust function, copies the output data back to JS, and calls `free`. **This means 4 heap allocations and frees occur on every single audio block.** This is a catastrophic real-time audio violation that will cause dropouts, garbage collection stuttering, and CPU spikes in the browser.
   *   **Fix:** Refactor the WASM bindings to match the standard pattern used in Sourdaw: maintain internal `input_left`/`output_left` vectors, expose `get_input_left_ptr()` methods, and have the JS side write directly into the shared WASM linear memory before calling `process(block_size: u32)`.

### 🐛 Logical Bugs
1. **Pre-Delay Buffer Underflow Risk (`engine.rs`)**:
   *   **Issue:** The read index for the pre-delay ring buffer is calculated as:
       ```rust
       let read_idx = (self.pre_delay_idx + pd_len - pd_samples) % pd_len;
       ```
   *   **Impact:** `pd_len` is initialized to exactly `sample_rate * 0.5`. The `pre_delay_ms` parameter is clamped to `500.0` (which is `0.5` seconds). Due to floating-point rounding during the `.floor()` conversion, if `pd_samples` ever evaluates to a value greater than `pd_len` (even by 1 sample), `pd_len - pd_samples` will cause an integer underflow panic, instantly crashing the audio thread.
   *   **Fix:** Make the ring buffer safely wrap around the subtraction, or allocate a slightly larger buffer (e.g., `max_pre_delay_samples + 16`). A safer mathematical modulo formula would be: `(self.pre_delay_idx + pd_len - (pd_samples % pd_len)) % pd_len`.

**Summary:** The core Dattorro tank implementation is solid, but the WASM integration layer is fundamentally broken for real-time Web Audio use due to its reliance on `wasm-bindgen` array slicing, which inherently triggers heavy per-block memory allocation.
