# Spec: Flagship Piano Physical Modeling Plugin

## 1. Overview

This specification defines the implementation of a state-of-the-art physically modeled piano for Sourdaw, based on generic **modal and waveguide synthesis** principles. It aims to achieve professional-grade realism, unlimited dynamic range, and a small footprint (~50MB), deployable across Native (Tauri) and WASM (Browser) environments. It includes an optional hybrid sampled-attack pathway and MIDI 2.0 support.

> ⚠️ **LEGAL & COMPLIANCE WARNING**: While commercial products like Modartt's Pianoteq serve as the benchmark for expected quality and performance, **under no circumstances** should any patented algorithms (such as US7915515B2) or proprietary code be implemented or reverse-engineered. The implementation MUST be entirely clean-room, utilizing open-source (MIT/Apache) or public domain acoustic physics research (e.g., standard digital waveguide synthesis, generic modal synthesis).

## 2. Architecture & Deployment

### 2.1 Three-Layer Separation

- **React UI (Presentation)**: Modern UI with WebGPU-powered visualizations (string vibration, spectral waterfall, 3D piano model).
- **Project State (TS)**: Canonical state management for parameters, presets, and automation.
- **DSP Engine (Rust)**: Real-time modal synthesis, voice management, and audio rendering.

### 2.2 Deployment Targets & Lock-Free Communication

- **Native (Tauri)**: Uses `cpal` for low-latency audio. Support for up to 256 voices and full soundboard modeling. Audio never crosses the IPC bridge. Uses **Tauri v2 Channels** (async callbacks) for streaming metering data to the frontend at 30-60 fps.
- **WASM (Browser)**: Runs in `AudioWorkletProcessor` (128-sample blocks). Targeted 64-voice polyphony with quality tiering. A **Web Worker** handles background tasks (preset loading, sample decoding for hybrid attacks). SharedArrayBuffer connects the AudioWorklet to the main thread (using wait-free `ringbuf.js`).
- **Communication**: Use `AtomicF32` for scalar values (hammer hardness, etc.) and `rtrb` SPSC ring buffers for complex state changes (model loading, temperaments) to prevent DSP graph rebuilds.

### 2.3 MIDI 2.0 & Microtuning

- **MIDI 2.0 UMP**: Full support for 65,536-level velocity resolution directly mapped to the nonlinear hammer interaction.
- **Per-note Expression**: Maps pitch bend, pressure, and timbre controllers to per-voice modal parameters.
- **Microtuning**: Supports 1/512th of a semitone precision per note for historical temperaments.

## 3. User-Visible Behavior & Scope

### 3.1 User-Visible Behavior

- **Zero-Friction Playability**: High-polyphony support (256 voices) and MIDI 2.0 resolution ensure a seamless experience from pianissimo to fortissimo.
- **WebGPU Visualizations**: Real-time feedback via 3D string vibration splines, spectral waterfall, and an interactive 3D grand piano model with articulated lid/hammers.
- **Authentic Pedaling**: Support for continuous half-pedaling, repedaling (catch pedaling), and authentic timbral shifts via Una Corda and Sostenuto.
- **Custom Calibration**: User-adjustable velocity curves and MIDI controller calibration to match the instrument to the player's touch.
- **Granular Control**: **Per-note parameter editing** of 30+ physical parameters (hammer hardness, string stiffness, bridge coupling, etc.).
- **Morphing Capabilities**: Support for morphing and layering across different piano models.
- **Near-Zero Footprint**: Instant loading (~50MB) and near-zero disk anxiety compared to multi-gigabyte sample libraries.

### 3.2 Scope

- **In scope**:
    - **Rust Audio Engine (DSP)**: Modal synthesis with pre-allocated lock-free voice pool.
    - **React Frontend**: Modern UI with Zustand state management.
    - **Visuals (WebGPU)**: Compute shaders for wave equation (string vibration) and rolling 3D spectrogram (spectral waterfall).
    - **Usability Features**: MIDI controller calibration tool, per-note parameter editing, and preset/model marketplace integration.
    - **Advanced Modeling**: Sympathetic resonance (global resonator bank), dampers, mechanical noise components, **longitudinal modes** (phantom partials), and **duplex scale resonance**.
    - **Historical Temperaments**: Full support for historical tuning systems with cent-accurate offsets.

---

## 4. Historical Temperament Offsets (Relative to A=0)

| Temperament          | C     | C#    | D    | D#    | E    | F     | F#    | G    | G#    | A   | A#    | B    |
| :------------------- | :---- | :---- | :--- | :---- | :--- | :---- | :---- | :--- | :---- | :-- | :---- | :--- |
| **Werckmeister III** | +11.7 | +2.0  | +3.9 | +5.9  | +2.0 | +9.8  | 0.0   | +7.8 | +3.9  | 0.0 | +7.8  | +3.9 |
| **Kirnberger III**   | +10.3 | +0.5  | +3.4 | +4.4  | -3.4 | +8.3  | +0.5  | +6.8 | +2.4  | 0.0 | +6.4  | -1.5 |
| **Vallotti**         | +5.9  | 0.0   | +2.0 | +3.9  | -2.0 | +7.8  | -2.0  | +3.9 | +2.0  | 0.0 | +5.9  | -3.9 |
| **Young II**         | +5.9  | -3.9  | +2.0 | 0.0   | -2.0 | +3.9  | -5.9  | +3.9 | -2.0  | 0.0 | +2.0  | -3.9 |
| **Meantone ¼-comma** | +10.3 | -13.7 | +3.4 | +20.5 | -3.4 | +13.7 | -10.3 | +6.8 | -17.1 | 0.0 | +17.1 | -6.8 |

---

## 5. Synthesis Engine: Modal Synthesis

### 3.1 The Stiff String Wave Equation

The core engine represents transverse displacement `y(x,t)` of a damped stiff piano string:

```
∂²y/∂t² = c² · ∂²y/∂x² − κ² · ∂⁴y/∂x⁴ − 2b₁ · ∂y/∂t + 2b₂ · ∂³y/(∂x²∂t) + f(x,t)
```

Where `c` = √(T / ρA) and `κ` = √(EI / ρA). Steel Young's Modulus E = 210 GPa.

**Modal Frequencies (Inharmonicity)**:

```
f_n = n · f₁ · √(1 + B · n²)
```

Inharmonicity coefficient `B`: `B = π³ · E · d⁴ / (64 · T · L²)`.
Equivalent Linear Density (Wound Strings): `ρA = ρ_steel · π(d_core/2)² + ρ_copper · π[(d_outer/2)² − (d_core/2)²]`.

**Modal Decay Rates**:

```
σ_n = b₁ + b₂ · (2πf_n)² / c²
```

T60 decay time: `T60_n = 6.91 / σ_n`.

### 3.2 Hammer-String Interaction

A nonlinear power-law model for felt compression:

```
F(t) = K · [δ(t)]^p  (contact if δ > 0)
```

Where `δ(t) = x_H(t) − y(x₀, t)`.

**Stulov Hysteresis Extension**:

```
F(t) = F₀ · [ξ(t)]^p · [1 − ε₀ · h(t) / max(ξ(t), ε_min)]
```

- `h(t)` is low-pass-filtered compression rate: `h[n] = α · h[n−1] + (1−α) · dξ/dt[n]`
- `α = exp(−Δt / t₀)`
- `ε₀`: Hysteresis strength (0.2–0.5)
- `t₀`: Memory time scale (1–5 ms)

**Hammer Implementation (Oversampled 4-8x)**:
Use Störmer-Verlet (leapfrog) integration.

