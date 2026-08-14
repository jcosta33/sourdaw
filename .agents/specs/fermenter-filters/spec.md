---
type: spec
id: SPEC-fermenter-filters
title: Fermenter filter bank
status: done
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter filter bank

## Intent

Fermenter's filter bank gives each voice a selectable filter model — a clean
zero-delay-feedback state-variable filter plus analog emulations (Moog ladder,
diode ladder, MS-20, SEM, Curtis), digital RBJ biquads, and a formant filter —
with model-specific saturation placed pre-, in-, or post-loop. The filter models
ship today.

## Non-goals

- Drive/distortion as a standalone effect (`../fermenter-effects/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — The TPT/ZDF SVF stays stable at high resonance

When the state-variable filter runs at high resonance, the zero-delay-feedback
topology must remain stable and self-oscillate cleanly at cutoff.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::svf_zdf_stability`

### AC-002 — The SVF exposes simultaneous response outputs

When the SVF ticks, it must produce low-pass, band-pass, high-pass, notch, peak,
and allpass outputs from the same state.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::svf_outputs`

### AC-003 — The Moog ladder is 24 dB/oct and self-oscillates

When the Moog ladder filter runs, it must roll off at 24 dB/octave and
self-oscillate at maximum resonance.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::moog_ladder`

### AC-004 — Each analog model applies its characteristic nonlinearity

When an analog model is selected (Moog, diode, MS-20, SEM, Curtis), the filter
must apply that model's defined saturation shape.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::filter_model_nonlinearity`

### AC-005 — Digital biquads match the RBJ cookbook responses

When a digital filter band type is selected, its coefficients must match the RBJ
cookbook formula for that band type.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::rbj_biquads`

### AC-006 — The formant filter renders the selected vowel

When a vowel is selected, the formant filter must place its resonant peaks at
that vowel's formant frequencies.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::formant_vowels`

### AC-007 — Saturation placement changes resonance behavior

When drive placement is set pre-filter, in-loop, or post-filter, the resonance
and harmonic response must differ accordingly.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::filter_drive_placement`

### AC-008 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Should tape-style filter saturation model hysteresis, or
  stay with the pre-emphasis + soft-clip + post-LP approximation?

## Affected areas

- `crates/daw-dsp/src/fermenter/filters/`
- `src/modules/Fermenter/` (filter parameter bridge, model selector)

## Dropped from sources

- Full tape hysteresis modeling inside the filter loop — too heavy; the
  approximation ships instead.
