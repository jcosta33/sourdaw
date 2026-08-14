---
type: spec
id: SPEC-fermenter-thermal-drift
title: Fermenter incommensurate thermal drift
status: draft
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter incommensurate thermal drift

## Intent

Give Fermenter's oscillators the pitch instability of real analog hardware: each
voice drifts ±2–5 cents from the sum of several independent drift generators
without low-order ratio locking, each voice independently seeded, so two voices
at the same pitch beat rather than cancel. This replaces the single shared LFO
sketch, which sounds like "digital with vibrato."

## Non-goals

- The oscillator waveforms themselves (`../fermenter-virtual-analog/spec.md`).
- LFO, envelope, and pitch modulation (`../fermenter-modulation/spec.md`) — drift
  is a separate, lowest modulation layer.

## Requirements

### AC-001 — Each voice sums at least three independent drift generators

When a voice drifts, its pitch offset must be the weighted sum of at least three
periodic generators, never a single LFO.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_generator_count`

### AC-002 — Drift frequencies avoid low-order rational locking

The default baseline drift frequency set must be `{0.05 Hz, 0.13 Hz, 0.31 Hz}`,
and each pair must satisfy `abs((f_high / f_low) / (p / q) - 1) > 0.005` for
every reduced ratio `p/q` whose positive integers `p` and `q` are no greater
than 8. This bounded low-order-ratio test is the operational meaning of
"incommensurate" here; finite decimal frequencies are not mathematically
irrational.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_incommensurate_ratios`

### AC-003 — Each voice carries an independent drift seed and phases

When two voices are allocated for the same note at the same time, each must have
a distinct `drift_seed` and therefore distinct initial drift phases.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_per_voice_seed`

### AC-004 — Per-voice frequency jitter perturbs the baseline set

When a voice initializes, its drift frequencies must be the baseline set scaled
by a per-voice jitter factor drawn from its seed.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_frequency_jitter`

### AC-005 — Drift amount scales total excursion to ±5 cents

When `drift_amount` is one, the peak drift excursion must reach ±5 cents.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_amount_scaling`

### AC-006 — Drift state is separate from other modulation

When other modulation is applied, the drift generators must remain separate
state, summed after user-accessible modulation, disableable only via
`drift_amount = 0`.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_independent_layer`

### AC-007 — Drift updates at control rate without allocating

When a block is processed, drift must update once per block (≤128 samples) from
per-voice phase accumulators, with no allocation or lock.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_rt_safe`

### AC-008 — Two same-pitch voices beat instead of cancelling

When two seeded voices hold the same note at `drift_amount = 1`, their inverted
mix must stay above −24 dB and show beating below 10 Hz, never dropping below
−60 dB.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_two_voice_beating`

### AC-009 — drift_amount = 0 is bit-deterministic

When `drift_amount` is zero, two voices at identical pitch, velocity, and reset
mode must produce bit-identical output over the first second.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_zero_deterministic`

### AC-010 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-011 — drift_amount = 0 frequency-locks voices

When `drift_amount` is zero, voices must be frequency-locked.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::drift_amount_scaling`

## Open questions

- [ ] (non-blocking) Should a fourth generator (~0.71 Hz) be included in the
  default set, or kept optional to save per-voice state?

## Affected areas

- `crates/daw-dsp/src/fermenter/` (per-voice `VoiceDrift`, oscillator pitch sum)
- `src/modules/Fermenter/` (drift-amount parameter bridge)

## Dropped from sources

- The illustrative single shared `drift_lfo = 0.3 Hz` path — must not ship as the
  default drift source; deleted or gated behind a disabled legacy flag.
- An FFT instantaneous-frequency analysis harness as a shipped runtime feature —
  it is a verification method (AC-008), not a product requirement.
