# Mathematical models for classic analog drum synthesis

**Every iconic drum machine sound from the TR-808, TR-909, LinnDrum, CR-78, and SP-1200 can be recreated digitally using well-documented circuit equations, and MIT-licensed Rust reference code already exists.** The academic foundation is remarkably solid: Kurt Werner's 2016 Stanford dissertation provides complete ODE systems for the 808's bridged-T networks, while the Stanford CCRMA paper on the SP-1200 details the exact drop-sample algorithm that creates its signature crunch. This appendix provides the transfer functions, component-derived coefficients, envelope models, and implementation strategies needed to build all major voices in Sourdaw's drum engine.

---

## 1. TR-808 bass drum: the bridged-T oscillator in full

The 808 kick is the most thoroughly analyzed analog drum circuit in academic literature. Werner, Abel, and Smith (DAFx-14, 2014) decomposed it into six cascaded blocks: trigger logic → pulse shaper → bridged-T network → feedback buffer → envelope generator → output stage. Each block has a closed-form transfer function.

### Bridged-T network component values and center frequency

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

### The attack frequency jump

The envelope generator (Q41–Q43) produces a **~5 ms pulse** that grounds R165 through Q43's collector, reducing R_eff from 53.8 kΩ to just **6.8 kΩ** (R166 alone). This raises the instantaneous center frequency to approximately **130 Hz** — over an octave above resting pitch. The resulting downward chirp is too fast to perceive as pitch but creates the attack's characteristic "punch."

### Bridged-T transfer function (bandpass, forward path)

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

### Feedback buffer (decay control)

```
H_fb(s) = (R169 × VR6k × C43 × s + R169) / (R164 × (R169 + VR6k) × C43 × s + R164)
```

where `VR6k = VR6 × k` and `k ∈ [0, 1]` is the decay knob position. **Decay range: 50–800 ms** (300 ms at center). This is a first-order high-shelf filter whose gain increases with k, sustaining oscillation longer.

### Pulse shaper nonlinear ODE

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

### Pitch sigh: transistor Q43 leakage model

The gradual downward pitch drift through the decay ("pitch sigh") is caused by residual collector current in Q43. Werner fits this as:

```
i_C = −ln(1 + e^(α × (V_comm − V₀)))^m / α
```

with fitted constants **α = 14.3150**, **V₀ = −0.5560**, **m = 1.4765 × 10⁻⁵**. As the control voltage decays, R_eff smoothly transitions from 6.8 kΩ back toward 53.8 kΩ, sweeping pitch downward.

### Discrete-time implementation

Werner recommends **bilinear transform** (c = 2/T) for all continuous-to-discrete conversions, implemented in **Transposed Direct Form II** (TDF-II) for numerical stability under time-varying coefficients. The delay-free feedback loop is resolved by inserting a **single unit delay** after the feedback buffer — negligible at kick drum frequencies relative to 48 kHz sample rate. All six blocks cascade in series, with nonlinearities applied as memoryless functions between filter stages.

```rust
// Per-sample kick drum processing (simplified)
fn process_kick(&mut self, trigger: bool, accent: f32) -> f32 {
    // 1. Trigger: accent controls voltage (5V normal, up to 15V accented)
    let v_trig = if trigger { 5.0 + accent * 10.0 } else { 0.0 };

    // 2. Pulse shaper: first-order shelf filter + diode clip
    let shaped = self.pulse_shelf.process(v_trig);
    let shaped = pulse_shape(shaped);

    // 3. Envelope: 5ms pulse controls R_eff
    self.env_timer = if trigger { 0.005 * SAMPLE_RATE } else { (self.env_timer - 1.0).max(0.0) };
    let r_eff = if self.env_timer > 0.0 { 6800.0 } else { 53800.0 };
    // Smooth r_eff for pitch sigh using Q43 leakage model

    // 4. Update bridged-T coefficients from r_eff
    self.bridged_t.update_coefficients(r_eff, R167, C41, C42);

    // 5. Process bridged-T with feedback
    let bt_out = self.bridged_t.process(shaped + self.feedback);
    self.feedback = self.feedback_buffer.process(bt_out) * self.decay_gain;

    // 6. Output: LPF (tone) → level → HPF (6.7 Hz DC block)
    let out = self.tone_lpf.process(bt_out);
    self.dc_block.process(out * self.level)
}
```

