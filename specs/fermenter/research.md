---
type: research
id: RESEARCH-fermenter
title: Fermenter outstanding synthesis features
status: open
owner: The Sourdaw team
sources:
  - ../intake/spec-of-the-gaps.md
  - ../intake/implementation-gaps.md
---

# Research: Fermenter outstanding synthesis features

## Question

Fermenter ships its core hybrid-synth architecture (LayerStack, MacroStrip,
wavetable playback, the basic VA / FM / additive / granular / sampler / physical
engines, the filter bank, the Dattorro/FDN reverbs, and the compressor). Which
advanced features from the original master-synth research remain unimplemented,
and how should each be built without breaking the audio-thread RT-safety
contract?

## Findings

### R-001 — Advanced spectral morph modes are missing

- **Claim:** The DSP backend implements only a subset of warp modes (`Sync`,
  `Quantize`, `Squeeze`, `Bend`, `Formant`, `Fold`). The eleven Vital-style
  spectral/wave morph modes — Vocode, Formant Scale, Harmonic Stretch,
  Inharmonic Stretch, Smear, Random Amplitudes, spectral Low/High Pass, Phase
  Disperse, Shepard Tone, and Spectral Time Skew — are not yet present.
- **Evidence:** `crates/daw-dsp/src/fermenter/spectral.rs` warp-mode enum;
  morph algorithms catalogued in the gaps research.
- **Confidence:** high
- **Bears on:** SPEC-fermenter-spectral-warp (existing spec).

### R-002 — The MinBLEP oscillator path is missing

- **Claim:** Only `PolyBlepOsc` exists for virtual-analog oscillators. MinBLEP
  (a precomputed minimum-phase bandlimited step) is preferable for hard sync
  with frequent resets, arbitrary discontinuous waveforms, and fast-modulated
  PWM, and has no implementation.
- **Evidence:** `crates/daw-dsp/src/fermenter/oscillator.rs`; gaps research §2.
- **Confidence:** high
- **Bears on:** SPEC-fermenter-virtual-analog (deferred hard-sync quality).

### R-003 — GPU compute workloads have no implementation

- **Claim:** No `wgpu` / compute-shader code exists. GPU FFT spectrum analysis,
  GPU additive synthesis, partitioned GPU convolution tails, and visualization
  shaders (oscilloscope, spectrum, wavetable 3D, mod rings) are all unbuilt.
- **Evidence:** absence across `crates/daw-dsp` and `crates/daw-engine`; gaps
  research §3.
- **Confidence:** high
- **Bears on:** SPEC-fermenter-gpu-compute.

### R-004 — Advanced modulation structure is partial

- **Claim:** Basic modulation routing exists (e.g. `ModDest::ReverbMix`), but
  modulation dependency ordering (meta-modulation), audio-rate modulation, and a
  dedicated Modulation Dock UI are missing in Fermenter (the dock currently
  exists only in the `Bacteria` module).
- **Evidence:** gaps research §4.
- **Confidence:** medium
- **Bears on:** SPEC-fermenter-modulation.

### R-005 — The unified block UI and context inspector are partial

- **Claim:** The frontend ships `MacroStrip` and `LayerStack`, but the unified
  five-block interface (Play & Macros / Generators & Layers / Mix & Modulation /
  Routing & FX / Advanced & Lab), a stable center context inspector, guided
  empty-state flows, and per-layer bounce/freeze are not complete.
- **Evidence:** `src/modules/Fermenter/presentations/`; gaps research §5.
- **Confidence:** medium
- **Bears on:** SPEC-fermenter-ui.

### R-006 — The AI preset pipeline is missing

- **Claim:** No AI preset generation or auto-tagging exists. The quality
  classifier (64-feature MLP via ONNX), spectral-feature auto-tagging,
  text-to-preset, and preset morphing are unimplemented.
- **Evidence:** absence in codebase; gaps research §6.
- **Confidence:** high
- **Bears on:** SPEC-fermenter-ai-presets.

### R-007 — Analog drift needs incommensurate per-voice generators

- **Claim:** A single shared sinusoidal drift LFO produces "digital with
  vibrato," not analog character. Convincing analog drift requires at least
  three per-voice drift generators at pairwise-incommensurate frequencies, each
  voice independently seeded, so two same-pitch voices beat rather than cancel.
- **Evidence:** master-synth spec §2.2 normative requirement (now lifted into
  SPEC-fermenter-thermal-drift).
- **Confidence:** high
- **Bears on:** SPEC-fermenter-thermal-drift.

### R-008 — RT-safe spectral warps depend on a bounded table-update cadence

- **Claim:** Frequency-domain warps and inverse FFTs are too expensive per
  sample, but stay RT-safe when recomputed only at a bounded table-update
  cadence (e.g. every 16 samples native / 64–128 on WASM) with plain table
  lookup between updates. This is what lets warp amount be modulated at audio
  rate without blowing the audio-thread budget.
- **Evidence:** master-synth spec wavetable §"Table Update Scheduling".
- **Confidence:** high
- **Bears on:** SPEC-fermenter-wavetable, SPEC-fermenter-spectral-warp.

## Open questions

- [ ] Q-001 — What table-update cadence best balances morph responsiveness
  against CPU on WASM (bears on R-008, the wavetable and spectral-warp specs)?
- [ ] Q-002 — Should meta-modulation cycles be broken by a one-block delay or
  disallowed in the UI (bears on R-004)?
- [ ] Q-003 — Does GPU compute earn its transfer overhead for spectrum analysis
  at the FFT sizes Fermenter actually uses, or only for additive at high partial
  counts (bears on R-003)?

## Recommendation

Sequence the unbuilt work by RT risk and user payoff: land the spectral morph
modes (R-001, R-008) and incommensurate drift (R-007) first because they are
audible quality wins inside the existing engine; treat GPU compute (R-003) and
the AI preset pipeline (R-006) as optional, quality-gated layers that must fall
back to CPU / manual workflows; and stage the modulation depth (R-004) and the
unified UI (R-005) behind the patch format, which already supports them.
