# Grinder High-Gain Modeling Research

## Scope

This note grounds the next Grinder high-gain stabilization pass, focused on the remaining `DistortionPedal` and `FuzzPedal` behavior in `crates/daw-dsp/src/grinder/pedals.rs`.

## Sources

1. Bilbao, Esqueda, Parker, and Välimäki, "Antiderivative Antialiasing for Memoryless Nonlinearities", IEEE Signal Processing Letters 24(7), 2017.
   Source: Aalto research portal, DOI `10.1109/LSP.2017.2675541`
   URL: `https://research.aalto.fi/en/publications/antiderivative-antialiasing-for-memoryless-nonlinearities/`

2. Holters, "Antiderivative Antialiasing for Stateful Systems", Applied Sciences 10(1), 2020, extended from DAFx-19.
   Source: MDPI open-access article, DOI `10.3390/app10010020`
   URL: `https://www.mdpi.com/2076-3417/10/1/20`

3. Yeh, Abel, and Smith, "Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals", DAFx-07.
   Source: DAFx paper archive PDF
   URL: `https://dafx.de/paper-archive/2007/Papers/p189.pdf`

4. Yeh and Smith, "Simulating guitar distortion circuits using wave digital and nonlinear state-space formulations", DAFx-08.
   Source: DAFx paper archive detail page / PDF
   URL: `https://dafx.de/paper-archive/details/gZvqz8Bk39w9LqNNr1SDlg`

5. Parker, Zavalishin, and Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution", DAFx-16.
   Source: DAFx paper archive PDF
   URL: `https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf`

6. Cohen and Hélie, "Real-Time Simulation of a Guitar Power Amplifier", DAFx-10.
   Source: DAFx paper archive detail page
   URL: `https://dafx.de/paper-archive/details/yZNxN3FPA2HJUN5vKmCG0A`

## Findings

### 1. High-gain guitar stages need explicit alias-mitigation, not just a raw per-sample clipper

Bilbao et al. show that discrete-time memoryless nonlinearities are a direct alias source and motivate antiderivative-based mitigation as a lower-cost alternative to brute-force oversampling. Parker et al. reach the same practical conclusion from a continuous-time-convolution angle: plain sample-rate waveshaping is the wrong baseline for quality distortion stages.

Implication for Grinder:

- The current `DistortionPedal` and `FuzzPedal` should not remain as plain sampled waveshapers with only sample-rate filtering around them.
- A bounded fix can use low-order oversampling plus shaped pre/post filtering now, even if full ADAA is deferred.

### 2. Practical pedal emulations are usually filter -> nonlinearity -> EQ, not "huge gain into arbitrary clip"

Yeh, Abel, and Smith derive efficient pedal models around a conditioning filter, a memoryless nonlinearity, and an equalization filter. They also note that real pedal circuits are usually low-order and that this structure is perceptually effective when grounded in circuit behavior.

Implication for Grinder:

- The distortion and fuzz stages should be structured as:
    - input tightening / conditioning
    - controlled nonlinear transfer
    - post-shape EQ / DC cleanup / output compensation
- The present "very large gain, then clip, then tone" structure is too uncontrolled for a believable guitar product.

### 3. Silence invariants matter

The cited work models analog stages that distort incoming signal; it does not justify a pedal generating a constant output from silence in the normal operating path. During code inspection, Grinder's `FuzzPedal` was found to add a fixed bias offset before clipping, which can produce non-zero output even for zero input.

Implication for Grinder:

- Enabled fuzz must decay to silence on silence input.
- Asymmetry should come from the transfer curve and dynamic bias behavior, not from a permanent DC-producing offset.

### 4. Low-order oversampling is a reasonable bounded step for this repo

Yeh et al. note that distortion implementations commonly upsample around the nonlinear stage, while Parker et al. show that alias reduction improves further when low-order oversampling is combined with better nonlinear treatment. Holters extends anti-alias reasoning into stateful cases, but Grinder's immediate pedal problem is still concentrated in bounded nonlinear blocks.

Implication for Grinder:

- A 2x internal oversampling pass around the main distortion/fuzz nonlinearities is a credible phase step.
- This stays RT-safe if it is implemented with a few additional state variables and no allocation.

### 5. Preamp and power-amp realism still matter, but they are not the first bounded fix

Yeh and Smith and Cohen and Hélie both reinforce that complete guitar-amp realism comes from interacting stages, not just a pedal clipper. Grinder's triode and power-amp models already attempt that broader topology, while the remaining obvious user-facing breakage is concentrated in the front-end high-gain pedals.

Implication for Grinder:

- The next implementation pass should first stabilize `DistortionPedal` and `FuzzPedal`.
- A later phase can revisit preamp/power-amp voicing and any deeper stateful antialias strategy.

## Recommended phase boundary

For the next implementation phase:

- Fix distortion/fuzz loudness and silence behavior.
- Add low-order alias mitigation around their nonlinear cores.
- Preserve RT safety and existing patch controls.
- Defer deeper triode / power-amp retuning to a later spec.
