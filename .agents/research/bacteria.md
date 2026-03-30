# Bacteria for Sourdaw — AI Implementation Guide

## Document Purpose

This document consolidates the provided source material into a single, implementation-oriented specification for **Bacteria**, a flagship **creative multi-effects framework** for **Sourdaw**.

It is structured for direct AI-agent consumption and implementation planning across:

- DSP architecture
- UX architecture
- routing and graph execution
- modulation systems
- visualization systems
- performance constraints
- algorithm deconstruction
- engineering priorities

No source information has been intentionally removed. Where the source contained repeated material, conflicting formulations, or transcription artifacts, those are preserved and clarified in dedicated notes.

---

## Core Product Definition

**Bacteria** is a **high-performance, modular, creative processor** for **Sourdaw**, built on:

- a **Rust-based DSP backend** (`daw-dsp`)
- a **WebGPU-accelerated React 19 frontend**

Bacteria is not intended to be a clinical or corrective utility plugin. It is designed for:

- **radical sonic transformation**
- **multi-band sound mangling**
- **modular routing**
- **deep modulation**
- **real-time performance interaction**
- **progressive disclosure UX**
- **character-first defaults**

Its conceptual goal is to synthesize the strengths of elite proprietary processors while introducing a unified, multi-band, modulation-heavy environment.

---

## Primary Design Philosophy

### 1. Creative FX over Utility FX

Bacteria prioritizes:

- **character**
- **movement**
- **interesting defaults**
- **frequency-specific destruction**
- **playability**
- **deep editability without immediate overwhelm**

Transparency is not the default target. Effects should sound compelling at default settings.

### 2. Progressive Disclosure

Bacteria uses a **5-level progressive disclosure architecture** to solve the interaction problem of exposing extreme complexity while remaining usable:

- Level 1: Play
- Level 2: Shape
- Level 3: Build
- Level 4: Route
- Level 5: Lab

This follows a **What-You-Use-Is-What-You-See (WYUIWYS)** philosophy.

### 3. Multi-Band as Structural Core

The engine centers on a configurable **multi-band processor** with:

- **1 full-range band** minimum
- **up to 6 bands** maximum

The crossover design must guarantee **perfect or near-perfect reconstruction** when no effect processing is active.

---

# 1. System Architecture

## 1.1 High-Level Stack

### DSP Backend

- Language: **Rust**
- Module: **`daw-dsp`**
- Processing model: **block-based**
- Real-time safety: **lock-free communication**
- Routing representation: **Directed Acyclic Graph (DAG)**
- Parallel execution: **thread pool**, **topological sorting per block**
- Non-linear processing: **oversampled**
- Modulation: sample-accurate or near-sample-accurate, with some source material specifying **4x modulation-rate oversampling**

### Frontend

- Framework: **React 19**
- Rendering system: **WebGPU**
- UI interaction model: **nested progressive disclosure**
- Responsiveness strategy: **concurrent rendering**
- Real-time visualizations:
    - spectrum analyzer
    - modulation collars
    - modulation flow particles
    - signal flow DAG view
    - stereo phase / oscilloscope displays
    - spectral heatmaps
    - crossover boundaries

### IPC / Synchronization

- lock-free ring buffers
- specifically referenced:
    - **SPSC (Single Producer Single Consumer) queues**
    - **Tauri v2 (Rust IPC)** in UX-specific source material

---

# 2. Multi-Band Processing Engine

## 2.1 Functional Requirements

Bacteria must support:

- configurable band count from **1 to 6**
- draggable crossover boundaries
- complementary crossover reconstruction
- per-band processing chains
- per-band solo/mute/level controls
- optional per-band oversampling
- serial, parallel, and mid/side routing

## 2.2 Design Goal

After splitting the input into discrete frequency bands and recombining them:

- the summed output should exhibit **flat frequency response**
- the summed output should maintain **coherent phase**
- when no processors are active, the engine should reconstruct the original signal as faithfully as possible

---

## 2.3 Crossover Filter Design and Topologies

The source material identifies several crossover options.

### Comparison Table

| Filter Type    | Magnitude at Crossover |      Phase Difference |     Slope (Order) | Typical Latency |
| -------------- | ---------------------: | --------------------: | ----------------: | --------------: |
| Butterworth    |                  -3 dB | 90° (2nd), 180° (4th) | 6/12/18/24 dB/oct |      Zero (IIR) |
| Linkwitz-Riley |   -6 dB (sums to 0 dB) |         0° (in-phase) |   12/24/48 dB/oct |      Zero (IIR) |
| Linear Phase   |   -6 dB (sums to 0 dB) |           0° (linear) |      Configurable |      High (FIR) |
| Bessel         |                  -3 dB |       0° (linearized) |      12/24 dB/oct |      Zero (IIR) |

---

## 2.4 Default Crossover Mode: Linkwitz-Riley 4th Order (LR4)

The default crossover topology is **4th-order Linkwitz-Riley**.

### Properties

- implemented as a cascade of **two 2nd-order Butterworth filters**
- attenuation slope: **24 dB/oct**
- zero-latency **IIR**
- in-phase at crossover
- low computational cost
- professional standard for active crossovers

### Transfer Functions Given in Source

For LR4, the low-pass and high-pass transfer functions are specified as:

$$
H_{LP}(s) = \frac{1}{(s^2 + \sqrt{2}s + 1)^2}
$$