```rust
fn update_hammer(h: &mut Hammer, y_string: f64, dt: f64) -> f64 {
    let compression = (h.x - y_string).max(0.0);
    let force = h.stiffness_k * compression.powf(h.exponent_p);
    let accel = -force / h.mass;
    h.v += accel * dt;
    h.x += h.v * dt;
    force
}
```

### 3.3 Hybrid Sampled-Attack Pathway

To mitigate the "uncanny valley" risk of pure modeling, implement an **optional hybrid pathway**.

- Blend sample-based attack transients (first 10–50 ms) with the modeled sustain.
- Combines real hammer-strike recording authenticity with the infinite decay fidelity of modal synthesis.

### 3.4 Coupled Strings & Two-Stage Decay

Notes (A1-C8) have 2-3 unison strings detuned by 0.5–2 cents.

- **Vertical Polarization**: Fast initial decay ("prompt sound"). `σ_{n,fast} = σ_string(n) + σ_bridge`.
- **Horizontal Polarization**: Slow sustained decay ("aftersound"). `σ_{n,slow} = σ_string(n) + σ_bridge/100`.
  Bridge admittance `Y_bridge ≈ 10⁻³ s/kg`.

### 3.5 Modal Resonator (Biquad)

Implemented as second-order bandpass resonators using impulse-invariant transform:

```
y[n] = C0 · (x[n] − x[n−2]) + C1 · y[n−1] + C2 · y[n−2]
```

**Coefficients**:

```rust
let theta = 2.0 * PI * f_k / f_s;
let r = (-PI * bw / f_s).exp();
let c0 = amp * (1.0 - r * r) * theta.sin() / 2.0;
let c1 = 2.0 * r * theta.cos();
let c2 = -(r * r);
```

**Modal Amplitude `A_n`**: `A_n ∝ sin(nπ · x_hammer / L) / n`.
Striking position: `x_hammer / L ≈ 1/8` (middle), `1/12` (treble), `1/7` (bass) creates a notch at the 8th harmonic.

### 3.6 Soundboard Model

- **Option A (Commuted)**: Convolve excitation with soundboard IR (partitioned FFT).
- **Option B (Multi-rate)**: Split at ~2.2 kHz. LF band downsampled 8x with FIR; HF band magnitude-only IIR.
- **Option C (Parametric)**: Bank of 100-200 parallel biquads representing physical modes.

## 4. Voice Management & Polyphony

### 4.1 Voice Pool & Progressive Simplification

- Fixed-size array of 256 `PianoVoice` structs, lock-free state transitions via `AtomicU32`.
- **Progressive Model Simplification**: Switch from nonlinear to linear string models as notes decay, reducing per-voice cost by ~40% for older voices without audible degradation.

### 4.2 Voice Stealing Scoring

```
Score = Idle(1000) > Stealing(500) > Released(400 - age) > PedalSustained(200 - amp)
```

Protect highest/lowest notes and apply a 1ms exponential fade-out for stolen voices.

### 4.3 Sympathetic Resonance

Global resonator bank of 12-24 biquad filters tuned to fundamental frequencies.
Driven by aggregate bridge force: `bridge_force_total(t) = Σ_{active strings i} coupling(i,j) · F_bridge_i(t)`.

## 5. Mechanical Noise & Pedals

### 5.1 Mechanical Noise Components

Triggered short filtered noise bursts: `noise_burst(t) = A · envelope(t) · bandpass_filter(white_noise(t))`

- **Key-down thud**: 5–15 ms, -30 to -50 dB.
- **Hammer let-off click**: 2–5 ms, -40 to -55 dB.
- **Damper lift**: 5–10 ms, -45 to -60 dB.
- **Pedal down**: 15–30 ms, -30 to -45 dB.

### 5.2 Damper & Pedal Models

- **Damper Model**: `σ_total(n) = σ_string(n) + σ_damper(n, pedal_pos)`.
- **Half-pedaling (CC64)**: `σ_damper(n, p) = σ_max(n) · (1 − smoothstep(p, 0.15, 0.85))`. Scale with `n^0.5`. Notes above C7 have no dampers.
- **Una Corda (CC67)**: `hammer_stiffness_K *= 0.7`, `sympathetic_coupling_to_unexcited = 0.3`. Strikes 2/3 strings.
- **Sostenuto (CC66)**: Selectively sustains held notes at engagement time.

## 6. Physical Parameter Tables (Steinway D Reference)

### 6.1 Hammer Interpolation Formulae

- `log₁₀(K(key)) ≈ 8.3 + 0.048 · (key − 1)`
- `p(key) ≈ 2.0 + 0.017 · (key − 1)`
- `m_H(key) ≈ 11.0 · exp(−0.0134 · (key − 1))` [grams]

### 6.2 Typical String Parameters

| Note | Key# | f₀ (Hz) | L (m) | d (mm)        | B      | Type           |
| ---- | ---- | ------- | ----- | ------------- | ------ | -------------- |
| A0   | 1    | 27.5    | 2.01  | 1.0 c + 5.5 w | 0.0002 | Double wound   |
| C4   | 40   | 261.6   | 0.62  | 1.00 plain    | 0.0007 | Trichord plain |
| C8   | 88   | 4186    | 0.05  | 0.70 plain    | 0.10   | Trichord plain |

### 6.3 Railsback Curve (Stretched Tuning)

| Note | Key# | Offset (cents) |
| ---- | ---- | -------------- |
| A0   | 1    | -30            |
| C4   | 40   | -1             |
| A4   | 49   | 0              |
| C8   | 88   | +35            |

## 7. Advanced Modeling Details

### 7.1 Phantom Partials & Longitudinal Modes

- Longitudinal wave speed in steel: `c_L ≈ 5,100 m/s`. `f_L,k = k · c_L / (2L)`.
- Add 2–5 additional resonators for bass notes (below C5), driven by squared transverse partial sum.

### 7.2 Duplex Scale Resonance

- Add 1–2 high-Q resonators for C4+ notes, tuned to octave/12th/double-octave ratios. Level: -30 to -40 dB.

### 7.3 Numerical Stability & SIMD Optimization

- Use `f64` for resonators below 200 Hz. Consider coupled-form oscillator for narrow-bandwidth stability.
- **SIMD (SoA)**: `#[repr(C, align(64))]` Struct-of-Arrays processing `c0, c1, c2, y_prev, y_prev2` arrays with `f32x8`.

## 8. UI & Visualization (WebGPU)

- **String Vibration**: 88 strings rendered as 3D splines with amplitudes driven by note velocity and frequency-dependent decay (Wave Equation compute shader). Visually shows sympathetic resonance.
- **Spectral Waterfall**: A rolling 3D spectrogram (FFT compute shaders) using audio data shared via `SharedArrayBuffer → GPUBuffer`. Shows 2-stage decay.
- **Interactive 3D Piano**: Full grand piano model with articulated lid, animated hammers on note-on, and damper felts lifting/lowering with pedals.

## 9. Acceptance Criteria

- [ ] `PianoEngine` pre-allocates all memory (lock-free, allocation-free audio thread).
- [ ] 256 voices native, 64 voices WASM (SIMD optimized). Progressive simplification active for decayed notes.
- [ ] Correct inharmonicity `B` implementation for all 88 keys.
- [ ] Continuous half-pedaling response (CC64) and proper Una Corda/Sostenuto logic.
- [ ] Velocity curve editor correctly scales MIDI 2.0 16-bit velocity to the hammer force model.
- [ ] 3D piano model correctly animates lid position and per-key hammer/damper state.
- [ ] Preset loading is instantaneous (<100ms) and does not cause audio glitches.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] Sympathetic resonance gated by sustain pedal/held keys.
- [ ] Longitudinal modes and duplex scale present at specified levels.
- [ ] WebGPU UI renders string vibration and spectral waterfall via GPU buffers.
- [ ] MIDI 2.0 resolution and microtuning correctly map to synthesis parameters.
- [ ] Optional hybrid sampled-attack pathway correctly crossfades into modal sustain.

