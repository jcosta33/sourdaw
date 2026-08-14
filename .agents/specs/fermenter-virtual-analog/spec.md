---
type: spec
id: SPEC-fermenter-virtual-analog
title: Fermenter virtual-analog engine
status: done
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter virtual-analog engine

## Intent

Fermenter's virtual-analog oscillator produces classic subtractive waveforms
(saw, square, triangle, pulse, sine) with band-limited discontinuities so they
stay alias-free across the keyboard, plus hard sync and per-voice phase-reset
behavior. The PolyBLEP path ships today.

## Non-goals

- The incommensurate analog drift model (`../fermenter-thermal-drift/spec.md`).
- Filters and saturation (`../fermenter-filters/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — Sawtooth is band-limited at its discontinuity

When a sawtooth plays, the oscillator must subtract a PolyBLEP residual at the
wrap point so the reset produces no audible aliasing.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::va_saw_blep`

### AC-002 — Pulse width is band-limited at both edges

When a pulse waveform plays, both edges must be band-limited (difference of two
band-limited saws) so a swept pulse width stays alias-free.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::va_pulse_blep`

### AC-003 — Each waveform produces its defined shape

When a waveform is selected, the oscillator must produce that waveform's
defined time-domain shape (saw, square, triangle, pulse, sine).

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::va_waveforms`

### AC-004 — Hard sync resets the slave on master wrap

When hard sync is enabled, the slave oscillator must reset its phase each time
the master completes a cycle.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::va_hard_sync`

### AC-005 — Phase reset mode is honoured at note-on

When phase-reset-on-note is enabled, a new note must start at phase zero.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::va_phase_reset`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-007 — Free-running phase is preserved when phase reset is disabled

When phase-reset-on-note is disabled, the oscillator must keep its free-running
phase across a new note.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::va_phase_reset`

## Open questions

- [ ] (non-blocking) Triangle currently uses a naive shape rather than an
  integrated band-limited square; does it alias audibly at high pitch?

## Affected areas

- `crates/daw-dsp/src/fermenter/oscillator.rs` (`PolyBlepOsc`)
- `src/modules/Fermenter/` (VA parameter bridge)

## Dropped from sources

- The MinBLEP oscillator path for high-quality hard sync and fast PWM — distinct
  unbuilt work tracked in `research.md` (R-002); PolyBLEP ships as the default.
- Per-voice drift — the single-LFO sketch in the source is illustrative only and
  is superseded by `../fermenter-thermal-drift/spec.md`.
