---
type: research
id: RESEARCH-drum-machine-realism
title: Mathematical models for classic analog drum synthesis
status: open
owner: The Sourdaw team
sources:
  - "Question: can the TR-808/909/SP-1200/LinnDrum/CR-78 be recreated from documented circuit equations with reusable Rust code?"
---

# Research: Mathematical models for classic analog drum synthesis

## Question

Can the iconic sounds of the TR-808, TR-909, SP-1200, LinnDrum, and CR-78 be recreated
digitally from documented circuit equations, and does legally reusable Rust reference code
exist?

## Findings

### R-001 — The 808 kick is a fully documented bridged-T resonator

- **Claim:** The 808 bass drum decomposes into six closed-form blocks (trigger → pulse shaper → bridged-T → feedback buffer → envelope → output), with `fc ≈ 49 Hz` at rest and a ~130 Hz attack jump.
- **Evidence:** Werner/Abel/Smith DAFx-14 transfer functions; Roland service-manual component values (R165 47k, R166 6.8k, R167 1M, C41/C42 15 nF).
- **Confidence:** high
- **Bears on:** AC-001 (kick model).

### R-002 — 808 accent is timbral, not just volume

- **Claim:** Trigger voltage 5–15 V increases excitation into the bridged-T, lengthening ring, deepening chirp, and adding diode harmonics.
- **Evidence:** Accent circuit analysis.
- **Confidence:** high
- **Bears on:** AC-002.

### R-003 — The 808 hi-hat is six square oscillators needing PolyBLEP

- **Claim:** A hex Schmitt-trigger IC generates six square waves at measured frequencies (800, 540, 522.7, 369.6, 304.4, 205.3 Hz), summed into two BPFs; digital squares need PolyBLEP antialiasing.
- **Evidence:** Werner ICMC-2014 SPICE measurements.
- **Confidence:** high
- **Bears on:** AC-004, AC-005.

### R-004 — The 909 separates VCO from envelopes and uses LFSR/EPROM

- **Claim:** The 909 kick is a phase-reset VCO + diode waveshaper with separate pitch/amp envelopes; noise is a 31-bit LFSR (taps 31,13); hats are pre-baked 6-bit buffers.
- **Evidence:** 909 circuit analysis; LFSR period 2³¹−1.
- **Confidence:** high
- **Bears on:** AC-007, AC-008.

### R-005 — SP-1200 character is drop-sample pitch shifting

- **Claim:** The SP-1200 sound comes from no-interpolation drop-sample pitch shift + 12-bit quantization + ZOH (no reconstruction filter) + channel-dependent output filters at 26.04 kHz.
- **Evidence:** Yeh/Nolting/Smith CCRMA 2007 model.
- **Confidence:** high
- **Bears on:** AC-009.

### R-006 — LinnDrum warmth is µ-law companding

- **Claim:** 8-bit samples through AM6070 µ-255 companding DACs yield ~72–78 dB effective range, warmer than linear 8-bit; no playback anti-alias filter by design.
- **Evidence:** LinnDrum LM-2 architecture and µ-law expansion.
- **Confidence:** high
- **Bears on:** AC-010.

### R-007 — Behavioral biquads suffice; WDF is a later upgrade

- **Claim:** Time-varying biquads (bilinear transform, TDF-II) capture the essential timbre at far lower cost than wave digital filters.
- **Evidence:** mi-plaits-dsp-rs approach; Werner recommends TDF-II for stability under rapid R_eff sweeps.
- **Confidence:** high
- **Bears on:** AC-001, AC-003 (modeling approach).

### R-008 — First-order ADAA beats oversampling for gentle nonlinearities

- **Claim:** First-order ADAA gives meaningful alias suppression at 0.5-sample delay for tanh/diode curves, cheaper than 2× oversampling.
- **Evidence:** Bilbao/Esqueda/Parker/Välimäki IEEE SPL 2017.
- **Confidence:** medium
- **Bears on:** the no-oversampling non-goal.

### R-009 — MIT-licensed Rust reference exists

- **Claim:** mi-plaits-dsp-rs ports Plaits' analog bass drum, snare, and hi-hat to `no_std` Rust and is the best starting point; ChowKick/DaisySP are additional references.
- **Evidence:** Crate and source repositories with permissive licenses.
- **Confidence:** high
- **Bears on:** implementation start point and attribution obligations.

### R-010 — Component tolerance is a feature

