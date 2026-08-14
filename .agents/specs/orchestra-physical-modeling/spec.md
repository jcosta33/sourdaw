---
type: spec
id: SPEC-orchestra-physical-modeling
title: Orchestra physical-modeling augmentation
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra physical-modeling augmentation

## Intent

Add continuous life to Orchestra's sampled core with optional physical-modeling
layers — bow/breath noise, sympathetic resonance, a parametric body-resonance
filter bank, and a low-level waveguide sustain — so sustained notes change
continuously under CC/MPE instead of looping a static sample. This is an
augmentation layer over samples, sequenced as a later phase.

## Non-goals

- Replacing the sample engine with full synthesis — samples remain the core
  timbre (`SPEC-orchestra`).
- Full FDTD / two-polarisation research models in real time — Lab/offline only
  (see Open questions).
- Sample-based vibrato and the expression model — owned by
  `SPEC-orchestra-expression-dynamics`.

## Requirements

### AC-001 — A bow/breath noise layer tracks dynamics

When dynamics rise on a sustaining note, the engine must raise the level of a
filtered noise layer (bow-on-string or air turbulence) mixed subtly below the
sample.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::physical::noise_layer_tracks_cc`

### AC-002 — Sympathetic resonance excites tuned resonators

When a note sounds, the engine must excite a bank of narrow resonators tuned to
the instrument's open-string frequencies, adding a subtle sympathetic tail.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::physical::sympathetic_resonance`

### AC-003 — A parametric body-resonance filter colors the output

When the body-resonance layer is enabled, the engine must apply a biquad
resonator bank whose center frequencies, gains, and bandwidths are adjustable.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::physical::body_resonance_bank`

### AC-004 — A waveguide sustain layer blends under samples

When the waveguide augmentation is enabled, the engine must blend a low-level
bowed/reed waveguide signal under the sustain so continuous CC/MPE input changes
the timbre between sample loop points.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::physical::waveguide_sustain_blend`

### AC-005 — Augmentation layers are individually bypassable with no residual cost

When a physical-modeling layer is disabled, the engine must produce output
identical to the sample-only path and add no per-block processing for that layer.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::physical::bypass_is_clean`

## Open questions

- [ ] (blocking) Which models ship real-time (velocity-dependent friction,
  parametric body bank) versus Lab-only (thermal friction, two-polarisation,
  FDTD brass)? The implementation phases must be fixed before build.
- [ ] (non-blocking) Body-resonance scaling across the string family by
  frequency-scaling a violin IR versus per-instrument measured banks.

## Affected areas

- `crates/daw-dsp/src/levain/physical/` (noise layer, sympathetic resonators,
  body bank, waveguide/reed models, modal synthesis)
- `crates/daw-dsp/src/` (shared delay lines, fractional interpolators,
  resonators)

## Dropped from sources

- The realism appendix's friction-model equations, body-mode tables, wind-bore
  models, and open-source codebase survey (NESS, STK, Faust) — design rationale
  and reference material for implementers; they inform the models but are not
  themselves requirements.
- Commuted synthesis as a specific optimization — an implementation technique
  behind AC-004's observable, not a separate requirement.
