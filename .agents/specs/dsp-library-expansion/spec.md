---
type: spec
id: SPEC-dsp-library-expansion
title: DSP library expansion — analog modeling and primitives
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# DSP library expansion — analog modeling and primitives

## Intent

Expand `daw-dsp` beyond standard SVF filters and linear envelopes with analog-accurate
models and missing primitives shared across instruments: zero-delay-feedback ladder
filters, capacitor-curve envelopes, anti-aliased oscillators, a permissively-licensed
time-stretch engine behind one trait, shared pitch detection, and FFT-based
linear-phase EQ / partitioned-convolution reverb / look-ahead limiter — plus a
build-time FAUST→Rust pipeline for reference DSP.

## Non-goals

- Plugin hosting and sandboxing (see `plugin-hosting-clap`).
- Instrument-specific feature work (Fermenter spectral morph, drum engines) — those are
  deferred gaps against their own features.
- Browser-side native-node offloading (see `browser-dsp-offload`).

## Requirements

### AC-001 — ZDF ladder filters

Zero-delay-feedback Moog and MS-20 ladder filter models (Newton-Raphson solved) must
exist as DSP nodes without high-frequency cramping.

Verify with: `pnpm cargo:test -- -p daw-dsp zdf_ladder`

### AC-002 — Analog envelope and oscillator primitives

Capacitor-charge (RC) envelope curves and MinBLEP/PolyBLEP anti-aliased oscillators
must be available as primitives.

Verify with: `pnpm cargo:test -- -p daw-dsp analog_primitives`

### AC-003 — One time-stretch trait, permissive license

A single `TimeStretch` trait must be the sole entry point for warp/stretch; no GPL
stretch dependency is imported for shipping code.

Verify with: `pnpm cargo:test -- -p daw-dsp time_stretch_trait`

### AC-004 — Shared pitch-detection primitive

One pitch-detection implementation must be shared by Knead, legato heuristics, and
tuning tools, with ≤3 cents median error on the reference vocal fixture.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch_detection_accuracy`

### AC-005 — Linear-phase EQ, convolution reverb, look-ahead limiter

FFT-based linear-phase EQ, non-uniform partitioned-convolution reverb, and a
look-ahead limiter must each exist and pass `assert_no_alloc` on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-dsp dsp_primitives_no_alloc`

### AC-006 — FAUST→Rust build pipeline

A build-time pipeline must compile reference `.dsp` sources to checked-in Rust; a
regen task leaves `git diff` empty on a machine with FAUST installed, and Sourdaw
builds without FAUST installed.

Verify with: `cargo xtask faust:regen`

## Open questions

- [ ] (non-blocking) Time-stretch backend choice (signalsmith-stretch vs clean-room
  WSOLA/phase-vocoder) pending license review. Resolve during implementation.

## Affected areas

- `crates/daw-dsp/` (filters, envelopes, oscillators, stretch, pitch, EQ/reverb/limiter)
- `crates/daw-dsp/faust/` and an `xtask` regen target

## Dropped from sources

- `mi-plaits-dsp-rs` adoption as a flagship synth backbone — tracked as a deferred gap
  against `fermenter`/instrument work, not this primitives spec.
