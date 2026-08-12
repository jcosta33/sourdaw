# Time-stretch seed baseline

Frozen repository: `origin/main@0518a84671dcabe58ddaa7b0f57319296dfe5663` (tree `5cd1749a34f7cb1ec98a06b8042ff1b1ba6d3005`). This ledger inventories only the current Crumbs repitch, phase-vocoder, and WSOLA seeds. It does not accept an engine, change product selection, or claim a time-stretch specification AC.

## Implementation and caller census

| Seed | Frozen definition and public shape | Frozen callers/bindings | Identity and parameters | Allocation and lifecycle |
|---|---|---|---|---|
| Repitch helpers | `crates/daw-dsp/src/crumbs/warp/repitch.rs`: public `semitones_to_ratio(f32) -> f64`, `cents_to_ratio(f32) -> f64`, `ratio_to_semitones(f64) -> f32`, and `bpm_match_ratio(f32, f32) -> f64` | No Rust/native/WASM/TypeScript call at the frozen base. Public only through `daw_dsp::crumbs::warp::repitch`; Crumbs has no `wasm_bindgen` surface. This task adds test-only calls in `tests/time_stretch_contract.rs`. | Name/comment identity only; there is no serialized or binding algorithm ID in this file. Semitone/cents conversion accepts every `f32`; `ratio_to_semitones` accepts every `f64`; BPM matching returns `1.0` when original BPM is non-positive and otherwise returns `target/original` without further validation. | Stateless pure arithmetic; no explicit heap allocation, channel state, reset, latency, tail, bypass, or sample-rate input. It is not a streaming resampler implementation. |
| Phase vocoder seed | `crates/daw-dsp/src/crumbs/warp/phase_vocoder.rs`: public `PhaseVocoder::{new, process}`; IPL-labelled offline DFT with `FFT_SIZE_PV=2048`, analysis hop `512`, 1025 bins, Hann window | No caller outside its definition at the frozen base. No native command, WASM export, or TypeScript binding. This task adds the bounded test-only characterization caller in `tests/time_stretch_contract.rs`. | Name/comment identity only. `process(input, ratio)` uses the legacy inverse duration ratio: above `1.0` is longer/slower. Inputs shorter than 2048 frames or ratios `<=0` are copied unchanged; finite input and finite ratio are not otherwise validated. | `new` performs six non-empty vector allocations: window plus previous phase, synthesis phase, magnitude, frequency, and peak-flag workspaces. For a normal process with `N` analysis frames, `analyze` allocates its outer vector and `N` frame vectors, then processing allocates output and window-sum vectors (`N+3` process allocations); early returns allocate an input copy. Whole-buffer mono only; sample rate is unrepresented. Phase arrays reset at each normal `process`, but there is no public discontinuity/reset contract, declared latency, finite-tail contract, bypass, or RT proof. Output length is `(N-1)*max(1,floor(512*ratio))+2048`. |
| WSOLA seed | `crates/daw-dsp/src/crumbs/warp/wsola.rs`: public `WsolaProcessor::{new, process}`; frame length 1024, overlap 512, search tolerance 256, Hann window | No caller outside its definition at the frozen base. No native command, WASM export, or TypeScript binding. This task adds the bounded test-only characterization caller in `tests/time_stretch_contract.rs`. | Name/comment identity only. `process(input, ratio)` uses the legacy inverse duration ratio: above `1.0` is longer/slower. Inputs shorter than 1024 frames or ratios `<=0` are copied unchanged; finite input and finite ratio are not otherwise validated. | `new` allocates one 1024-sample window. A normal call allocates one output vector of `floor(input_frames*ratio)` samples; an early return allocates an input copy. Whole-buffer mono only; sample rate is unrepresented. Per-call analysis/synthesis positions are local, but there is no public discontinuity/reset contract, declared latency, finite-tail contract, bypass, or RT proof. Correlation search is bounded by the fixed 256-frame tolerance but the whole-buffer loop is not an audio-render callback. |

Frozen-base exact search:

```text
git grep -n -e PhaseVocoder -e WsolaProcessor -e semitones_to_ratio -e cents_to_ratio -e ratio_to_semitones -e bpm_match_ratio 0518a84671dcabe58ddaa7b0f57319296dfe5663 -- ':!crates/daw-dsp/src/crumbs/warp/phase_vocoder.rs' ':!crates/daw-dsp/src/crumbs/warp/wsola.rs' ':!crates/daw-dsp/src/crumbs/warp/repitch.rs'
```