$$
H_{HP}(s) = \frac{s^4}{(s^2 + \sqrt{2}s + 1)^2}
$$

### Mid-Band Construction

For a 3-band architecture, the source describes:

- low band: LPF
- mid band: BPF or cascaded HPF + LPF
- high band: HPF

The mid band can be obtained by:

- subtracting low + high from the original signal, or
- more commonly, cascading HP and LP at the appropriate boundaries

---

## 2.5 Optional Mode: Linear Phase FIR

Bacteria must also support a **Linear Phase** mode for high-fidelity and mastering-grade use.

### Motivation

IIR crossovers such as LR4 introduce **frequency-dependent phase shift**. This can become problematic in:

- mastering-grade saturation
- complex parallel processing
- high-fidelity summing
- phase-sensitive routing

### Requirements

- use **FIR** filters
- preserve identical delay across all frequencies
- maintain phase integrity
- accept high latency and possible **pre-ringing**

### Additional Source-Specific Detail

The source also specifies a possible implementation using **windowed-sinc FIR filters**.

#### Tap Count Logic

At **44.1 kHz**, a cited example uses:

- **32,768 taps**

Latency formula:

$$
\text{latency} = \frac{N - 1}{2f_s}
$$

For the example tap count, the source states latency is approximately:

- **371 ms**

---

## 2.6 Alternate Linear-Phase/Subtractive Crossover Variant

A separate source section describes a **Phase-Linear Subtractive Crossover**:

$$
y_{HP}[n] = x[n - d] - y_{LP}[n]
$$

Where:

- $d$ is the group delay of the low-pass filter

This is described as a way to achieve linear-phase behavior with **significantly lower throughput delay** than traditional FIR-only approaches.

This should be preserved as an **implementation option or research branch**, since it is explicitly included in the provided material.

---

## 2.7 Crossover UI Requirements

The UI must expose crossover management via:

- real-time **WebGPU spectrum display**
- draggable vertical crossover boundaries
- up to **6 bands**
- per-crossover slope control
- source material specifies slope choices including:
    - 6 dB/oct
    - 12 dB/oct
    - 24 dB/oct
    - 36 dB/oct
    - 48 dB/oct

---

# 3. Signal Routing Architecture

## 3.1 Core Routing Requirement

Bacteria supports a modular signal path with **real-time updates**.

Routing must support:

- serial
- parallel
- mid/side
- multi-band
- sidechain-like internal modulation paths
- internal feedback loop concepts in Route/Lab modes

## 3.2 Routing Modes

| Routing Mode | Technical Process                                  | Creative Application                |
| ------------ | -------------------------------------------------- | ----------------------------------- |
| Serial       | $y = f(g(h(x)))$                                   | Sequential tone shaping             |
| Parallel     | $y = f(x) + g(x)$                                  | Layering textures, wet/dry blending |
| Mid/Side     | $y = \text{Matrix}(f(\text{Mid}), g(\text{Side}))$ | Widening, center-punch preservation |
| Multi-Band   | $y = \sum_{i=1}^N f_i(\text{Band}_i)$              | Frequency-specific mangling         |

---

## 3.3 Parallel Chains

Parallel routing is implemented using a **Chain architecture**:

- split signal into multiple independent paths
- apply independent effect lists per path
- sum outputs at the end

Use cases:

- texture layering
- clean/dirty blending
- frequency-specific parallel color
- macro-controlled morphing between paths

---

## 3.4 Mid/Side Routing

Mid/Side mode decomposes stereo input into:

- **Mid** = $L + R$
- **Side** = $L - R$

Applications:

- stereo widening
- preserving center impact
- side-only distortion/filtering
- side-only modulation
- center-punch retention

### UX Cue

Source material specifies:

- Mid and Side should be visually differentiated
- example color suggestion:
    - White for Mid
    - Blue for Side

---

## 3.5 DAG-Based Routing Execution

The signal path is modeled as a **Directed Acyclic Graph (DAG)**.

### Requirements

- topologically sort the graph per audio block
- determine optimal parallel execution plan
- support UI-driven graph mutation without audio dropouts

### Real-Time Graph Mutation

The source specifies:

- lock-free SPSC queues from UI thread to audio thread
- graph mutation messages are transmitted to audio engine safely
- routing changes must avoid glitches

---

## 3.6 Multicore Execution

The Rust backend should:

- process parallel chains across multiple CPU cores
- use a thread pool
- resolve node dependencies from graph topology
- avoid allocations on the audio thread

---

# 4. Creative Effect Modules

Bacteria’s effect modules follow a **dual-mode philosophy**:

- **clean / utility mode** for subtle enhancement
- **creative / extreme mode** for destructive or radical processing

---

## 4.1 Non-Linear Distortion and Custom Waveshaping

### Design Intent

Inspired by:

- iZotope Trash 2 dual-stage waveshaping
- FabFilter Saturn 2 multi-band saturation

### Supported Algorithms

At minimum, the source material names:

- soft clip
- hard clip
- wavefolding
- bitcrushing
- vacuum tube emulation
- foldback distortion
- custom transfer function drawing
- asymmetry control
- breakdown/pitch-down distortion
- smudge pre-blur + shaping

---

### 4.1.1 Harmonic Behavior

#### Symmetric Waveshaping

