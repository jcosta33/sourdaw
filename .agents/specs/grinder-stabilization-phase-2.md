# Grinder Stabilization Phase 2

## Context

Phase 1 fixed Grinder's most obvious control-truth bugs: pedal toggles now persist correctly, and the gate has an explicit enable toggle in the Lab section. The audit at `.agents/audits/grinder/control-deck.md` still identifies three high-impact product problems that block serious guitar-amp use:

1. Overdrive and the broader gain stack sound brittle, over-hot, and artifact-prone.
2. The Neural tab still duplicates Control Deck content and presents decorative model-browser language.
3. Grinder still lacks explicit metal-focused preset content and tests that protect those workflows.

This phase addresses those issues with a bounded stabilization pass rather than a full DSP redesign.

## Goal

Grinder becomes materially more usable as a guitar amp: the overdrive behaves like a controllable front-end boost rather than a chaos generator, the gate clamps more decisively when enabled, the Neural tab stops repeating itself, and the preset list includes a real metal-voiced starting point.

## User-visible behavior

When the user enables Overdrive, the result is still driven and colored, but not explosively louder or obviously broken at moderate settings. When the user enables the gate, it attenuates idle noise more decisively. The Neural tab no longer shows a duplicated Engine Mode card deck with the exact same copy. The preset browser includes an explicit metal-oriented preset that reflects a believable modern high-gain workflow.

## Scope

**In scope:**

- Recalibrate the Grinder overdrive pedal around saner gain/output behavior.
- Tighten the gate attenuation floor so the enabled gate behaves more like a guitar gate than a barely audible expander.
- Remove the duplicated Neural "Mode guide" presentation and replace it with non-duplicated, honest status/routing information.
- Add at least one dedicated metal preset and strengthen Grinder preset/UI/DSP tests around this work.

**Non-goals (explicitly out of scope):**

- Adding true oversampling or a full anti-aliasing architecture across every nonlinear stage.
- Implementing real Neural model loading.
- Wiring cabinet mic distance, room, or routing placeholders to DSP.
- Investigating Arrangement clip-alignment precision.
- Rebuilding the full Grinder UI layout.

## Requirements

1. **Overdrive stays in a usable loudness range** — moderate overdrive settings must not explode in level relative to the bypassed path, and low-drive settings must permit near-unity output.
2. **Overdrive still changes tone audibly** — the recalibration must not reduce Overdrive to a no-op; tests must prove it still changes the signal path.
3. **Gate closes more decisively when enabled** — the DSP gate must reach a substantially lower closed-gain floor than the current soft-expander behavior.
4. **Neural tab stops duplicating Engine Mode copy** — the hero area must not render the same `ENGINE_MODES` labels/descriptions that already appear in the Neural Control Deck.
5. **Neural UI copy is honest about the current implementation** — the panel should present routing/status information without implying that model-library selection loads distinct DSP assets when it currently does not.
6. **Metal preset coverage exists** — Grinder must expose at least one dedicated metal preset category entry with a believable high-gain amp/gate/front-end combination.
7. **Regression tests cover the new contracts** — DSP tests must guard the overdrive/gate behavior, and TS tests must guard the Neural UI/preset expectations.

## Constraints

- Preserve current module boundaries and keep Grinder UI changes inside the Grinder presentation layer.
- Do not add cross-module internal imports.
- Keep test files under existing `__tests__/` folders.
- Prefer stabilization through targeted parameter/DSP changes rather than broad rewrites.
- Do not present placeholder cabinet/neural features as solved in this phase.

## Design decisions

### Decision: Revoice overdrive instead of trying to solve the entire gain stack

**Chosen:** address the worst user-facing pedal by recalibrating Overdrive and its defaults first.

**Considered and rejected:**

- Retune all pedals and amp stages together — rejected because it is too large for a stabilization pass and would make regression harder to reason about.
- Add oversampling immediately — rejected because it is a larger architecture decision that should follow separate DSP research/spec work.

### Decision: Make the Neural page more honest instead of leaving decorative duplication in place

**Chosen:** replace the duplicated hero-side Mode guide with a non-duplicated signal-path/status panel and more explicit wording.

**Considered and rejected:**

- Leave the duplication until real Neural model loading exists — rejected because the current UI is already misleading today.
- Remove the entire model browser — rejected because that is a bigger UX/product decision than needed for this stabilization pass.

### Decision: Add one strong metal preset now instead of waiting for a broader factory-presets overhaul

**Chosen:** add a dedicated metal preset plus tests for the new taxonomy.

**Considered and rejected:**

- Keep using generic High Gain presets only — rejected because the audit and user feedback explicitly call out missing metal content.

## Acceptance criteria

- [ ] A new Rust DSP test proves moderate Overdrive settings stay within a sane loudness ratio relative to bypass.
- [ ] A new Rust DSP test proves the enabled gate can close to a materially lower gain floor than before.
- [ ] The Neural panel test suite proves the duplicated "Mode guide" content is no longer rendered in the Neural hero area.
- [ ] The Grinder preset tests prove a `Metal` category now exists and includes at least one preset with gate + high-gain/front-end configuration.
- [ ] Targeted Grinder TS tests pass.
- [ ] Targeted `cargo test -p daw-dsp grinder` coverage for the touched DSP modules passes.

## Implementation notes

- Calibrate Overdrive around realistic pedal behavior: tighter input filtering, lower pre-clip gain, and level mapping that permits true trim rather than only additional boost.
- Use a direct gate-floor assertion via the existing `NoiseGate::gain()` accessor rather than trying to infer closure only from audio output.
- In the Neural hero area, prefer current-state summaries, routing labels, and honest descriptive text over a second static mode-card deck.
- Keep the new metal preset believable by using gate + amp gain + a restrained front-end overdrive rather than stacking every distortion source at once.

## Test plan

- [ ] Automated: add Rust tests in Grinder DSP for overdrive loudness sanity and gate closure depth.
- [ ] Automated: extend the Grinder panel tests to cover the Neural tab's non-duplicated content.
- [ ] Automated: extend the Grinder preset tests to assert dedicated metal coverage.
- [ ] Automated: run the targeted Vitest Grinder suite.
- [ ] Automated: run targeted `cargo test -p daw-dsp grinder`.
- [ ] Manual: listen to Overdrive at low, medium, and high settings and confirm it feels controllable rather than explosively noisy.

## Open questions

- [ ] **[MINOR]** Should the default init patch ship with the gate enabled once the deeper gate floor lands, or should the stronger gate remain opt-in through presets and manual toggle?

## Tradeoffs and risks

- Revoicing Overdrive without adding oversampling will improve usability, but it will not eliminate every source of alias-like harshness in Grinder.
- More aggressive gate closure is useful for high-gain workflows, but it can feel abrupt if a user expects a softer expander.
- Honest Neural copy reduces product hype, but that is preferable to shipping visibly duplicated or misleading UI.