### Accent circuit behavior

Accent is **not just volume**. The CPU trigger voltage ranges from **5 V (unaccented) to 15 V (full accent)**. Higher trigger voltage increases the pulse amplitude into the bridged-T, which increases both loudness AND:

- **Longer ring time** (more energy in the resonator)
- **More pronounced pitch chirp** (higher initial excitation of the frequency-shifted mode)
- **Greater harmonic content** from the diode nonlinearity seeing larger signals
- In swing-type VCAs used on other voices, higher control voltage drives the transistor harder, adding **saturation harmonics**

---

## 2. TR-808 snare, hi-hat, and percussion voices

### Snare drum: dual bridged-T plus noise

The snare uses two bridged-T oscillators tuned roughly an octave apart, mixed with bandpass-filtered white noise.

**Lower oscillator (from service manual):** R196 = 680 Ω, R197 = 820 kΩ, C58 = 56 nF, C59 = 27 nF → **fc ≈ 173 Hz** (revised; original ~238 Hz). **Upper oscillator:** R195 = 2.2 kΩ, R198 = 1 MΩ, C60 = 6.8 nF, C61 = 15 nF → **fc ≈ 335 Hz** (revised; original ~476 Hz). The **Tone** knob (VR8) crossfades between oscillators. The **Snappy** knob (VR9) controls the noise VCA envelope amplitude.

The noise source is a reverse-biased **2SC828 NPN transistor** generating avalanche (white) noise, bandpass-filtered through a Sallen-Key 2-pole HPF at **~2749 Hz**. An attenuated noise envelope is summed into the oscillator excitation, coupling the "snappy" character into the tonal attack.

### Hi-hat and cymbal: six square-wave oscillators

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

```rust
// Hi-hat oscillator bank (simplified)
const HH_FREQS: [f32; 6] = [800.0, 540.0, 522.7, 369.6, 304.4, 205.3];

fn generate_metallic_noise(&mut self, sample_rate: f32) -> f32 {
    let mut sum = 0.0;
    for i in 0..6 {
        self.phase[i] += HH_FREQS[i] / sample_rate;
        if self.phase[i] >= 1.0 { self.phase[i] -= 1.0; }
        // Square wave: +1 or -1
        sum += if self.phase[i] < 0.5 { 1.0 } else { -1.0 };
    }
    sum / 6.0 // Normalize
}
```

### Handclap: multi-burst envelope

Bandpass-filtered white noise (center **~1000 Hz**) passes through two parallel VCA paths. Path 1 uses a **sawtooth-shaped envelope with 3 rapid bursts** (~10 ms each) followed by a 20 ms final discharge — total **~50 ms**. Path 2 provides a simple **100 ms decay** tail (fake reverb). This multi-burst pattern simulates multiple hands clapping at slightly different times.

### Remaining voices quick reference

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

---

## 3. TR-909: VCO architecture and hybrid analog-digital design

The 909 represents a fundamentally different design philosophy from the 808. Its kick uses a conventional VCO with separate envelope generators, and its cymbals/hi-hats are **6-bit digital samples** — a hybrid architecture that was unprecedented in 1983.

### 909 kick drum: sawtooth → waveshaper

The 909 kick has two parallel signal paths mixed at the output:

**Upper path (tone):** A VCO generates a triangle/sawtooth waveform. This passes through a **diode clipper** (back-to-back 1N4148 diodes) that soft-clips the peaks to approximate a sine wave. The waveshaper transfer function is:

```
f(x) ≈ V_clip × tanh(x / V_clip)    where V_clip ≈ 0.6–0.7 V
```

