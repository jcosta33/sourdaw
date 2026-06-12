# Grinder Amp Family Voicing Phase 11

## Context

Phase 10 made later-stage controls more honest and reduced brittle behavior in:

- `crates/daw-dsp/src/grinder/triode.rs`
- `crates/daw-dsp/src/grinder/power_amp.rs`

The next problem is less about dead controls and more about product identity. Grinder exposes user-facing amp families through:

- `ampModel` in the preamp path
- `powerTubeType` in the power-amp path

Those labels imply recognizable personalities, but current implementation still leans too close to "same amp, lightly reweighted" behavior. Phase 11 should make those families more referenceable without claiming full circuit cloning.

## Goal

Grinder's amp-family choices become more obviously distinct under guitar-like material, especially the higher-gain preamp families and the power-tube families.

## User-visible behavior

Switching between amp families should feel like choosing a different rig voice, not just nudging the same rig:

- Rectifier-style settings should feel thicker and lower-mid-heavier than Lead JCM-style settings
- Lead JCM-style settings should keep more upper-mid bite and cut than Rectifier-style settings
- 6L6 power tubes should feel cleaner and less compressed than EL84 under the same driven burst
- EL84 power tubes should compress and fold earlier than 6L6 under the same driven burst

## Scope

**In scope:**

- Strengthen preamp-family voicing separation in `triode.rs`
- Strengthen power-tube-family voicing separation in `power_amp.rs`
- Add DSP regressions for family-voicing ordering and distinctness
- Update the Grinder audit/task trail to reflect the resolved family-voicing behavior

**Out of scope:**

- Neural work
- `inputMode` completion
- routing/cabinet expansion
- UI redesign
- full circuit-accurate cloning of named amps

## Requirements

1. **Power-tube families are not interchangeable**
   `powerTubeType` must produce measurably distinct driven-burst behavior, not just tiny level changes.

2. **6L6 keeps more headroom than EL84**
   Under the same driven-burst stimulus, 6L6 must preserve a meaningfully higher attack peak / lower compression than EL84.

3. **Rectifier and Lead JCM preamp families are not interchangeable**
   Under the same palm-muted high-gain stimulus, Rectifier and Lead JCM preamp voicings must produce measurably different low-vs-edge balance.

4. **Family voicing remains bounded and believable**
   The new separation must not collapse into gimmicky EQ caricatures or break existing later-stage stability/control-truth coverage.

5. **RT safety is preserved**
   The implementation must remain allocation-free and lock-free in `process_sample()`.

6. **Regression coverage exists**
   Tests must prove the family-ordering/distinctness invariants above.

## Constraints

- Reuse the existing `Preamp` and `PowerAmp` types.
- Keep all state preallocated inside the stage structs.
- Favor bounded voicing separation over feature expansion.
- Do not silently expand into new UI or patch-contract work.

## Design decisions

### Decision: phase 11 targets ordering and balance, not exact amp cloning

**Chosen:** define verifiable ordering relationships for family behavior instead of pretending to match exact commercial references.

**Rejected:**

- Specifying exact frequency-response or harmonic tables for named amps.
  Rejected because Grinder is not yet accurate enough for that contract and the phase should remain incremental.

### Decision: use guitar-like burst and palm-mute stimuli

**Chosen:** drive the regressions with burst/palm-muted material rather than steady sine waves so family differences show up in dynamics and edge/body balance.

**Rejected:**

- Relying on subjective listening-only validation.
  Rejected because the phase needs durable regression coverage.

## Acceptance criteria

- [x] A DSP test proves 6L6 preserves a meaningfully higher driven-burst attack peak than EL84.
- [x] A DSP test proves power-tube families produce distinct driven-burst behavior beyond near-zero level drift.
- [x] A DSP test proves Rectifier and Lead JCM preamp families produce measurably different low-vs-edge balance on the same high-gain palm-muted stimulus.
- [x] Existing later-stage stability/control-truth regressions continue to pass.
- [x] Existing Grinder DSP and UI tests continue to pass.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Implementation notes

- Prefer shaping stage distribution, damping, and recovery behavior over bolting on large static EQ offsets.
- For power-tube families, focus on compression/headroom, damping, and edge character under burst load.
- For preamp families, focus on interstage drive balance and body/edge separation under high gain.

## Test plan

- [x] Add a failing DSP test for power-tube-family compression/headroom ordering.
- [x] Add a failing DSP test for power-tube-family distinctness.
- [x] Add a failing DSP test for Rectifier vs Lead JCM preamp body/edge balance.
- [x] Re-run the later-stage regression suite.
- [x] Run full Grinder DSP tests.
- [x] Run Grinder UI tests to catch accidental module regressions.

## Open questions

- [x] **[MINOR]** After phase 11, is the higher-value next slice `inputMode` completion or another later-stage tone pass?
      Answer: `inputMode` completion is the cleaner next slice now that amp-family labels and power-tube families are no longer acting like near-interchangeable choices.

## Tradeoffs and risks

- Stronger family voicing separation can become cartoonish if overdone.
- Ordering-based regressions are useful guardrails, but they are still proxies rather than full perceptual truth.
- This phase should improve recognizability of the family choices without implying exact modeling parity.
