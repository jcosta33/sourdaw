---
type: spec
id: SPEC-grinder-amp-family-voicing-phase-11
title: Grinder amp-family voicing — phase 11 (distinct preamp and power-tube families)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder amp-family voicing — phase 11 (distinct preamp and power-tube families)

## Intent

Make Grinder's amp-family choices feel like choosing a different rig voice rather than
nudging the same rig. Strengthen the voicing separation of the `ampModel` preamp
families and the `powerTubeType` power-tube families through verifiable ordering
relationships, without claiming exact commercial cloning.

## Non-goals

- Neural work.
- `inputMode` completion.
- Routing/cabinet expansion.
- UI redesign.
- Full circuit-accurate cloning of named amps.

## Requirements

### AC-001 — Power-tube families are not interchangeable

`powerTubeType` must produce measurably distinct driven-burst behavior, not just tiny
level changes.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — 6L6 keeps more headroom than EL84

Under the same driven-burst stimulus, 6L6 must preserve a meaningfully higher attack peak
/ lower compression than EL84.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — Rectifier and Lead JCM preamp families are not interchangeable

Under the same palm-muted high-gain stimulus, Rectifier and Lead JCM preamp voicings must
produce measurably different low-vs-edge balance.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Family voicing remains bounded and believable

The new separation must not collapse into gimmicky EQ caricatures or break existing
later-stage stability/control-truth coverage.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-005 — RT safety is preserved

The implementation must remain allocation-free and lock-free in `process_sample()`, with
all state preallocated inside the stage structs.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — Family voicing separation is directional, not just different

Under the same palm-muted high-gain stimulus, Rectifier-style settings must sound thicker
and lower-mid-heavier than Lead JCM-style settings, and Lead JCM-style settings must keep
more upper-mid bite and cut than Rectifier-style settings. The low-vs-edge difference of
AC-003 must run in this exact direction.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-007 — Existing Preamp and PowerAmp types are reused

The voicing-separation work must reuse the existing `Preamp` and `PowerAmp` types rather
than introducing parallel stage types.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

## Open questions

- None.

## Affected areas

- `crates/daw-dsp/src/grinder/triode.rs`
- `crates/daw-dsp/src/grinder/power_amp.rs`

## Dropped from sources

- Exact frequency-response or harmonic tables for named amps — rejected; Grinder is not
  accurate enough for that contract, so the phase commits to verifiable ordering instead.
- Subjective listening-only validation — rejected; burst/palm-muted regressions give
  durable coverage of dynamics and edge/body balance.
- The source's resolved open question — "After phase 11, is the higher-value next slice
  `inputMode` completion or another later-stage tone pass?" answered "`inputMode`
  completion is the cleaner next slice now that amp-family labels and power-tube families
  are no longer acting like near-interchangeable choices." Carried forward as the
  `inputMode` completion Non-goal rather than restated as an open question.