More precisely, the Shockley diode equation applies: **I = Is × (e^(V/(n×VT)) − 1)** with Is ≈ 2.52 nA for 1N4148, n ≈ 1.0, VT ≈ 25.85 mV. The result is a rounded waveform with residual odd harmonics — warmer and slightly grittier than a pure sine.

**EG3** provides an instant-attack, slow-decay contour applied to VCO frequency: pitch jumps high at trigger, then sweeps down to resting frequency (~55 Hz, set by **R59 = 47 kΩ**). The VCO resets phase on every trigger via Q11 for a consistent click.

**Lower path (attack/click):** The trigger is shaped through LPF and BPF circuits into a short transient, mixed with filtered LFSR noise, and passed through a separate VCA with its own envelope (ENV-2).

Key component: **C9 = 0.22–0.33 µF** (varies by PCB revision) sets the tune range. Default resting pitch: **~55 Hz**.

### 909 vs 808 kick: the critical difference

The 808 kick is a **self-decaying resonant circuit** — the bridged-T network IS the oscillator, and its natural decay IS the envelope. No separate VCO or amplitude envelope is needed. The 909 kick separates oscillation from amplitude shaping, using a **free-running VCO** plus explicit **envelope generators** for pitch and amplitude. This gives the 909 more "punch" and midrange presence, while the 808 produces deeper, cleaner sub-bass.

### 909 noise generator: 31-bit LFSR

Shared by snare, clap, and toms. Two **CD4006** 18-stage shift registers plus one **CD4070** quad-XOR gate form a **31-stage maximal-length LFSR** with feedback taps at **stages 31 and 13**:

```rust
fn lfsr_step(&mut self) -> f32 {
    let new_bit = ((self.state >> 30) ^ (self.state >> 12)) & 1;
    self.state = (self.state << 1) | new_bit;
    self.state &= 0x7FFFFFFF; // 31-bit mask
    // Output: bipolar [-1, 1]
    if (self.state >> 30) & 1 == 1 { 1.0 } else { -1.0 }
}
// Sequence length: 2^31 - 1 = 2,147,483,647
// Clock: ~300 kHz in hardware; run at sample rate in DSP
```

### 909 hi-hat: 6-bit samples from EPROM

Three **32 KB HN61256P EPROMs** store cymbal samples at **6-bit resolution**. The hi-hat ROM is shared between open and closed hats via address-line logic. Playback rate is **~32 kHz** at stock tuning (adjustable via counter clock). Samples were compressed before storage; an analog VCA with exponential decay envelope restores dynamics after the 6-bit DAC (simple resistor ladder). A post-DAC lowpass filter removes clock artifacts. The 909's cymbal samples were recorded from **Paiste and Zildjian hi-hat cymbals** by engineer Atsushi Hoshiai.

### 909 clap: four-burst envelope

Bandpass-filtered LFSR noise (center **~1140 Hz**, Q ≈ 1.95) through two parallel VCA paths. The primary path uses a **four-part sequential attack-decay envelope** — four op-amp stages chained together, each burst **~11 ms apart**, creating the "ta-ta-ta-TAA" signature. The reverb tail path uses a simple AR envelope with longer decay (C61 = 0.01 µF controls timing).

---

## 4. SP-1200 signal chain: where the "crunch" comes from

The E-mu SP-1200's character comes from the specific interaction of five signal processing stages, each contributing distinct artifacts. The Stanford CCRMA paper (Yeh, Nolting, Smith, 2007) provides the definitive model.

### Complete signal chain model

**Stage 1 — Anti-aliasing input filter:** Opamp-based, modeled as an **order-11 IIR filter** at 96 kHz (coefficients derived via SPICE AC analysis → MATLAB `invfreqz.m` system identification). Attenuates 42 dB at Nyquist.

**Stage 2 — ADC:** 12-bit linear quantization using an **AD7541** multiplying DAC in successive-approximation mode. Fixed sample rate of **26.04 kHz** (measured; not 27.5 kHz as originally specified). This yields **4096 quantization levels** and a **72 dB** theoretical dynamic range.

