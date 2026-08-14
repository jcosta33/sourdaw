---
type: spec
id: SPEC-grinder-later-amp-voicing-phase-10
title: Grinder later-amp voicing — phase 10 (independent grid/coupling controls, real rectifier)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder later-amp voicing — phase 10 (independent grid/coupling controls, real rectifier)

## Intent

Make the later amp stages more believable under hard playing and make their remaining
expert controls map to distinct audible behaviors. In particular, split `gridConduction`
and `couplingCapCharge` so they stop sharing one internal state variable, and make
`rectifierType` audibly change sag/recovery under burst load.

## Non-goals

- Neural modal work.
- `inputMode` completion.
- Modular routing / graph work.
- Cabinet/IR import expansion.
- UI redesign.
- A full white-box circuit-solver rewrite.

## Requirements

### AC-001 — `gridConduction` is a real independent control

Changing `gridConduction` must alter preamp behavior through grid-current/drive
interaction rather than rewriting the same state variable owned by `couplingCapCharge`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — `couplingCapCharge` remains a distinct recovery control

Changing `couplingCapCharge` must alter blocking/recovery behavior independently from
`gridConduction`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — `rectifierType` is audibly real under burst load

Tube, solid-state, and variac rectifier modes must produce measurably different
sag/recovery behavior for the same driven-burst stimulus.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Later-stage anti-aliasing is improved in a bounded way

The later nonlinear amp stages must use a bounded real-time numerical improvement (a small
internal oversampled pass, 2x-style in magnitude rather than a full topology rewrite)
rather than staying single-rate brittle shapers.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-005 — Existing later-stage control truth is preserved

`powerAmpBias`, `presence`, `resonance`, `tubeBias`, `bright`, `fat`, `ampModel`, and
`powerTubeType` must remain audibly active after the retune.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — RT safety is preserved

The implementation must remain allocation-free and lock-free in `process_sample()`, with
all state preallocated inside the stage structs.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-007 — Differentiated controls stay amp-like, not exaggerated

The `gridConduction` and `rectifierType` differences must stay within an amp-like
calibration range so the result reads as a real amp rather than a gimmicky, exaggerated
effect — the audible spread must be measurable yet bounded, not extreme.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-008 — Cross-module Grinder regression and typecheck guard holds

The retune must not regress the Grinder frontend module or break types: existing Grinder
DSP and UI tests must continue to pass, and the project typecheck must stay clean.

Verify with: `pnpm test:run src/modules/Grinder` and `pnpm typecheck`

## Tradeoffs and risks

- A bounded oversampled pass improves brittleness and alias sensitivity but does not make Grinder a full circuit-accurate simulation.
- If `gridConduction` or rectifier differences are exaggerated, the result can feel gimmicky rather than amp-like.
- Later-stage tone quality is still broader than any single regression metric, so this phase should tighten the worst remaining gaps without claiming complete realism.

## Open questions

- [ ] (non-blocking) After this phase, is the next higher-value move `inputMode`
  completion or fuller external Neural fidelity?
- [ ] (restored detail) Implementation should keep the existing Koren-inspired triode
  structure and the sag/feedback structure of the power amp, differentiating the controls
  within those topologies rather than replacing them. Later-stage tests should drive
  burst and recovery stimuli (not steady sine), since those reveal sag/blocking behavior.

## Affected areas

- `crates/daw-dsp/src/grinder/triode.rs`
- `crates/daw-dsp/src/grinder/power_amp.rs`

## Dropped from sources

- New expert controls — rejected; the product already overpromises controls relative to
  behavior, so the phase differentiates existing ones instead of adding knobs.
- A full differential-equation solver rewrite — rejected; out of scope for a
  stabilization phase and not reviewable as an incremental delivery.
