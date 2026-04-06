# Spec: Flagship Piano Physical Modeling Plugin

## 1. Overview

This specification defines the implementation of a state-of-the-art physically modeled piano for Sourdaw, based on **modal synthesis**. It aims to achieve professional-grade realism, unlimited dynamic range, and a small footprint (~50MB), deployable across Native (Tauri) and WASM (Browser) environments. It includes an optional hybrid sampled-attack pathway and MIDI 2.0 support.

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

## 3. Synthesis Engine: Modal Synthesis

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
