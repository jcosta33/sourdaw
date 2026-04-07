---
goal: Modernize the codebase using ES2024-2026 and Rust 2024 Edition primitives to improve memory efficiency, reduce GC pressure, and eliminate boilerplate.
---

# Audit: Bleeding Edge Primitives (Revised)

## Current State

The codebase relies heavily on standard ES6+ and pre-2024 Rust patterns. There are specific "invisible" performance costs in our telemetry and hot loops that the latest primitives can address.

### JavaScript / TypeScript

- **Shared-memory polling**: The concrete SAB hot loop we found is the render-ahead worker in `grandBouleEngineWorker.ts`, which now uses `Atomics.pause()` between shared-memory refill iterations; the telemetry readers themselves are `requestAnimationFrame`-driven rather than tight spin loops.
- **Telemetry buffers**: AudioEngine telemetry slots stay fixed at `Float32Array` because the SAB ABI crosses main-thread/worklet realms; the Proof worklet now writes metering into the shared slot path already used by its node wrapper.
- **Compact UI buffers**: UI history buffers like `GrHistory.tsx` and `CrustWaveformDisplay.tsx` now prefer `Float16Array` at runtime through a shared helper while keeping `Float32Array` fallback semantics.
- **API-bound float buffers**: `drumSynthVoices.ts` and other Web Audio APIs still require `Float32Array` inputs (for example `WaveShaperNode.curve`), so not every float buffer is a valid `Float16Array` candidate.
- **Async**: Manual `new Promise` wrappers in repositories.

### Rust

- **Lookup Tables**: `bacteria/stft.rs` now precomputes the default 2048-point bit-reversal table at compile time and selects it via `inline_const`; other runtime-generated tables remain as-is.
- **FFT Logic**: `bacteria/stft.rs` now uses `const_mut_refs`-friendly compile-time bit-reversal generation instead of recomputing the permutation on every FFT call.
- **DSP SIMD**: The current nightly toolchain still treats `std::simd` / `portable_simd` as unstable in this crate, so hot loops remain scalar unless the crate opts into nightly-only features or another SIMD strategy.

## Findings

### 1. `Atomics.pause` belongs in actual shared-memory refill loops, not the meter readers

The concrete busy loop we found was `grandBouleEngineWorker.ts`, which repeatedly checks shared write/read heads while trying to keep the ring buffer ahead of the consumer. The meter readers in the AudioEngine node wrappers are `requestAnimationFrame` polling loops instead.

- **File**: `src/modules/AudioEngine/workers/grandBouleEngineWorker.ts`

### 2. Remaining compact-buffer candidates are UI-side histories, not Web Audio API buffers

The best remaining `Float16Array` candidates in the current codebase were UI-side history/ring buffers. Web Audio APIs like `WaveShaperNode.curve` still require `Float32Array`, so some buffers flagged in the original audit are intentionally left as float32.

- **File**: `src/modules/Gluten/presentations/components/GrHistory.tsx`
- **File**: `src/modules/Crust/presentations/components/CrustWaveformDisplay.tsx`
- **File**: `src/modules/Synth/engine/drumSynthVoices.ts`

### 3. `bacteria/stft.rs` is the concrete compile-time FFT target

The STFT path is where lookup-table locality and compile-time FFT preparation actually converge. The default bit-reversal table is now generated at compile time; window coefficients still stay runtime-generated because the needed trigonometric functions are not const-friendly in this implementation.

- **File**: `crates/daw-dsp/src/bacteria/stft.rs`

### 4. `std::simd` remains blocked by crate/toolchain policy

Attempting to use `std::simd` in `daw-dsp` currently requires opting the crate into the unstable `portable_simd` feature. That is a larger project-level decision than a local refactor.

- **File**: `crates/daw-dsp/src/bacteria/stft.rs`
- **File**: `crates/daw-dsp/src/fermenter/oscillator.rs`

### 5. The decorator audit item is underspecified

`src/setupTests.ts` currently only imports `@testing-library/jest-dom`, and the DI layer is function-based (`Container`/`inject`) rather than class-decorator-driven. There is no clear migration target for “standardized decorators” without an explicit design decision.

- **File**: `src/setupTests.ts`
- **File**: `src/helpers/DependencyInjector/Container.ts`
- **File**: `src/helpers/DependencyInjector/inject.ts`

## Issues

| ID  | Title                                      | Needed                                                                                                                                                                       | Priority |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 002 | Inline lookup tables with `inline_const`   | Continue auditing other runtime-generated lookup tables beyond the default STFT bit-reversal table now selected via `inline_const`.                                          | Medium   |
| 004 | Native SIMD in DSP                         | Decide whether `daw-dsp` may opt into nightly `portable_simd` (or another SIMD strategy) before rewriting hot kernels.                                                       | High     |
| 005 | Precision optimization with `Float16Array` | Selected UI history buffers now prefer `Float16Array`; keep cross-realm SAB telemetry and API-mandated buffers on `Float32Array` unless the format is negotiated explicitly. | Medium   |
| 006 | Standardized Decorators                    | Clarify the intended decorator model for `setupTests.ts` and the function-based DI layer before changing those surfaces.                                                     | Low      |

## Resolved

- Added `Atomics.pause()` to the concrete shared-memory refill loop in `src/modules/AudioEngine/workers/grandBouleEngineWorker.ts`.
- Proof metering now uses the shared telemetry slot path already allocated by `ProofNode`, removing the stale split between node-side SAB polling and processor-side `MessagePort` metering.
- `src/helpers/createCompactFloatBuffer.ts` now lets selected UI history buffers (`GrHistory`, `CrustWaveformDisplay`) prefer `Float16Array` at runtime while falling back to `Float32Array`.
- `crates/daw-dsp/src/bacteria/stft.rs` now precomputes the default 2048-point FFT bit-reversal table at compile time and reuses it instead of recalculating the permutation every FFT call.

## Risks

- **CPU Overheating/Throttling**: Inefficient polling in the audio thread can lead to thermal throttling on mobile devices.
- **L2 Cache Misses**: Lack of locality for large constants in DSP code impacts performance.
- **Nightly Feature Creep**: Enabling `portable_simd` to satisfy issue 004 would make `daw-dsp` explicitly depend on unstable crate features.
- **Build-Time vs Run-Time**: Moving more logic to `const` reduces startup time but increases binary size slightly.

## Suggested Approaches

1. **Shared-memory hinting**: Keep `Atomics.pause()` limited to genuine shared-memory refill/spin loops like `grandBouleEngineWorker.ts`; do not sprinkle it into `requestAnimationFrame` meter readers.
2. **Compact buffers**: Continue migrating eligible non-audio UI/history buffers to the shared compact-float helper, but leave Web Audio API buffers on `Float32Array` where required by platform contracts.
3. **Rust STFT locality**: Extend the compile-time-table approach in `bacteria/stft.rs` if more const-friendly FFT tables become worthwhile.
4. **SIMD gating**: Resolve whether nightly `portable_simd` is acceptable before attempting issue 004.
