---
type: spec
id: SPEC-fermenter-physical-modeling
title: Fermenter physical-modeling engine
status: done
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter physical-modeling engine

## Intent

Fermenter's physical-modeling engine is a Karplus-Strong plucked-string voice: a
noise-excited delay line tuned to pitch, with a feedback low-pass for natural
decay and allpass fractional-delay interpolation for accurate tuning. The basic
plucked-string voice ships today.

## Non-goals

- Full waveguide instruments (bowed, blown) beyond plucked-string.
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — Delay-line length tunes the string to pitch

When a note sounds, the delay-line length must be set to `sample_rate / freq` so
the resonant pitch matches the note.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::ks_tuning`

### AC-002 — Fractional tuning uses allpass interpolation

When the required delay is fractional, the engine must interpolate with a
Schroeder allpass so the pitch is accurate between integer delay lengths.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::ks_fractional_delay`

### AC-003 — A noise burst excites the string at note-on

When a note starts, the engine must fill the excitation region of the delay line
with a noise burst.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::ks_excitation`

### AC-004 — The feedback low-pass produces natural decay

When the string rings, the feedback path's one-pole low-pass must damp higher
harmonics faster than the fundamental, producing a natural decay.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::ks_decay`

### AC-005 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Should the excitation be selectable (noise vs filtered
  pluck shape) to widen the timbral range?

## Affected areas

- `crates/daw-dsp/src/fermenter/physical/karplus_strong.rs`
- `src/modules/Fermenter/` (physical-modeling parameter bridge)

## Dropped from sources

- Bowed/blown waveguide models — out of scope; this engine is plucked-string
  only.