## 10. References

- Bank & Chabassier (2019): _Physical Modeling of Piano Sound_.
- Guillaume (US7915515B2): _Pianoteq Patent_.
- Chabassier & Duruflé (2012): _INRIA Technical Report RT-0425_.

# Realism appendix for physical-modeling piano synthesis

A physical-modeling piano synthesizer that passes blind listening tests must close specific, measurable gaps in hammer hysteresis, soundboard radiation, nonlinear string coupling, and attack-transient detail. **The single most important finding across the literature is that spectral-envelope evolution over the first 500 ms — not steady-state harmonic content — is what listeners use to distinguish modeled from recorded piano.** This appendix compiles every equation, measured parameter, and technique needed to close those gaps, organized for direct implementation in a Rust DSP engine. Each section targets a specific perceptual deficiency identified in academic listening tests, provides the governing math, cites measured data, and offers a concrete implementation strategy.

---

## A1. What listeners actually hear: perceptual gaps in current models

Bernays & Traube (2014, CIM14 Berlin) conducted the most directly relevant study: **19 expert pianists** compared timbre identification across real audio recordings, Pianoteq 4.5, and GarageBand sample-based synthesis. The overall identification rates were statistically indistinguishable between Pianoteq (0.616) and recordings (0.591), with p = 0.447. However, Pianoteq showed a specific weakness reproducing **"dark" timbre** (0.386 vs 0.439), suggesting the model under-represents low-frequency body resonance characteristics.

Bernays & Traube (2011, ISPS Toronto) established a **five-descriptor taxonomy** of piano timbre — bright, dry, dark, round, velvety — derived from multidimensional scaling of 14 adjectives. These five descriptors span a four-dimensional perceptual space where the first two dimensions explain **78% of variance**. A physical model must reproduce all five timbral nuances through appropriate velocity, articulation, and pedal response.

Siedenburg (2019, JASA 145(2):1078) demonstrated that **slowly evolving spectral-envelope buildup** during the onset is more perceptually critical than rapidly varying noise transients. Removing the fast transient component degraded instrument identification by only 6%, while shifting the analysis window away from onset degraded it by 25%. For piano synthesis, this means the first 50–150 ms of harmonic energy buildup matters far more than the brief chaotic click.

Fletcher, Blackham & Stratton (1962, JASA 34(6):749) established foundational thresholds: attack times must be **< 10 ms** for piano-like quality, optimal partial roll-off is **2 dB per 100 Hz**, and notes below middle C require audible inharmonicity. Their 8-listener jury could not distinguish 100-partial synthetic tones from real recordings when these criteria were met.

Järveläinen, Välimäki & Karjalainen (2001, Acoustics Research Letters Online 2(3):79) measured inharmonicity detection thresholds: **ln(B) = 2.57·ln(f₀) − 26.5**, meaning the threshold at C♯6 is over 1,000× higher than at A1. Below C4, inharmonicity must be modeled accurately; above C5, it is perceptually optional.

Osses & Kohlrausch (2019, JASA 146(2):1024; 2021, JASA 149(5):3534) validated the **PEMO auditory model** against human discrimination of 7 pianos, finding that the adaptation-loop overshoot at onset is particularly important for piano sounds. This model provides a computational quality metric for synthesis evaluation.

**Ranked perceptual priorities for implementation:**

- **Critical (implement first):** Spectral-envelope accuracy in first 500 ms, attack timing < 10 ms, inharmonicity below C4, double-decay from coupled strings, stretched tuning
- **High (implement second):** Velocity-dependent brightness, sympathetic resonance, phantom partials in bass, soundboard body resonance
- **Medium (implement third):** Key mechanism noise, longitudinal modes, half-pedaling, radiation directivity
- **Lower (optimize later):** High-partial behavior during late decay, very high partials in loud passages (masked by upward spread), precise partial phase relationships

Community listening tests from the Modartt forums consistently identify these specific Pianoteq weaknesses: a **metallic ring in the upper two octaves**, insufficient overall resonance compared to real Steinways, and excess high-mid energy in the attack. These map directly to incomplete soundboard modeling and over-simplified hammer-felt nonlinearity.

---

## A2. Advanced hammer-string interaction

### Stulov's viscoelastic felt model

The basic Chaigne & Askenfelt power-law F = Kδᵖ is memoryless. Real hammer felt exhibits hysteresis — the loading and unloading paths differ, dissipating energy and producing asymmetric force pulses. Stulov (1995, JASA 97(4):2577, DOI: 10.1121/1.411912) derived a four-parameter hereditary model:

$$F(t) = F_0 \left[\delta^p(t) - \frac{\varepsilon}{\tau_0}\int_0^t e^{-(t-s)/\tau_0}\,\delta^p(s)\,ds\right]$$

The four parameters are: **F₀** (instantaneous stiffness, N/mmᵖ), **p** (nonlinearity exponent), **ε** (hysteresis amplitude, 0 < ε < 1), and **τ₀** (relaxation time, µs). Measured values for C4 from Stulov (2005, Acta Acustica 91:1086): F₀ = 8800 N/mmᵖ, p = 3.95, ε = 0.992, τ₀ = 2.0 µs.

Stulov's simplified three-parameter Voigt-like form eliminates the convolution integral:

$$F(t) = Q_0\left[\delta^p(t) + a\cdot\dot\delta(t)\cdot|\delta(t)|^{p-1}\right]$$

For note n = 49: a = 310 µs, p = 4.43, Q₀ = 1660 N/mmᵖ. This form requires only a finite difference for δ̇ and no history buffer, making it **ideal for real-time Rust implementation**. The hysteresis causes asymmetric force pulses (fast rise, slower decay), richer spectral excitation, velocity-dependent effective stiffness, and realistic energy dissipation during contact.

**Rust implementation:** Compute `F = Q0 * (delta.powf(p) + a * delta_dot * delta.abs().powf(p - 1.0))` each sample. Use `delta_dot = (delta - delta_prev) * sample_rate`. The exponential kernel in the four-parameter model maps to a one-pole IIR filter on δᵖ(t) if needed.

### Hammer shank flexibility

Askenfelt & Jansson (1991, JASA 90:2383, DOI: 10.1121/1.402043) measured two shank resonance modes: a **"backwash" mode at ~50 Hz** (whole-shank flexure) and a **"ripple" mode at ~250 Hz** for C4 (higher-order bending with the hammer head oscillating in the string direction). The ripple mode correlates with perceived piano quality — better instruments show more developed ripple.

Chabassier & Duruflé (2014, J. Sound Vib. 333(24):7198) modeled the shank as a Timoshenko beam in non-forced rotation, with governing equations:

$$\rho A \frac{\partial^2 u}{\partial t^2} = \frac{\partial}{\partial x}\left[GA\kappa\left(\frac{\partial u}{\partial x} - \phi\right)\right], \quad \rho I \frac{\partial^2 \phi}{\partial t^2} = \frac{\partial}{\partial x}\left(EI\frac{\partial \phi}{\partial x}\right) + GA\kappa\left(\frac{\partial u}{\partial x} - \phi\right)$$