- primarily produces **odd-order harmonics**
- associated with tape-like or symmetric saturation

#### Asymmetric Waveshaping

- positive and negative cycles processed differently
- introduces **even-order harmonics**
- perceived as warmer / more analog

---

### 4.1.2 Soft Clipping

A provided soft-clipping function is:

$$
y = \tanh(k \cdot x)
$$

Where:

- $x$ = input amplitude
- $k$ = drive amount
- $y$ = output amplitude

---

### 4.1.3 Foldback Distortion

Source formula:

$$
y =
\begin{cases}
x & \text{if } |x| \leq T \\
(2T - x) & \text{if } x > T \\
(-2T - x) & \text{if } x < -T
\end{cases}
$$

Where:

- $T$ = threshold

This creates dense, complex spectral patterns and responds strongly to input dynamics.

#### Additional Source Note

Another section describes this as a **recursive algorithm** and states it mirrors the signal back into the range when exceeding $T$, but the original text appears to contain a truncation artifact around the explicit range notation. Preserve the above equation as the concrete definition.

---

### 4.1.4 Custom Waveshaping Editor

Users can draw a custom transfer function:

$$
f(x)
$$

Requirements:

- coordinate-based transfer-function editor
- cubic Bezier segments
- tension control
- real-time evaluation in backend
- continuity-preserving evaluation

The source additionally specifies:

- evaluation using the **Bernstein basis**
- target continuity: **$C^1$ continuity**

---

### 4.1.5 Smudge Algorithm

The source describes a **Smudge** mode as a temporal/spectral hybrid that blurs transients before distortion.

#### Description

- operates in STFT domain
- smooths FFT magnitudes across successive frames
- turns transients and bright peaks into sustained spectral textures before waveshaping

#### Two Formula Variants in Source

Variant A:

$$
M_{avg}[k, n] = (1 - \alpha) \cdot M[k, n] + \alpha \cdot M_{avg}[k, n-1]
$$

Variant B:

$$
M_{avg}[k, n] = \alpha \cdot M[k, n] + (1 - \alpha) \cdot M_{avg}[k, n - 1]
$$

Where:

- $M[k, n]$ = magnitude of bin $k$ at frame $n$
- $M_{avg}[k, n]$ = smoothed magnitude
- $\alpha$ = smoothing coefficient

### Implementation Guidance

Both formulations are present in the source and should be treated as **source variants**. An implementation should choose one convention and define clearly whether $\alpha$ weights:

- the current frame, or
- the prior averaged state

---

### 4.1.6 Breakdown Mechanism

Inspired by **Saturn 2 Breakdown** style.

#### Description

- combines pitch-down / octaver-like processing with aggressive foldback clipping
- intended to create dense, low-frequency harmonic destruction

#### Pitch Component

Implemented using **Phase Vocoder bin remapping**.

Remapping logic:

$$
f_{new} = f_{original} \times 2^{-n}
$$

Where:

- $n$ = octaver depth

The source also specifies:

- phase unwrapping to reduce phasiness
- continuity should be preserved across bins

---

## 4.2 Multi-Mode Filtering

### Core Topology

Bacteria includes a **multi-mode State Variable Filter (SVF)**.

### Supported Modes

- low-pass
- high-pass
- band-pass
- notch
- resonant experimental modes
- formant
- comb

### Rationale for SVF

The source specifies SVF is chosen for:

- stability
- ability to modulate cutoff at **audio rates**
- reduced artifacting under fast modulation

---

### 4.2.1 Envelope-Tracked Filtering

Filter cutoff may be driven by an **integrated envelope follower**.

Use cases:

- breathing filter effects
- dynamic wah-like motion
- amplitude-sensitive timbre tracking

This is explicitly compared to:

- Logic’s **Phat FX**

---

### 4.2.2 Audio-Rate Modulation

The filter should accept:

- modulation from internal oscillators
- modulation from Sourdaw environment oscillators
- FM-style filter synthesis / aggressive cutoff movement

---

## 4.3 Modulation Effects: Chorus, Flanger, Phaser

### Chorus / Flanger

- implemented as **modulated delay lines**
- include **feedback**
- designed for movement and spatial depth

### Phaser

- implemented via **series of all-pass filters**
- creates moving notches in the spectrum

---

## 4.4 Frequency Shifting

This is identified as a critical module.

### Design Goal

Unlike pitch shifting, which preserves harmonic ratios, a **frequency shifter** adds/subtracts a constant amount in **Hz** to all partials.

Result:

- inharmonicity
- metallic or bell-like tones
- discordant movement
- phaser-like motion at sub-audio rates

---

### 4.4.1 Analytic Signal Formulation

The source gives:

$$
s(t) = x(t) + j\hat{x}(t)
$$

Where:

- $x(t)$ = input signal
- $\hat{x}(t)$ = Hilbert transform of input

Then multiply by complex exponential:

$$
e^{j\omega_c t}
$$

Output:

$$
y(t) = \text{Re}\{s(t) \cdot e^{j\omega_c t}\} = x(t)\cos(\omega_c t) - \hat{x}(t)\sin(\omega_c t)
$$

A second source variant gives:

$$
y(t) = x(t)\cos(\omega_{shift} t) \mp \hat{x}(t)\sin(\omega_{shift} t)
$$

This indicates possible upper/lower sideband selection.

---