- **Claim:** ±20% capacitor / ±5% resistor tolerances made every hardware unit sound slightly different; exposing seeded jitter reproduces organic per-instance variation.
- **Evidence:** Measured 48–60 Hz spread on nominal-56 Hz 808 kicks.
- **Confidence:** high
- **Bears on:** AC-011.

## Open questions

- [ ] Q-001 — Include congas as distinct voices or defer to sample-based alternatives?
- [ ] Q-002 — When to layer a WDF fidelity upgrade over the behavioral biquads.

## Recommendation

Start from mi-plaits-dsp-rs (R-009) for a working baseline, then layer Werner's transfer
functions as time-varying biquads (R-001, R-007). Implement the SP-1200 (R-005) and LinnDrum
(R-006) as separate models, use first-order ADAA over oversampling (R-008), and expose seeded
component tolerance (R-010). Defer WDF to a later fidelity pass.

---

## Restored detail sections (recovered from migration loss)

The summarized findings above (R-001 … R-010) condensed away substantial circuit-level
detail that lived in the original factory research note
(`research/factory/active/drum-machine-realism.md`, git `bb84b0e`). The full sections are
restored verbatim below so the source equations, component values, and citations remain
co-located with the spec that depends on them. Each block notes the recovered lost item.

### Restored §1 — 808 kick pitch-sigh model and feedback transfer functions (lost item 5)

The 808 kick is the most thoroughly analyzed analog drum circuit in academic literature. Werner, Abel, and Smith (DAFx-14, 2014) decomposed it into six cascaded blocks: trigger logic → pulse shaper → bridged-T network → feedback buffer → envelope generator → output stage. Each block has a closed-form transfer function.

#### Bridged-T network component values and center frequency

From the Roland service manual (June 1981), the core oscillator components are:

| Component | Value  | Role                              |
| --------- | ------ | --------------------------------- |
| R165      | 47 kΩ  | Series resistance (switchable)    |
| R166      | 6.8 kΩ | Series resistance (always active) |
| R167      | 1 MΩ   | Shunt feedback resistance         |
| C41       | 15 nF  | Capacitor leg 1                   |
| C42       | 15 nF  | Capacitor leg 2                   |

**Center frequency formula:**

```
fc = 1 / (2π × √(R_eff × R167 × C41 × C42))
```

At steady state, `R_eff = R165 + R166 = 53.8 kΩ`, yielding **fc ≈ 49.4 Hz** (G1 + 14 cents). The service manual lists 56 Hz typical; real units measure 48–60 Hz due to **±20% capacitor tolerance**.

#### The attack frequency jump

The envelope generator (Q41–Q43) produces a **~5 ms pulse** that grounds R165 through Q43's collector, reducing R_eff from 53.8 kΩ to just **6.8 kΩ** (R166 alone). This raises the instantaneous center frequency to approximately **130 Hz** — over an octave above resting pitch. The resulting downward chirp is too fast to perceive as pitch but creates the attack's characteristic "punch."

#### Bridged-T transfer function (bandpass, forward path)

```
H(s) = (β₂s² + β₁s + β₀) / (α₂s² + α₁s + α₀)

β₂ = R_eff × R167 × C41 × C42
β₁ = R_eff × C41 + R167 × C41 + R_eff × C42
β₀ = 1
α₂ = R_eff × R167 × C41 × C42
α₁ = R_eff × (C41 + C42)
α₀ = 1
```

The feedback path transfer function (from feedback buffer to bridged-T output) is:

```
H_fb(s) = (Rk × R167 × C41 × s) / (Rk × R167 × C41 × C42 × s² + Rk × R170 × (C41 + C42) × s + Rk + R170)
```

where `Rk = R161 ‖ (R165 + R166)`.

#### Feedback buffer (decay control)

```
H_fb(s) = (R169 × VR6k × C43 × s + R169) / (R164 × (R169 + VR6k) × C43 × s + R164)
```

where `VR6k = VR6 × k` and `k ∈ [0, 1]` is the decay knob position. **Decay range: 50–800 ms** (300 ms at center). This is a first-order high-shelf filter whose gain increases with k, sustaining oscillation longer.

#### Pulse shaper nonlinear ODE

The trigger pulse passes through a shelf filter with diode D53 (1N4148):

```
R162 × R163 × C40 × (dV_trig/dt − dV⁺/dt) − R162 × V_trig
  + (R162 + R163) × V⁺ − R162 × R163 × Is × (e^(V⁺/(n×VT)) − 1) = 0
```