The only matches are prose occurrences of `cents_to_ratio`, `WSOLA`, and `PhaseVocoder` in project specifications; no code caller exists. `git grep -n wasm_bindgen 0518a84671dcabe58ddaa7b0f57319296dfe5663 -- crates/daw-dsp/src/crumbs` is empty. Final-state exact search must show only the seed definitions and this task's integration-test characterization calls. The new `primitives::time_stretch` surface must likewise have no caller outside its own module and `tests/time_stretch_contract.rs`.

## Tests and assets

The frozen base has no test, fixture directory, checked-in asset, generated asset, latency/reset/channel contract, or allocation assertion for these three files. This task adds only the seven manifest entries under this directory:

| Path | Bytes | SHA-256 |
|---|---:|---|
| `canonical/mono_440hz.f32le` | 768000 | `2f0f3fc39f5b0988f8b7cb1f4d78f2c35896609c7a426e2ab73baa3623c3ed55` |
| `canonical/mono_880hz.f32le` | 768000 | `825b624e6835de54aface6b87ecd0617c7f9e456a27500d5a46981a1f70a8688` |
| `canonical/stereo_440_880hz.f32le` | 1536000 | `14b76599eeef3bf352d54c5b8800ece9f220eb8d513d725f6833b1f8e0a792ec` |
| `canonical/percussive_16_attacks.f32le` | 768000 | `c8da5e0c3f4728a29dc78a63cbf9280aca3a415a7fc1071a12c6ca0730d99629` |
| `characterization/crumbs_input_4096.f32le` | 16384 | `97131ca3e9be54adc39a9c87a9a377e1545880bfe2e43c7551c02723d8cf35d5` |
| `characterization/phase_vocoder_duration_ratio_1_25.f32le` | 18432 | `bb8849bba547dbd115b978b9574a93032f78e117a50d9d4a345ac0e708f2ca2c` |
| `characterization/wsola_duration_ratio_1_25.f32le` | 20480 | `8a0679ff8613be3d7c121010162ee5e99dd1ba4d39b042ce2ad7e9a280e80654` |

Encoding is raw frame-interleaved IEEE-754 `f32` little-endian. `manifest.json` records every sample rate, channel count, frame count, formula, role, digest, and verification policy. Every target verifies the seven checked-in byte streams against their manifest SHA-256 digests, frame/channel shapes, finite samples, and generated samples within a maximum absolute difference of `0.00005`. Only the phase-vocoder characterization output has a fixture-local `0.00035` allowance for its measured `0.00029724836` delta between debug and optimized release builds on the reference target.

Exact-byte regeneration is deliberately narrower because Rust does not promise bit-portable results for the `f32` transcendental functions used by the synthetic formulas and the frozen Crumbs seeds. The sole reference-generation environment is `aarch64-apple-darwin`, `rustc 1.97.0-nightly` commit `17584a181979f04f2aaad867332c22db1caa511a`, macOS `26.5.2`, Apple M4 Pro. The ordinary test performs two independent generations only when all six environment fields match, then requires both byte streams and digests to match each other, the manifest, and the checked-in corpus. The ignored `regenerate_time_stretch_fixtures` test hard-fails before writing on every other environment; non-reference targets never claim exact regeneration.

All samples are original in-house synthetic signals produced from the recorded formulas. No external recording, copied fixture, reference corpus, third-party stretch implementation, runtime-generated asset, or new dependency is introduced. The workspace package declares no license in Cargo metadata. Existing test dependencies used by this packet report: `assert_no_alloc 1.1.2` — `BSD-1-Clause`; `serde 1.0.229` and `serde_json 1.0.150` — `MIT OR Apache-2.0`. The production contract itself uses only Rust `std`; the Crumbs seeds use only `std` plus constants from their own `crumbs::types` module.

## Nonbinding characterization timing

One hardware-labelled observation was captured solely to expose the seed cost; it is not a realtime claim, hardware matrix, promotion threshold, or substitute for the performance specification:

```text
{"duration_ratio":1.25,"hardware":"Apple M4 Pro; macOS 26.5.2; arm64","input_frames":4096,"phase_vocoder_median_us":96797,"profile":"release","runs":5,"wsola_median_us":1230}
```

The ignored `time_stretch_crumbs_characterization_cpu` test produced the observation. No warmup/run policy or acceptance threshold is asserted here; those remain exclusively owned by `SPEC-performance-contracts-and-profiling.md`.