### 4.4.2 Precision Implementation Variant

A separate source section describes a **Bode-style frequency shifter** using:

- IIR implementation
- two all-pass filter chains
- approximately **90° phase separation**
- target band: **20 Hz–20 kHz**

Additional note:

- coefficients are optimized with a **Chebyshev approximation**
- goal: **1% phase accuracy** down to **20 Hz**

This should be treated as a high-quality implementation target.

---

## 4.5 Real-Time Granular Processing

Bacteria includes a **real-time granular engine** inspired by **Output Portal**, operating on live incoming audio rather than preloaded files.

### Buffer Strategy

- short-term **circular buffer**
- buffer size cited as **1–2 seconds**

### Operation

- incoming audio written continuously to circular buffer
- grains extracted from live buffer
- re-synthesized with randomized or sequenced parameters

### Parameter Table

| Granular Parameter | Technical Description                   | Sonic Effect                 |
| ------------------ | --------------------------------------- | ---------------------------- |
| Grain Size         | Duration in samples / roughly 10–500 ms | Choppiness vs. smoothness    |
| Density            | Number of grains per second             | Texture thickness            |
| Position Offset    | Playback start relative to write head   | Time-stretching / smearing   |
| Pitch Shift        | Resampling rate of grain                | Harmonic / melodic variation |
| Grain Shape        | Envelope type (Hann, Gaussian)          | Reduces transient clicks     |

### Freeze Mode

Special mode where:

- write head stops updating
- read heads continue sampling from captured buffer state
- creates perpetual drone / frozen texture

### Grain Windowing

Explicitly named window types:

- Hann
- Gaussian

Purpose:

- reduce zero-crossing clicks
- smooth grain boundaries

---

## 4.6 Lo-Fi, Degradation, and Codec Artifacts

### Core Lo-Fi Functions

- bit-depth reduction
- sample-rate reduction
- aliasing
- quantization noise

### Codec Simulation

Inspired by:

- **Goodhertz Lossy**

Goal:

- simulate low-bitrate MP3 / streaming artifacts
- chirping
- smearing
- packet-loss-like behavior
- quantized transform-domain degradation

---

### 4.6.1 Fast Hartley Transform (FHT) Variant

The source repeatedly identifies **Fast Hartley Transform (FHT)** as central to codec-style artifact simulation.

#### Rationale

- real-valued alternative to FFT
- computationally efficient for real-valued signals
- source claims it can produce more “musical” errors under quantization

#### Artifact Procedure

One version specifies:

- transform using real-to-real Hartley transform
- threshold coefficients
- inverse transform to produce artifacts

Another version expands:

- threshold coefficients using:
    - set $H_k = 0$ if $|H_k| < T$
- apply **run-length encoding (RLE) logic**
- simulate packet loss and quantization noise
- inverse transform back to time domain

This full variant should be preserved as the more detailed implementation description.

---

## 4.7 Spectral Processing

Bacteria includes STFT-based spectral processing.

### Core Techniques

- Short-Time Fourier Transform (STFT)
- spectral freeze
- spectral blur
- bin-level editing
- temporal spectral smoothing

### Spectral Freeze

Freeze magnitude/phase or some subset of spectral state to create a sustained spectral image.

### Spectral Blur

Blur magnitudes over time by recursive averaging.

Reference equation already provided in Smudge section.

---

## 4.8 Convolution / Body Modeling

The source emphasizes **body modeling**, not room simulation.

### Design Intent

Convolution should use **impulse responses of physical objects** rather than standard reverb IRs.

Examples named:

- ceramic pipes
- wooden cabinets
- metallic springs
- ceramic
- wood
- metal

### Goal

Impart resonant body character to:

- distorted signals
- sustained material
- leads and textures
- sound-design layers

### Additional Feature

A **Separation** control is specified to widen mono IRs into stereo.

---

# 5. Modulation Engine

Bacteria uses a **unified modulation architecture** where essentially all parameters can be modulation targets.

## 5.1 Core Principles

- drag-and-drop modulation targeting
- sample-accurate or high-rate modulation
- visual range indicators on target parameters
- per-module quick modulation
- global modulation dock
- internal movement as a core sound-design value

---

## 5.2 ShaperBox-Style Custom LFO

### Function

Users draw arbitrary LFO shapes via **Bezier curves**.

### Purpose

- sample-accurate modulation
- rhythmic ducking
- parameter automation without external sidechain
- complex tempo-synced motion

### Cubic Bezier Formula

The source provides:

$$
P(t) = (1-t)^3P_0 + 3(1-t)^2tP_1 + 3(1-t)t^2P_2 + t^3P_3
$$

A source fragment appears truncated and states:

- “Where $t \in$ is the normalized time within the segment.”

For implementation purposes, interpret as normalized segment time, conventionally:

$$
t \in [0, 1]
$$

This is a clarification, not a removal of source information.

### Editor Requirements

- draw arbitrary rhythmic curves
- grid snapping
- smoothing / anti-click handling
- rhythmic sidechain behavior
- tempo sync

---

## 5.3 Envelope Followers

Each effect slot has access to a dedicated **envelope follower**.

### Parameters

- adjustable attack
- adjustable release

### Use Cases

- amplitude-sensitive distortion drive
- filter envelope
- dynamic modulation
- transient shaping

### Special Mode

A **Transient mode** is specified:

- behaves like a peak detector
- useful for drums and percussion

---

## 5.4 Quick Modulators

At Level 2, each module exposes:

- one **LFO**
- one **Envelope Follower**

These are pre-mapped to the most salient parameters of that module.

---

## 5.5 Global Modulation Dock

At Level 3, the UI exposes a global modulation tray.

Sources name:

- XLFOs
- chaotic **Lorenz attractors**
- step sequencers

---

## 5.6 Lorenz Attractor LFO

A source section specifies a **chaotic modulator** based on the Lorenz system.

### Differential Equations

$$
\frac{dx}{dt} = \sigma(y - x), \quad
\frac{dy}{dt} = x(\rho - z) - y, \quad
\frac{dz}{dt} = xy - \beta z
$$

### Numerical Integration

- **4th-order Runge-Kutta** method

### Mapping

The source states the $x$ and $z$ coordinates are normalized to drive parameters such as:

- filter cutoff
- granular density

A transcription artifact obscures the explicit normalization interval in the source. Preserve the existence of normalization without inventing an exact interval unless implementation requires one.

---

## 5.7 Audio-Rate Modulation

A source section explicitly states:

- modulator signals run at **4x the base sample rate**

Purpose:

- sample-accurate high-frequency FM
- clean rhythmic ducking
- accurate control-rate behavior under extreme modulation

This should be treated as a target for high-end modes, even if other modes use lighter control-rate evaluation.

---

## 5.8 Drag-and-Drop Modulation UX

Pattern compared to **Vital**.

### Interaction

- drag modulation source icon
- drop onto any target knob/slider/parameter
- create **modulation collar** around target
- show:
    - amount
    - polarity/range
    - real-time movement

---

## 5.9 Rhythmic Sidechaining Without External Sidechain

The source makes this a core “secret sauce” feature.

### Concept

Instead of requiring an external sidechain trigger, users draw the ducking curve directly.

### Terms Used

- “ShaperBox-style LFO editor”
- “VolumeShaping”
- predictive rather than reactive ducking

### Benefits

- tempo-perfect synchronization
- genre-specific ducking shapes
- cleaner than envelope-reactive compression
- no need for routing another track as trigger

---

# 6. X/Y Morphing and Macros

## 6.1 Macro Controls

Bacteria exposes **8 macro knobs**.

### Requirements

- high visibility
- map to many parameters across bands and modules
- Ableton Rack-style macro mapping
- support multi-dimensional sound changes from one control

---

## 6.2 X/Y Snapshot Morpher

The X/Y pad morphs between **four saved snapshots**:

- A, B, C, D

Alternative notation in sources:

- $S_{00}$, $S_{10}$, $S_{01}$, $S_{11}$

### Interpolation Formula

Variant 1:

$$
V_{interp} = V_A(1-x)(1-y) + V_B(x)(1-y) + V_C(1-x)(y) + V_D(x)(y)
$$

Variant 2:

$$
V_{morph}(u, v) = S_{00}(1-u)(1-v) + S_{10}u(1-v) + S_{01}(1-u)v + S_{11}uv
$$

These are equivalent formulations.

### Purpose

- play the plugin like an instrument
- morph entire states in real time
- explore preset spaces
- macro-level performance control

### UX Comparison

Compared to:

- Alchemy-style performance morphing
- Ableton Rack-like macro performance

### Level 1 Requirement

The X/Y pad is a key Level 1 component and must be immediately available in performance mode.

---

# 7. 5-Level Progressive Disclosure UX

Bacteria’s UX is explicitly designed around five levels.

---

## 7.1 Level 1: Play

### Role

Performance view / immediate gratification.

### Target User

Performer / preset tweaker

### Purpose

- hide complexity
- enable fast, expressive interaction
- present the plugin as a playable instrument

### Required UI Elements

- preset browser
- 8 performance macros
- X/Y morphing pad
- master wet/dry
- optional wet/dry lock while browsing presets

### UX Pattern

Compared to:

- Ableton Audio Effect Rack
- “pick a preset and tweak” workflow

### Design Constraint

All DSP-chain detail should remain hidden at this level to avoid decision paralysis.

---

## 7.2 Level 2: Shape

### Role

Module-focused parameter editing.

### Target User

Producer

### Purpose

- contextual access to selected module
- reveal only core controls for one effect at a time

### Required Elements

When a module is selected:

- show core parameters
    - examples:
        - distortion: Drive, Asymmetry, Foldback Threshold
        - filter: Cutoff, Resonance, Mode
- show two quick modulators:
    - one LFO
    - one envelope follower

### UX Behavior

- focused disclosure
- selected module expands
- rest of interface dims or de-emphasizes

---

## 7.3 Level 3: Build

### Role

Multi-band architecture and modulation dock.

### Target User

Sound designer

### Purpose

- define band structure
- manage band-specific chains
- access global modulators

### Required Elements

- interactive spectrum display with draggable crossovers
- up to 6 bands
- per-band strip:
    - solo
    - mute
    - level
    - local signal chain
- modulation dock:
    - XLFOs
    - step sequencers
    - Lorenz attractor
    - other global sources

### UX Pattern

Compared to **Vital**:

- drag source to target
- modulation collar appears

---

## 7.4 Level 4: Route

### Role

Architectural signal topology view.

### Target User

Architect / advanced sound designer

