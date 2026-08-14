---
type: spec
id: SPEC-fermenter-effects
title: Fermenter effects engine
status: in-progress
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter effects engine

## Intent

Fermenter's effects lanes host reverbs (Dattorro plate, feedback delay network),
delay, distortion, modulation effects (chorus/flanger/phaser), dynamics
(compressor, true-peak limiter), EQ, and stereo width. The plate and FDN reverbs
and the compressor ship; the remaining effects and oversampled distortion are the
outstanding work.

## Non-goals

- Filter-stage saturation (`../fermenter-filters/spec.md`).
- GPU convolution reverb tails (`../fermenter-gpu-compute/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — The Dattorro plate reverb scales delays to the running sample rate

When the plate reverb runs at any sample rate, its delay lengths must be the
29761 Hz reference lengths rescaled to the current sample rate.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::dattorro_delay_scaling`

### AC-002 — The FDN reverb feedback matrix is energy-preserving

When the FDN reverb runs, its feedback junction must use an orthogonal
(Hadamard/Householder) matrix so the network does not gain energy.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::fdn_orthogonal_matrix`

### AC-003 — Stereo delay crossfades read heads on time change

When delay time changes, the stereo delay must crossfade read heads.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::stereo_delay`

### AC-004 — Distortion oversamples around the nonlinearity

When a distortion mode runs, the nonlinearity must be applied at 2× oversampling
with halfband filtering to suppress aliasing.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::distortion_oversampling`

### AC-005 — The compressor applies a soft-knee static curve

When the compressor processes a signal above threshold, gain reduction must
follow the ratio with quadratic soft-knee interpolation around the knee.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::compressor_soft_knee`

### AC-006 — The limiter catches inter-sample peaks with lookahead

When the limiter runs, it must detect true (inter-sample) peaks via oversampling
and delay the audio path by the lookahead window.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::limiter_true_peak`

### AC-007 — Stereo width scales the side signal

When width is changed, the processor must scale the mid/side side component so
width zero is mono and width above one widens.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::stereo_width`

### AC-008 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-009 — Stereo delay cross-feeds between channels

The stereo delay's cross-feedback must route each channel's output into the
other's feedback.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::stereo_delay`

## Open questions

- [ ] (non-blocking) Should oversampling be a per-effect quality toggle, tied to
  drive amount, as Serum exposes it?

## Affected areas

- `crates/daw-dsp/src/fermenter/effects/`
- `src/modules/Fermenter/` (FX lane parameter bridge)

## Dropped from sources

- GPU partitioned convolution reverb — tracked in
  `../fermenter-gpu-compute/spec.md`.
