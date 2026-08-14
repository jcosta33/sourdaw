---
type: spec
id: SPEC-fermenter-fm-synthesis
title: Fermenter FM / phase-modulation engine
status: in-progress
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter FM / phase-modulation engine

## Intent

Fermenter's FM engine is a six-operator phase-modulation synth in the DX7
lineage: operators modulate each other through a routing matrix, each with its
own envelope, key scaling, and feedback. The basic engine sounds; the full 32
DX7 algorithm set and the arbitrary operator routing matrix are the remaining
work.

## Non-goals

- Classic-synth preset templates (`../fermenter-presets/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — Operators use phase modulation, not frequency modulation

When an operator modulates a carrier, the carrier must add the modulator output
to its phase (PM), so pitch stays correct regardless of modulator frequency.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::fm_is_phase_modulation`

### AC-002 — Each of the 32 DX7 algorithms routes operators as defined

When a DX7 algorithm is selected, the engine must connect the six operators per
that algorithm's modulator-to-carrier map.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::dx7_algorithms`

### AC-003 — An arbitrary operator routing matrix overrides the preset algorithm

When a custom routing matrix is supplied, the engine must route operators by the
matrix instead of a fixed algorithm.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::fm_custom_routing`

### AC-004 — Operator feedback uses a one-sample delay and stays bounded

When an operator feeds back, it must use a one-sample-delayed output and remain
stable across the feedback range.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::fm_feedback`

### AC-005 — Carriers are summed to the voice output

When a voice renders, only operators with no outgoing modulation edge (the
carriers) must be summed into the output.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::fm_carrier_sum`

### AC-006 — Key scaling attenuates operator level across the keyboard

When a note is played away from an operator's key-scale break point, the
operator level must scale by its left/right key-scale slopes.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::fm_key_scaling`

### AC-007 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Should the DX-style envelope rates exactly match the DX7
  rate-to-time curve, or use a perceptually-tuned approximation?

## Affected areas

- `crates/daw-dsp/src/fermenter/` (FM operators, routing, DX envelopes)
- `src/modules/Fermenter/` (FM parameter bridge, algorithm selector)

## Dropped from sources

- Operator oversampling for "hot" feedback — deferred; feedback is clamped to a
  safe range instead.
- Fixed-frequency (non-ratio) operator mode beyond the basic toggle.
