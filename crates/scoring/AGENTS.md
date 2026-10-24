# crates/scoring — Agent Guidelines

Reference-grade chromatic tuner and pitch detection DSP engine compiling to WebAssembly (`public/wasm/scoring/scoring.wasm`).

## Domain Ownership

- Owns tuner preprocessing, candidate/fallback integration, cents offset calculation, concert-A
  calibration, stabilization and polyphonic scheduling.
- Reuses `daw_dsp::primitives::pitch` for YIN/MPM detection. The shared primitive owns difference
  producers, CMND, candidate policies, interpolation and detector scratch; `scoring::yin` and
  `scoring::mpm` retain compatibility exports. Mono analysis uses `YinDetector::detect_with_mpm` to
  share exactly one autocorrelation without exposing mutable scratch.
- Compiles via `wasm-pack` (`pnpm wasm:scoring`) and generates worklet glue via `scripts/gen-scoring-worklet.ts`.
- Does not own tuner UI presentation (`src/modules/Tuner`) or WebAudio node graph lifecycle (`AudioEngine`).

## Invariants & Traps

- **Zero Allocation**: Real-time pitch analysis frame processing must execute with zero heap allocations on the audio thread (`assert_no_alloc` in tests).
- **Concert-A Calibration**: Frequency reference tuning (A4 = 415Hz to 466Hz, default 440Hz) must interpolate smoothly without triggering buffer resets.
- **WASM Freshness**: Rust source changes require running `pnpm wasm:scoring` and verifying with `pnpm wasm:verify`.

## Verification

```bash
cargo test --package scoring
pnpm wasm:scoring
pnpm wasm:verify
```
