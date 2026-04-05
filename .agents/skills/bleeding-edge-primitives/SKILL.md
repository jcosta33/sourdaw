---
name: bleeding-edge-primitives
description: Advanced JS (ES2024-2026) and Rust (2024 Edition) primitives for audio DSP, Tauri interop, and memory-efficient state.
---

# Bleeding Edge Primitives

Use these modern patterns to improve performance, memory safety, and ergonomics. Avoid older, more verbose polyfills or manual synchronization.

## JavaScript (ES2024–2026)

### Memory & Performance
- **`Float16Array`**: Use for large sample libraries or wavetables to halve memory usage vs `Float32Array`. Native support for WebGPU.
- **`Atomics.pause` (Stage 3)**: Use in AudioWorklet/Worker spin-loops (e.g., ring buffers) to improve CPU efficiency and reduce thermal throttling.
- **Explicit Resource Management (`using` keyword)**: Automatically cleanup `AudioBuffer`, `Worker`, or WASM memory.
  ```javascript
  {
    using handle = acquireWasmBuffer();
    // handle is freed at the end of block
  }
  ```

### Architecture & Logic
- **Standardized Decorators (TS 6.0)**: Use for DI and event metadata. Prefer native `@decorator` syntax over legacy experimental modes.
- **`Promise.withResolvers()`**: Cleaner "one-shot" async events (e.g., waiting for sample load).
- **`Object.groupBy` / `Map.groupBy`**: Standard way to group tracks, plugins, or MIDI events.

## Rust (2024 Edition / 1.85+)

### Audio Thread & DSP
- **`inline_const` (Stable 1.79)**: Define lookup tables (LFOs, curves) exactly where they are used: `let table = const { generate_lookup() };`.
- **`const_mut_refs` (Stable 1.83)**: Perform complex compile-time math (e.g., FFT bit-reversal indexing) using mutable logic inside `const` blocks.
- **Portable SIMD (`std::simd`)**: Unified DSP code that auto-optimizes for AVX-512 (PC) and NEON (Apple Silicon).
- **`naked_functions` (Stable 1.88)**: Use for ultra-critical DSP kernels requiring zero-overhead assembly interop.

### Async & Tauri Interop
- **Async Closures (`async || {}`)**: Simplified callbacks for UI-to-Engine events without lifetime "gymnastics."
- **Async Functions in Traits (AFIT)**: Native `async` definitions for plugin or module interfaces.

## Core Mandates
1. **No-Allocation Hot Loops**: Use GATs, Const Generics, and `inline_const` in Rust to maintain "no-alloc" status on the audio thread.
2. **Efficiency**: Use `Atomics.pause` in shared-memory spin-locks to prevent unnecessary CPU waste.
3. **Resource Safety**: Always use `using` for long-lived DAW assets.