### Purpose

- expose signal flow structure
- manage branches and topologies
- understand routing under the hood

### Required Elements

- visual signal flow diagram
- node-based DAG view
- signal-chain branches
- routing toggles:
    - series
    - parallel
    - mid/side
- internal sidechain / feedback path representation

### UX Comparisons

Compared to:

- Bitwig’s FX Grid
- node-based modular routing environments

### Note on Feedback

One source says cables may be dragged to create internal feedback loops. Because the broader architecture is also described as a DAG, implementation must either:

- constrain feedback to special delay-buffered safe structures, or
- treat that statement as a UX aspiration that requires explicit cycle-breaking rules

Do not assume unrestricted zero-delay feedback is allowed.

---

## 7.5 Level 5: Lab

### Role

Deep algorithm editing.

### Target User

Specialist

### Purpose

Expose low-level shaping and analysis tools.

### Required Editors

- custom waveshaper editor
- Bezier LFO editor
- spectral bin gate / blur editor
- granular grain-shaping editor
- advanced algorithm controls

### UX Identity

This is the “laboratory” mode.

---

## 7.6 Progressive Disclosure Summary Table

| UI Level | Target User    | Key Tool / Interaction                | Salient Feature              |
| -------- | -------------- | ------------------------------------- | ---------------------------- |
| 1: Play  | Performer      | Bilinear XY Snapshot Morpher          | 8 Performance Macros         |
| 2: Shape | Producer       | Contextual Module Knobs               | Quick Mod (LFO / Follower)   |
| 3: Build | Sound Designer | Drag-and-Drop Modulation Dock         | Band-specific chains         |
| 4: Route | Architect      | Node-based DAG Visualization          | Parallel / M/S split toggles |
| 5: Lab   | Specialist     | Bezier Curve / Waveshape / Bin Editor | Custom waveshaper $f(x)$     |

---

# 8. Real-Time Visual Feedback

WebGPU is not decorative; it is a core interpretability layer.

## 8.1 Visual Feedback Systems

| Feedback Type      | Implementation                                   | UX Rationale                                           |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| Modulation Collars | Animated arcs around knobs                       | Show exact modulation depth and phase                  |
| Source Flow        | Diffuse particles between modulators and targets | Show global modulation activity without cable clutter  |
| Spectral Heatmaps  | WebGPU frequency analyzer                        | Help decide crossover points from energy concentration |
| Stereo-ize Display | Dual-trace oscilloscope                          | Show phase relationship of Mid and Side signals        |

Additional required visualizations from the broader source set:

- real-time frequency response display
- draggable crossover boundaries
- signal-flow DAG
- modulation curves
- spectral bin displays
- active-state indicators
- per-band activity

---

## 8.2 Performance Goals

Visualization should:

- maintain high frame rate
- avoid taxing the CPU
- remain responsive even during heavy DSP
- support 60 fps target where feasible

One source explicitly states:

- WebGPU compute shaders should offload spectral analysis and particles
- maintain a “rock-solid 60fps” even during complex Smudge processing

---

# 9. Technical Secret Sauce

This section consolidates the conceptual differentiators repeatedly emphasized across the provided material.

---

## 9.1 Character-First Defaults

Unlike utility processors, Bacteria should not initialize in a neutral or lifeless state.

Requirements:

- presets should feel alive immediately
- subtle modulation may be active by default
- default drive/filter settings may already impart character
- the plugin should reward immediate interaction

Explicit inspiration:

- Goodhertz approach

---

## 9.2 Psychoacoustics of Multi-Band Saturation

A key rationale for multi-band distortion:

### Intermodulation Distortion (IMD) Avoidance

Full-range distortion allows low-frequency energy to modulate high-frequency material, producing:

- muddiness
- congestion
- loss of punch

By splitting into bands:

- low-band harmonics stay low
- high-band detail remains clearer
- punch and clarity are preserved

This is a major sonic justification for Bacteria’s multi-band architecture.

---

## 9.3 Per-Band Oversampling

Oversampling is required for non-linear processing to prevent aliasing.

### General Principle

When harmonics exceed Nyquist, aliasing occurs.

### Bacteria Optimization

Oversampling is **band-dependent**:

- low band may require less or no oversampling
- high band may use heavier oversampling

### Source-Specified Values

One source states:

- high-frequency bands are oversampled at **8x** or **32x**
- low-frequency bands may bypass oversampling entirely

### Backend Note

Another source states:

- non-linear operations are oversampled using **polyphase IIR filters** for minimal phase distortion

These should be combined into the implementation plan:

- support configurable per-band oversampling ratios
- use efficient polyphase structures where possible

---

## 9.4 Internal Rhythmic Ducking

Instead of relying on external sidechain compression:

- use tempo-synced custom LFO curves
- enable direct visual drawing of ducking shape
- produce cleaner, more intentional pumping

This is repeatedly framed as a creative advantage over traditional sidechaining.

---

# 10. Proprietary Algorithm Deconstructions to Replicate or Extend

The source explicitly frames this product as replicating/extending the “secret sauce” of elite processors.

## 10.1 FabFilter Saturn 2 Influences

- multi-band saturation
- breakdown style pitch-down + clipping
- character-rich nonlinearity
- polished creative distortion workflows

## 10.2 Goodhertz Lossy Influences