Their key finding: **pianistic touch influences the spectrum of equally-loud notes** through shank vibration, even without modeling impact-point variation or longitudinal rubbing.

**Rust implementation:** Model the shank as 2–3 damped harmonic oscillators (backwash + ripple modes) coupled to the hammer-head mass. This adds only 4–6 state variables per active note: `m_H * y_H_ddot = -F_contact + sum(F_shank_modes)` where each shank mode is a second-order resonator driven by the reaction force at the pivot.

### Multiple hammer-string contacts

Multiple contacts are not an artifact — they are a **physical reality** in the bass register. Askenfelt & Jansson (1993, JASA 93:2181, DOI: 10.1121/1.406680) measured 2–4 contacts for bass notes, diminishing to single contact in the treble. The governing physics: reflected waves from the near bridge return to the hammer contact point and push the hammer away. When the mass ratio r = m_H/M_string is small (bass), the hammer rebounds and recontacts.

Contact durations decrease from **~4 ms (bass, pp) to < 0.5 ms (highest treble, ff)**, with ~±20% variation across the dynamic range.

**Rust implementation:** Multiple contacts emerge automatically from a properly coupled simulation. Check δ > 0 every sample; allow force to go to zero and re-engage. For waveguide models, the incoming traveling wave at the hammer point determines recontact. Bass notes require sufficient spatial resolution in the delay line.

### Velocity-dependent spectral envelope

The hammer-string contact acts as a **low-pass filter** with cutoff frequency f_cutoff ≈ 1/(2τ_c), where τ_c is contact duration. Russell & Rossing (1998, Acta Acustica 84:967) measured residual shock spectrum peak frequencies across 15 voiced Steinway D hammers:

| Velocity | Bass peak | Treble peak |
| -------- | --------- | ----------- |
| 1 m/s    | ~200 Hz   | ~2000 Hz    |
| 5 m/s    | ~500 Hz   | ~6000 Hz    |

The peak frequency scales as f_peak ∝ v^((p−1)/(p+1)). The nonlinearity exponent p increases smoothly from **~2 in bass to ~4 in treble**.

Aramaki et al. (2000, ICMC) decomposed the excitation spectrum into energy, static spectrum, and a brightness tilt:

$$B_t(\omega_k) = (B_M - B_m \cdot e^{-\beta v})\cdot k$$

where k is the partial index, v is hammer velocity, B_m and B_M define the brightness range, and β is velocity sensitivity. This linear-in-k spectral tilt saturates asymptotically at high velocity.

**Rust implementation — three approaches (increasing fidelity):**

1. **One-pole lowpass** on excitation with velocity-dependent cutoff: `f_c(v) = f_c_min + (f_c_max - f_c_min) * (1.0 - (-beta * v).exp())`
2. **Per-partial gain** via Aramaki tilt model applied in dB
3. **Full nonlinear simulation** where spectral envelope emerges naturally from the coupled hammer-string ODE

---

## A3. Soundboard radiation and room coupling

### Driving-point mobility: the Skudrzyk framework

Boutillon & Ege (2013, J. Sound Vib. 332:4261, DOI: 10.1016/j.jsv.2013.03.005) applied the Skudrzyk mean-value theorem to obtain the characteristic (mean) admittance of the soundboard:

$$G_C = \frac{n(f)}{4M}$$

where n(f) is modal density (modes/Hz) and M is total soundboard mass. The Langley envelope bounds resonance and anti-resonance peaks:

$$G_{\text{res}} = G_C\cdot\frac{1+e^{-\pi\mu}}{1-e^{-\pi\mu}}, \quad G_{\text{ares}} = G_C\cdot\frac{1-e^{-\pi\mu}}{1+e^{-\pi\mu}}$$

where µ(f) = n(f)·η·f is the **modal overlap factor** and η ≈ 0.02 is the modal loss factor.

For a homogeneous orthotropic plate, modal density is:

$$n(f) = \frac{S}{2}\sqrt{\frac{\rho h}{\sqrt{D_x D_y}}}$$

where S is area, ρ ≈ 400 kg/m³ (spruce), h = 7–9.5 mm, and D_x, D_y are bending stiffnesses along and across grain.

**Measured values (Pleyel P131 upright / Steinway D grand):**

| Parameter               | Upright             | Concert Grand |
| ----------------------- | ------------------- | ------------- | --------- | --------- |
| Soundboard mass M       | 10–12 kg            | 18–25 kg      |
| Modal density < 1.1 kHz | 0.04–0.06 modes/Hz  | similar       |
| Modal density > 1.1 kHz | up to 0.15 modes/Hz | similar       |
| Modal loss factor η     | ~2%                 | ~2%           |
| Mean bridge impedance   | Z                   |               | ~10³ kg/s | ~10³ kg/s |
| First eigenfrequency    | 70–100 Hz           | 50–70 Hz      |

### Two vibration regimes

Chaigne, Cotté & Viggiano (2013, JASA 133(4), DOI: 10.1121/1.4794387) identified a critical transition at **~1.1 kHz**: below this frequency, the soundboard vibrates as a homogeneous plate with modes spanning the entire surface. Above it, inter-rib spaces act as waveguides and modes become localized. This localization broadens radiation directivity and reduces the number of radiation lobes — explaining why piano sound becomes more diffuse at higher frequencies.

Ege, Boutillon & Rébillat (2013, J. Sound Vib. 332:1288) confirmed that **nonlinear response is ≈ −40 dB below linear** at fortissimo — the soundboard is essentially a linear system.

### Radiation efficiency and air coupling

Suzuki (1986, JASA 80(6):1573, DOI: 10.1121/1.394321) measured radiation from a 6-ft Steinway and identified six resonance modes below 200 Hz. Radiation efficiency follows three regimes: below 80 Hz (very poor), 100 Hz–1 kHz (moderate), above 1.4 kHz (efficient). The critical frequency for soundboard-air coincidence is typically **f_c ≈ 1–2 kHz**.

Trévisan, Ege & Laulagnet (2017, JASA 141(3), DOI: 10.1121/1.4976082) formulated the modal radiation impedance:

$$Z_{\text{rad}}^{mn} = \rho_0 c_0 S \cdot \sigma_{mn}(f)$$

where σ_mn is the modal radiation efficiency, ρ₀ = 1.2 kg/m³, c₀ = 343 m/s.

**Rust implementation — computationally efficient soundboard:**

1. Use **50–100 second-order IIR resonators (biquads)** parameterized from the Skudrzyk mean admittance with random fluctuations following the Langley envelope
2. Split at 1.1 kHz: plate-like modes below, waveguide modes above (higher modal density)
3. Apply frequency-dependent radiation filter: roll-off below ~100 Hz, flat 100 Hz–1 kHz, slight boost above 1.4 kHz
4. Use a **feedback delay network (FDN)** for the soundboard impulse response, with frequency-dependent loss filters in each delay line

### Why physical models lack "warmth"

The "body" and "warmth" that samplers capture comes from five sources that simplified models miss: (1) room coupling captured in recordings, (2) the soundboard's 2D frequency-dependent radiation pattern, (3) double-decay envelopes from coupled strings, (4) sympathetic resonance from all undamped strings, (5) frequency-dependent modal damping where lows sustain and highs decay faster. Physical models using single-point impedance approximations miss the spatial richness of the full 2D vibroacoustic field. Adding a high-quality convolution reverb can mask many model imperfections.

---

## A4. String-bridge-soundboard coupling

### Weinreich's coupled-string theory

