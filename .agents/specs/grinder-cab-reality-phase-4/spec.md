---
type: spec
id: SPEC-grinder-cab-reality-phase-4
title: Grinder cab reality — phase 4 (audible mic distance and room amount)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Grinder cab reality — phase 4 (audible mic distance and room amount)

## Intent

Make Grinder's surfaced cabinet controls behave honestly: `mic1Distance`,
`mic2Distance`, and `roomAmount` audibly affect the cabinet capture instead of being
decorative, and the Cab UI exposes a direct room control because that parameter is now
real. This is a modest spatial model, not full IR management or true room simulation.

## Non-goals

- Full IR-slot management or user IR loading.
- Real multi-room simulation or stereo room modeling.
- `routingMode`, `cabType`, or `cabIrId` completion.
- Neural model loading.
- Broader distortion/fuzz/high-gain voicing work.

## Requirements

### AC-001 — Mic distance is audible

Changing `mic1Distance` or `mic2Distance` must change the rendered cabinet output in a
stable, repeatable way.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — Distance is directionally correct

A farther mic must reduce directness relative to a close mic through lower direct level
and/or softer high-frequency response, and must not behave as a random tonal change.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — Room amount is audible

Increasing `roomAmount` from minimum to a high setting must change the cabinet output in
a stable, repeatable way.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — Cab UI exposes only real cabinet controls

If `roomAmount` remains part of the audible cabinet path, the user must have a direct
`Room` control for it in the Grinder cab section.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-005 — RT safety is preserved

The cabinet implementation must remain allocation-free and lock-free in
`process_sample()`, with added state preallocated at construction/reset time.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — Reuse the existing cabinet path

The audible mic-distance and room-amount behavior must extend the existing
`CabinetConvolver`; a parallel cabinet effect path must not be introduced.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-007 — Patch contracts stay stable

Existing patch contracts must remain unchanged unless an existing contract is actively
misleading.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder:: && pnpm test:run -- GrinderPanel`

### AC-008 — Regression coverage exists

Dedicated regression tests must prove that mic distance and room amount alter cabinet
output.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-009 — Existing Grinder DSP and UI tests do not regress

The existing Grinder DSP and UI test suites must continue to pass unchanged after the
mic-distance and room-amount work lands.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder:: && pnpm test:run -- GrinderPanel`

### AC-010 — Types stay sound

The repository must typecheck cleanly after the cab control and param-bridge changes.

Verify with: `pnpm typecheck`

### AC-011 — Grinder audit/task trail reflects honest controls

The Grinder audit/task trail must be updated to record that `mic1Distance`,
`mic2Distance`, and `roomAmount` are no longer decorative.

Verify with: `grep -ri "mic.*distance\|roomAmount" .agents/specs/grinder-cab-reality-phase-4/`

## Open questions

- [ ] (non-blocking) Should farther mic distance also slightly reduce speaker-edge
  coloration, or is direct-level plus extra damping enough for this phase?
- [ ] (non-blocking) Should room amount affect both mics equally, or follow mic
  enable/blend weighting only?

## Affected areas

- `crates/daw-dsp/src/grinder/cabinet.rs`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`

## Dropped from sources

- A full room convolution/reverb subsystem — rejected; a lightweight preallocated
  ambience contribution is cheaper, deterministic, and within the phase goal.
- Removing the distance controls instead of implementing them — rejected; the existing
  UI already leans into speaker-field interaction.
- `routingMode` / `cabIrId` completion — deferred to phase 9.
- Tuning risk (from the original): if the distance effect is too subtle the controls
  still feel fake; if too exaggerated the cab sounds artificial — the tests prove a
  difference but the tuning still needs ears. Recorded here as a known tradeoff; the
  open questions above cover the directional tuning choices.
