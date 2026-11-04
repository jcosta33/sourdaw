# crates/scoring — Agent Guidelines

Reference-grade chromatic tuner and pitch detection DSP engine compiling to WebAssembly (`public/wasm/scoring/scoring.wasm`).

## Domain Ownership

- Owns high-precision pitch detection algorithms (autocorrelation, harmonic peak interpolation, cents offset calculation, concert-A frequency reference calibration).
- Compiles via `wasm-pack` (`pnpm wasm:scoring`) and generates worklet glue via `scripts/gen-scoring-worklet.ts`.
- Does not own tuner UI presentation (`src/modules/Tuner`) or WebAudio node graph lifecycle (`AudioEngine`).

## Invariants & Traps

- **Zero Allocation**: Real-time pitch analysis frame processing must execute with zero heap allocations on the audio thread (`assert_no_alloc` in tests).
- **Concert-A Calibration**: Frequency reference tuning (A4 = 415Hz to 466Hz, default 440Hz) must interpolate smoothly without triggering buffer resets.
- **WASM Freshness**: Rust source changes require running `pnpm wasm:scoring` and verifying with `pnpm wasm:verify`.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

```bash
pnpm cargo:test --package scoring <filter>
pnpm wasm:scoring
pnpm wasm:verify
```