Weinreich (1977, JASA 62(6):1474, DOI: 10.1121/1.381677) established that the bridge admittance couples unison strings into normal modes. For N strings sharing a bridge with admittance Y_b(ω), each string has characteristic impedance Z_s = √(Tµ). The coupled modes are:

- **Symmetric mode** (strings in phase): strong bridge excitation → fast decay (prompt sound) with rate γ_sym ≈ γ₀ + N·Re[Z_s·Y_b(ω)]
- **Antisymmetric mode** (strings out of phase): near-zero bridge force → slow decay (aftersound) with rate γ_anti ≈ γ₀

This two-stage decay is the **defining characteristic of piano tone**. The bridge impedance-to-string impedance ratio is typically **~100–200**, ensuring weak coupling and long sustain.

### Bridge reflectance for waveguide models

Smith (Physical Audio Signal Processing, W3K, 2010) gives the bridge reflectance:

$$R_b(s) = \frac{Z_b(s) - Z_s}{Z_b(s) + Z_s}$$

For a single-resonance bridge impedance Z_b(s) = ms + R + K/s, the reflectance is digitized via bilinear transform into a second-order IIR filter with |R_b| ≤ 1 at all frequencies (Schur stability guaranteed).

Bank & Karjalainen (2010, DAFx-10) developed passive admittance matrix modeling: Y(z) = Σ_r Y_r·H_r(z) where Y_r are positive-semidefinite matrices and H_r are second-order IIR sections, guaranteeing passivity by construction.

### Measured bridge impedance

| Source          | Piano         | Mean \|Z\| at bridge               |
| --------------- | ------------- | ---------------------------------- |
| Wogram (1980)   | Upright       | ~10³ kg/s                          |
| Nakamura (1983) | Upright       | ~10³ kg/s, mobility rise > 1 kHz   |
| Conklin (1996)  | Concert Grand | ~10³ kg/s, ±10–15 dB fluctuations  |
| Giordano (1998) | Upright       | ~10³ kg/s, step falloff at 2.5 kHz |

String characteristic impedance is **~5–10 kg/s**, giving the essential impedance mismatch ratio of 100–200×.

### Woodhouse's coupling loss and double-decay condition

Woodhouse (2004, JASA 116(6):3439; 2021, JASA 150(6):4375) derived the loss factor from body coupling:

$$\eta_b \approx 2Z_s \cdot \text{Re}(Y_b(\omega_n))$$

and the corresponding decay time of the nth partial:

$$\tau_n = \frac{1}{\pi f_n \eta_{\text{total},n}}, \quad \eta_{\text{total}} = \eta_{\text{internal}} + \eta_{\text{air}} + \eta_{\text{body}}$$

The piano is unique among stringed instruments: its fundamental frequencies fall in a region of significant soundboard modal overlap, producing **anti-veering behavior** where coupled frequencies coalesce (no beats) while decay rates separate maximally — a beatless double decay.

**Rust implementation:**

1. Model 2–3 strings per note sharing a bridge impedance junction, with **0.1–0.5 cents** mistuning
2. Implement bridge reflectance as a parallel bank of second-order IIR sections fitted to measured admittance
3. Model two string polarizations (vertical and horizontal) with different bridge admittance in each direction (Weinreich notes the resistive part differs by ~4× between polarizations)
4. The coupled system naturally produces double decay, beating, and the una corda effect

---

## A5. Nonlinear phenomena critical for realism

### Tension modulation and phantom partials

Bank & Sujbert (2005, JASA 117(4):2268, DOI: 10.1121/1.1868212) derived the coupled transverse-longitudinal equations. The tension varies with transverse displacement:

$$T(x,t) \approx T_0 + ES\left[\frac{\partial\xi}{\partial x} + \frac{1}{2}\left(\frac{\partial y}{\partial x}\right)^2\right]$$

The forcing term driving longitudinal vibration from transverse vibration is:

$$F_{t\to l}(x,t) = \frac{1}{2}ES\frac{\partial}{\partial x}\left(\frac{\partial y}{\partial x}\right)^2$$

After modal expansion, phantom partials appear at **sum frequencies** f_m + f_n and **difference frequencies** |f_m − f_n| of transverse modes. The modal excitation force for longitudinal mode k is:

$$F_{t\to l,k}^{(+)} = -ES\frac{\pi^3}{8L^2}\sum_{n=1}^{k-1}y_{k-n}(t)\,y_n(t)\cdot k(k-n)n$$

Conklin (1999, JASA 105(1):536) first identified these phantom partials and showed their inharmonicity coefficient is approximately **one-quarter** that of normal transverse partials:

$$f_p \approx f_0\,p\sqrt{1 + \tfrac{1}{4}Bp^2}$$

Bank & Lehtonen (2010, JASA 128(3):EL117) established perceptual boundaries: nonlinear effects are **audible in the first 3 octaves (A0–B3) at fortissimo** levels. At pianissimo, a linear model suffices everywhere. The longitudinal component creates the **metallic character** of low piano notes.

**Typical C2 parameters:** f₀ ≈ 65 Hz, first longitudinal mode f'₁ ≈ 690 Hz (~10.6× fundamental), longitudinal decay time τ' ≈ 0.15 s. Longitudinal wave speed c_L = √(EA/m) is ~10–20× the transverse wave speed c_T = √(T₀/m).

Moore, Neldner & Rokni (2018, JASA 144(3):1564) discovered that phantom partials arise **even without string motion** — nonlinearities in the bridge and soundboard also contribute, sometimes more than the string alone.

### Pitch glide from tension modulation

Large-amplitude transverse vibrations increase mean tension, causing an initial upward pitch shift:

$$f(t) \approx f_0\sqrt{1 + \alpha\,e^{-t/\tau}}$$

where α is proportional to the square of initial displacement amplitude and τ is the energy decay time constant (50–200 ms). Tolonen, Välimäki & Karjalainen (2000, IEEE Trans. SAP 8(3):300, DOI: 10.1109/89.841212) implemented this in a digital waveguide by modulating the delay length proportional to string elongation:

$$\Delta L(t) = \frac{1}{2}\int_0^L\left(\frac{\partial y}{\partial x}\right)^2 dx$$

Bank (2009, DAFx) showed this can be computed efficiently from short-time energy: the tension variation is proportional to total string energy, requiring only a first-order lowpass filter on an energy estimate to modulate delay length.

### Precursor waves

Stiff strings are dispersive: high-frequency components travel faster than low-frequency ones. Podlesak & Lee (1988, JASA 83(1):305, DOI: 10.1121/1.396432) showed this produces **precursor waves** — high-frequency energy arriving at the bridge before the main transverse pulse. Combined with the longitudinal attack pulse (which travels at c_L ≫ c_T), precursors form the complex initial transient of piano tone. They are most prominent in bass strings and contribute to the initial "brightness" and "bite."

### Implementation strategy

Bank's regime-based approach is efficient:

1. **Regime 1 (linear):** Standard digital waveguide — pianissimo across keyboard
2. **Regime 2 (one-way coupling):** Transverse waveguide + longitudinal modal resonators — fortissimo in first 3 octaves
3. **Regime 3 (full nonlinear):** Coupled finite-difference — extreme levels only

**Rust implementation:** Transverse modes as parallel biquad resonators, with outputs y_m(t)·y_n(t) feeding longitudinal resonator bank (3–10 resonators per string). The key nonlinear operation — pairwise products of modal amplitudes — is SIMD-friendly. Ducceschi & Bilbao (2019–2024) developed Scalar Auxiliary Variable (SAV) techniques enabling **non-iterative, linearly-implicit time-stepping** for geometrically exact nonlinear strings, achieving computation times comparable to simplest explicit methods.

