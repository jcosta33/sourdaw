---
type: spec
id: SPEC-fermenter-additive
title: Fermenter additive engine
status: in-progress
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter additive engine

## Intent

Fermenter's additive engine sums up to 512 sinusoidal partials per voice with
per-partial amplitude, a brightness rolloff, and a harmonicity exponent that
bends partials toward inharmonic spectra. The CPU partial bank ships; the GPU
offload path for high partial counts is deferred.

## Non-goals

- GPU additive synthesis (`../fermenter-gpu-compute/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — Partials sum at integer multiples of the fundamental

When harmonicity is one, partial `n` must sound at `(n+1)` times the fundamental
frequency.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::additive_harmonics`

### AC-002 — Partials above Nyquist are dropped

When a partial's frequency reaches or exceeds Nyquist, the engine must stop
adding higher partials so no aliasing is produced.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::additive_nyquist_limit`

### AC-003 — The harmonicity exponent bends partials inharmonic

When harmonicity differs from one, partial frequencies must follow
`f0 * (n+1)^harmonicity`, shifting the spectrum inharmonic.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::additive_harmonicity`

### AC-004 — Brightness attenuates higher partials

When brightness increases, higher-indexed partials must be progressively
attenuated by the exponential brightness scale.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::additive_brightness`

### AC-005 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Should the CPU path adopt the recursive sin/cos oscillator
  update to cut `sin()` calls before GPU offload is built?

## Affected areas

- `crates/daw-dsp/src/fermenter/additive.rs`
- `src/modules/Fermenter/` (additive parameter bridge)

## Dropped from sources

- IFFT-based block-wise additive synthesis — an alternative implementation
  technique; the direct partial bank is the shipped path.
- GPU additive offload for `partials × block_size > ~8192` — tracked in
  `../fermenter-gpu-compute/spec.md`.
