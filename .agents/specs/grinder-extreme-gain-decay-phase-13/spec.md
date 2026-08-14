---
type: spec
id: SPEC-grinder-extreme-gain-decay-phase-13
title: Grinder extreme-gain decay — phase 13 (smoother high-gain tails, intact attack)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder extreme-gain decay — phase 13 (smoother high-gain tails, intact attack)

## Intent

Reduce brittle, edge-heavy decay behavior in the later amp stages under extreme-gain
material without flattening the initial pick attack or breaking the existing
family-ordering regressions. The smoothing must read as later-stage damping/recovery,
not a static low-pass glued onto the output.

## Non-goals

- Neural expansion.
- UI redesign.
- New patch fields.
- Full circuit-solver rewrite.
- Arbitrary modular routing work.

## Requirements

### AC-001 — Extreme-gain preamp decay smooths after the attack

Under high gain, later-stage preamp output must retain less edge-heavy content in the
later tail than during the earlier sustain window.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — Extreme-gain power-stage decay smooths after the attack

Under high gain, later-stage power-amp output must retain less edge-heavy content in the
later tail than during the earlier sustain window.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — Attack stays intact

The smoothing pass must not dull the whole amp; the early attack must remain materially
stronger/brighter than the later tail.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Existing family ordering survives

Rectifier vs Lead JCM and 6L6 vs EL84 ordering regressions must remain green.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-005 — Behavior stays bounded

The pass must read as later-stage damping/recovery (dynamic), not a blunt static low-pass
cut on the output.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — RT safety is preserved

No allocation or locking in sample processing; any new state must be preallocated.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-007 — Smoothing reuses existing later-stage structs and state

The smoothing pass must reuse the existing later-stage structs and their state rather
than introducing new parallel stage machinery.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-008 — High-gain families keep their denser feel

Under high gain, rectifier/high-gain families must retain their characteristically
denser feel and must not collapse into thin, fizzy tails after the smoothing pass.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-009 — Smoothing is materially effective

The smoothing must measurably reduce later-tail edge energy under extreme-gain material,
not merely perturb the DSP while leaving the user-facing fizz essentially intact.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

## Open questions

- None.

## Affected areas

- `crates/daw-dsp/src/grinder/triode.rs`
- `crates/daw-dsp/src/grinder/power_amp.rs`

## Dropped from sources

- Blunt static EQ cuts — rejected in favor of dynamic damping/recovery behavior, so the
  amp keeps pick definition rather than feeling dead.
