---
type: spec
id: SPEC-grinder-stabilization-phase-2
title: Grinder stabilization — phase 2 (overdrive, gate depth, honest Neural tab, metal preset)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder stabilization — phase 2 (overdrive, gate depth, honest Neural tab, metal preset)

## Intent

Make Grinder materially more usable as a guitar amp through a bounded stabilization
pass: the overdrive behaves like a controllable front-end boost instead of a chaos
generator, the enabled gate clamps idle noise more decisively, the Neural tab stops
duplicating its own Engine Mode copy, and the preset list gains a believable
metal-voiced starting point.

## Non-goals

- True oversampling or a full anti-aliasing architecture across every nonlinear stage.
- Real Neural model loading.
- Wiring cabinet mic distance, room, or routing placeholders to DSP.
- Investigating Arrangement clip-alignment precision.
- Rebuilding the full Grinder UI layout.

## Requirements

### AC-001 — Overdrive stays in a usable loudness range

When overdrive is set to moderate values, the pedal output must remain within a sane
loudness ratio relative to the bypassed path.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — Overdrive still changes tone audibly

When overdrive is enabled, the recalibrated pedal must still audibly change the signal
path and must not collapse into a no-op.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — Gate closes more decisively when enabled

When the gate is enabled, the DSP gate must reach a substantially lower closed-gain
floor than the prior soft-expander behavior, asserted directly via `NoiseGate::gain()`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Metal preset coverage exists

Grinder must expose at least one dedicated metal preset category entry combining gate,
high-gain amp, and a restrained front-end overdrive.

Verify with: `pnpm test:run -- grinderPresets`

### AC-005 — Neural tab stops duplicating Engine Mode copy

The Neural hero area must not render the same `ENGINE_MODES` labels and descriptions
that already appear in the Neural Control Deck.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-006 — Neural UI copy is honest about the implementation

The Neural panel should present routing and status information without implying that
model-library selection loads distinct DSP assets when it does not.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-007 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-009 — Grinder UI changes stay inside the Grinder presentation layer

This change must preserve current module boundaries: all Grinder UI edits must remain
inside the Grinder presentation layer and must not relocate behavior across module roots.

Verify with: `pnpm deps:validate`

### AC-010 — New test files live under existing `__tests__/` folders

Any new test files added by this change must reside under an existing `__tests__/`
folder rather than introducing a new test-location convention.

Verify with: `pnpm test:run -- grinderPresets GrinderPanel`

### AC-008 — Low-drive overdrive permits near-unity output

When overdrive is set to low-drive settings, the pedal must permit near-unity output
rather than only added boost.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

## Open questions

- [ ] (restored detail) Scope boundary deliberately set for this stabilization pass:
  retuning all pedals and amp stages together was considered and rejected (too large for
  a stabilization pass, harder to reason about for regression); the model browser was kept
  rather than removed (full removal is a larger UX/product decision than this phase needs);
  and generic High Gain presets alone were rejected in favor of dedicated metal coverage
  (the audit and user feedback explicitly call out missing metal content). Revisit these if
  a later phase reopens the broader gain-stack or factory-presets overhaul.

- [ ] (restored detail) Two further considered-and-rejected alternatives behind this
  phase's decisions: adding oversampling immediately was rejected as a larger architecture
  decision that should follow separate DSP research/spec work (see "Dropped from sources");
  and leaving the Neural Mode-guide duplication in place until real Neural model loading
  exists was rejected because the current UI is already misleading today — so the
  duplicated hero-side deck is replaced now with a non-duplicated signal-path/status panel
  (AC-005, AC-006) rather than deferred.

- [ ] (non-blocking) Should the default init patch ship with the gate enabled once the
  deeper floor lands, or should the stronger gate remain opt-in through presets and the
  manual toggle? Does not block: the gate is operable either way.

- [ ] (non-blocking) (deferred-gap from intake/audit-deferred-fixes.md, "Group B —
  Grinder AudioParam policy" / item I-26) Should Grinder's AudioWorklet processor expose
  its automation-relevant controls as audio-rate `AudioParam`s rather than control-rate
  message-passed values? The deferred policy is to promote the 11 most automation-relevant
  params to `parameterDescriptors` in `grinderProcessor.ts` — `gain`, `bass`, `mid`,
  `treble`, `presence`, `resonance`, `master`, `inputGain`, `outputGain`, `tubeDrive`,
  `feedback` — and read each per-sample inside the inner DSP loop via `values[i]` (not
  the block-final `values[frames - 1]`); all other params stay control-rate via
  `port.postMessage` for now. Does not block this phase: phase 2 changes the DSP behavior
  of the overdrive and gate, not the worklet's parameter-exposure surface, and the current
  control-rate path remains functional.

## Known risks

- Revoicing Overdrive without adding oversampling improves usability but will not
  eliminate every source of alias-like harshness in Grinder (partly echoed by the
  phase-1 audit at `../grinder-stabilization-phase-1/audit.md`).
- More aggressive gate closure helps high-gain workflows but can feel abrupt if a user
  expects a softer expander (AC-003).
- Honest Neural copy reduces product hype, but that is preferable to shipping visibly
  duplicated or misleading UI (AC-005, AC-006).

## Affected areas

- `crates/daw-dsp/src/grinder/pedals.rs`
- `crates/daw-dsp/src/grinder/engine.rs`
- `src/modules/Grinder/useCases/grinderPresets.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`

## Dropped from sources

- Oversampling / full anti-aliasing — deferred to later DSP research and the phase 5
  high-gain pass; stabilization here is targeted parameter/DSP changes only.
- Real Neural model loading — deferred to phase 7; this phase only makes the Neural copy
  honest about the current build.
- Cabinet mic/room/routing wiring — deferred to phases 4 and 9; not presented as solved.
