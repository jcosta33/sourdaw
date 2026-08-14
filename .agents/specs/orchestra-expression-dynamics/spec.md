---
type: spec
id: SPEC-orchestra-expression-dynamics
title: Orchestra expression and dynamics
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Orchestra expression and dynamics

## Intent

Give Orchestra the professional orchestral expression model — velocity as attack
character, CC1 as sustained dynamic, CC11 as volume — with continuous,
artifact-free crossfading between dynamic layers, controllable vibrato, and
per-note humanization so sampled playback reads as a live performance.

## Non-goals

- The dynamic-layer sample assets themselves (asset work).
- Physical-modeling vibrato/SEM augmentation — owned by
  `SPEC-orchestra-physical-modeling`.
- Ensemble-intelligence behaviors (auto-divisi, pitch convergence) — owned by
  `SPEC-orchestra-performance-intelligence`.

## Requirements

### AC-001 — CC1 drives the sustained dynamic layer, not velocity

When CC1 changes on a sustaining note, the engine must move the blended dynamic
layer to track CC1 while velocity continues to govern only the attack character.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::expression::cc1_drives_dynamic`

### AC-002 — Dynamic-layer crossfade is equal-power

When CC1 moves between two adjacent dynamic layers, the engine must blend them
with an equal-power curve (`g0 = cos(π/2·a)`, `g1 = sin(π/2·a)`) so there is no
perceived volume dip.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::expression::equal_power_crossfade`

### AC-003 — CC11 scales volume without changing the dynamic layer

When CC11 changes, the engine must scale output level while leaving the selected
dynamic layer (timbre) unchanged.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::expression::cc11_volume_only`

### AC-004 — Layer crossfade is time-smoothed

When CC1 jumps, the engine must ramp the layer crossfade over a bounded time
(50–200 ms) rather than switching layers within a single block.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::expression::crossfade_smoothing`

### AC-005 — Vibrato depth is CC-controllable with onset delay

When the vibrato-depth CC is raised on a held note, the engine must increase
vibrato depth, applying it only after the configured onset delay from note
start.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::expression::vibrato_onset`

### AC-006 — Humanization is a single scaled, seeded control

When the Humanize amount is set, the engine must apply per-note timing, tuning,
dynamic, and vibrato variation scaled by that one control, and reproduce the
identical variation for a fixed seed.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::humanize::seeded_deterministic`

### AC-007 — MPE per-note expression maps to intonation, dynamics, and timbre

When MPE per-note pitch, pressure, and timbre (CC74) arrive, the engine must
route them per voice to intonation, dynamic/bow-breath, and brightness
respectively.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::expression::mpe_per_note`

## Open questions

- [ ] (non-blocking) Default crossfade width (overlap %) between adjacent dynamic
  layers — fixed (10–30%) or per-instrument from layer count?
- [ ] (non-blocking) Which CC carries vibrato depth by default (CC2 vs a
  dedicated CC) and is it user-remappable?

## Affected areas

- `crates/daw-dsp/src/levain/expression/` (CC1/CC11/velocity model, dynamic
  crossfade, MPE routing)
- `crates/daw-dsp/src/levain/humanize/` (seeded per-note variation)

## Dropped from sources

- Section-size scaling by player multiplication (solo→large) — moved to
  `SPEC-orchestra-performance-intelligence` with the ensemble-realism behaviors
  it shares parameters with.
- Spectral-envelope modulation (SEM) as a resynthesis effect — physical-modeling
  augmentation, in `SPEC-orchestra-physical-modeling`.
