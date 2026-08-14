---
type: spec
id: SPEC-grinder-input-conditioning-phase-12
title: Grinder input conditioning — phase 12 (audible inputMode)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder input conditioning — phase 12 (audible inputMode)

## Intent

Make `inputMode` a real, audible input-conditioning choice in `InputConditioner` instead
of decorative patch metadata: `instrument`, `line`, and `reamp` sound like different
source paths into the amp, while staying subtle enough to read as front-end conditioning
rather than a fake extra pedal.

## Non-goals

- New Neural work.
- UI redesign.
- Broader later-stage amp retuning.
- Full pickup/cable/circuit simulation.
- New patch fields.

## Requirements

### AC-001 — `inputMode` is audibly real

The conditioner must respond to `inputMode` with measurably different output for the same
guitar-like stimulus.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — `instrument` stays more open than `reamp`

Under the same bright pick stimulus, `instrument` must preserve more attack/edge than
`reamp`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — `line` stays flatter and more padded than `instrument`

Under the same stimulus, `line` must not collapse to the same calibrated response as
`instrument`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Behavior stays bounded

Input-mode changes must remain in the category of front-end conditioning, not obvious
fake EQ gimmicks.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-005 — RT safety is preserved

`InputConditioner::process_sample()` must remain allocation-free and lock-free, with all
state preallocated inside the conditioner struct.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

## Open questions

- None. (Decided: patch/preset-level support is sufficient for this phase — the
  user-facing lie was the dead DSP contract, not a missing UI affordance; explicit UI
  exposure can be evaluated later as a discoverability improvement.)

## Affected areas

- `crates/daw-dsp/src/grinder/input.rs`
- `crates/daw-dsp/src/grinder/engine.rs`
- `src/modules/Grinder/useCases/grinderParamBridge/setGrinderParamWithAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`

## Dropped from sources

- Explicit `inputMode` UI affordance — deferred; the contract lie was the dead DSP path,
  and patch/preset-level support resolves it. UI exposure is a later discoverability call.
- Full pickup/cable/reamp-box modeling — out of scope; the change stays bounded front-end
  conditioning to remain believable.