where **Is ≈ 10⁻¹² A**, **VT ≈ 26 mV**, n ≈ 1. The diode clips the negative swing at **~0.71 V**, leaving positive voltages unaffected. In Rust pseudocode, the memoryless nonlinearity after the linear shelf filter is:

```rust
fn pulse_shape(v: f32) -> f32 {
    if v >= 0.0 { v } else { -0.71 * (v.exp() - 1.0) }
}
```

#### Pitch sigh: transistor Q43 leakage model

The gradual downward pitch drift through the decay ("pitch sigh") is caused by residual collector current in Q43. Werner fits this as:

```
i_C = −ln(1 + e^(α × (V_comm − V₀)))^m / α
```

with fitted constants **α = 14.3150**, **V₀ = −0.5560**, **m = 1.4765 × 10⁻⁵**. As the control voltage decays, R_eff smoothly transitions from 6.8 kΩ back toward 53.8 kΩ, sweeping pitch downward.

#### Accent circuit behavior

Accent is **not just volume**. The CPU trigger voltage ranges from **5 V (unaccented) to 15 V (full accent)**. Higher trigger voltage increases the pulse amplitude into the bridged-T, which increases both loudness AND:

- **Longer ring time** (more energy in the resonator)
- **More pronounced pitch chirp** (higher initial excitation of the frequency-shifted mode)
- **Greater harmonic content** from the diode nonlinearity seeing larger signals
- In swing-type VCAs used on other voices, higher control voltage drives the transistor harder, adding **saturation harmonics**

### Restored §2 — 808 secondary voices: snare, hi-hat, clap, remaining (lost items 6, 8)

#### Snare drum: dual bridged-T plus noise

The snare uses two bridged-T oscillators tuned roughly an octave apart, mixed with bandpass-filtered white noise.

**Lower oscillator (from service manual):** R196 = 680 Ω, R197 = 820 kΩ, C58 = 56 nF, C59 = 27 nF → **fc ≈ 173 Hz** (revised; original ~238 Hz). **Upper oscillator:** R195 = 2.2 kΩ, R198 = 1 MΩ, C60 = 6.8 nF, C61 = 15 nF → **fc ≈ 335 Hz** (revised; original ~476 Hz). The **Tone** knob (VR8) crossfades between oscillators. The **Snappy** knob (VR9) controls the noise VCA envelope amplitude.

The noise source is a reverse-biased **2SC828 NPN transistor** generating avalanche (white) noise, bandpass-filtered through a Sallen-Key 2-pole HPF at **~2749 Hz**. An attenuated noise envelope is summed into the oscillator excitation, coupling the "snappy" character into the tonal attack.

#### Hi-hat and cymbal: six square-wave oscillators

A **Hitachi HD14584** hex Schmitt trigger inverter IC generates six square waves via RC astable multivibrators. Werner (ICMC 2014) measured these frequencies from SPICE simulation:

| Oscillator | Frequency    | Note     | Tunable                |
| ---------- | ------------ | -------- | ---------------------- |
| 1          | **800 Hz**   | G5 +35¢  | Yes (TM1), 359–1150 Hz |
| 2          | **540 Hz**   | C♯5 −45¢ | Yes (TM2), 254–627 Hz  |
| 3          | **522.7 Hz** | C5 −2¢   | Fixed                  |
| 4          | **369.6 Hz** | F♯4 −2¢  | Fixed                  |
| 5          | **304.4 Hz** | D♯4 −38¢ | Fixed                  |
| 6          | **205.3 Hz** | G♯3 −20¢ | Fixed                  |

The Schmitt trigger oscillator frequency is:

```
f = 1 / (2 × R_osc × C_osc × ln((VDD − VT⁻)/(VDD − VT⁺)))
```

All six outputs are summed, then split into **two bandpass filters**: BPF1 at **~3440 Hz** and BPF2 at **~7100 Hz**. Each feeds a separate VCA with independent envelopes. Closed hat has a fixed **50 ms** decay; open hat is adjustable **90–600 ms**. The cowbell taps oscillators 1 and 2 through a BPF centered at **~850 Hz** (Q ≈ 4.25) with a **50 ms** decay.

The **choke mechanism**: when closed hat triggers while open hat is sounding, transistor Q23 immediately kills the open hat VCA envelope.

#### Handclap: multi-burst envelope

