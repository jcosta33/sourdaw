# Grinder Later Amp Stability Phase 6

## Context

Phase 5 stabilized Grinder's front-end high-gain pedals. The next audible weak spot is the later amp path:

- `TriodeStage` / `Preamp` in `crates/daw-dsp/src/grinder/triode.rs`
- `PowerAmp` in `crates/daw-dsp/src/grinder/power_amp.rs`

Research on guitar amp modeling keeps pointing at the same problem: high-gain tube stages are dynamic systems, and simple nonlinear treatment is especially weak on transients and under heavy drive. Grinder already keeps dynamic state in these stages, but phase-6 investigation showed that the most concrete remaining miss is later-stage control authority, especially `powerAmpBias`, with sample-rate stability retained as a regression guardrail.

## Goal

The later amp stages become more believable under high gain. Grinder's preamp and power amp should keep their character while later-stage expert controls, especially `powerAmpBias`, produce audible and defensible changes instead of decorative movement.

## User-visible behavior

High-gain amp settings should still sound aggressive, but the later amp section should feel more intentional. In particular, changing power-amp bias should now audibly change crossover feel and headroom instead of appearing dead.

## Scope

**In scope:**

- Improve the numerical treatment of the later nonlinear amp stages in `triode.rs` and `power_amp.rs`.
- Keep bounded sample-rate-stability regressions around those stages.
- Make later-stage expert controls produce audible changes where they were effectively decorative.
- Add DSP regressions for high-gain preamp and power-amp sample-rate stability.
- Add a DSP regression for power-amp bias audibility.
- Update the Grinder audit/task trail to reflect the resolved later-stage behavior.

**Out of scope:**

- Neural model loading.
- Routing-mode completion.
- Cabinet-selection completion.
- A full circuit-solver rewrite.
- UI redesign.

## Requirements

1. **High-gain preamp remains sample-rate stable**
   A high-gain preamp scenario must produce reasonably similar output behavior at 48 kHz and 96 kHz instead of diverging excessively.

2. **High-gain power amp remains sample-rate stable**
   A high-drive power-amp scenario must produce reasonably similar output behavior at 48 kHz and 96 kHz instead of diverging excessively.

3. **Power-amp bias is audibly real**
   Cold and hot `powerAmpBias` settings must produce an audible change in the power-stage response rather than a near-zero difference.

4. **Later stages remain audibly active**
   The fix must not flatten the preamp or power amp into near-linear behavior; the stages must still audibly shape the signal.

5. **Existing dynamic behavior is preserved**
   Triode blocking/bias behavior and power-amp sag/feedback behavior must remain stateful rather than being replaced by a plain static shaper.

6. **RT safety is preserved**
   The implementation must remain allocation-free and lock-free in `process_sample()`.

7. **Regression coverage exists**
   Tests must prove the sample-rate-stability and bias-audibility invariants above.

## Constraints

- Reuse the existing `TriodeStage`, `Preamp`, and `PowerAmp` types.
- Keep all state preallocated inside the stage structs.
- Favor a bounded numerical improvement over a full topology rewrite.
- Do not silently expand into Neural/routing or UI work.

## Design decisions

### Decision: keep sample-rate stability as a guardrail, but fix the control that is actually fake

**Chosen:** preserve 48 kHz vs 96 kHz regressions while implementing the concrete later-stage fix on `powerAmpBias`.

**Rejected:**

- Using only "audible output exists" tests.
  Rejected because the current stages already pass that bar while still allowing decorative controls.

### Decision: improve the stage update, not the public control contract

**Chosen:** refine the numerical treatment inside the existing preamp/power-amp DSP.

**Rejected:**

- Adding new user-facing controls in this phase.
  Rejected because the problem is stage credibility, not parameter count.

## Acceptance criteria

- [x] A DSP test proves a high-gain preamp scenario is reasonably sample-rate stable between 48 kHz and 96 kHz.
- [x] A DSP test proves a high-drive power-amp scenario is reasonably sample-rate stable between 48 kHz and 96 kHz.
- [x] A DSP test proves `powerAmpBias` audibly changes the power-stage response.
- [x] Existing Grinder DSP and UI tests continue to pass.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Implementation notes

- Preserve the Koren-inspired triode structure and the sag/feedback structure of the power amp.
- Use the sample-rate tests as regression guardrails, but tune the actual implementation around later-stage control truth.
- `powerAmpBias` should influence crossover width, asymmetry, and effective headroom strongly enough to be heard.

## Test plan

- [x] Add failing DSP tests for high-gain preamp and power-amp sample-rate stability.
- [x] Add a failing DSP test for `powerAmpBias` audibility.
- [x] Run targeted Grinder DSP tests first.
- [x] Run full Grinder DSP tests.
- [x] Run Grinder UI tests to catch accidental module regressions.

## Open questions

- [ ] **[MINOR]** After phase 6, is the next higher-value move Neural delivery or routing/cab completion?

## Tradeoffs and risks

- Sample-rate stability is a bounded proxy for tone quality, not a complete perceptual guarantee.
- If the later-stage bias effect is exaggerated, the amp can feel gimmicky rather than realistic.
- This phase improves later-stage control truth without claiming to be a complete circuit-accurate amp simulation.
