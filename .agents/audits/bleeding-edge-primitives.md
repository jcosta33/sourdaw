---
goal: Modernize the codebase using ES2024-2026 and Rust 2024 Edition primitives to improve memory efficiency, reduce GC pressure, and eliminate boilerplate.
---

# Audit: Bleeding Edge Primitives (Revised)

## Current State

The codebase relies heavily on standard ES6+ and pre-2024 Rust patterns. There are specific "invisible" performance costs in our telemetry and hot loops that the latest primitives can address.

### JavaScript / TypeScript
- **Spin-loops**: `SharedArrayBuffer` telemetry views (e.g., in `scoringProcessor.ts`) perform manual polling without hint instructions to the CPU.
- **Wavetables**: `drumSynthVoices.ts` uses runtime allocation for wave curves.
- **Async**: Manual `new Promise` wrappers in repositories.

### Rust
- **Lookup Tables**: Curves and DSP coefficients are either runtime-calculated or declared at module level, losing locality.
- **FFT Logic**: Complexity in `bacteria/stft.rs` could benefit from `const_mut_refs` to pre-calculate bit-reversal tables.
- **DSP**: Hot loops use scalar math rather than `std::simd`.

## Findings

### 1. Inefficient Shared Memory Polling
Our `SharedArrayBuffer` telemetry views (e.g., `_sabView` in `bacteriaProcessor.ts`) could trigger high CPU load during high-concurrency sessions.
- **File**: `src/modules/AudioEngine/services/bacteriaProcessor.ts`
- **File**: `src/modules/AudioEngine/services/scoringProcessor.ts`

### 2. Lack of Locality for Lookup Tables
DSP engines like `levain/mod.rs` use parameters that could be better structured using `inline_const`.
- **File**: `crates/daw-dsp/src/levain/mod.rs`

### 3. Native Assembly Opportunities
Critical kernels in `bacteria/stft.rs` perform heavy lifting that could be optimized with `naked_functions` for specific target architectures.
- **File**: `crates/daw-dsp/src/bacteria/stft.rs`

## Issues

| ID | Title | Needed | Priority |
|---|---|---|---|
| 001 | Spin-loop optimization with `Atomics.pause` | Add `Atomics.pause()` to telemetry polling loops in AudioWorklets. | High |
| 002 | Inline lookup tables with `inline_const` | Replace module-level wave constants with `inline_const` blocks for better locality. | Medium |
| 003 | Compile-time FFT tables | Use `const_mut_refs` in `bacteria` to pre-calculate bit-reversal indices at compile time. | Medium |
| 004 | Native SIMD in DSP | Implement `std::simd` in `daw-dsp` for oscillators and filter banks. | High |
| 005 | Precision optimization with `Float16Array` | Migrate non-audio signal buffers (curves, telemetry) to `Float16Array`. | Medium |
| 006 | Standardized Decorators | Migrate `src/setupTests.ts` and DI layers to standardized native decorators (TS 6.0). | Low |

## Risks
- **CPU Overheating/Throttling**: Inefficient polling in the audio thread can lead to thermal throttling on mobile devices.
- **L2 Cache Misses**: Lack of locality for large constants in DSP code impacts performance.
- **Build-Time vs Run-Time**: Moving more logic to `const` reduces startup time but increases binary size slightly.

## Suggested Approaches
1. **Telemetry Hinting**: Inject `Atomics.pause()` into the `process()` methods of our `*Processor.ts` files.
2. **DSP Locality**: Refactor `drumSynthVoices.ts` to use `inline_const` for its curve generation.
3. **Rust STFT Refactor**: Use `std::simd` for the windowing and magnitude calculation in `bacteria`.
