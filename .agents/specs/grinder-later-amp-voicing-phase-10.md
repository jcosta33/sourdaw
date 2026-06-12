# Grinder Later Amp Voicing Phase 10

## Context

Phase 9 closed the routing/cabinet contract gap. The main remaining Grinder risk is now later-stage amp credibility:

- `TriodeStage` / `Preamp` in `crates/daw-dsp/src/grinder/triode.rs`
- `PowerAmp` in `crates/daw-dsp/src/grinder/power_amp.rs`

Phase 6 made `powerAmpBias` audibly real, but the broader later-stage path still has two concrete weaknesses:

1. later triode/power-amp transients still lean brittle and under-differentiated under hard drive
2. some expert controls still do not map cleanly to independent physical behaviors

Current inspection found one explicit control-truth miss: `gridConduction` in `TriodeStage::set_param()` rewrites the same `coupling_cap_tau` state that `couplingCapCharge` already owns, so it is not a real independent control.

## Goal

The later amp stages become more believable under hard playing, and the remaining expert controls in those stages map to distinct audible behaviors instead of partially duplicated internals.

## User-visible behavior

High-gain amp settings should keep aggression, but the later amp section should respond more like an amp and less like a brittle clipper. In particular:

- preamp blocking/grid behavior should feel more intentional on hard attacks
- coupling-cap behavior should affect recovery feel separately from grid-conduction intensity
- rectifier choice should audibly change sag/recovery under bursty playing

## Scope

**In scope:**

- Improve the numerical treatment of the later nonlinear stages in `triode.rs` and `power_amp.rs`.
- Reuse the existing bounded anti-aliasing/oversampled nonlinear approach where it materially improves later-stage behavior.
- Split `gridConduction` and `couplingCapCharge` into distinct later-stage behaviors instead of duplicated parameter wiring.
- Make at least one additional later-stage power-amp expert behavior measurably real, with `rectifierType` as the primary target.
- Add DSP regressions for later-stage dynamic-response behavior and control truth.
- Update the Grinder audit/task trail to reflect the resolved later-stage behavior.

**Out of scope:**

- Neural modal work
- `inputMode` completion
- modular routing / graph work
- cabinet/IR import expansion
- UI redesign
- a full white-box circuit solver rewrite

## Requirements

1. **Later-stage anti-aliasing is improved in a bounded way**
   The later nonlinear amp stages must use a bounded numerical improvement appropriate for real time, rather than staying as single-rate brittle shapers where a small internal oversampled pass is feasible.

2. **`gridConduction` is a real independent control**
   Changing `gridConduction` must alter preamp behavior through grid-current / drive interaction rather than merely rewriting the same state variable already owned by `couplingCapCharge`.

3. **`couplingCapCharge` remains a distinct recovery control**
   Changing `couplingCapCharge` must alter blocking/recovery behavior independently from `gridConduction`.

4. **`rectifierType` is audibly real under burst load**
   Tube, solid-state, and variac rectifier modes must produce measurably different sag/recovery behavior for the same driven burst stimulus.

5. **Existing later-stage control truth is preserved**
   `powerAmpBias`, `presence`, `resonance`, `tubeBias`, `bright`, `fat`, `ampModel`, and `powerTubeType` must remain audibly active after the retune.

6. **RT safety is preserved**
   The implementation must remain allocation-free and lock-free in `process_sample()`.

7. **Regression coverage exists**
   Tests must prove the later-stage control-truth and dynamic-response invariants above.

## Constraints

- Reuse the existing `TriodeStage`, `Preamp`, and `PowerAmp` types.
- Keep all state preallocated inside the stage structs.
- Favor a bounded 2x-style internal improvement over a full topology rewrite.
- Do not silently expand into unrelated UI, Neural, or Arrangement work.

## Design decisions

### Decision: phase 10 focuses on distinct physical behaviors, not more knobs

**Chosen:** make existing later-stage controls more honest and better differentiated before adding any new UI surface.

**Rejected:**

- Adding new expert controls in this phase.
  Rejected because the product already overpromises enough controls relative to the current behavior.

### Decision: reuse the repo's existing bounded oversampling pattern

**Chosen:** adapt the existing Grinder pedal strategy of a small internal oversampled nonlinear pass where it improves later-stage brittleness without changing the public contract.

**Rejected:**

- Jumping straight to a full differential-equation solver rewrite.
  Rejected because it is out of scope for this stabilization phase and would not be reviewable as an incremental delivery.

## Acceptance criteria

- [x] A DSP test proves `gridConduction` audibly changes preamp behavior as an independent control.
- [x] A DSP test proves `couplingCapCharge` audibly changes preamp recovery behavior as an independent control.
- [x] A DSP test proves `rectifierType` audibly changes driven burst sag/recovery behavior.
- [x] Existing later-stage sample-rate stability guardrails continue to pass.
- [x] Existing Grinder DSP and UI tests continue to pass.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Implementation notes

- Keep the Koren-inspired triode structure and the sag/feedback structure of the power amp.
- Separate grid-current intensity from coupling-cap recovery time so the two controls stop fighting over one field.
- Prefer a bounded internal oversampled pass around the most brittle later-stage nonlinear sections instead of broad retuning without numerical support.
- Use burst and recovery stimuli for later-stage tests, since those reveal sag/blocking behavior better than steady sine waves.

## Test plan

- [x] Add a failing DSP test for independent `gridConduction` audibility.
- [x] Add a failing DSP test for independent `couplingCapCharge` recovery behavior.
- [x] Add a failing DSP test for `rectifierType` burst-response audibility.
- [x] Re-run the existing later-stage sample-rate and bias tests.
- [x] Run full Grinder DSP tests.
- [x] Run Grinder UI tests to catch accidental module regressions.

## Open questions

- [ ] **[MINOR]** After phase 10, is the next higher-value move `inputMode` completion or fuller external Neural fidelity?

## Tradeoffs and risks

- A bounded oversampled pass improves brittleness and alias sensitivity but does not make Grinder a full circuit-accurate simulation.
- If `gridConduction` or rectifier differences are exaggerated, the result can feel gimmicky rather than amp-like.
- Later-stage tone quality is still broader than any single regression metric, so this phase should tighten the worst remaining gaps without claiming complete realism.