- codec-like chirping
- smearing
- low-bitrate digital artifact simulation
- “interesting defaults”
- stylized degradation rather than transparent emulation

## 10.3 ShaperBox Influences

- Bezier-drawn modulation curves
- rhythmic ducking
- tempo-locked movement
- volume shaping without external sidechain

## 10.4 Ableton Rack Influences

- macro mapping
- performance-oriented top layer
- hidden depth beneath a simple entry point

## 10.5 Vital Influences

- drag-and-drop modulation UX
- modulation collars
- visual range display

## 10.6 Bitwig FX Grid Influences

- node-based routing
- visual graph architecture
- modular internal flow

## 10.7 Logic Phat FX Influence

- breathing envelope-following filters

## 10.8 Output Portal Influence

- real-time granular processing from live input

## 10.9 iZotope Trash 2 Influence

- custom waveshaping
- destructive nonlinear creativity
- algorithm-lab style editing

---

# 11. Accessibility and Usability Requirements

A dedicated UX section specifies professional accessibility expectations.

## 11.1 POUR Framework

The interface should be:

- **Perceivable**
- **Operable**
- **Understandable**
- **Robust**

### Practical Requirements

- high-contrast themes
- full keyboard shortcut support
- progressive disclosure aids comprehension
- WebGPU with **WebGL2 fallback**

## 11.2 Touch Optimization

- large hit areas for knobs/sliders
- tablet-friendly interaction
- “explore by touch” compatibility

## 11.3 Status Indicators

- global auto-mute indicators
- filled-dot modulation source icons
- active-state visibility across the patch

---

# 12. Visual / Typographic Metaphor

A UX-specific source section includes this aesthetic/interaction idea:

## 12.1 Variable Typography

Using **Coldtype** or equivalent variable font animation:

- the word “DRIVE” widens as saturation increases
- visual metaphor bridges technical data and expressive feedback

This is not core DSP but is explicitly part of the supplied UX vision.

---

# 13. Data Model and Execution Model Recommendations

The source implies the following data architecture.

## 13.1 Graph Model

Represent the plugin state as:

- processing graph (audio nodes)
- modulation graph (control signal nodes)
- parameter map
- snapshot state set (A/B/C/D)
- macro mapping table
- UI disclosure level state
- visualization state buffers

## 13.2 Parameter System

All parameters should support:

- normalized internal representation
- modulation accumulation
- smoothing
- snapshot serialization
- macro mapping
- undo/redo compatibility
- UI exposure flags by level

## 13.3 Snapshot Morph Model

Store complete parameter-state sets for:

- A
- B
- C
- D

Interpolate continuously during X/Y interaction.

## 13.4 Band Model

Each band should include:

- crossover boundaries
- chain list
- solo/mute
- gain
- oversampling mode
- routing mode / branch membership
- optional M/S split state

---

# 14. Implementation Priorities for an AI Agent

This section translates the source into an actionable build order.

## 14.1 Phase 1 — Core Audio Engine

Implement first:

1. block-based Rust DSP runtime
2. DAG execution infrastructure
3. lock-free UI/audio communication
4. LR4 crossover engine
5. band splitting/recombination validation
6. serial and parallel chain support
7. per-band gain/mute/solo

## 14.2 Phase 2 — Must-Have Creative Modules

Implement next:

1. soft clip
2. hard clip
3. foldback
4. custom waveshaper
5. SVF multi-mode filter
6. chorus/flanger/phaser
7. envelope follower
8. macro system
9. X/Y state morphing

## 14.3 Phase 3 — Signature Processing

Add:

1. real-time granular engine
2. STFT spectral freeze / blur
3. Smudge pre-distortion stage
4. Hilbert-transform frequency shifter
5. codec artifact engine with FHT path
6. convolution body-model module

## 14.4 Phase 4 — Signature UX

Add:

1. Level 1–5 progressive disclosure shell
2. WebGPU spectrum + crossover editing
3. drag-and-drop modulation dock
4. node-based routing diagram
5. Bezier editors for LFO and waveshaping
6. modulation collars and flow particles

## 14.5 Phase 5 — High-End Fidelity / Optimization

Add:

1. per-band oversampling
2. linear-phase crossover mode
3. subtractive linear-phase crossover experiment
4. multicore graph scheduling
5. high-rate modulation mode
6. FIR/Hilbert precision tuning
7. fallback rendering path

---

# 15. Validation and QA Requirements

## 15.1 DSP Correctness

Validate:

- null/reconstruction tests for crossover engine
- phase behavior of LR4 and linear-phase modes
- oversampling alias suppression
- foldback continuity and threshold handling
- custom waveshaper continuity
- modulation-rate stability
- frequency shifter sideband correctness
- granular freeze stability
- convolution IR loading and stereo handling

## 15.2 Performance

Validate:

- no allocation on audio thread
- no lock contention on audio thread
- stable UI under heavy modulation
- WebGPU visualization scalability
- multicore chain speedup
- acceptable latency reporting in linear-phase mode

## 15.3 UX

Validate:

- progressive disclosure keeps entry friction low
- Level 1 usable without deeper knowledge
- modulation targets are discoverable
- routing complexity remains understandable
- active modulation is always visible
- touch and keyboard accessibility are preserved

---

# 16. Consolidated Mathematical Reference

## 16.1 Linkwitz-Riley Transfer Functions