Bandpass-filtered white noise (center **~1000 Hz**) passes through two parallel VCA paths. Path 1 uses a **sawtooth-shaped envelope with 3 rapid bursts** (~10 ms each) followed by a 20 ms final discharge — total **~50 ms**. Path 2 provides a simple **100 ms decay** tail (fake reverb). This multi-burst pattern simulates multiple hands clapping at slightly different times. (The cross-referenced `advanced-instruments.md` summary states the 808 clap as "3 noise bursts in 30ms" — the same dual-path multi-burst structure recovered here for lost item 8.)

#### Remaining voices quick reference

| Voice        | Method              | Frequency/Frequencies | Decay                 |
| ------------ | ------------------- | --------------------- | --------------------- |
| **Clave**    | Single bridged-T    | 2500 Hz               | Natural ring (~20 ms) |
| **Rimshot**  | Two bridged-T       | 1667 Hz + 455 Hz      | ~10 ms, HPF for snap  |
| **Low Tom**  | Bridged-T + noise   | 80–100 Hz (tunable)   | 200 ms                |
| **Mid Tom**  | Bridged-T + noise   | 120–160 Hz (tunable)  | 130 ms                |
| **High Tom** | Bridged-T + noise   | 165–220 Hz (tunable)  | 100 ms                |
| **Maracas**  | White noise → VCA   | Broadband             | 25–35 ms              |
| **Cowbell**  | Osc 1 + Osc 2 → BPF | 800 Hz + 540 Hz       | ~50 ms                |

Toms include diodes (D80–D85) in the feedback path that create a subtle **downward pitch sweep** as amplitude decays — the diode's forward resistance increases at lower signal levels, reducing effective resonance. Congas use the same circuits with one bridged-T half bypassed and no noise component.

### Restored §4 — SP-1200 SSM2044 output-filter specifications (lost item 4)

The E-mu SP-1200's character comes from the specific interaction of five signal processing stages, each contributing distinct artifacts. The Stanford CCRMA paper (Yeh, Nolting, Smith, 2007) provides the definitive model.

**Stage 5 — Output filters (channel-dependent):**

| Channels               | Filter                        | Details                                              |
| ---------------------- | ----------------------------- | ---------------------------------------------------- |
| 1–2 (Toms)             | **SSM2044** 4-pole VCF        | AR envelope from Z80; 5 ms attack, exponential decay |
| 3–4 (Snare, Bass)      | **5-pole 1 dB Chebyshev LPF** | Fixed cutoff, static                                 |
| 5–6 (Claps, Cowbell)   | **5-pole 1 dB Chebyshev LPF** | Higher cutoff than Ch 3–4                            |
| 7–8 (Hi-hats, Cymbals) | **Unfiltered**                | Direct output                                        |

#### SSM2044 filter specifications