```rust
fn quantize_12bit(x: f32) -> f32 {
    (x * 2047.0).round() / 2047.0  // ±1.0 normalized range
}
```

**Stage 3 — Drop-sample pitch shifting (the "magic"):** Zero-order-hold, nearest-neighbor lookup with **no interpolation whatsoever**. For tuning ratio r:

```rust
fn drop_sample_pitch(buffer: &[f32], n: usize, ratio: f64) -> f32 {
    buffer[(n as f64 * ratio).floor() as usize % buffer.len()]
}
// ratio = 2.0_f64.powf(semitones / 12.0)
// Irrational ratios create complex, non-harmonic aliasing
```

This is the **single most important element** of the SP-1200 sound. When r is irrational (non-equal-temperament intervals), irregular sample skips create unpredictable aliasing patterns — the "stardust" artifacts.

**Stage 4 — ZOH DAC (no reconstruction filter):** The AD7541 output is a staircase waveform. Critically, **no reconstruction filter** exists on the output, so spectral images appear at f + k × 26040 Hz. The ZOH frequency response is: `H(f) = sinc(f/fs) × e^(−jπf/fs)`. Digitally, this is modeled by repeating each sample N times (N = 4 is sufficient).

**Stage 5 — Output filters (channel-dependent):**

| Channels               | Filter                        | Details                                              |
| ---------------------- | ----------------------------- | ---------------------------------------------------- |
| 1–2 (Toms)             | **SSM2044** 4-pole VCF        | AR envelope from Z80; 5 ms attack, exponential decay |
| 3–4 (Snare, Bass)      | **5-pole 1 dB Chebyshev LPF** | Fixed cutoff, static                                 |
| 5–6 (Claps, Cowbell)   | **5-pole 1 dB Chebyshev LPF** | Higher cutoff than Ch 3–4                            |
| 7–8 (Hi-hats, Cymbals) | **Unfiltered**                | Direct output                                        |

### SSM2044 filter specifications

