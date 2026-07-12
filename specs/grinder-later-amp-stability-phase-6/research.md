---
type: research
id: RESEARCH-grinder-later-amp-stage-modeling
title: Grinder later amp-stage modeling
status: open
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Research: Grinder later amp-stage modeling

## Question

After the front-end pedal fixes, what bounded numerical improvement to the later
nonlinear amp stages in `crates/daw-dsp/src/grinder/triode.rs` and `power_amp.rs` would
raise high-gain credibility and transient behavior without a full circuit-solver rewrite?

## Findings

### R-001 — The amp sound is interacting stages, not "a clipper after pedals"

- **Claim:** A guitar tube amp is a chain of interacting stages — preamp, tone stack, power amp, transformer/speaker loading — so the remaining post-pedal tone risk sits in those later stages, not only the pedalboard.
- **Evidence:** Pakarinen & Yeh, "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers", Computer Music Journal 33(2), 2009, DOI `10.1162/comj.2009.33.2.85`.
- **Confidence:** high
- **Bears on:** moving the next tone pass into `triode.rs` and `power_amp.rs`.

### R-002 — High-gain triode stages need dynamic behavior, not static waveshaping

- **Claim:** High-gain triode stages exhibit grid current, parasitic capacitance, and Miller effect that are audibly relevant; stage models that track dynamic bias outperform static waveshaping plus linear filtering.
- **Evidence:** Cohen & Hélie, "Simulation of a guitar amplifier stage for several triode models", AES 127th Convention, 2009; Macák & Schimmel, "Real-Time Guitar Tube Amplifier Simulation using an Approximation of Differential Equations", DAFx-10.
- **Confidence:** high
- **Bears on:** keeping the triode/power-amp stages stateful (phase 6 AC-005).

### R-003 — Static waveshaping plus filters fails on transients

- **Claim:** Static waveshaping with linear filtration is acceptable for stationary signals but fails on transients because analog bias shifts are dynamic — matching the "artifacty and weird" user report.
- **Evidence:** Macák & Schimmel, DAFx-10.
- **Confidence:** high
- **Bears on:** measuring a stability property rather than just non-zero audio output.

### R-004 — Later amp stages need alias-aware numerical treatment

- **Claim:** The preamp/power-amp literature is framed around solving or approximating nonlinear differential systems efficiently for real time; bounded oversampling or improved numerical treatment around the nonlinear state update beats a single-step sample-rate-sensitive block.
- **Evidence:** Cohen & Hélie, "Real-Time Simulation of a Guitar Power Amplifier", DAFx-10; combined with the phase-5 antialiasing sources.
- **Confidence:** medium
- **Bears on:** the bounded numerical improvement in phase 6.

### R-005 — Sample-rate dependence is a useful bounded regression target

- **Claim:** A nonlinear stage that behaves materially differently at 48 kHz vs 96 kHz under the same stimulus signals an implementation too dependent on sampling conditions; this is a good bounded indicator for the aliasing/numerical-stability problem.
- **Evidence:** synthesis of the differential-equation/antialiasing sources above applied to discrete-time stability.
- **Confidence:** medium
- **Bears on:** the 48 kHz vs 96 kHz regression guardrails (phase 6 AC-002, AC-003).

## Open questions

- [ ] Q-001 — After the later-stage pass, is Neural delivery or routing/cab completion
  the higher-value next move? (carried to the phase 6 spec)

## Recommendation

Keep the Koren-inspired triode and sag/push-pull power-amp structure (R-002), improve
their numerical treatment with a bounded oversampled update (R-004), and add 48 kHz vs
96 kHz sample-rate-stability regressions as the empirical guardrail (R-005), while caring
specifically about transient/high-gain stability (R-003). Defer Neural loading and
routing completion to later phases.

## Sources (restored from research/grinder/later-amp-stage-modeling.md)

The original research note recorded the specific public-access URLs discovered for each
source alongside the DOIs and titles cited above. They are restored here verbatim so the
mirrors and archive pages used during the survey are not lost.

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
