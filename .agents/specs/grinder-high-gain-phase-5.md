# Grinder High-Gain Phase 5

## Context

Grinder's remaining trust gap is now mostly audible rather than structural. Cabinet distance/room, snapshot recall, and supported pedal order are already real. The next obvious failure is the high-gain front end.

Current code inspection and research show two bounded problems in `crates/daw-dsp/src/grinder/pedals.rs`:

- `DistortionPedal` still behaves like a large sampled clipper with limited output discipline.
- `FuzzPedal` currently injects a fixed bias offset that can create output from silence, which aligns with the user report that fuzz produces an insane amount of noise.

Research on virtual-analog distortion modeling points to the same immediate remedy: conditioning filters, a controlled nonlinear transfer, and explicit alias mitigation around the main nonlinear stage.

## Goal

Distortion and fuzz become usable high-gain pedals instead of brittle artifact generators. They should stay in a sane loudness range, remain silent on silence input, and sound more controlled under gain without removing their character.

## User-visible behavior

Turning on distortion or fuzz should audibly change the rig without causing a giant loudness jump or a constant noisy bed. Fuzz should stop manufacturing signal when the guitar is not playing. High-gain settings should still sound aggressive, but less fizzy and less broken.

## Scope

**In scope:**

- Retune `DistortionPedal` gain structure and nonlinear transfer.
- Retune `FuzzPedal` gain structure and nonlinear transfer.
- Ensure enabled fuzz decays to silence on silence input.
- Add a bounded alias-mitigation strategy around the main distortion/fuzz nonlinear stages.
- Add DSP regressions for distortion/fuzz loudness sanity and fuzz-on-silence behavior.
- Update the Grinder audit/task trail to reflect the resolved pedal behavior.

**Out of scope:**

- Full ADAA rollout across every Grinder nonlinear stage.
- Triode/preamp/power-amp retuning.
- Neural model loading.
- Routing-mode completion.
- Cabinet model or IR management changes.

## Requirements

1. **Distortion loudness stays usable**
   Moderate distortion settings must remain within a sane loudness range relative to bypass instead of behaving like a broken gain jump.

2. **Fuzz does not generate output from silence**
   With fuzz enabled and silence at the input, the pedal output must settle near silence instead of emitting a steady residual signal.

3. **Fuzz loudness stays usable**
   Moderate fuzz settings must remain within a sane loudness range relative to bypass.

4. **High-gain pedals remain audibly active**
   Distortion and fuzz must still audibly change the signal when enabled; the fix must not collapse them into near-bypass behavior.

5. **Bounded alias mitigation is real**
   Distortion and fuzz must no longer rely only on plain sample-rate clipping. The implementation must add a real, RT-safe mitigation step around the main nonlinearity.

6. **RT safety is preserved**
   The new pedal processing must remain allocation-free and lock-free in `process_sample()`.

7. **Regression coverage exists**
   Tests must prove the loudness and silence invariants above.

## Constraints

- Reuse the existing pedal types; do not introduce a parallel high-gain subsystem.
- Keep all processing state inside the pedal structs and initialize it in `new()` / `reset()`.
- Preserve the existing public parameter contract (`drive`, `tone`, `level`, `fuzz`, `enabled`).
- Favor a bounded, credible improvement over a speculative full circuit solver.

## Design decisions

### Decision: stabilize the front-end pedals before deeper amp-stage work

**Chosen:** address the obvious pedal-stage failures first.

**Rejected:**

- Retuning preamp and power amp first.
  Rejected because the most concrete current bug is in the pedal stage itself, especially fuzz generating signal on silence.

### Decision: use a bounded anti-alias strategy now instead of waiting for full ADAA everywhere

**Chosen:** implement a low-cost alias-mitigation step around distortion/fuzz immediately.

**Rejected:**

- Leaving the current sample-rate clippers in place until a full cross-engine ADAA rewrite exists.
  Rejected because that keeps the main audible complaint unresolved.
- Expanding this phase into a full triode/power-amp antialias rewrite.
  Rejected because it is a larger spec.

## Acceptance criteria

- [x] A pedal DSP test proves moderate distortion stays in a usable loudness range.
- [x] A pedal DSP test proves moderate fuzz stays in a usable loudness range.
- [x] A pedal DSP test proves enabled fuzz settles near silence for silence input.
- [x] Existing Grinder DSP and UI tests continue to pass.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Implementation notes

- Prefer the research-backed `conditioning filter -> nonlinearity -> EQ` structure over uncontrolled gain into a raw clipper.
- A credible bounded alias-mitigation step can be a low-order oversampled nonlinear core with pre/post conditioning.
- Silence behavior is a hard invariant for fuzz in this phase.

## Test plan

- [x] Add failing pedal DSP tests for distortion loudness, fuzz loudness, and fuzz silence behavior.
- [x] Run targeted Grinder DSP tests first.
- [x] Run full Grinder DSP tests.
- [x] Run Grinder UI tests to catch accidental regressions in the module.

## Open questions

- [ ] **[MINOR]** Should the next phase after this target triode/preamp voicing or neural/routing completion first?

## Tradeoffs and risks

- A bounded oversampled pedal core will improve high-gain behavior, but it will not by itself make Grinder a full reference-grade amp model.
- If the loudness compensation is too aggressive, the pedals can feel small; if it is too weak, the original complaint remains.
- This phase intentionally stabilizes the most broken high-gain front-end behavior before deeper amp-stage interaction work.
