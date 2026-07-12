---
type: research
id: RESEARCH-grinder-high-gain-modeling
title: Grinder high-gain pedal modeling
status: open
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Research: Grinder high-gain pedal modeling

## Question

What bounded, RT-safe change to `DistortionPedal` and `FuzzPedal` in
`crates/daw-dsp/src/grinder/pedals.rs` would make Grinder's high-gain front end usable —
controlled loudness, silent on silence, less aliasing — without a full circuit-solver
rewrite?

## Findings

### R-001 — High-gain stages need explicit alias mitigation, not a raw per-sample clipper

- **Claim:** Discrete-time memoryless nonlinearities are a direct alias source; antiderivative-based mitigation and continuous-time-convolution treatments are lower-cost alternatives to brute-force oversampling, and plain sample-rate waveshaping is the wrong baseline for quality distortion.
- **Evidence:** Bilbao, Esqueda, Parker, Välimäki, "Antiderivative Antialiasing for Memoryless Nonlinearities", IEEE SPL 24(7), 2017, DOI `10.1109/LSP.2017.2675541`; Parker, Zavalishin, Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution", DAFx-16.
- **Confidence:** high
- **Bears on:** the requirement that distortion/fuzz add a real bounded alias-mitigation step (phase 5 AC-005).

### R-002 — Practical pedal models are filter → nonlinearity → EQ, not huge gain into an arbitrary clip

- **Claim:** Efficient, perceptually effective pedal emulations are structured as a conditioning filter, a low-order memoryless nonlinearity, and an equalization/cleanup filter.
- **Evidence:** Yeh, Abel, Smith, "Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals", DAFx-07; Yeh, Smith, "Simulating guitar distortion circuits using wave digital and nonlinear state-space formulations", DAFx-08.
- **Confidence:** high
- **Bears on:** the structure of the retuned distortion/fuzz transfer (phase 5 implementation).

### R-003 — Silence invariants matter; fuzz must not produce output from silence

- **Claim:** The cited models distort incoming signal and do not justify a pedal generating constant output from silence; Grinder's `FuzzPedal` added a fixed bias offset before clipping, which can produce non-zero output for zero input.
- **Evidence:** code inspection of `crates/daw-dsp/src/grinder/pedals.rs`; absence of any silence-generating term in the DAFx-07/08 pedal models.
- **Confidence:** high
- **Bears on:** the hard fuzz-on-silence invariant (phase 5 AC-001).

### R-004 — Low-order oversampling is a reasonable bounded step

- **Claim:** A 2x internal oversampling pass around the main distortion/fuzz nonlinearities is a credible, RT-safe step if implemented with a few extra state variables and no allocation.
- **Evidence:** Yeh et al. note common upsampling around the nonlinear stage; Holters, "Antiderivative Antialiasing for Stateful Systems", Applied Sciences 10(1), 2020, DOI `10.3390/app10010020` extends the reasoning to stateful cases.
- **Confidence:** medium
- **Bears on:** the bounded mitigation approach (phase 5 AC-005, AC-006).

### R-005 — Preamp/power-amp realism matters but is not the first fix

- **Claim:** Full amp realism comes from interacting stages, but the most concrete current breakage is in the front-end pedals; later amp stages are a separate pass.
- **Evidence:** Pakarinen & Yeh review framing; Cohen & Hélie, "Real-Time Simulation of a Guitar Power Amplifier", DAFx-10.
- **Confidence:** medium
- **Bears on:** the phase boundary between phase 5 (pedals) and phase 6 (later amp stages).

## Open questions

- [ ] Q-001 — Should the phase after pedal stabilization target triode/preamp voicing or
  neural/routing completion first? (carried to the phase 5 spec)

## Recommendation

Stabilize the front-end pedals first (R-005): fix distortion/fuzz loudness and the
fuzz-on-silence bug (R-003), restructure each stage as conditioning → nonlinearity → EQ
(R-002), and add bounded low-order alias mitigation around the nonlinear cores (R-001,
R-004) while preserving RT safety and the existing patch controls. Defer deeper
triode/power-amp work to a later spec.