The SSM2044 (Dave Rossum's design, now reissued as SSI2144) is a **4-pole (24 dB/oct) improved ladder filter** — distinct from the Moog ladder topology:

- **Sweep range:** 10,000:1 minimum
- **Frequency control:** −19 mV/octave (range: −18 to −20 mV/oct)
- **Q control:** 0–1000 µA; self-oscillation at ~400 µA
- **Key characteristic:** Passband gain **decreases** as Q increases — the distinctive "SSM2044 sound"
- **Dynamic range:** 92 dB (A-weighted)
- **External capacitors:** 6.8 nF on C1–C3, 560 pF on C4

In the SP-1200, resonance (Q) is fixed at zero/minimal — no user control. Cutoff is modulated only by the Z80's AR envelope via internal trimpots.

### Restored §5 — CR-78 metallic beat finding (lost item 1)

#### LinnDrum: µ-Law companding is the secret

The LinnDrum (LM-2, 1982) plays back 8-bit samples at **35 kHz** through **AM6070 µ-Law companding DACs** — one per voice. The µ-255 law encoding is critical:

```rust
fn mu_law_expand(compressed: u8) -> f32 {
    let mu: f32 = 255.0;
    let sign = if compressed & 0x80 != 0 { -1.0 } else { 1.0 };
    let magnitude = (compressed & 0x7F) as f32 / 127.0;
    sign * (1.0 / mu) * ((1.0 + mu).powf(magnitude) - 1.0)
}
// Effective dynamic range: ~72-78 dB (equivalent to 12-13 linear bits)
```

This non-linear quantization sounds dramatically warmer than linear 8-bit. The LinnDrum also has **no anti-aliasing filter on playback** — Roger Linn deliberately chose to let high-frequency aliasing through because "the results sounded like the sizzle of drums." Kick, toms, and congas pass through **CEM3320** voltage-controlled filters (24 dB/oct multimode). Each voice has its own DAC and clock, so pitch shifting equals variable sample-rate playback with attendant aliasing.

#### CR-78: the 808's predecessor

The Roland CR-78 (1978) is 100% analog using discrete transistor circuits. It shares the **bridged-T oscillator** topology with the 808 for drum tones, but with simpler envelopes (single-transistor "swing-type VCA" throughout). The hi-hat mixes square waves with white noise through a bridged-T bandpass filter. The signature **"metallic beat"** sound uses three filtered square waves through an **inductor-based filter** — a component that cannot be replicated with simple RC networks and must be modeled as an RLC resonator. The CR-78 sounds more delicate and organic than the 808, owing to simpler VCA envelopes and less defined transients.

### Restored §6 — Core DSP theory: saturation, antialiasing, numerical methods (lost item 7)

#### Nonlinear saturation models

Three saturation curves match different circuit behaviors:

**Soft diode clipping (808 pulse shaper, 909 kick waveshaper):** The Shockley diode equation I = Is × (e^(V/(n×VT)) − 1) governs 1N4148 behavior. For back-to-back diodes (909 waveshaper), the practical approximation is tanh soft clip:

```rust
fn tanh_saturate(x: f32, drive: f32) -> f32 {
    (x * drive).tanh() / drive.tanh()
}
// First antiderivative (for ADAA): F₁(x) = ln(cosh(x))
```

**Transistor saturation (808 swing-type VCA):** The Ebers-Moll model uses two back-to-back diodes with current gain. Key parameters for typical BJT: **βF = 200, βR = 0.1, Is = 6.734 × 10⁻¹⁵ A, VT = 26 mV**.

**Hard clipping (comparator/Schmitt trigger):** Digital output swings between VOL and VOH when input crosses thresholds VT+ and VT−.

#### Antiderivative antialiasing (ADAA)

For any memoryless nonlinearity y = f(x), first-order ADAA computes:

```rust
fn adaa_first_order(f1: impl Fn(f32) -> f32, x_n: f32, x_prev: f32, f_orig: impl Fn(f32) -> f32) -> f32 {
    let dx = x_n - x_prev;
    if dx.abs() > 1e-7 {
        (f1(x_n) - f1(x_prev)) / dx
    } else {
        f_orig(x_n) // Limiting case
    }
}
// For tanh: F₁(x) = ln(cosh(x))
// For hard clip at ±1: F₁(x) = x²/2 if |x|<1, |x|-0.5 if |x|≥1
// Introduces 0.5 sample delay
```

Second-order ADAA uses F₂ (second antiderivative) for ~20 dB better SNR at the cost of 1.0 sample delay. Bilbao, Esqueda, Parker, and Välimäki (IEEE SPL, 2017) provide the foundational theory.

#### Numerical integration: trapezoidal rule for WDFs

The **trapezoidal rule** (bilinear transform) is the standard discretization for virtual analog:

```
s → (2/T) × (z − 1)/(z + 1)
```

This is inherently **energy-preserving** and A-stable, making it ideal for wave digital filter (WDF) implementations. For stiff circuits with multiple nonlinearities, Werner's WDF approach uses **R-type scattering matrices** derived from Modified Nodal Analysis (MNA). The K-method/DK-method (Yeh, 2010) provides an alternative state-space formulation:

```
State update: x[n] = α·H·x[n-1] + H·(B·u[n] + C·i[n])
K matrix: K = D·H·C + F
Nonlinear solve: 0 = f(p[n] + K·i[n]) − i[n]  (Newton-Raphson)
```

where H = (αI − A)⁻¹ and α = 2/T for trapezoidal rule.

#### PolyBLEP for square wave oscillators

The 808 hi-hat's six square oscillators need antialiasing. Second-order PolyBLEP corrects ~2 samples around each transition:

```rust
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

fn square_wave(phase: f32, dt: f32) -> f32 {
    let mut value = if phase < 0.5 { 1.0 } else { -1.0 };
    value += poly_blep(phase, dt);
    value -= poly_blep((phase + 0.5) % 1.0, dt);
    value
}
```

#### Envelope shapes

808/909 envelopes are primarily **RC-derived exponential decays**, not linear ramps. The clap's multi-burst envelope is more complex — a chain of RC circuits triggered sequentially by comparator thresholds, requiring a state machine (`enum ClapEnvState { Burst(u8), Tail }`).

### Restored §7 — Reference-implementation roster with licensing tiers (lost item 3)

#### Tier 1: directly usable MIT-licensed code

**mi-plaits-dsp-rs** (MIT, Rust) — A complete native Rust port of Mutable Instruments Plaits, including all drum engines: analog bass drum (bridged-T + FM triangle VCO variants), analog snare (dual bridged-T + noise), and hi-hat (6 square oscillators + HPF noise). Runs at 48 kHz, `no_std` compatible, published as a crate. This is the **single best starting point** for Sourdaw. Source: `github.com/sourcebox/mi-plaits-dsp-rs`.

**Mutable Instruments Plaits** (MIT, C++) — The original C++ reference. Drum engines in `plaits/dsp/drums/`: `analog_bass_drum.h`, `analog_snare_drum.h`, `hihat.h`. Source: `github.com/pichenettes/eurorack`.

**DaisySP** (MIT, C++) — Clean API port of Plaits drum engines for embedded. Files: `AnalogBassDrum.cpp`, `AnalogSnareDrum.cpp`, `HiHat.cpp`. Source: `github.com/electro-smith/DaisySP`.

**ChowKick** (BSD 3-clause, C++) — Kick drum plugin directly based on Werner's 808 analysis. Uses chowdsp_wdf for wave digital filter modeling of the pulse shaper and bridged-T resonator. Source: `github.com/Chowdhury-DSP/ChowKick`.

**FunDSP** (MIT/Apache 2.0, Rust) — Composable audio DSP graph notation. Provides building blocks (oscillators, filters, envelopes, noise generators). Source: `crates.io/crates/fundsp`.

#### Tier 2: copyleft-licensed references

**WDR-8** (GPLv3, C++) — The most physically accurate 808 model found. Uses wave digital filters to model individual subcircuits from the service manual schematic. Built on chowdsp_wdf. Source: `github.com/Simon-L/WDR-8-rack`.

**Faust synths.lib** (LGPL) — Standard library drum functions: `kick()`, `clap()`, `hat()`, `additiveDrum()`, `popFilterDrum()`. Compiles to Rust, C++, and WASM. Source: `faustlibraries.grame.fr`.

**Geonkick** (GPLv3, C++) — Full-featured percussive synthesizer, LV2 plugin. Source: `github.com/Geonkick-Synthesizer/geonkick`.

#### Tier 3: academic reference code

**chowdsp_wdf** (BSD-style, C++) — Standalone WDF library implementing Werner's theory with Lambert-W diode solvers. Source: `github.com/Chowdhury-DSP/chowdsp_wdf`.

**ACME.jl** (Julia) — Holters-Zölzer generalized state-space method for automated circuit simulation. Source: `acmejl.readthedocs.io`.

### Restored §8 — Academic reading list (lost item 2)

The foundational literature breaks into four categories:

**TR-808 circuit analysis (Werner et al.):** Werner's 2016 Stanford dissertation "Virtual Analog Modeling of Audio Circuitry Using Wave Digital Filters" is the definitive source, using the 808 bass drum as its primary case study across all four chapters. The DAFx-14 paper provides the ODE systems and transfer functions. The ICMC 2014 paper covers the cymbal/hi-hat oscillator bank. The AES 2015 paper covers the cowbell. All are freely available from CCRMA.

**Antialiasing theory (Bilbao, Esqueda, Parker, Välimäki):** The IEEE SPL 2017 ADAA paper provides the core antialiasing framework for memoryless nonlinearities. Esqueda's 2019 Aalto dissertation "Aliasing Reduction in Nonlinear Audio Signal Processing" extends this with BLAMP methods and wavefolder models. Parker et al. (DAFx-16) established the continuous-time convolution foundation. Holters (DAFx-19) extended ADAA to stateful systems. Albertini et al. (DAFx-20) integrated ADAA into WDFs.

**Numerical circuit simulation (Yeh, Holters):** Yeh's 2009 Stanford dissertation introduces the K-method/DK-method for automated state-space modeling from netlists. Part I (IEEE TASLP 2010) provides theory; Part II (2012) validates on BJT circuits. Holters-Zölzer (EUSIPCO 2015) offers a more flexible generalized method implemented in Julia.

**Oscillator antialiasing (Välimäki et al.):** The DPW method (IEEE TASLP 2010) and PolyBLEP method (JASA 2012) are essential for the square-wave oscillators in hi-hat synthesis. The IEEE SPM 2007 survey provides the broader context.