The SSM2044 (Dave Rossum's design, now reissued as SSI2144) is a **4-pole (24 dB/oct) improved ladder filter** — distinct from the Moog ladder topology:

- **Sweep range:** 10,000:1 minimum
- **Frequency control:** −19 mV/octave (range: −18 to −20 mV/oct)
- **Q control:** 0–1000 µA; self-oscillation at ~400 µA
- **Key characteristic:** Passband gain **decreases** as Q increases — the distinctive "SSM2044 sound"
- **Dynamic range:** 92 dB (A-weighted)
- **External capacitors:** 6.8 nF on C1–C3, 560 pF on C4

In the SP-1200, resonance (Q) is fixed at zero/minimal — no user control. Cutoff is modulated only by the Z80's AR envelope via internal trimpots.

### Mathematical sources of SP-1200 character

The five artifacts compound multiplicatively:

1. **12-bit quantization distortion:** Signal-correlated noise at −72 dB. Creates harmonic distortion on sinusoidal inputs.
2. **Undersampling aliasing:** Frequencies above 13.02 kHz fold back as `f_alias = |f − k × 26040|`
3. **Drop-sample aliasing:** Effective sample rate becomes `26040/r`. Non-integer r creates non-harmonic content.
4. **ZOH spectral imaging:** Mirror images at `f + k × 26040 Hz`, shaped by sinc envelope — perceived as brightness.
5. **No reconstruction filter:** Images are NOT removed, creating "phantom" harmonics above Nyquist.

Simply applying a 12-bit bitcrusher and sample-rate reducer does **not** capture the SP-1200 sound — the pitch-shifting artifacts and analog filter chain are essential.

---

## 5. LinnDrum and CR-78 characteristics

### LinnDrum: µ-Law companding is the secret

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

### CR-78: the 808's predecessor

The Roland CR-78 (1978) is 100% analog using discrete transistor circuits. It shares the **bridged-T oscillator** topology with the 808 for drum tones, but with simpler envelopes (single-transistor "swing-type VCA" throughout). The hi-hat mixes square waves with white noise through a bridged-T bandpass filter. The signature **"metallic beat"** sound uses three filtered square waves through an **inductor-based filter** — a component that cannot be replicated with simple RC networks and must be modeled as an RLC resonator. The CR-78 sounds more delicate and organic than the 808, owing to simpler VCA envelopes and less defined transients.

---

## 6. Core DSP theory: saturation, antialiasing, and numerical methods

### Nonlinear saturation models

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

### Antiderivative antialiasing (ADAA)

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

### Numerical integration: trapezoidal rule for WDFs

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

### PolyBLEP for square wave oscillators

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

### Envelope shapes

808/909 envelopes are primarily **RC-derived exponential decays**, not linear ramps:

```rust
fn rc_decay(state: &mut f32, target: f32, coefficient: f32) -> f32 {
    // coefficient = e^(-1/(decay_time_seconds * sample_rate))
    // Typical: 0.9999 for ~200ms at 48kHz
    *state = target + (*state - target) * coefficient;
    *state
}
```

The clap's multi-burst envelope is more complex — a chain of RC circuits triggered sequentially by comparator thresholds, requiring a state machine:

```rust
enum ClapEnvState { Burst(u8), Tail }

fn clap_envelope(&mut self) -> f32 {
    match self.state {
        ClapEnvState::Burst(n) if n < 3 => {
            self.env *= 0.985; // ~10ms RC decay at 48kHz
            if self.env < 0.1 {
                self.env = 1.0; // Retrigger
                self.state = ClapEnvState::Burst(n + 1);
            }
            self.env
        }
        _ => {
            self.env *= 0.9997; // ~100ms tail decay
            self.env
        }
    }
}
```

---

## 7. Open-source reference implementations and licensing

The following projects provide legally reusable code for Sourdaw's drum engine:

### Tier 1: directly usable MIT-licensed code

**mi-plaits-dsp-rs** (MIT, Rust) — A complete native Rust port of Mutable Instruments Plaits, including all drum engines: analog bass drum (bridged-T + FM triangle VCO variants), analog snare (dual bridged-T + noise), and hi-hat (6 square oscillators + HPF noise). Runs at 48 kHz, `no_std` compatible, published as a crate. This is the **single best starting point** for Sourdaw. Source: `github.com/sourcebox/mi-plaits-dsp-rs`.

**Mutable Instruments Plaits** (MIT, C++) — The original C++ reference. Drum engines in `plaits/dsp/drums/` implement behavioral simulation of classic circuits: `analog_bass_drum.h` (bridged-T excitation model), `analog_snare_drum.h` (dual resonators + noise), `hihat.h` (six square oscillators or three ring-modulated pairs). Émilie Gillet's code comment: "No fancy acronyms or patented technology here... Just behavioral simulation of circuits from classic drum machines!" Source: `github.com/pichenettes/eurorack`.

**DaisySP** (MIT, C++) — Clean API port of Plaits drum engines for embedded. Files: `AnalogBassDrum.cpp`, `AnalogSnareDrum.cpp`, `HiHat.cpp`. Source: `github.com/electro-smith/DaisySP`.

**ChowKick** (BSD 3-clause, C++) — Kick drum plugin directly based on Werner's 808 analysis. Uses chowdsp_wdf library for wave digital filter modeling of the pulse shaper and bridged-T resonator. Source: `github.com/Chowdhury-DSP/ChowKick`.

**FunDSP** (MIT/Apache 2.0, Rust) — Composable audio DSP graph notation. No dedicated drum models but provides all building blocks (oscillators, filters, envelopes, noise generators). Source: `crates.io/crates/fundsp`.

### Tier 2: copyleft-licensed references

**WDR-8** (GPLv3, C++) — The most physically accurate 808 model found. Uses wave digital filters to model individual subcircuits from the service manual schematic, including simplified envelope generator, shell resonators with waveshapers, and diode clipper VCA. Built on chowdsp_wdf. Source: `github.com/Simon-L/WDR-8-rack`.

**Faust synths.lib** (LGPL) — Standard library drum functions: `kick()`, `clap()`, `hat()`, `additiveDrum()`, `popFilterDrum()`. Faust compiles to Rust, C++, and WASM. Source: `faustlibraries.grame.fr`.

**Geonkick** (GPLv3, C++) — Full-featured percussive synthesizer, LV2 plugin. Source: `github.com/Geonkick-Synthesizer/geonkick`.

### Tier 3: academic reference code

**chowdsp_wdf** (BSD-style, C++) — Standalone WDF library implementing Werner's theory with Lambert-W diode solvers. Source: `github.com/Chowdhury-DSP/chowdsp_wdf`.

**ACME.jl** (Julia) — Holters-Zölzer generalized state-space method for automated circuit simulation. Source: `acmejl.readthedocs.io`.

---

## 8. Academic papers: the essential reading list

The foundational literature for this implementation breaks into four categories:

**TR-808 circuit analysis (Werner et al.):** Werner's 2016 Stanford dissertation "Virtual Analog Modeling of Audio Circuitry Using Wave Digital Filters" is the definitive source, using the 808 bass drum as its primary case study across all four chapters. The DAFx-14 paper provides the ODE systems and transfer functions summarized in Section 1. The ICMC 2014 paper covers the cymbal/hi-hat oscillator bank. The AES 2015 paper covers the cowbell. All are freely available from CCRMA.

**Antialiasing theory (Bilbao, Esqueda, Parker, Välimäki):** The IEEE SPL 2017 ADAA paper provides the core antialiasing framework for memoryless nonlinearities. Esqueda's 2019 Aalto dissertation "Aliasing Reduction in Nonlinear Audio Signal Processing" extends this with BLAMP methods and wavefolder models. Parker et al. (DAFx-16) established the continuous-time convolution foundation. Holters (DAFx-19) extended ADAA to stateful systems. Albertini et al. (DAFx-20) integrated ADAA into WDFs.

**Numerical circuit simulation (Yeh, Holters):** Yeh's 2009 Stanford dissertation introduces the K-method/DK-method for automated state-space modeling from netlists. Part I (IEEE TASLP 2010) provides theory; Part II (2012) validates on BJT circuits. Holters-Zölzer (EUSIPCO 2015) offers a more flexible generalized method implemented in Julia.

**Oscillator antialiasing (Välimäki et al.):** The DPW method (IEEE TASLP 2010) and PolyBLEP method (JASA 2012) are essential for the square-wave oscillators in hi-hat synthesis. The IEEE SPM 2007 survey provides the broader context.

---

## Conclusion: a practical implementation roadmap for Sourdaw

Three strategic insights emerge from this research. First, **start with mi-plaits-dsp-rs** — it is MIT-licensed, written in Rust, and implements behavioral models of all three core 808 voices (kick, snare, hi-hat) that are already proven in thousands of Eurorack modules. This provides a working baseline within days rather than weeks.

Second, for **higher fidelity**, layer in circuit-level modeling from Werner's transfer functions. The bridged-T equations in Section 1 can be implemented as time-varying biquad filters with bilinear-transformed coefficients, using TDF-II topology for stability. The 808 kick alone has six cascaded stages, but each is individually simple — at most a second-order filter or a memoryless nonlinearity.

Third, the SP-1200 effect is **algorithmically simple but perceptually critical** — the entire character reduces to `buffer[floor(n × ratio)]` with no interpolation, 12-bit quantization, and a 4-pole lowpass on select channels. This can be implemented in under 100 lines of Rust and applied as a channel insert effect.

The component tolerances (±20% capacitors, ±5% resistors) that made every hardware unit sound slightly different are a feature, not a bug. Exposing these as randomized parameters in Sourdaw would give each drum instance authentic organic variation — the same mathematical property that made these machines legendary.
