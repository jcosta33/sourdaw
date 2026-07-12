---
type: research
id: RESEARCH-piano-plugin
title: Physically-modeled piano synthesis for a Rust + WASM + WebGPU stack
status: open
owner: The Sourdaw team
sources:
  - Competitive survey (Pianoteq, Ivory 3, Keyscape, VSL, EastWest, Ravenscroft, Arturia)
  - Acoustic-physics literature (Bensa 2003, Chaigne & Askenfelt 1994, Weinreich 1977, Bank 2010, Chabassier & Duruflé 2012)
---

# Research: Physically-modeled piano synthesis for a Rust + WASM + WebGPU stack

## Question

Can a physical-modeling-first piano, built in Rust and deployable as native code or
WASM from one codebase, compete with Pianoteq-tier plugins — and which synthesis
algorithm, real-time architecture, and parameter sources should it use?

## Findings

### R-001 — Physical modeling is the only viable engine for the WASM target

- **Claim:** A ~50 MB physically-modeled engine compiles identically to native and
  WASM and respects RT thread boundaries; sample libraries (42–240 GB) cannot stream
  through an AudioWorklet (WASM's 4 GB linear-memory limit, no disk I/O).
- **Evidence:** Pianoteq ships ~50 MB with zero samples; Keyscape 77 GB, EastWest
  ~240 GB; WASM linear memory caps at 4 GB.
- **Confidence:** high
- **Bears on:** the core "physical modeling, single Rust crate, two targets" decision.

### R-002 — Modal synthesis (parallel biquads) is the right core algorithm

- **Claim:** Representing each string partial as a second-order resonator (biquad)
  gives per-partial parameter control, an SoA SIMD-friendly layout, and graceful
  degradation by truncating partials under CPU pressure.
- **Evidence:** Bank, Zambon & Fontana (2010) demonstrate a complete real-time modal
  piano; Pianoteq's patent (US7915515B2) uses exciter→modal-resonator separation.
  Per-voice cost ≈ 1,000–1,200 MAC/sample at 48 kHz.
- **Confidence:** high
- **Bears on:** AC-001/002/003 and the engine architecture.

### R-002a — The definitive parameter source is the Chabassier & Duruflé INRIA report

- **Claim:** Complete physical parameters for all 88 Steinway D strings (lengths,
  diameters, densities, tensions, inharmonicity, hammer mass/stiffness, damping) are
  available in machine-readable form.
- **Evidence:** INRIA RT-0425 (`hal-00688679v2`); the open MAESSTRO project incorporates
  the same parameters.
- **Confidence:** high
- **Bears on:** the parameter tables for the modal engine — gated by R-Q002 license audit.

### R-003 — Coupled unison strings give the characteristic two-stage decay

- **Claim:** Notes above ~F2 use 2–3 unison strings detuned 0.5–2 cents; bridge
  coupling splits each partial into a fast "prompt" (vertical, T60 0.3–2 s) and a slow
  "aftersound" (horizontal, T60 5–30 s) decay.
- **Evidence:** Weinreich (1977); Bank (2010) modal implementation as 2K resonators
  per harmonic for K unison strings.
- **Confidence:** high
- **Bears on:** AC-002 (two-stage decay).

### R-004 — Velocity-dependent hammer nonlinearity, not velocity layers

- **Claim:** A power-law felt-compression hammer (`F = K·δ^p`, p ≈ 2.5–3.5) brightens
  timbre with velocity continuously, eliminating the velocity-layer "jump" that is
  sampling's Achilles heel.
- **Evidence:** Chaigne & Askenfelt (1994); Stulov (1995) hysteresis extension;
  Ivory 3's RGB engine and Pianoteq both solve layering via continuous modeling.
- **Confidence:** high
- **Bears on:** AC-001 (velocity → timbre).

### R-005 — Lock-free RT architecture: atomics + SPSC ring buffers, never graph rebuilds

- **Claim:** Scalar params go through `AtomicF32` with per-sample smoothing; structural
  changes (model, temperament) go through an `rtrb` (native) / `ringbuf.js` over
  SharedArrayBuffer (browser) SPSC queue applied with crossfade. Parameter changes
  never trigger a DSP graph rebuild.
- **Evidence:** nih-plug `Smoother` pattern; `rtrb`/`ringbuf.js` SPSC queues; audio
  must never cross Tauri IPC (~0.5 ms/invoke) — `cpal` owns the native pipeline.
- **Confidence:** high
- **Bears on:** AC-004/005/012/014 (RT safety, voice pool, glitch-free switching, parity).

### R-006 — 256-voice pool natively, fixed and pre-allocated

- **Claim:** Pedaled passages reach 60–100+ sounding notes; with release and
  sympathetic voices the total approaches 256. A fixed array of `Voice` structs with
  `AtomicU32` state and scored stealing (1 ms fade-out) handles it lock-free.
- **Evidence:** Pianoteq supports up to 256 voices and recommends it; Keyscape's
  64-cap produces audible stealing artifacts in heavy pedal passages.
- **Confidence:** high
- **Bears on:** AC-005 (voice pool); browser tier defaults to 64 voices.

### R-007 — Low-register biquads need f64 or a coupled form

- **Claim:** At 27.5 Hz / 48 kHz, `C1 ≈ −1.999987` leaves only ~8 bits of effective
  f32 resolution; low modes must use f64 coefficients or a coupled-form oscillator to
  avoid denormal floor / NaN drift on long held notes.
- **Evidence:** numerical analysis in the modal-resonator section; coupled form costs
  one extra multiply but is far more stable.
- **Confidence:** high
- **Bears on:** AC-011 (low-register stability).

### R-008 — Sympathetic resonance as a global bank, not O(N²) coupling

- **Claim:** A global bank of 12–24 biquads tuned to low fundamentals, driven by
  aggregate bridge force and gated by damper state, captures the sustain-pedal "wash"
  at O(N) cost; true per-voice coupling is O(N²) and prohibitive at 256 voices.
- **Evidence:** Lehtonen et al. (2007) use 12 string models; sympathetic energy adds
  10–30% to mid-register decay, < 1 dB to initial harmonic levels.
- **Confidence:** high
- **Bears on:** AC-009 (gated, bounded sympathetic resonance).

### R-009 — WASM reaches ~95% of native for tuned SIMD DSP, but it is unmeasured here

- **Claim:** With SIMD and tuned inner loops, WASM closes to ~5% of native; without
  it, DSP runs 1.5–2.5× slower. The piano workload (hundreds of biquads × 64 voices ×
  48 kHz) has not been measured in this repo.
- **Evidence:** 2025 V8/SpiderMonkey benchmarks; WASM 128-bit SIMD standardized across
  modern browsers; the per-voice cost in-browser remains a projection.
- **Confidence:** medium
- **Bears on:** the browser-target scope — see Q-001.

## Open questions

- [ ] Q-001 — WASM polyphony envelope on reference hardware. Below 32 browser voices at
  target quality, the browser scope must be renegotiated. Unblocks the browser target.
- [ ] Q-002 — License audit of every imported parameter table; NC-licensed sources
  (e.g. CC BY-NC-SA) are incompatible with commercial distribution. Unblocks importing constants.
- [ ] Q-003 — Realism target and evaluation methodology (no-audible-glitches disclaimer
  vs formal listening test). Unblocks the release gate.
- [ ] Q-004 — Numerical tolerance for the spectral-envelope realism criterion; the
  current "±3 dB over 50 ms" is an unvalidated guess.

## Recommendation

Build a modal-synthesis engine with physically-derived parameters from the INRIA
tables (R-002, R-002a), coupled unison strings for two-stage decay (R-003), and a
power-law hammer for continuous velocity timbre (R-004). Manage real-time state with
atomics + SPSC ring buffers and a fixed 256-voice pool (R-005, R-006), use f64 / coupled
forms in the low register (R-007), and model sympathetic resonance as a gated global
bank (R-008). Treat the browser polyphony budget as unproven until measured (R-009,
Q-001) and gate parameter imports on the license audit (Q-002). Patent US7915515B2
requires clean-room implementation — derive only from open-license physics literature.

---

# Restored: implementation specification (verbatim from `research/factory/piano-plugin.md`, Part 2)

> The original factory research note had two halves. Part 1 (findings, recommendations,
> sources) is captured above. Part 2 — the full implementation specification, with every
> equation, parameter table, filter structure, and reference algorithm — had no home in
> the migrated suspec and is restored verbatim below from `bb84b0e:research/factory/piano-plugin.md`
> (lines 259–1300). It is reference material for the engine, not a set of requirements;
> the verifiable requirements live in `spec.md`.

# Piano physical modeling synthesizer: implementation specification

A state-of-the-art physically modeled piano can be built in Rust using **modal synthesis** as the core architecture, matching Pianoteq's approach. The signal for each note is generated as a sum of exponentially decaying sinusoidal partials, each implemented as a second-order digital resonator (biquad). This document provides every equation, parameter value, filter structure, and algorithm needed for a coding agent to implement a complete 88-key concert grand piano synthesizer. The recommended architecture follows Bank (2010) for string modal synthesis, Pianoteq's patent (US7915515B2) for the overall exciter-resonator separation, and the Chabassier & Duruflé (2012) INRIA report RT-0425 for physical parameters of a Steinway D. **The complete parameter set for all 88 notes is available in machine-readable form from that INRIA report** at `https://inria.hal.science/hal-00688679v2/file/RT-425.pdf`.

---

## 1. System architecture and signal flow

The synthesizer decomposes into five real-time subsystems connected in series, plus offline precomputation. The core equation from Pianoteq's patent (Guillaume, US7915515B2) defines the output signal for note _p_ as:

```
s(p,t) = Σ_n [ a_n(p) · exp(-d_n(p)·t) · sin(2π·f_n(p)·t + φ_n(p)) ] + b(p,t)
```

where `f_n` and `d_n` are **timbre coefficients** (resonator properties), `a_n` and `φ_n` are **excitation parameters** (velocity-dependent), and `b(p,t)` is a percussive noise component. In the real-time engine, each damped sinusoid is implemented as a biquad filter. The signal chain is:

```
MIDI Input → Hammer Model (nonlinear ODE, 4-8× oversampled)
           → Excitation Signal (force pulse spectrum)
           → String Resonator Bank (parallel biquads, one per partial)
           → Soundboard Post-Filter (parallel biquads or FFT convolution)
           → Sympathetic Resonance (secondary resonator bank)
           → Mechanical Noise (triggered samples/noise bursts)
           → Stereo Output
```

**Per-voice computational cost** (Bank 2010): approximately **1,000–1,200 multiply-accumulates per output sample** at 48 kHz. Full polyphony of 88 voices requires ~100,000 MAC/sample, well within a single modern CPU core using SIMD.

---

## 2. The stiff string wave equation

### 2.1 Continuous PDE (Bensa, Bilbao, Kronland-Martinet, Smith 2003)

The well-posed formulation for transverse displacement `y(x,t)` of a damped stiff piano string is:

```
∂²y/∂t² = c² · ∂²y/∂x² − κ² · ∂⁴y/∂x⁴ − 2b₁ · ∂y/∂t + 2b₂ · ∂³y/(∂x²∂t) + f(x,t)
```

**Parameter definitions:**

| Symbol   | Definition                              | Units |
| -------- | --------------------------------------- | ----- |
| `c`      | Transverse wave speed = √(T / ρA)       | m/s   |
| `κ`      | Stiffness parameter = √(EI / ρA)        | m²/s  |
| `b₁`     | Frequency-independent damping           | s⁻¹   |
| `b₂`     | Frequency-dependent damping             | m²/s  |
| `T`      | String tension                          | N     |
| `ρA`     | Linear mass density                     | kg/m  |
| `E`      | Young's modulus (steel: **210 GPa**)    | Pa    |
| `I`      | Second moment of area = πd⁴/64          | m⁴    |
| `L`      | Vibrating string length                 | m     |
| `f(x,t)` | External force (hammer) per unit length | N/m   |

**Boundary conditions** (hinged at both ends):

```
y(0,t) = y(L,t) = 0
∂²y/∂x²(0,t) = ∂²y/∂x²(L,t) = 0
```

### 2.2 Modal frequencies of the stiff string

The nth partial frequency of a stiff string (Fletcher 1964):

```
f_n = n · f₁ · √(1 + B · n²)
```

where the **inharmonicity coefficient** B is:

```
B = π³ · E · d⁴ / (64 · T · L²)
```

For wound bass strings, only the steel core contributes to bending stiffness; the copper winding adds mass but not stiffness. The equivalent linear density for wound strings is:

```
ρA = ρ_steel · π(d_core/2)² + ρ_copper · π[(d_outer/2)² − (d_core/2)²]
```

### 2.3 Modal decay rates

Each partial n has a decay rate (inverse time constant):

```
σ_n = b₁ + b₂ · (2πf_n)² / c²
```

The **T60 decay time** for partial n is: `T60_n = 6.91 / σ_n`

**Empirical fit for b₁ and b₂** across the keyboard (Bensa et al. 2003, Yamaha C6):

```
b₁(f₀) = 4.4 × 10⁻³ · f₀ − 4 × 10⁻²    [s⁻¹]
b₂(f₀) = 1.0 × 10⁻⁶ · f₀ + 1 × 10⁻⁵    [m²/s]
```

Alternative from Chabassier & Duruflé (2012), Steinway D — fluid damping as function of string index _i_ (1–88):

```
R_transverse(i) = 5 × 10⁻³ · i − 0.015    [s⁻¹]
η_transverse(i) = 2.78 × 10⁻¹¹ · i + 1.5274 × 10⁻⁹   [s]
```

### 2.4 Calibrated string parameters (Bensa et al. 2003)

| Parameter | C2 (65 Hz) | C4 (262 Hz) | C7 (2093 Hz) | Units |
| --------- | ---------- | ----------- | ------------ | ----- |
| L         | 1.23       | 0.63        | 0.10         | m     |
| c         | 160.9      | 329.6       | 418.6        | m/s   |
| κ         | 0.58       | 1.25        | 1.24         | m²/s  |
| b₁        | 0.25       | 1.1         | 9.17         | s⁻¹   |
| b₂        | 7.5 × 10⁻⁵ | 2.7 × 10⁻⁴  | 2.1 × 10⁻³   | m²/s  |

---

## 3. Hammer-string interaction model

### 3.1 Power-law felt compression (Chaigne & Askenfelt 1994)

The hammer is modeled as a point mass `m_H` with nonlinear felt stiffness:

```
F(t) = K · [δ(t)]^p      when δ(t) > 0  (contact)
F(t) = 0                  when δ(t) ≤ 0  (no contact)
```

where `δ(t) = x_H(t) − y(x₀, t)` is felt compression (hammer position minus string displacement at striking point x₀).

**Hammer motion ODE:**

```
m_H · d²x_H/dt² = −F(δ)
```

Initial condition: hammer velocity `v₀` at moment of contact (0.5–5.0 m/s for pp to fff).

### 3.2 Stulov hysteresis extension (Stulov 1995, JASA 97)

For more realistic felt behavior, the stiffness K is replaced by a history-dependent function:

```
F(t) = F₀ · [ξ(t)]^p · [1 − ε₀ · h(t) / max(ξ(t), ε_min)]
```

where `h(t)` is a low-pass-filtered compression rate:

```
h[n] = α · h[n−1] + (1−α) · dξ/dt[n]
α = exp(−Δt / t₀)
```

| Parameter | Meaning             | Typical value   |
| --------- | ------------------- | --------------- |
| `ε₀`      | Hysteresis strength | 0.2–0.5         |
| `t₀`      | Memory time scale   | 1–5 ms          |
| `F₀`      | Stiffness scale     | Same order as K |

### 3.3 Complete hammer parameter table

| Key # | Note | f₀ (Hz) | m_H (g) | K (N/m^p)  | p   | Contact time mf (ms) |
| ----- | ---- | ------- | ------- | ---------- | --- | -------------------- |
| 1     | A0   | 27.5    | 11.0    | 2.0 × 10⁸  | 2.0 | 4.0                  |
| 16    | C2   | 65.4    | 9.0     | 4.0 × 10⁸  | 2.3 | 3.5                  |
| 28    | C3   | 130.8   | 7.5     | 1.5 × 10⁹  | 2.4 | 3.0                  |
| 40    | C4   | 261.6   | 5.0–7.0 | 4.5 × 10⁹  | 2.5 | 2.0                  |
| 52    | C5   | 523.2   | 4.5     | 2.0 × 10¹⁰ | 2.7 | 1.5                  |
| 64    | C6   | 1046.5  | 4.0     | 1.0 × 10¹¹ | 2.9 | 1.0                  |
| 76    | C7   | 2093    | 3.5     | 1.0 × 10¹² | 3.0 | 0.7                  |
| 88    | C8   | 4186    | 3.2     | 5.0 × 10¹² | 3.5 | 0.4                  |

**Interpolation formulae** (for all 88 keys):

```
log₁₀(K(key)) ≈ 8.3 + 0.048 · (key − 1)
p(key) ≈ 2.0 + 0.017 · (key − 1)
m_H(key) ≈ 11.0 · exp(−0.0134 · (key − 1))    [grams]
```

**Striking position** (fraction of string length from agraffe): ~1/8 for most notes, decreasing to ~1/12 in the highest treble, ~1/7 in the lowest bass.

**Hammer velocity ranges:**

| Dynamic | Velocity (m/s) |
| ------- | -------------- |
| pp      | 0.5–1.0        |
| p       | 1.0–1.5        |
| mf      | 1.5–2.5        |
| f       | 2.5–4.0        |
| ff      | 4.0–5.0+       |

### 3.4 Discrete-time hammer implementation

Use **Störmer-Verlet (leapfrog) integration** at 4–8× the audio sample rate (176.4–384 kHz) during the contact phase (~2–8 ms):

```rust
struct Hammer {
    x: f64,           // position [m]
    v: f64,           // velocity [m/s]
    mass: f64,        // [kg]
    stiffness_k: f64, // K [N/m^p]
    exponent_p: f64,  // p [dimensionless]
}

fn update_hammer(h: &mut Hammer, y_string: f64, dt: f64) -> f64 {
    let compression = (h.x - y_string).max(0.0);
    let force = h.stiffness_k * compression.powf(h.exponent_p);
    let accel = -force / h.mass;
    h.v += accel * dt;
    h.x += h.v * dt;
    force
}
```

The hammer model runs at an oversampled rate (4–8×) to resolve the nonlinear contact. The resulting force signal F[n] is then decimated to the audio sample rate and used as the excitation input to the modal resonator bank.

**Delay-free loop resolution:** The hammer force depends on string displacement, which depends on hammer force. Solutions: (a) Run hammer at 4× string rate, inserting a 0.25-sample effective delay that breaks the loop (Bank 2000). (b) Use the K-method algebraic decoupling (Borin et al. 1997).

---

## 4. Coupled strings and two-stage decay (Weinreich 1977)

### 4.1 The physics of unison coupling

Piano notes above approximately F2 have **2 or 3 unison strings** tuned to nearly the same frequency but intentionally detuned by **0.5–2 cents**. The strings couple through the common bridge, creating two distinct decay regimes:

- **Vertical polarization** (perpendicular to soundboard): strong bridge coupling → fast initial decay ("prompt sound"), T60 ≈ 0.3–2 s
- **Horizontal polarization** (parallel to soundboard): weak bridge coupling → slow sustained decay ("aftersound"), T60 ≈ 5–30 s

The hammer strikes nearly vertically, exciting mainly vertical polarization. Bridge asymmetry gradually transfers energy to horizontal polarization.

### 4.2 Modal implementation of two-stage decay

For each harmonic n of a note with K unison strings, there exist **K closely-spaced modal frequencies** (Bank 2010). For a trichord (K=3):

```
f_{n,1} = n · f₁ · √(1 + B·n²)           // string 1
f_{n,2} = n · (f₁ + Δf) · √(1 + B·n²)    // string 2, detuned by Δf
f_{n,3} = n · (f₁ − Δf) · √(1 + B·n²)    // string 3, detuned by -Δf
```

Each string-mode pair has two decay rates:

```
σ_{n,fast} = σ_string(n) + σ_bridge    // vertical polarization
σ_{n,slow} = σ_string(n) + σ_bridge/100  // horizontal polarization
```

where `σ_bridge` represents energy lost to the soundboard. **Bridge admittance**: Y_bridge ≈ 10⁻³ s/kg (Weinreich). String characteristic impedance: Z_string ≈ 2 kg/s (middle register).

### 4.3 Implementation: parallel resonators per partial

For each note, allocate **2 resonators per harmonic per unison string** (one for each polarization), but in practice the coupled modes can be represented more efficiently as **2K resonators per harmonic** with frequencies, amplitudes, and decay rates derived from the coupling matrix:

```
// For trichord, 6 resonators per harmonic:
// 3 "fast" (symmetric modes, strong soundboard coupling)
// 3 "slow" (antisymmetric modes, weak coupling)
```

The amplitudes are set so that the sum of the 6 resonators reproduces the measured double-decay envelope. **Total resonators per note**: for a trichord with 50 audible harmonics: 6 × 50 = 300. In practice, this can be reduced to ~80–120 by combining closely-spaced modes and truncating inaudible upper partials.

### 4.4 String distribution across the keyboard

| Key range | Notes  | Strings per note                        |
| --------- | ------ | --------------------------------------- |
| 1–8       | A0–E1  | 1 (single wound bass)                   |
| 9–12      | F1–G#1 | 2 (wound bass bichords)                 |
| 13–88     | A1–C8  | 3 (trichords; lower wound, upper plain) |

The bass-treble break (wound to plain strings) occurs around F#3–A3 (notes 33–37) on most pianos. The Steinway D uses 12 whole and half wire gauge sizes for treble strings.

---

## 5. The modal resonator: biquad filter implementation

### 5.1 Core equation

Each modal partial is implemented as a **second-order bandpass digital resonator** using the impulse-invariant transform (NOT bilinear transform, which warps frequencies). The difference equation:

```
y[n] = C0 · (x[n] − x[n−2]) + C1 · y[n−1] + C2 · y[n−2]
```

This requires only **3 coefficients** and **2 state variables** per mode — the most efficient form for SIMD processing.

### 5.2 Coefficient calculation

Given modal frequency `f_k` (Hz), bandwidth `BW_k` (Hz), and amplitude `A_k`:

```
θ = 2π · f_k / f_s                    // pole angle [rad/sample]
R = exp(−π · BW_k / f_s)              // pole radius (decay)

C0 = A_k · (1 − R²) · sin(θ) / 2     // input gain
C1 = 2 · R · cos(θ)                   // feedback coefficient 1
C2 = −R²                              // feedback coefficient 2
```

where `BW_k = σ_k / π` and σ_k is the modal decay rate in s⁻¹.

**Alternative coefficient form** (from Haken, DSPRelated):

```
ω = 2π · f_k / f_s
α = sin(ω) · BW_k / (2 · f_s)
β = 1.0 / (1.0 + α)

C0 = A_k · β · sin(ω)
C1 = 2.0 · β · cos(ω)
C2 = β · (α − 1.0)
```

### 5.3 Modal amplitude from physics

The amplitude of partial n at the output (bridge) given an excitation at the hammer position:

```
A_n = (2 / (ρA · L)) · sin(nπ · x_hammer / L) · sin(nπ · x_bridge / L)
```

For standard piano geometry where the output is taken at the bridge (x_bridge ≈ L):

```
A_n ∝ sin(nπ · x_hammer / L) / n
```

The striking position `x_hammer/L ≈ 1/8` creates a **notch at the 8th harmonic** (and 16th, 24th, etc.), which is a characteristic piano timbre feature.

### 5.4 Numerical stability at low frequencies

For A0 (27.5 Hz) at 48 kHz: `cos(θ) ≈ 0.999993527`, so `C1 ≈ −1.999987`. In f32 (24-bit mantissa), this represents only ~8 bits of effective resolution for the deviation from −2.0.

**Solutions** (choose one):

- **Use f64** for all modes below ~200 Hz (doubles precision, halves SIMD width)
- **Coupled-form oscillator** — inherently more stable for narrow-bandwidth resonances:

```
[s1[n]]   [R·cos(θ)  −R·sin(θ)] [s1[n−1]]   [sin(θ)]
[s2[n]] = [R·sin(θ)   R·cos(θ)] [s2[n−1]] + [cos(θ)] · x[n]
output = s1[n]
```

This requires 4 multiplies vs. 3 for biquad but has much better numerical behavior.

### 5.5 Number of modes per note

| Component                    | Modes per note | Notes                                        |
| ---------------------------- | -------------- | -------------------------------------------- |
| Primary transverse partials  | 20–60          | More for lower notes (audible up to Nyquist) |
| Secondary partials (beating) | 20–60          | One per unison string detuning               |
| Longitudinal ("phantom")     | 2–5            | Most important for bass notes                |
| **Total**                    | **60–130**     | Varies by register                           |

---

## 6. Soundboard modeling

### 6.1 Material properties (Sitka spruce, Dumond & Baddour 2014)

| Property                       | Symbol | Value         | Units |
| ------------------------------ | ------ | ------------- | ----- |
| Density                        | ρ      | 404           | kg/m³ |
| Young's modulus (along grain)  | E_L    | **12,141**    | MPa   |
| Young's modulus (across grain) | E_R    | **896**       | MPa   |
| Shear modulus                  | G_LR   | **777**       | MPa   |
| Poisson's ratio ν_LR           | ν_LR   | 0.394         | —     |
| Poisson's ratio ν_RL           | ν_RL   | 0.042         | —     |
| Thickness                      | h      | 6–9 (tapered) | mm    |
| Loss factor                    | η      | 0.01–0.03     | —     |
| Rib spacing                    | —      | ~12.8         | cm    |

**Maple bridge**: ρ ≈ 680 kg/m³, E_L ≈ 12.6 GPa, dimensions ~25 mm wide × 30 mm tall.

### 6.2 Bridge impedance

| Frequency range | Bridge impedance   | Z                   |     | Behavior |
| --------------- | ------------------ | ------------------- | --- | -------- |
| Below ~1.1 kHz  | 800–1000 kg/s      | Homogeneous plate   |
| 1.1–2.5 kHz     | Falls to ~230 kg/s | Inter-rib waveguide |
| Above 2.5 kHz   | ~200–500 kg/s      | Complex modal       |

String characteristic impedance is ~2–10 kg/s. The **impedance mismatch** (~100:1) ensures long sustain while allowing adequate energy transfer to the soundboard.

### 6.3 Three implementation approaches (choose one)

**Option A: Commuted synthesis** (Smith & Van Duyne 1995) — lowest computational cost:

- Measure/compute the soundboard impulse response by exciting the bridge at each string position
- Convolve this IR into the excitation signal (commute it past the string model)
- The LTI commutativity property allows this: `Output = (Excitation * H_soundboard) * H_string`
- Store different IR tables for different velocity levels
- Cost: ~633 MAC/sample via partitioned FFT convolution with 128-sample blocks

**Option B: Multi-rate parallel filters** (Bank, De Poli, Sujbert 2002):

- Split into two bands at crossover frequency **~2.2 kHz**
- **LF band** (< 2.2 kHz): downsample 8×, apply FIR filter preserving magnitude AND phase
- **HF band** (> 2.2 kHz): magnitude-only IIR filter (human ear insensitive to HF phase)
- Total cost: ~200–400 MAC/sample

**Option C: Parallel second-order filters** — most parametric:

- Model soundboard as bank of 100–200 parallel biquad resonators
- Each biquad represents one soundboard mode with frequency, damping, and amplitude
- H(z) = Σ_k (b0_k + b1_k·z⁻¹) / (1 + a1_k·z⁻¹ + a2_k·z⁻²)
- Requires adding a parallel FIR component (~10–20 taps) for initial transient
- Most flexible: allows runtime adjustment of soundboard parameters

**Recommendation**: Use Option A (commuted synthesis) for highest quality with reasonable cost, or Option C for full physical parameterization matching Pianoteq's approach.

### 6.4 Soundboard modal equation (Ducceschi & Bilbao 2019)

For a rectangular orthotropic plate (simplified soundboard), eigenfrequencies:

```
Ω²(r_x, r_y) = (T_p / ρ_p·H) · [(r_x·π/L_x)² + (r_y·π/L_y)²]
              + D_x · (r_x·π/L_x)⁴ / (ρ_p·H)
              + D_y · (r_y·π/L_y)⁴ / (ρ_p·H)
              + 2·D_xy · (r_x·π/L_x)² · (r_y·π/L_y)² / (ρ_p·H)
```

Rigidity constants:

```
D_x = E_x · H³ / (12·(1 − ν_x·ν_y))
D_y = E_y · H³ / (12·(1 − ν_x·ν_y))
D_xy = D_x·ν_y + G·H³/6
```

For a Steinway D soundboard (~1.5 m × 1.0 m, 7 mm thick): approximately **2,400 modes below 10 kHz** (Chabassier et al. 2013).

---

## 7. Damper model

### 7.1 Damper force on string

```
F_damper(x,t) = −K_d · max(0, y(x,t) − y_d)^α − R_d · ẏ(x,t) · H(y(x,t) − y_d)
```

| Parameter | Value             | Description                |
| --------- | ----------------- | -------------------------- |
| K_d       | 10³–10⁴ N/m       | Damper felt stiffness      |
| R_d       | varies            | Velocity-dependent damping |
| y_d       | f(pedal_position) | Damper rest position       |
| α         | 2–3               | Felt nonlinearity exponent |

### 7.2 Modal implementation (simplified)

For real-time synthesis, model dampers by adding frequency-dependent damping to each partial:

```
σ_total(n) = σ_string(n) + σ_damper(n, pedal_pos)
σ_damper(n, p) = σ_max(n) · (1 − smoothstep(p, 0.15, 0.85))
```

**Decay times by register:**

| Register       | T60 undamped | T60 damped       |
| -------------- | ------------ | ---------------- |
| A0 (27 Hz)     | 20–45 s      | 0.3–0.8 s        |
| C4 (262 Hz)    | 8–15 s       | 0.05–0.15 s      |
| C6 (1047 Hz)   | 3–8 s        | 0.02–0.05 s      |
| C7+ (2093+ Hz) | 1–3 s        | N/A (no dampers) |

Notes above approximately C7 (key 76) have **no dampers** and ring freely.

### 7.3 Half-pedaling

The sustain pedal (CC64, continuous 0–127) controls damper height:

```
damper_position = smoothstep(CC64/127.0, 0.15, 0.85)
```

Between threshold_low (0.15) and threshold_high (0.85), dampers partially contact strings. Higher partials are damped more effectively at partial contact — model by scaling σ_damper(n) with n:

```
σ_damper(n, p) = σ_base · n^0.5 · (1 − smoothstep(p, 0.15, 0.85))
```

---

## 8. Pedal models

### 8.1 Sustain pedal (CC64)

When engaged: all dampers lift, all 88 strings free to resonate sympathetically. Implementation: set `σ_damper = 0` for all notes.

**Catch/repedaling**: if pedal re-engages within ~50–100 ms of release, strings continue from current state rather than being fully damped.

### 8.2 Una corda / soft pedal (CC67)

On a grand piano, shifts the action sideways so hammers hit 2 of 3 strings:

```rust
if una_corda {
    active_strings = max(1, num_strings_per_note - 1);
    hammer_stiffness_K *= 0.7;   // softer felt surface
    // unexcited strings still vibrate sympathetically
    sympathetic_coupling_to_unexcited = 0.3;
}
```

### 8.3 Sostenuto pedal (CC66)

Selectively sustains only notes whose keys are held when the pedal engages:

```rust
fn on_sostenuto_engage(&mut self) {
    for note in 0..88 {
        if self.key_is_held[note] {
            self.sostenuto_set.insert(note);
        }
    }
}

fn on_key_release(&mut self, note: usize) {
    if !self.sostenuto_set.contains(&note) {
        self.engage_damper(note);  // normal damping
    }
    // else: keep damper lifted until sostenuto releases
}
```

---

## 9. Sympathetic resonance

### 9.1 Coupling physics

Energy from vibrating strings transfers through the bridge/soundboard to other undamped strings. Strings resonate when any of their partials are close to partials of sounding strings:

```
|f_A(n) − f_B(m)| < Δf_critical    where Δf_critical ≈ 2–5 Hz
```

### 9.2 Implementation (Bank 2010 approach)

For each undamped string j, maintain a **secondary resonator bank** tuned to its partials. The excitation comes from the aggregate bridge force of all currently sounding strings:

```
bridge_force_total(t) = Σ_{active strings i} coupling(i,j) · F_bridge_i(t)
y_sympathetic_j(t) = resonator_bank_j(bridge_force_total(t))
```

**Coupling strength** between strings i and j at frequency f:

```
C(i,j,f) ∝ Y_bridge(f) · Σ_n Σ_m 1/(|f_i(n) − f_j(m)|² + BW²)
```

### 9.3 Efficient approximation

Full sympathetic resonance modeling for 88 strings is expensive. Optimizations:

- **Lehtonen et al. (2007)**: use only 12 string models (one per pitch class in the lowest octave) to represent sustain-pedal resonance
- Energy of sympathetic vibrations increases decay times in the middle register by **10–30%**
- Initial harmonic levels change by less than 1 dB when sustain pedal is engaged
- Can be approximated as a long convolution reverb tail on a separate bus, gated by pedal position

---

## 10. Phantom partials and longitudinal modes

### 10.1 Tension modulation mechanism

Geometric nonlinearity causes tension modulation during transverse vibration:

```
T(x,t) ≈ T₀ + (E·S / 2L) · ∫₀ᴸ (∂y/∂x)² dx
```

When transverse modes at frequencies f_m and f_n are present, their interaction produces **phantom partials** at:

- `f_m + f_n` (sum frequencies)
- `f_m − f_n` (difference frequencies)
- `2·f_m` (second harmonics)

### 10.2 Longitudinal mode frequencies

Longitudinal wave speed in steel: `c_L = √(E/ρ) ≈ 5,100 m/s`

```
f_L,k = k · c_L / (2L)
```

For C2 (L = 1.23 m): f_L,1 ≈ 2,073 Hz — approximately the **32nd transverse partial**. These contribute a metallic attack character, especially in bass notes.

### 10.3 Implementation for modal synthesis

Add **2–5 additional resonators per bass note** tuned to the first few longitudinal mode frequencies. Drive them with a signal derived from the sum of squared transverse partial amplitudes (tension modulation). This is perceptually important primarily for notes **below C5**.

---

## 11. Duplex scale resonance

Short string segments between bridge and hitch pin (rear duplex) and between agraffe and tuning pin (front duplex) resonate at harmonics of the main speaking length. On well-maintained pianos, these are tuned to the **octave, twelfth, or double octave** of the main string.

**Implementation**: add 1–2 extra high-Q resonators per treble note (C4 and above) tuned to the appropriate harmonic ratios. Amplitude: **−30 to −40 dB** relative to the main partials. These add "shimmer" and brightness to the upper register.

---

## 12. Tuning and temperament

### 12.1 Railsback curve (stretched tuning)

Piano tuning is stretched relative to equal temperament because inharmonicity makes mathematically pure octaves sound flat. Approximate cent deviations from equal temperament:

| Note | Key # | Approx. deviation (cents) |
| ---- | ----- | ------------------------- |
| A0   | 1     | −30                       |
| C2   | 16    | −12                       |
| C3   | 28    | −5                        |
| A3   | 37    | −2                        |
| C4   | 40    | −1                        |
| A4   | 49    | 0 (reference)             |
| C5   | 52    | +1                        |
| C6   | 64    | +5                        |
| C7   | 76    | +18                       |
| C8   | 88    | +35                       |

**Total stretch**: ~60 cents for a Steinway D concert grand. The Railsback curve emerges naturally from tuning procedure: match the 2nd partial of the lower note to the 1st partial of the upper note (4:2 octave stretch). This accumulates stretch from the inharmonicity coefficient B across the keyboard.

### 12.2 Historical temperament cent offsets (relative to A = 0)

| Temperament          | C     | C#    | D    | D#    | E    | F     | F#    | G    | G#    | A   | A#    | B    |
| -------------------- | ----- | ----- | ---- | ----- | ---- | ----- | ----- | ---- | ----- | --- | ----- | ---- |
| **Equal**            | 0     | 0     | 0    | 0     | 0    | 0     | 0     | 0    | 0     | 0   | 0     | 0    |
| **Werckmeister III** | +11.7 | +2.0  | +3.9 | +5.9  | +2.0 | +9.8  | 0.0   | +7.8 | +3.9  | 0.0 | +7.8  | +3.9 |
| **Kirnberger III**   | +10.3 | +0.5  | +3.4 | +4.4  | −3.4 | +8.3  | +0.5  | +6.8 | +2.4  | 0.0 | +6.4  | −1.5 |
| **Vallotti**         | +5.9  | 0.0   | +2.0 | +3.9  | −2.0 | +7.8  | −2.0  | +3.9 | +2.0  | 0.0 | +5.9  | −3.9 |
| **Young II**         | +5.9  | −3.9  | +2.0 | 0.0   | −2.0 | +3.9  | −5.9  | +3.9 | −2.0  | 0.0 | +2.0  | −3.9 |
| **Meantone ¼-comma** | +10.3 | −13.7 | +3.4 | +20.5 | −3.4 | +13.7 | −10.3 | +6.8 | −17.1 | 0.0 | +17.1 | −6.8 |

### 12.3 Unison detuning within string groups

| Condition     | Typical detuning |
| ------------- | ---------------- |
| Concert-tuned | < 0.5 cents      |
| Home piano    | 0.5–2.0 cents    |
| Aged piano    | 2–5 cents        |

For synthesis: detune trichord strings by `[0, +δ, −δ]` where δ = 0.5–2.0 cents. At A4=440 Hz, 2 cents ≈ 0.5 Hz beat rate.

---

## 13. Mechanical noise components

Piano realism depends on subtle mechanical noises. These are best implemented as **short filtered noise bursts** or pre-recorded samples triggered at appropriate times:

| Event                  | Duration | Spectral character       | Level (re: note) |
| ---------------------- | -------- | ------------------------ | ---------------- |
| Key-down thud          | 5–15 ms  | Broadband, peaks 1–5 kHz | −30 to −50 dB    |
| Hammer let-off click   | 2–5 ms   | High-freq transient      | −40 to −55 dB    |
| Damper lift            | 5–10 ms  | Low-mid broadband        | −45 to −60 dB    |
| Key-up backcheck click | 3–8 ms   | Mid-high transient       | −35 to −50 dB    |
| Damper fall thud       | 10–30 ms | Low-mid, pitch-dependent | −25 to −40 dB    |
| Pedal down             | 15–30 ms | Low-mid broadband        | −30 to −45 dB    |
| Pedal up               | 10–25 ms | Broadband clatter        | −25 to −40 dB    |

**Pianoteq confirms** this approach: its executable contains embedded FLAC files for percussive/noise components that are added to the modal synthesis output.

Synthesis method:

```
noise_burst(t) = A · envelope(t) · bandpass_filter(white_noise(t))
```

Scale amplitude A with MIDI velocity for key noises and with pedal velocity (derivative of CC64) for pedal noises.

---

## 14. Complete physical parameter reference

### 14.1 Piano wire material constants

| Property                      | Value       | Units |
| ----------------------------- | ----------- | ----- |
| Steel density                 | 7,850       | kg/m³ |
| Steel Young's modulus         | 210         | GPa   |
| Steel shear modulus           | 79          | GPa   |
| Steel Poisson's ratio         | 0.30        | —     |
| Copper density (winding)      | 8,960       | kg/m³ |
| Tensile strength (piano wire) | 2,620–2,930 | MPa   |

### 14.2 Piano wire gauge table (American standard)

| Gauge | Diameter (mm) | Usage              |
| ----- | ------------- | ------------------ |
| 13    | 0.787         | Highest treble     |
| 14    | 0.838         | Upper treble       |
| 15    | 0.889         | Mid-treble         |
| 16    | 0.940         | Mid-range          |
| 17    | 0.991         | Lower mid-range    |
| 18    | 1.041         | Upper tenor        |
| 19    | 1.092         | Lower tenor        |
| 20    | 1.143         | Upper bass (plain) |
| 22    | 1.245         | Bass core wire     |

### 14.3 Typical string parameters across the keyboard (concert grand)

| Note | Key# | f₀ (Hz) | L (m) | d (mm)               | #str | Type         | B      |
| ---- | ---- | ------- | ----- | -------------------- | ---- | ------------ | ------ |
| A0   | 1    | 27.5    | 2.01  | 1.0 core + 5.5 wound | 1    | double-wound | 0.0002 |
| C2   | 16   | 65.4    | 1.50  | 0.9 core + 3.5 wound | 2    | single-wound | 0.0003 |
| C3   | 28   | 130.8   | 0.95  | 0.95 plain           | 3    | plain steel  | 0.0004 |
| C4   | 40   | 261.6   | 0.62  | 1.00 plain           | 3    | plain steel  | 0.0007 |
| C5   | 52   | 523.3   | 0.33  | 0.95 plain           | 3    | plain steel  | 0.002  |
| C6   | 64   | 1046.5  | 0.17  | 0.85 plain           | 3    | plain steel  | 0.008  |
| C7   | 76   | 2093    | 0.085 | 0.78 plain           | 3    | plain steel  | 0.03   |
| C8   | 88   | 4186    | 0.05  | 0.70 plain           | 3    | plain steel  | 0.10   |

**Tensions**: 600–900 N per string across the keyboard. Total frame tension: ~200 kN (45,000 lbs) for Steinway D.

### 14.4 The definitive parameter source

The **Chabassier & Duruflé (2012) INRIA Technical Report RT-0425** provides complete parameters for all 88 strings of a Steinway D concert grand, including string lengths, diameters, densities (with equivalent densities for wound strings), tensions, Young's moduli, inharmonicity coefficients, hammer masses, stiffnesses, and damping coefficients. Download the 24-page PDF from: `https://inria.hal.science/hal-00688679v2/file/RT-425.pdf`

The open-source **MAESSTRO** project (`https://gitlab.com/benjamin.elie/maesstro`) incorporates these parameters in its codebase.

---

## 15. Rust implementation architecture

### 15.1 Recommended data structures

```rust
use std::simd::f32x8; // or use `wide` crate for stable SIMD

const MAX_MODES: usize = 128;  // per voice, padded to SIMD width
const MAX_VOICES: usize = 96;  // 88 keys + 8 extra for overlapping

#[repr(C, align(64))]  // cache-line aligned for SIMD
struct ModalVoice {
    // SoA layout — each array processes in parallel via SIMD
    c0: [f32; MAX_MODES],        // input gain coefficient
    c1: [f32; MAX_MODES],        // y[n-1] feedback coefficient
    c2: [f32; MAX_MODES],        // y[n-2] feedback coefficient
    y_prev: [f32; MAX_MODES],    // state y[n-1]
    y_prev2: [f32; MAX_MODES],   // state y[n-2]
    active_modes: usize,
    note: u8,
    velocity: f32,
    age_samples: u64,
    damper_engaged: bool,
}

struct PianoEngine {
    voices: Vec<ModalVoice>,
    active_voice_indices: Vec<usize>,
    soundboard_filter: SoundboardFilter,
    sympathetic_bank: SympatheticResonanceBank,
    noise_generator: MechanicalNoiseGen,
    sample_rate: f32,

    // Pre-computed parameter tables (88 entries each)
    string_params: [StringParams; 88],
    hammer_params: [HammerParams; 88],
    tuning_offsets: [f32; 88],      // cents deviation from ET
}

struct StringParams {
    fundamental_hz: f64,
    inharmonicity_b: f64,
    length_m: f64,
    num_strings: u8,        // 1, 2, or 3
    damping_b1: f64,        // s⁻¹
    damping_b2: f64,        // m²/s
    striking_ratio: f64,    // x_hammer / L
    unison_detuning_cents: f64,
}

struct HammerParams {
    mass_kg: f64,
    stiffness_k: f64,       // N/m^p
    exponent_p: f64,
}
```

### 15.2 SIMD modal synthesis kernel

```rust
fn process_modal_bank(
    voice: &mut ModalVoice,
    input_current: f32,
    input_prev2: f32,
) -> f32 {
    let input_diff = input_current - input_prev2;
    let input_vec = f32x8::splat(input_diff);
    let mut sum = f32x8::splat(0.0);

    let n = voice.active_modes;
    for i in (0..n).step_by(8) {
        let c0 = f32x8::from_slice(&voice.c0[i..]);
        let c1 = f32x8::from_slice(&voice.c1[i..]);
        let c2 = f32x8::from_slice(&voice.c2[i..]);
        let y1 = f32x8::from_slice(&voice.y_prev[i..]);
        let y2 = f32x8::from_slice(&voice.y_prev2[i..]);

        // y[n] = c0*(x[n]-x[n-2]) + c1*y[n-1] + c2*y[n-2]
        let y_new = c0 * input_vec + c1 * y1 + c2 * y2;

        y1.copy_to_slice(&mut voice.y_prev2[i..i+8]);
        y_new.copy_to_slice(&mut voice.y_prev[i..i+8]);
        sum += y_new;
    }

    sum.reduce_sum()  // horizontal sum of 8 lanes
}
```

**Performance**: at ~1 ns per biquad with AVX2 (8 parallel f32), processing 100 modes takes ~12.5 ns per sample. At 48 kHz, this is **0.06% of a single core** per voice. Full 88-voice polyphony: ~5% of one core.

### 15.3 Voice lifecycle

```rust
impl PianoEngine {
    fn note_on(&mut self, note: u8, velocity: u8) {
        let voice = self.allocate_voice(note);
        let params = &self.string_params[note as usize];
        let hammer = &self.hammer_params[note as usize];

        // 1. Compute hammer force pulse at oversampled rate
        let force_signal = self.compute_hammer_force(
            hammer, velocity as f32 / 127.0, params
        );

        // 2. Set up modal resonators
        let v_hammer = 0.5 + 4.5 * (velocity as f64 / 127.0); // m/s
        for n in 1..=voice.active_modes {
            let f_n = params.fundamental_hz * (n as f64)
                * (1.0 + params.inharmonicity_b * (n as f64).powi(2)).sqrt();
            if f_n > self.sample_rate as f64 / 2.0 { break; }

            let sigma_n = params.damping_b1
                + params.damping_b2 * (2.0 * PI * f_n).powi(2)
                    / (params.fundamental_hz * params.length_m * 2.0).powi(2);
            let bw = sigma_n / PI;
            let amp = (n as f64 * PI * params.striking_ratio).sin() / (n as f64);

            // Compute biquad coefficients
            let theta = 2.0 * PI * f_n / self.sample_rate as f64;
            let r = (-PI * bw / self.sample_rate as f64).exp();
            voice.c0[n-1] = (amp * (1.0 - r*r) * theta.sin() / 2.0) as f32;
            voice.c1[n-1] = (2.0 * r * theta.cos()) as f32;
            voice.c2[n-1] = (-(r * r)) as f32;
        }

        // 3. For coupled strings, add detuned resonators
        if params.num_strings >= 2 {
            self.add_coupled_string_modes(voice, params);
        }
    }
}
```

### 15.4 Sample rate strategy

| Subsystem               | Sample rate                      | Rationale                                            |
| ----------------------- | -------------------------------- | ---------------------------------------------------- |
| Hammer model            | 176.4–384 kHz (4–8× oversampled) | Nonlinear contact needs high temporal resolution     |
| String modal resonators | 48 kHz                           | Modal synthesis aliases only if modes exceed Nyquist |
| Soundboard filter       | 48 kHz                           | LTI post-filter                                      |
| Sympathetic resonance   | 48 kHz (or 24 kHz downsampled)   | Lower precision acceptable                           |
| Audio output            | 44.1 or 48 kHz                   | Standard                                             |

### 15.5 Real-time safety checklist

- **No heap allocation** in the audio callback — pre-allocate all voice pools and buffers at initialization
- **No locks** — use lock-free ring buffers (`crossbeam` or `ringbuf` crate) for MIDI-to-audio thread communication
- **No syscalls** — avoid file I/O, logging, `println!` in the audio thread
- **Block processing** — process 64–256 samples per callback to amortize overhead
- **SIMD alignment** — use `#[repr(C, align(64))]` on all coefficient/state arrays

### 15.6 Recommended crate dependencies

| Crate                 | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `cpal`                | Cross-platform audio I/O                              |
| `midir`               | MIDI input                                            |
| `wide` or `std::simd` | Portable SIMD operations                              |
| `crossbeam`           | Lock-free channels for real-time thread communication |
| `biquad`              | Reference biquad implementations (DF1, DF2T)          |

---

## 16. Pianoteq's architecture — what to replicate

Based on the Guillaume patent (US7915515B2) and public technical information:

### 16.1 Key architectural decisions

Pianoteq uses **pure modal synthesis** — NOT digital waveguides. The patent explicitly rejects waveguides as "imperfect and not very realistic." The core innovation is the **two-module architecture**:

**Presynthesis module** (offline, runs when parameters change):

1. Run FEM eigenvalue solver on the coupled string-soundboard system
2. Compute complex eigenfrequencies f_n + i·d_n and eigenmodes u_n
3. Build interpolation function (multivariate Padé approximants) mapping physical parameters → modal parameters
4. When user adjusts any physical knob, the interpolation function rapidly recomputes timbre coefficients

**Real-time module** (audio callback):

1. Read MIDI event → select excitation parameters (a_n, φ_n) from velocity-indexed tables
2. Sum damped sinusoids: `s(t) = Σ_n a_n · exp(-d_n·t) · sin(2π·f_n·t + φ_n)`
3. Add percussive noise component b(p,t) from stored samples
4. Each active note is an independent summation — trivially parallelizable

### 16.2 What makes Pianoteq sound superior

- **Coupled string-soundboard eigenmodes**: FEM computes the complete coupled system, so sympathetic resonance and energy transfer emerge naturally from the modal structure
- **Multivariate Padé interpolation**: allows smooth, physically meaningful parameter variation — every MIDI velocity produces a genuinely different timbre
- **K unison strings → K modes per harmonic**: automatically produces beating and two-stage decay
- **Percussive noise from samples**: the attack transient and mechanical noises use stored FLAC samples, not purely synthesized — this is pragmatic and effective
- **32-bit floating-point** internal computation at configurable sample rates up to 192 kHz

### 16.3 Replicable innovations

To match Pianoteq quality, the Rust implementation should:

1. Use modal synthesis with ~100–150 resonators per voice (3 strings × ~50 partials)
2. Pre-compute modal parameters from physical equations rather than FEM (faster, simpler, close enough for most purposes)
3. Include mechanical noise samples (key thud, damper noise, pedal noise) as embedded audio data
4. Implement continuous pedal response (half-pedaling via CC64 continuous values)
5. Model sympathetic resonance as secondary resonator banks driven by aggregate bridge force

---

## 17. Perceptual priorities that determine synthesis quality

These are ranked by perceptual importance based on piano acoustics research and Pianoteq user community feedback:

1. **Velocity-dependent timbre** (not just volume) — the hammer felt nonlinearity must produce brighter spectra at higher velocities. This is the single most important feature separating physical models from naive synthesis.

2. **Two-stage decay with beating** — unison string detuning creates the characteristic "alive" quality. Without it, piano tones sound static and dead.

3. **Inharmonicity** — partials must be stretched according to B·n². Perfectly harmonic partials sound like an organ, not a piano.

4. **Attack transient complexity** — the first 20–50 ms includes hammer noise, key mechanism sounds, and rapid spectral evolution. Adding even low-level noise at the attack dramatically improves realism.

5. **Sympathetic resonance** — undamped strings resonating via soundboard coupling add depth. Most noticeable with sustain pedal, but present even in normal playing.

6. **Soundboard coloration** — the soundboard's frequency response shapes the overall timbre. Without it, the sound is thin and "electric."

7. **Damper/pedal behavior** — continuous pedal response and damper noise are essential for advanced piano repertoire.

8. **Longitudinal modes (phantom partials)** — contribute metallic attack character in the bass register. Subtle but important for authenticity.

---

## 18. Reference implementation pseudocode

```
INIT:
    for note in 0..88:
        load string_params[note] from Chabassier/Duruflé tables
        load hammer_params[note] from interpolation formulae
        compute tuning_offsets[note] from Railsback curve

    pre-allocate 96 ModalVoice structs (all memory pre-allocated)
    load mechanical noise samples (key_down, key_up, pedal_down, pedal_up)
    initialize soundboard filter (parallel biquad bank or FFT convolution)
    initialize sympathetic resonance bank

AUDIO CALLBACK (per 64-sample block):
    for each pending MIDI event:
        if note_on:
            voice = allocate_voice(note)
            // Compute hammer force at 4× oversampled rate
            force_pulse = run_hammer_ode(hammer_params[note], velocity, 4*fs)
            // Decimate force_pulse to audio rate
            force_decimated = decimate_4x(force_pulse)
            // Store force as excitation buffer in voice
            voice.excitation = force_decimated
            // Compute modal coefficients
            for n in 1..max_modes:
                f_n = f0 * n * sqrt(1 + B*n²) * cents_to_ratio(tuning_offset)
                if f_n > fs/2: break
                sigma_n = b1 + b2 * (2*pi*f_n)²
                A_n = sin(n*pi*strike_pos) / n * velocity_brightness_curve(vel)
                compute_biquad_coeffs(voice, n, f_n, sigma_n, A_n)
            // Add coupled string modes if num_strings > 1
            add_detuned_modes(voice, unison_detuning)
            // Trigger key-down noise
            trigger_noise(KEY_DOWN, velocity)

        if note_off:
            // Increase damping on all modes of this voice
            for n in voice.active_modes:
                voice.c2[n] *= damper_factor  // increase decay rate
            trigger_noise(KEY_UP, velocity)

    // Process all active voices
    output_buffer = [0.0; 64]
    for voice in active_voices:
        for sample in 0..64:
            excitation = voice.get_excitation_sample()  // 0 after initial pulse
            out = process_modal_bank(voice, excitation)
            output_buffer[sample] += out

    // Apply soundboard filter
    output_buffer = soundboard_filter.process(output_buffer)

    // Add sympathetic resonance (if sustain pedal active)
    if pedal_position > 0:
        sympathetic = sympathetic_bank.process(output_buffer, pedal_position)
        output_buffer += sympathetic

    // Add mechanical noises
    output_buffer += noise_generator.process()

    return output_buffer
```

---

## 19. Key open-source references for implementation

| Project                 | Language | Approach            | URL                                                   |
| ----------------------- | -------- | ------------------- | ----------------------------------------------------- |
| **Qiano** (Otey)        | C++      | Waveguide, commuted | `github.com/claytonotey/qiano`                        |
| **FAUST piano.dsp**     | FAUST    | Commuted waveguide  | `github.com/grame-cncm/faust/.../piano.dsp`           |
| **NESS** (Bilbao group) | C++/CUDA | FDTD                | `github.com/Edinburgh-Acoustics-and-Audio-Group/ness` |
| **MAESSTRO** (Elie)     | —        | Full physics        | `gitlab.com/benjamin.elie/maesstro`                   |
| **OpenPiano** (Perrone) | C++/JUCE | FDTD                | `github.com/michele-perrone/OpenPiano`                |
| **Mutable Elements**    | C++      | Modal synthesis     | `github.com/pichenettes/eurorack`                     |

The FAUST piano.dsp model is the most readable complete implementation of commuted waveguide piano synthesis. The Mutable Instruments Elements resonator code (`resonator.cc`) is an excellent reference for production-quality modal synthesis with SIMD.

---

## 20. Conclusion: building beyond Pianoteq

Matching Pianoteq requires implementing modal synthesis with physically-derived parameters, coupled unison string models, a soundboard post-filter, and mechanical noise components. **Surpassing** Pianoteq is possible by addressing its known weaknesses: the treble register can sound metallic, and the attack transient sometimes lacks the complexity of a real instrument.

Three areas offer the most potential for improvement. First, using **machine-learned soundboard transfer functions** from measured impulse responses of specific instruments (Steinway D, Bösendorfer 280VC, Yamaha CFX) rather than purely synthetic modal approximations. Second, implementing **full continuous hammer-string-soundboard coupling** rather than the exciter-resonator separation that Pianoteq uses — this would capture the way the hammer "listens" to the string through re-contact effects. Third, leveraging **modern SIMD (AVX-512)** and multi-core processing to run more modes per voice than Pianoteq's 2006-era architecture was designed for, enabling richer phantom partials and more detailed sympathetic resonance. The parameter tables in the Chabassier & Duruflé INRIA report, combined with the equations and algorithms specified in this document, provide everything needed to begin implementation.