$$
H_{LP}(s) = \frac{1}{(s^2 + \sqrt{2}s + 1)^2}
$$

$$
H_{HP}(s) = \frac{s^4}{(s^2 + \sqrt{2}s + 1)^2}
$$

## 16.2 FIR Latency

$$
\text{latency} = \frac{N - 1}{2f_s}
$$

## 16.3 Soft Clip

$$
y = \tanh(k \cdot x)
$$

## 16.4 Foldback Distortion

$$
y =
\begin{cases}
x & \text{if } |x| \leq T \\
(2T - x) & \text{if } x > T \\
(-2T - x) & \text{if } x < -T
\end{cases}
$$

## 16.5 Spectral Blur / Smudge Variant A

$$
M_{avg}[k, n] = (1 - \alpha) \cdot M[k, n] + \alpha \cdot M_{avg}[k, n-1]
$$

## 16.6 Spectral Blur / Smudge Variant B

$$
M_{avg}[k, n] = \alpha \cdot M[k, n] + (1 - \alpha) \cdot M_{avg}[k, n - 1]
$$

## 16.7 Cubic Bezier

$$
P(t) = (1-t)^3P_0 + 3(1-t)^2tP_1 + 3(1-t)t^2P_2 + t^3P_3
$$

## 16.8 Analytic Signal

$$
s(t) = x(t) + j\hat{x}(t)
$$

## 16.9 Frequency Shifting

$$
y(t) = \text{Re}\{s(t) \cdot e^{j\omega_c t}\} = x(t)\cos(\omega_c t) - \hat{x}(t)\sin(\omega_c t)
$$

Variant:

$$
y(t) = x(t)\cos(\omega_{shift} t) \mp \hat{x}(t)\sin(\omega_{shift} t)
$$

## 16.10 XY Bilinear Interpolation

$$
V_{interp} = V_A(1-x)(1-y) + V_B(x)(1-y) + V_C(1-x)(y) + V_D(x)(y)
$$

Equivalent:

$$
V_{morph}(u, v) = S_{00}(1-u)(1-v) + S_{10}u(1-v) + S_{01}(1-u)v + S_{11}uv
$$

## 16.11 Subtractive Linear-Phase Crossover Variant

$$
y_{HP}[n] = x[n - d] - y_{LP}[n]
$$

## 16.12 Lorenz Attractor

$$
\frac{dx}{dt} = \sigma(y - x), \quad
\frac{dy}{dt} = x(\rho - z) - y, \quad
\frac{dz}{dt} = xy - \beta z
$$

## 16.13 Pitch-Down Bin Remapping

$$
f_{new} = f_{original} \times 2^{-n}
$$

---

# 17. Source Integrity Notes

The provided source contained:

- repeated sections
- overlapping descriptions
- minor wording inconsistencies
- OCR/transcription artifacts
- a few truncated mathematical annotations

To ensure no information loss:

- all distinct algorithmic claims have been preserved
- repeated concepts have been merged rather than dropped
- conflicting formula variants have been retained as variants
- truncated items have been explicitly noted where relevant

Notable source artifacts preserved in clarified form:

1. Smudge smoothing appears with two alpha-weight conventions.
2. Bezier section had a truncated domain for $t$.
3. Lorenz normalization interval was visually truncated.
4. Foldback description included a truncated phrase about the mirrored range.
5. One section references feedback-loop cable UX despite the main routing model being a DAG; this is preserved as a design tension requiring implementation constraints.

---

# 18. Final Product Positioning

Bacteria is intended to be:

- the pinnacle creative sound-design tool inside Sourdaw
- a multi-band modular processor
- a performance instrument at the top layer
- a laboratory environment at the deepest layer
- a system that combines:
    - advanced crossover design
    - aggressive nonlinearity
    - granular live processing
    - spectral manipulation
    - body convolution
    - rich modulation
    - expressive real-time interaction
    - visually legible complexity

Its defining combination is:

- **multi-band frequency-specific mangling**
- **drag-and-drop universal modulation**
- **snapshot-based performance morphing**
- **progressive disclosure UX**
- **high-performance Rust DSP**
- **WebGPU visualization**
- **character-first sonic design**

---

# 19. Minimal AI-Agent Build Summary

If an AI agent needs the shortest faithful implementation brief, use this:

1. Build a Rust DSP DAG engine with lock-free UI/audio communication.
2. Implement a 1–6 band crossover system with LR4 default and optional linear-phase mode.
3. Support serial, parallel, and mid/side routing.
4. Build per-band effect chains with solo/mute/gain and optional per-band oversampling.
5. Implement distortion, custom waveshaping, SVF filtering, modulation delays, phaser, frequency shifter, granular processing, STFT spectral blur/freeze, codec artifacts, and body convolution.
6. Implement a unified modulation system with drag-and-drop mapping, Bezier LFOs, envelope followers, macros, and 4-state XY snapshot morphing.
7. Expose functionality through a 5-level progressive disclosure UI WITHOUT simply copy pasting elements from one to the other, each should be a cohesive singular unit, not just pieces of the next one:
    - Play
    - Shape
    - Build
    - Route
    - Lab
8. Render analysis and modulation visuals through WebGPU.
9. Use character-first defaults and pre-animated presets so the plugin sounds alive immediately.
10. Optimize for low-latency performance, multicore scalability, and audio-thread safety.
