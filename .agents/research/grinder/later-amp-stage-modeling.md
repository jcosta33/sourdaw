# Grinder Later Amp Stage Modeling Research

## Scope

This note grounds the next Grinder stabilization pass after the front-end pedal fixes. It focuses on the later nonlinear amp stages in:

- `crates/daw-dsp/src/grinder/triode.rs`
- `crates/daw-dsp/src/grinder/power_amp.rs`

## Sources

1. Pakarinen and Yeh, "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers", Computer Music Journal 33(2), 2009.
   DOI: `10.1162/comj.2009.33.2.85`
   Public abstract mirror discovered via search result: `https://www.researchgate.net/publication/220386487_A_Review_of_Digital_Techniques_for_Modeling_Vacuum-Tube_Guitar_Amplifiers`

2. Cohen and Hélie, "Simulation of a guitar amplifier stage for several triode models: examination of some relevant phenomena and choice of adapted numerical schemes", AES 127th Convention, 2009.
   Public abstract/manuscript mirror discovered via search result: `https://www.researchgate.net/publication/281417559_Simulation_of_a_guitar_amplifier_stage_for_several_triode_models_examination_of_some_relevant_phenomena_and_choice_of_adapted_numerical_schemes`

3. Cohen and Hélie, "Real-Time Simulation of a Guitar Power Amplifier", DAFx-10.
   DAFx archive detail page: `https://www.dafx.de/paper-archive/details/yZNxN3FPA2HJUN5vKmCG0A`

4. Macak and Schimmel, "Real-Time Guitar Tube Amplifier Simulation using an Approximation of Differential Equations", DAFx-10.
   DAFx archive page: `https://www.dafx.de/paper-archive/details/KotNLLBUHr-Wb7CEhWR_DA`
   PDF: `https://www.dafx.de/paper-archive/2010/DAFx10/MacakSchimmel_DAFx10_P12.pdf`

## Findings

### 1. The amp sound is not just "a clipper after pedals"

Pakarinen and Yeh frame the guitar tube amp as interacting stages: preamp, tone stack, power amp, and transformer/speaker loading. That matters for Grinder because the remaining post-pedal tone risk sits in exactly those later interacting stages, not only in the front-end pedalboard.

Implication for Grinder:

- After phase 5, the next credible tone pass should move into `triode.rs` and `power_amp.rs`.
- Fixing only the pedals does not close the "credible guitar amp" gap.

### 2. High-gain triode stages need dynamic behavior, not plain static waveshaping

Cohen and Hélie explicitly study high-gain triode stages and call out grid current, parasitic capacitances, and Miller effect as audibly relevant. Macak and Schimmel also distinguish simple static waveshaping plus linear filtering from stage models that track dynamic bias changes.

Implication for Grinder:

- The existing triode stage should keep its dynamic stateful behavior.
- A bounded improvement should refine the numerical treatment around the nonlinear stage rather than replacing it with a simple static shaper.

### 3. Static waveshaping plus filters is known to fail on transients

Macak and Schimmel state that static waveshaping with linear filtration can sound acceptable for stationary signals but fails on transients because analog bias shifts are dynamic. That is directly relevant to the user's "artifacty and weird" report.

Implication for Grinder:

- Phase 6 should specifically care about transient/high-gain stability, not just whether the stage outputs nonzero audio.
- Regressions should measure a stability property that would catch this class of problem.

### 4. Later amp stages still need alias-aware numerical treatment

The preamp and power-amp literature above is framed around solving or approximating nonlinear differential systems efficiently enough for real time. Combined with the earlier phase-5 antialiasing research, this points to the same practical direction for Grinder: bounded oversampling or otherwise improved numerical treatment around the nonlinear state update is preferable to leaving the later amp stages as single-step sample-rate-sensitive nonlinear blocks.

Implication for Grinder:

- A practical next step is low-order oversampled state updates for the triode and power amp.
- This stays aligned with the literature's focus on better numerical treatment without requiring a full circuit-solver rewrite.

### 5. Sample-rate dependence is a useful bounded regression target

If a nonlinear stage behaves materially differently at 48 kHz and 96 kHz under the same stimulus, that is a strong sign that the discrete-time implementation is still too dependent on sampling conditions. This is not the only quality metric, but it is a good bounded indicator for the aliasing/numerical-stability problem described in the sources.

Implication for Grinder:

- Add tests that compare the same high-gain preamp/power-amp scenario at 48 kHz and 96 kHz.
- Use that as the empirical guardrail for a bounded phase-6 implementation.

## Recommended phase boundary

For the next implementation phase:

- Keep the existing Koren-inspired triode and sag/push-pull power-amp structure.
- Improve the numerical treatment of those stages with a bounded oversampled update.
- Add regressions for high-gain sample-rate stability.
- Defer real Neural loading and routing completion to later phases.