---

## A6. Attack transient modeling: the first 50 ms

### Two-path transient transmission

Askenfelt (1993, SMAC '93:297) identified two distinct paths:

1. **String precursor ("bite"):** Longitudinal wave through string to bridge, arriving nearly instantly. Extends to ~5 kHz, **~25 dB above** the structure-borne component. Gives the attack its "metallic" quality.

2. **Touch precursor ("thump"):** Structure-borne through keybed/frame, arriving 20–30 ms before string contact in staccato. Bridge motion dominated by resonances at **~290 Hz and ~440 Hz** (key modal frequencies). ~25 dB weaker than string precursor. Touch-dependent: present in staccato, absent in legato.

### Spectral evolution timeline

| Time     | Event                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–2 ms   | Hammer-string contact. Broadband excitation. Initial pulse reflects 4–5 times on short string segment between hammer and agraffe.                  |
| 0–5 ms   | String precursor (longitudinal) reaches bridge. Broadband high-frequency energy up to 5 kHz.                                                       |
| 5–20 ms  | Transverse wave builds up. First reflected pulse from bridge arrives. Spectrum begins developing harmonic structure. Structure-borne thump active. |
| 20–50 ms | Harmonic pattern establishes. Broadband transient decays rapidly. Sound transitions from percussive/noisy to quasi-harmonic.                       |

### Key timing parameters from Askenfelt & Jansson (1990–1993)

Measured for C4 staccato forte: damper lifts off ~15 ms before hammer contact, jack contacts escapement dolly a few ms before contact, hammer-string contact duration ~2 ms at forte (increases at pp), maximum hammer velocity at forte ~5 m/s (~5× key velocity due to lever ratio).

### The "knocking mode"

The broadband transient from hammer impact exciting all soundboard modes simultaneously. Modeled as convolution of force pulse F(t) with soundboard impulse response h_SB(t). The force pulse approximates a skewed versed-sine: F(t) ≈ F_max·sin²(πt/τ)·e^{−βt} where β accounts for hysteresis asymmetry. Pianoteq includes "hammer noise" as a separately controllable parameter, confirming its perceptual importance.

### Sines-transient-noise decomposition

Simionato & Fasciani (2025, Front. Signal Process. 4:1494864, DOI: 10.3389/frsip.2024.1494864) decompose piano sound into three independently modelable components: (1) quasi-harmonic exponentially decaying sinusoids with inharmonicity, phantom partials, and double decay; (2) broadband transient from hammer impact modeled via inverse DCT from a convolutional network; (3) time-varying filtered noise from key/hammer mechanism friction. Their perceptual tests confirm that the attack transient is where most synthesis inaccuracies concentrate.

**Rust implementation:**

1. **Key noise:** Filtered noise burst at key depression, peaked at ~290 Hz and ~440 Hz (key modes), duration 20–30 ms, level ~25 dB below main tone
2. **Hammer broadband:** Short burst (2–5 ms) with velocity-dependent spectral tilt, derived from the nonlinear hammer model's force pulse convolved with a short soundboard IR
3. **Longitudinal component:** Below ~A3, add resonator bank for phantom partials at 2f_n and f_m + f_n frequencies, with rapid decay (~0.2–1 s) and formant-like peaks at longitudinal modal frequencies

---

## A7. Release and decay realism

### Double-decay envelope mathematics

Weinreich's coupled-string theory predicts a two-component amplitude envelope:

$$A(t) = A_1\,e^{-\alpha_1 t} + A_2\,e^{-\alpha_2 t}, \quad \alpha_1 \gg \alpha_2$$

Cheng, Dixon & Mauch (2015, ICASSP:594) classified three decay patterns from measured Disklavier recordings: simple linear decay, double decay (two segments with different slopes), and beat decay with amplitude modulation. Higher partials consistently decay faster than lower ones, but dynamics (pp/mf/ff) do **not** significantly affect decay rate.

Measured T₂₀ values show dramatic variation: F♯4 = 3.5 s vs. G4 = 0.7 s (5:1 ratio for adjacent notes) due to soundboard resonance matching.

### Frequency-dependent string damping

The standard formulation from Chaigne & Askenfelt (1994) and Bensa et al. (2003, JASA 114(2):1095, DOI: 10.1121/1.1587146):

$$\rho A\ddot{y} = c^2 y'' - \kappa^2 y'''' - 2b_1\dot{y} + 2b_2\dot{y}''$$

The decay rate of partial j is σ_j = b₁ + b₂·ω²_j/c², ensuring higher partials die faster. Measured parameter values for representative notes:

| Parameter | C2    | C4     | C7      |
| --------- | ----- | ------ | ------- |
| f₁ (Hz)   | 65.4  | 261.6  | 2093    |
| L (m)     | 1.92  | 0.62   | 0.082   |
| T (N)     | 717   | 670    | 728     |
| µ (kg/m)  | 0.028 | 0.0075 | 0.00068 |
| b₁ (s⁻¹)  | 0.5   | 1.0    | 1.5     |

### Loss filter design for waveguide synthesis

Bank & Välimäki (2003, IEEE SPL 10(1):18) designed loop-loss filters matching measured decay: the per-period loop gain at frequency f is |H(e^{jωT})| = exp(−T₀/τ(f)), with T₆₀(f) = 6.91·τ(f). Weighted least-squares design with weighting w_k = (g_k − 1)^{−4} emphasizes the longest-decaying (most exposed) partials. A **2nd–4th order IIR filter** per string suffices for piano.

### Part-pedaling physics

Lehtonen, Askenfelt & Välimäki (2009, JASA 126(2):EL49, DOI: 10.1121/1.3162438) identified three phases: (1) free vibration after hammer strike, (2) damper-string interaction with rapid frequency-dependent damping and nonlinear amplitude limitation, (3) continued free vibration at lower amplitude. Higher partials are damped first because the damper felt acts as a frequency-dependent absorber. Energy transfers to higher partials during contact due to nonlinear clipping.

**Rust implementation:**

- Model the damper as a **position-dependent lowpass filter** whose cutoff frequency drops with increasing damper pressure
- Full damper: heavy lowpass, all partials damped rapidly
- Half damper: gentle lowpass, highs attenuated, lows ring through
- Track damper gap distance as continuous control parameter (0 to full lift)
- When string displacement exceeds damper gap, apply strong damping with frequency-dependent absorption rate

---

## A8. Tuning and micro-detuning

### Stretched tuning: beyond the Railsback average

Fletcher (1964, JASA 36(1):203, DOI: 10.1121/1.1918933) established the inharmonicity formula:

$$f_n = n\,f_0\sqrt{1 + Bn^2}, \quad B = \frac{\pi^3 E d^4}{64\,T\,L^2}$$

Giordano (2015, JASA 138(4):2359, DOI: 10.1121/1.4931439) explained the Railsback stretch from inharmonicity and sensory dissonance minimization. Jaatinen & Pätynen (2022, JASA 152(2):1146, DOI: 10.1121/10.0013572) measured all individual strings on a Steinway D, finding:

| Piano                      | Bass extreme | Treble extreme | Total stretch |
| -------------------------- | ------------ | -------------- | ------------- |
| Steinway D (274 cm)        | −19 cents    | +45 cents      | 64 cents      |
| Kawai SK-EX (277 cm)       | −17 cents    | +43 cents      | 60 cents      |
| Bösendorfer 280VC (280 cm) | −16 cents    | +42 cents      | 58 cents      |

The conversion from inharmonicity to cents stretch for the nth partial: Stretch (cents) = 600·log₂(1 + Bn²) ≈ 865.62·B·n² for small B.

Tuners match the 4th partial of the lower note to the 2nd partial of the upper note (the "4:2 octave"), naturally producing stretched octaves because inharmonicity raises the 4th partial by 1+16B versus 1+4B for the 2nd partial.

Hinrichsen (2012, arXiv:1203.5101) documented **note-to-note fluctuations** of ±1–3 cents on top of the smooth Railsback curve, reflecting individual string irregularities, soundboard coupling, and partial intensity variations. These are NOT random measurement errors.

### Measured inharmonicity coefficients for Steinway D

| Register               | B value range |
| ---------------------- | ------------- |
| Bass (A0–C2)           | 0.0003–0.0006 |
| Mid (C3–C5)            | 0.0002–0.001  |
| Treble (C6–C7)         | 0.005–0.05    |
| Extreme treble (C7–C8) | 0.05–0.4+     |

The wound-to-plain string transition creates a **discontinuity** in the B curve.

### Unison detuning and the piano's "liveness"

Woodhouse (2021, JASA 150(6):4375) showed that the perceptual effect of unison detuning is extremely sensitive:

| Detuning      | Effect                                                     |
| ------------- | ---------------------------------------------------------- |
| 0.0 cents     | Only prompt sound, fast decay, no aftersound — sounds dead |
| 0.1 cents     | Strong double-decay appears                                |
| 0.3 cents     | Clear double-decay, enhanced aftersound                    |
| 0.5–1.0 cents | Optimal aftersound level, no audible beating               |
| 2.0 cents     | Beginning of perceptible pitch difference                  |
| 5.0 cents     | Audible beating, sounds "out of tune"                      |

The optimal range for piano synthesis is **0.1–0.5 cents** per unison string. The piano's high soundboard modal overlap produces anti-veering behavior where frequencies merge and decay rates diverge — yielding beatless double decay, unlike the guitar or lute where beats are always present.

### Pitch glide is the only significant "micro-fluctuation"

Real piano strings do **not** exhibit random micro-pitch fluctuations like voices or bowed strings. The primary "micro-fluctuation" is the deterministic pitch glide from tension modulation (several cents at ff, negligible at pp, τ = 50–200 ms). The perceived "liveness" comes entirely from unison beating, nonlinear effects, and spectral evolution — **not** from added random jitter.

**Rust implementation:**

```rust
fn partial_freq(f0: f64, n: u32, b: f64) -> f64 {
    let n = n as f64;
    n * f0 * (1.0 + b * n * n).sqrt()
}

fn inharmonicity_coeff(e: f64, d: f64, t: f64, l: f64) -> f64 {
    std::f64::consts::PI.powi(3) * e * d.powi(4)
        / (64.0 * t * l * l)
}

fn stretch_cents(b: f64, n: u32) -> f64 {
    600.0 * (1.0 + b * (n as f64).powi(2)).log2()
}
```

Add per-note Railsback deviations of ±1–3 cents modeled as a slowly varying random function correlated over ~3–5 semitones.

---

## A9. Machine learning approaches to closing the realism gap

### DDSP-Piano: differentiable synthesis from MIDI

Renault, Mignot & Roebel (2023, JAES 71(9):552; GitHub: `lrenault/ddsp-piano`) extended Google's DDSP to polyphonic piano. The architecture includes an inharmonicity model incorporating string stiffness, a detuner for multi-string beating, a monophonic spectral-envelope network tracking temporal evolution, and a release module. Trained on the MAESTRO dataset at 24 kHz with 250 Hz control rate using **multi-resolution spectral loss**.

The model achieves better subjective quality than other neural-based piano synthesizers with fewer parameters, though physical-modeling and sampling approaches still score higher in listening tests. The additive synthesis and filtered-noise modules are pure DSP operations readily implemented in Rust.

### Physics-informed differentiable parameter estimation

Simionato, Fasciani & Holm (2024, Front. Signal Process. 3:1276748, DOI: 10.3389/frsip.2023.1276748) embed physics formulas (inharmonicity, amplitude envelopes, double decay) directly into a differentiable pipeline where a neural network predicts the physical parameters, not the audio. This enables automatic calibration from recordings with low computational complexity and explicit real-time feasibility. Loss functions include STFT loss, RMS loss, frequency accuracy in cents, and inharmonicity parameter accuracy.

**This is the most practical ML approach for a Rust synthesizer:** train offline in Python to extract physics equation parameters from target recordings, then export the parameter tables to Rust. Zero neural-network inference at runtime.

### Inverse parameter estimation without real recordings

Gabrielli et al. (2017, DAFx-17:11; 2019, arXiv:1809.05483) trained supervised CNNs on **synthetic data generated by the physical model itself**, learning the inverse mapping from spectrogram to parameters with best-case error of 0.004 and SDR of 17.35 dB. This eliminates the need for labeled real recordings — generate thousands of parameter variations, render them through the model, and train the CNN to recover parameters from the renders.

### Stable differentiable modal synthesis

Zheleznov et al. (2026, arXiv:2601.10453) combine SAV techniques with neural ODEs: the linear modal behavior is solved analytically while a small **GradNet learns only the nonlinear coupling** between modes from data. Physical parameters remain accessible after training and the model generalizes to unseen parameters and sampling rates. This maps perfectly to piano: well-understood linear string modes + learned nonlinear bridge/soundboard coupling.

### Neural post-processing for "warmth"

Wright (2023, PhD thesis, Aalto) and Steinmetz & Reiss developed neural audio effects using small RNNs/TCNs trained on paired data. For piano: train on (physical model output, real recording) pairs for the same MIDI performance using multi-resolution STFT loss with perceptual pre-emphasis (~3–4 kHz emphasis). The RTNeural library demonstrates real-time inference of small networks for audio — directly portable to Rust. A network adding ~1 ms latency could inject missing sympathetic resonance, soundboard coloring, and subtle nonlinearities.

### Evaluation pipeline

1. Use MAESTRO test split (MIDI → model → audio; compare to real recordings)
2. Multi-resolution STFT loss for development: L = Σ_s (‖log|STFT_s(x)| − log|STFT_s(x̂)|‖₁) across FFT sizes {512, 1024, 2048, 4096}
3. Fréchet Audio Distance with CLAP embeddings for distribution-level quality
4. MUSHRA listening test (ITU-R BS.1534) for final perceptual validation
5. SI-SDR has ~0.76 Pearson correlation with MUSHRA scores

---

## A10. Psychoacoustic factors: what to optimize and what to skip

### Temporal resolution constraints

Auditory temporal resolution corresponds to ~**1–3 ms** time constants (TMTF cutoff), with gap detection thresholds of **2–3 ms**. This means transient microstructure below ~2 ms is not individually resolved — but the spectral consequences of that microstructure (e.g., the spectral envelope shaped by a 2 ms hammer contact) are fully audible.

### Frequency masking and computational budget

Simultaneous masking widens dramatically at high intensities, creating strong upward spread. This means that in forte playing, lower harmonics effectively mask many upper harmonics. Critical bandwidth determines which partials are individually resolvable: below ~1500 Hz, individual harmonics are resolvable; above, multiple harmonics merge within single auditory filters. Forward masking lasts up to ~100 ms, meaning during rapid passages, subsequent notes can mask the decay of previous notes.

**Computational budget allocation based on masking:**

- High partials during late decay: masked by dominant lower partials → reduce computation
- Very high partials in loud passages: masked by upward spread → simplify
- First 10 partials during first 500 ms: most exposed → allocate maximum accuracy
- Individual partial phase: generally not perceptually relevant (except in beating contexts) → ignore

### Timbre perception dimensions

McAdams (2019, Springer) identified three consensus dimensions from MDS studies: (1) **spectral centroid** (brightness), the most consistently identified; (2) **attack time** of the energy envelope; (3) **spectral flux** (time-varying composition). For a piano model, getting these three features right matters more than getting any individual partial exactly correct.

### The role of room acoustics

Simonetta et al. (2022, Multimedia Tools Appl., DOI: 10.1007/s11042-022-12476-0) found that changing room acoustics significantly altered listeners' perception of the "interpretation" even with identical MIDI. Appropriate room simulation can close a substantial portion of the perceived realism gap. Many differences attributed to the piano model itself may actually reflect differences in room acoustic simulation.

### Haptic feedback caveat

Saitis et al. (2018, Springer Series on Touch and Haptic Systems) demonstrated that piano quality perception from the performer's perspective includes vibrotactile and proprioceptive cues. Even a perfect audio model may not achieve full realism for performers on a digital keyboard. This is less relevant for listener-only evaluation but critical for performer evaluation.

---

## A11. Open-source codebases, datasets, and Rust tooling

### Research-grade piano physics implementations

**MAESSTRO** (gitlab.com/benjamin.elie/maesstro) is the most comprehensive open-source piano-specific physical model: modal soundboard basis, nonlinear FE string dynamics, hammer-string interaction, acoustic radiation, Steinway D comparison data, and MIDI input. By CNRS/INRIA researchers (Chabassier, Elie, Boutillon, Ege), published in Acta Acustica (2022).

**NESS** (github.com/Edinburgh-Acoustics-and-Audio-Group/ness) from Stefan Bilbao's group at Edinburgh provides the most scientifically rigorous FDTD code: stiff strings, plates, membranes, acoustic spaces, with optional CUDA acceleration. Not real-time but research-grade accuracy.

**OpenPiano** (github.com/michele-perrone/OpenPiano) offers a C++17 finite-difference piano string implementation using Chaigne/Askenfelt equations. Alpha quality, single string per note, no soundboard model — but clean code for studying FD discretization.

**FAUST piano.dsp** (github.com/grame-cncm/faust) provides commuted waveguide piano synthesis compilable directly to Rust via the **faust2rust** backend. The physmodels.lib includes bidirectional waveguides, dispersion filters, hammer excitation, and modal bridges.

**fan455/fan455_piano_synthesis** (GitHub) is an in-development Rust piano physical model referencing MAESSTRO and Bank's work — the closest existing Rust peer project.

**Bank's thesis** (home.mit.bme.hu/~bank/thesis/pianomod.pdf) provides the most complete publicly available description of a real-time piano synthesizer: nonlinear hammer, stiff string waveguide, beating/two-stage decay, FDN soundboard, and attack noise, calibrated from Yamaha Disklavier. Bank & Chabassier's 2019 IEEE SPM review is the definitive overview paper.

### Measured parameter datasets

**Euphonics** (euphonics.org/12-2-1-parameter-values-for-piano-simulations/) provides complete parameter tables for all C notes (C1–C8) of a Broadwood piano: string length, diameter, wrapping, mass per unit length, bending stiffness, striking ratio, hammer mass, hammer/string mass ratio, tension/length ratio, and nonlinear hammer stiffness K and α values. Licensed CC BY-NC-SA 4.0.

**Chabassier et al. (2014, ESAIM: M2AN 48(5):1241)** provide complete Steinway D simulation parameters: string tensions, densities, stiffnesses, damping coefficients, orthotropic soundboard properties (thickness ~8 mm, density ~400 kg/m³, along/cross-grain Young's moduli), and bridge coupling data.

**Conklin (1996, JASA 99–100, three parts)** remains the definitive reference for piano design parameters: hammer masses, felt parameters, string tensions, soundboard properties, and scale design data for multiple piano sizes.

### Validation datasets

**MAESTRO** (magenta.withgoogle.com/datasets/maestro): ~200 hours of Yamaha Disklavier recordings with ~3 ms MIDI-audio alignment, CC BY-NC-SA 4.0. The gold standard for A/B comparison.

**MAPS** (adasp.telecom-paris.fr): MIDI-aligned piano sounds including isolated single notes at multiple velocities with/without pedal across 9 piano settings. Ideal for per-note validation. CC BY-NC-SA 2.0.

**Salamander Grand Piano** (github.com/sfzinstruments/SalamanderGrandPiano): Yamaha C5, 48 kHz/24-bit, 16 velocity layers, **public domain** as of 2022. Includes hammer noise and release samples.

**University of Iowa** (theremin.music.uiowa.edu/mis.html): Steinway in anechoic chamber at 3 velocity layers, free for any use. Valuable for comparison without room acoustics.

### Rust audio ecosystem

| Crate                | Purpose                                    | Relevance                                |
| -------------------- | ------------------------------------------ | ---------------------------------------- |
| **cpal** (3.6k★)     | Cross-platform audio I/O                   | Required for real-time output            |
| **fundsp**           | Composable DSP graph, filters, delay lines | Waveguide building blocks                |
| **dasp** (1.1k★)     | Sample types, interpolation, ring buffers  | Fractional delay for waveguide tuning    |
| **nih-plug**         | VST3/CLAP plugin framework                 | Plugin delivery format                   |
| **hound**            | WAV I/O                                    | File export for validation               |
| **mi-plaits-dsp-rs** | Mutable Instruments Plaits port            | Physical modeling reference code in Rust |

The **faust2rust** compiler backend enables direct compilation of FAUST's piano.dsp and physmodels.lib to Rust code, providing an immediate working prototype.

---

## Conclusion: a roadmap for passing blind listening tests

The research synthesized here points to a clear implementation priority stack. **Three features alone — coupled-string double decay, velocity-dependent spectral envelope from nonlinear hammer felt, and accurate inharmonicity with stretched tuning — account for the majority of perceived piano identity.** Adding soundboard body resonance via a 50–100 mode FDN, key mechanism noise in the attack, and frequency-dependent decay filters pushes the model past the threshold where expert listeners struggle to distinguish physical model from recording, as Bernays & Traube's 2014 study already demonstrated for Pianoteq.

The remaining gap — the "warmth" and "body" that samplers capture — maps to three specific technical deficiencies: incomplete soundboard radiation modeling (fix with full 2D modal approach from Ege/Boutillon rather than single-point impedance), absent structural nonlinearity in the bridge (Moore 2018 showed the bridge contributes significantly to phantom partials), and missing room coupling (fix with high-quality convolution reverb or measured room IR). The ML approaches from Simionato et al. offer a practical shortcut: train offline to extract physics parameters from a target Steinway D recording, export parameter tables, and use pure DSP at runtime with zero neural-network inference overhead.

For Rust specifically, the optimal architecture combines digital waveguide strings (via dasp fractional delays and fundsp filters) with a biquad resonator bank for the soundboard (50–100 modes), the Stulov three-parameter hammer (one multiply per sample), and Bank's one-way nonlinear coupling for phantom partials in the first three octaves. Target total polyphony budget: ~10 simultaneous notes × 3 strings × 50 partials = 1,500 resonators, well within modern CPU capacity at 44.1 kHz with SIMD. The FAUST-to-Rust pipeline provides an immediate working prototype to iterate from, and the MAESTRO dataset enables objective A/B validation at every stage.
