---
type: spec
id: SPEC-grinder-later-amp-stability-phase-6
title: Grinder later-amp stability — phase 6 (sample-rate stability and real power-amp bias)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
  - research.md
---

# Grinder later-amp stability — phase 6 (sample-rate stability and real power-amp bias)

## Intent

Make Grinder's later amp stages more believable under high gain: the preamp and power
amp keep their dynamic character and sample-rate stability while the `powerAmpBias`
expert control produces an audible, defensible change instead of decorative movement.

## Non-goals

- Neural model loading.
- Routing-mode completion.
- Cabinet-selection completion.
- A full circuit-solver rewrite.
- UI redesign or new user-facing controls.

## Requirements

### AC-001 — Power-amp bias is audibly real

Cold and hot `powerAmpBias` settings must produce an audible change in the power-stage
response rather than a near-zero difference.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — High-gain preamp remains sample-rate stable

A high-gain preamp scenario must produce reasonably similar output behavior at 48 kHz
and 96 kHz rather than diverging excessively.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — High-gain power amp remains sample-rate stable

A high-drive power-amp scenario must produce reasonably similar output behavior at 48 kHz
and 96 kHz rather than diverging excessively.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Later stages remain audibly active

The fix must not flatten the preamp or power amp into near-linear behavior; the stages
must still audibly shape the signal.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-005 — Existing dynamic behavior is preserved

Triode blocking/bias behavior and power-amp sag/feedback behavior must remain stateful
rather than being replaced by a plain static shaper.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — RT safety is preserved

The implementation must remain allocation-free and lock-free in `process_sample()`, with
all state preallocated inside the stage structs.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-007 — Power-amp bias stays within realistic bounds

The `powerAmpBias` effect must shape crossover feel and headroom without being so
exaggerated that the amp sounds gimmicky rather than realistic.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-008 — Bias change stays within a bounded range

The audible bias change (AC-001) must stay within a bounded range that preserves
believable amp character.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

## Open questions

- [ ] (non-blocking) After this phase, is the next higher-value move Neural delivery or
  routing/cab completion?

## Affected areas

- `crates/daw-dsp/src/grinder/triode.rs`
- `crates/daw-dsp/src/grinder/power_amp.rs`

## Dropped from sources

- New user-facing controls — rejected; the problem is stage credibility, not parameter
  count, so the change refines numerical treatment behind the existing contract.
- "Audible output exists" tests as the bar — rejected; the stages already passed that
  while allowing decorative controls, so sample-rate stability and bias audibility are
  used instead.
- Full topology rewrite — deferred; a bounded numerical improvement is preferred.
- Over-exaggerating the `powerAmpBias` fix — the source spec's tradeoffs/risks noted: "If
  the later-stage bias effect is exaggerated, the amp can feel gimmicky rather than
  realistic." This design tension is now captured as a requirement (AC-007) rather than
  left as a loose risk.
