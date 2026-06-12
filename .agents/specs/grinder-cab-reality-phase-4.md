# Grinder Cab Reality Phase 4

## Context

Grinder's remaining trust gap is now concentrated in controls that look real but are not yet audible.

The cabinet path is the clearest bounded example:

- `mic1Distance`, `mic2Distance`, and `roomAmount` already exist in the patch model.
- The param bridge already syncs those values into the audio engine.
- The Cab UI already exposes mic distance movement and implies a spatial capture field.
- `CabinetConvolver::process_sample()` currently ignores both mic distances and room amount, so those controls are decorative from the listener's perspective.

This phase does not attempt full cabinet IR management, routing, or true room simulation. It makes the currently surfaced cabinet controls behave honestly enough to justify their presence.

## Goal

Mic distance and room amount become audibly meaningful cabinet controls. Grinder's cab UI stops implying a fake spatial model and instead reflects behavior that the current DSP actually produces.

## User-visible behavior

Moving a mic farther away in the Cab section audibly changes the cabinet capture by reducing direct level, softening the top end, and increasing the sense of distance relative to a close mic. Increasing room amount adds audible ambience rather than doing nothing. The Cab control deck exposes a direct room control because that parameter is now real.

## Scope

**In scope:**

- Make `mic1Distance` and `mic2Distance` audibly affect cabinet output.
- Make `roomAmount` audibly affect cabinet output.
- Expose a direct room control in the Grinder cab section.
- Add DSP regressions proving these controls change the rendered output.
- Update the Grinder audit/task trail to reflect that these cabinet controls are no longer decorative.

**Out of scope:**

- Full IR-slot management or user IR loading.
- Real multi-room simulation or stereo room modeling.
- `routingMode`, `cabType`, or `cabIrId` completion.
- Neural model loading.
- Broader distortion/fuzz/high-gain voicing work.

## Requirements

1. **Mic distance is audible**
   `mic1Distance` and `mic2Distance` must change the rendered cabinet output in a stable, repeatable way.

2. **Distance feels directionally correct**
   A farther mic must reduce directness relative to a close mic by at least combining lower direct level and/or softer high-frequency response. The parameter must not behave as a random tonal change.

3. **Room amount is audible**
   Increasing `roomAmount` from minimum to a high setting must change the cabinet output in a stable, repeatable way.

4. **Cab UI exposes only real cabinet controls**
   If `roomAmount` remains part of the audible cabinet path, the user must have a direct control for it in the Grinder cab section.

5. **RT safety is preserved**
   The cabinet implementation must remain allocation-free and lock-free in `process_sample()`.

6. **Regression coverage exists**
   Tests must prove mic distance and room amount alter cabinet output.

## Constraints

- Reuse the existing `CabinetConvolver` instead of inventing a parallel cabinet effect path.
- Keep DSP additions preallocated at construction/reset time only.
- Keep the resulting behavior intentionally simple and believable; do not fake a "full room engine" in this phase.
- Avoid changing patch contracts unless the existing contract is actively misleading.

## Design decisions

### Decision: implement a modest spatial model instead of removing the controls

**Chosen:** make distance and room parameters audibly real inside the current cabinet processor.

**Rejected:**

- Removing distance-related controls from the UI now.
  Rejected because the existing UI already leans into speaker-field interaction, and a bounded DSP implementation is cheaper than redesigning the whole Cab section.
- Pretending the controls are metadata-only with more copy.
  Rejected because this would preserve the core trust problem.

### Decision: keep the room model intentionally lightweight

**Chosen:** use a simple preallocated ambience contribution that is cheap and deterministic.

**Rejected:**

- Building a full room convolution/reverb subsystem.
  Rejected because it expands beyond the phase goal and would overlap with broader FX/routing work.

## Acceptance criteria

- [ ] A cabinet DSP test proves changing `mic1Distance` changes the rendered output.
- [ ] A cabinet DSP test proves changing `roomAmount` changes the rendered output.
- [ ] The Grinder cab control deck exposes a direct `Room` control.
- [ ] Existing Grinder DSP and UI tests continue to pass.
- [ ] `cargo test -p daw-dsp grinder::` passes.
- [ ] `pnpm test:run src/modules/Grinder` passes.
- [ ] `pnpm typecheck` passes.

## Implementation notes

- A believable first-pass distance model can combine:
    - direct gain attenuation
    - stronger low-pass behavior as distance increases
    - room-send weighting that rises with distance
- A believable first-pass room model can use preallocated short reflections and damping rather than a new general-purpose reverb system.
- Reuse the existing Cab UI surfaces before adding new layout concepts.

## Test plan

- [ ] Add failing cabinet DSP tests for distance and room audibility.
- [ ] Add/update Grinder panel tests if the cab control deck gains a new visible room control.
- [ ] Run targeted Grinder Vitest files.
- [ ] Run targeted Grinder DSP tests.

## Open questions

- [ ] **[MINOR]** Should farther mic distance also slightly reduce speaker-edge coloration, or is direct-level plus extra damping enough for this phase?
- [ ] **[MINOR]** Should room amount affect both mics equally in this pass, or should it follow mic enable/blend weighting only?

## Tradeoffs and risks

- A lightweight room model improves honesty, but it will not match a full captured room IR workflow.
- If the distance effect is too subtle, the controls will still feel fake; if it is too exaggerated, the cab will sound artificial. The tests should prove difference, but the tuning still needs ears.
- This phase improves cabinet truth without solving the broader fake-contract fields like `routingMode` or `cabIrId`.
