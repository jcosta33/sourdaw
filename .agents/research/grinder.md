# Grinder for Sourdaw — AI Implementation Guide

## Purpose

Grinder is a flagship **amp simulator, cabinet loader, pedalboard host, and neural-capture playback engine** for **Sourdaw**.

It is designed as a hybrid system that combines:

- **white-box circuit modeling** for tweakable analog realism
- **black-box neural capture playback** for high-accuracy snapshots
- **low-latency cabinet processing**
- **progressive-disclosure UX** for both immediate playability and deep engineering control

This document is a standalone implementation specification for an AI agent building Grinder with:

- a **Rust DSP backend** in `daw-dsp`
- a **React 19 frontend**
- **WebGPU** for visualization and GPU-assisted analysis

---

# 1. Product Definition

Grinder is not a generic guitar plugin. It is a modular virtual rig designed to deliver:

- convincing **touch sensitivity**
- realistic **preamp and power-amp dynamics**
- authentic **cabinet thump vs. fizz behavior**
- accurate **neural-capture playback**
- flexible **pedalboard and routing workflows**
- fast, intelligible **live-performance UX**

Core design goals:

1. **Feel first**  
   The system must react musically to picking intensity, guitar volume changes, and gain staging.

2. **Hybrid realism**  
   Use neural captures where snapshot accuracy is best, and circuit models where interactive dynamics and tweakability matter most.

3. **Low-latency behavior**  
   The rig must feel immediate and playable at professional buffer sizes.

4. **Progressive disclosure**  
   Everyday tone shaping must remain simple, while advanced engineering parameters remain available deeper in the UI.

---

# 2. High-Level Architecture

## 2.1 Backend

Implement the audio engine in Rust inside `daw-dsp`.

Requirements:

- block-based real-time processing
- zero-allocation audio callback
- lock-free message passing between UI and DSP
- deterministic parameter smoothing
- graph-based routing
- support for both sample-by-sample nonlinear blocks and block-based FFT / convolution blocks
- optional multicore execution for non-audio-thread-safe background work

Suggested subsystem split:

- `input`
- `pedalboard`
- `preamp`
- `tone_stack`
- `power_amp`
- `cabinet`
- `ir_engine`
- `neural`
- `routing`
- `meters`
- `visualization_bridge`

## 2.2 Frontend

Use React 19 for UI structure and state orchestration.

Requirements:

- urgent UI interactions must remain responsive
- expensive visual updates must be interruptible/deferred
- preset / model loading should support non-blocking UX states
- use progressive disclosure rather than exposing all controls at once

Use WebGPU for:

- spectrum visualization
- cabinet and mic visualization
- metering
- optional FFT / spectrogram compute paths
- waveform / hysteresis / saturation displays

---

# 3. Core Signal Flow

Default signal chain:

1. **Input Conditioning**
2. **Noise Gate**
3. **Pre-Amp Pedals**
4. **Preamp / Gain Stages**
5. **Tone Stack**
6. **FX Loop**
7. **Power Amp**
8. **Cabinet / IR**
9. **Post Effects**
10. **Output Master / Safety Limiter**

Alternative routing must support:

- serial chains
- split / merge parallel chains
- stereo rigs
- wet-dry-wet
- clean blend
- dual amp
- re-amping from dry DI
- scene / snapshot switching
- host automation and MIDI control

---

# 4. Vacuum Tube Circuit Modeling

## 4.1 Design Principle

Tube behavior must be modeled as a **dynamic state-dependent system**, not a static waveshaper.

A convincing amp sim must account for:

- triode transfer curvature
- asymmetric clipping
- grid conduction
- coupling-capacitor charging
- blocking distortion
- Miller capacitance
- power-supply interaction
- transformer behavior
- speaker impedance feedback effects

---

## 4.2 12AX7 Preamp Triode Model

The preamp core uses the **Norman Koren phenomenological triode model** as the main plate-current basis.

### Effective controlling voltage

$$
E_1 = \frac{V_{pk}}{K_p} \ln \left[ 1 + \exp \left( K_p \left( \frac{1}{\mu} + \frac{V_{gk} + V_{ct}}{\sqrt{K_{vb} + V_{pk}^2}} \right) \right) \right]
$$

### Plate current

$$
I_p = \frac{E_1^{E_x}}{K_g} \left(1 + \operatorname{sgn}(E_1)\right)
$$

Where:

- $V_{gk}$ = grid-to-cathode voltage
- $V_{pk}$ = plate-to-cathode voltage
- $\mu$ = amplification factor
- $E_x$ = transfer-curve exponent
- $K_g, K_p, K_{vb}, V_{ct}$ = fit parameters

For a 12AX7, a practical default fit may use values in the family of:

- $\mu \approx 100$
- $E_x \approx 1.4$

but the implementation must allow per-model calibration rather than hard-coding a single “true” tube.

### Implementation notes

- compute in double precision where needed for stability
- clamp dangerous regions around numerical singularities
- use fast approximations only if they preserve monotonicity and stability
- permit per-tube and per-brand parameter sets
- allow “aging” offsets as secondary calibration data

---

## 4.3 Grid Conduction and Blocking Distortion

A realistic model must include **grid conduction**.

When $V_{gk}$ goes positive enough, the grid begins conducting current and loads the previous stage.

Effects:

- nonlinear input loading
- coupling-capacitor charging
- temporary bias shift
- transient compression
- “elastic” preamp feel
- blocking distortion after hard attacks

Implementation model:

- piecewise nonlinear current law for grid current $I_g$
- coupling capacitor modeled as a dynamic state element
- bias shift must decay according to RC time constants
- expose internal state to the Lab view for debugging

This behavior is responsible for:

- attack “squish”
- bloom after hard picking
- continuous clean-up with guitar volume rollback

---

## 4.4 Miller Effect

Include **dynamic Miller capacitance** in gain stages.

Concept:

- grid-to-plate capacitance is multiplied by gain
- effective capacitance changes with stage operating conditions
- creates a dynamic high-frequency roll-off that changes with gain state

Implementation target:

- dynamic input low-pass behavior that depends on instantaneous or smoothed stage gain
- stage-specific coefficient recalculation or an equivalent approximation
- do not model this as a fixed EQ shelf

This contributes to perceived:

- shimmer
- softness
- gain-dependent top-end behavior

---

# 5. Tone Stack Modeling

## 5.1 Principle

Fender / Marshall / Vox style tone stacks are **interactive passive networks**, not independent EQ bands.

Adjusting one control affects:

- the operating point of others
- shelf and turnover frequencies
- phase response
- overall insertion loss

## 5.2 Method

Model tone stacks using **Discrete K-Method (DK-Method)** or an equivalently correct nodal-analysis discretization.

Requirements:

- solve circuit interaction directly
- preserve passive-network behavior
- avoid approximating the stack as disconnected biquads
- support runtime knob movement without phase-smearing artifacts

## 5.3 Supported Families

Provide parameter sets for at least:

- Fender Twin / blackface family
- Marshall JCM family
- Vox AC30 Top Boost family

The implementation should support:

- slope resistor changes
- cap-value variants
- fixed-mid vs. variable-mid variants
- bright caps and switchable voicings

---

# 6. Power Amp Modeling

## 6.1 Goals

The power amp is responsible for:

- thump
- body
- punch
- bloom
- power-stage compression
- interaction with cabinet load
- negative feedback behavior

## 6.2 Architecture

Support common push-pull families:

- 6L6-style
- EL34-style
- EL84-style

Model at minimum:

- pair bias excursion
- drive asymmetry
- phase inverter interaction
- negative feedback behavior
- supply droop
- output transformer saturation

The power amp does not need transistor-level SPICE completeness, but it must behave dynamically rather than as a static waveshaper.

---

## 6.3 Power Supply Sag and Bloom

Model an unregulated supply rail that sags under load.

A suitable first-order differential form is:

$$
\frac{dV_{B+}}{dt} = \frac{V_{nominal} - V_{B+}}{\tau_{sag}} - k \cdot |x(t)|
$$

Where:

- $V_{B+}$ = instantaneous rail voltage
- $V_{nominal}$ = unloaded rail voltage
- $\tau_{sag}$ = recovery time constant
- $k$ = load sensitivity
- $x(t)$ = proxy for power-stage current demand

Behavioral outcomes:

- reduced headroom on loud transients
- dynamic compression
- recovery “bloom”
- stronger feel differences across rectifier styles

Expose user-facing sag modes:

- **Tube Rectifier**
- **Solid-State Rectifier**
- **Reduced-Voltage / Variac-Style**

These can be implemented as presets over the same underlying supply model.

---

# 7. Transformer Modeling

## 7.1 Output Transformer Requirements

The output transformer must contribute:

- low-frequency saturation
- hysteresis-like memory
- damping behavior
- chewy low end rather than flabby clipping

## 7.2 Modeling Strategy

Use a **Wave Digital Filter (WDF)** framework for the transformer / output interaction.

For magnetic saturation / hysteresis, use a smooth nonlinear flux model. One practical form is:

$$
\Phi(H) = \operatorname{sgn}(H)\,\Phi_{sat}\,\tanh\!\left(\frac{|H| - H_c}{H_{sat}}\right)
$$

Where:

- $\Phi(H)$ = flux response
- $H$ = magnetizing force proxy
- $\Phi_{sat}$ = saturation flux scaling
- $H_c$ = coercive-force term
- $H_{sat}$ = saturation-shape scaling

Implementation requirements:

- smooth saturation, no discontinuities
- state memory between samples / blocks
- frequency-dependent saturation emphasis at low end
- ability to tune tight vs. chewy low-end behavior

Expose Lab parameters:

- transformer drive
- hysteresis amount
- low-end saturation emphasis
- negative feedback interaction

---

# 8. Cabinet and Speaker Interaction

## 8.1 Cabinet Role

The cabinet is not just an EQ. It is responsible for:

- removing high-gain fizz
- low-frequency thump
- resonant identity
- mic-dependent coloration
- part of the feedback load seen by the power amp

## 8.2 Non-Uniform Partitioned Convolution

Use **non-uniform partitioned convolution** for IR playback.

### Head partition

Process the first short segment in the time domain:

- typical size: 64–128 samples
- goal: no extra algorithmic delay from the early IR portion

### Tail partitions

Process the remainder in larger FFT partitions:

- example sizes: 512, 1024, 2048
- overlap-save or equivalent frequency-domain method
- tail work should be background-scheduled without stalling the real-time thread

### Design note

Do not describe the whole cabinet engine as “zero latency” in a literal end-to-end sense. The correct engineering goal is:

- **zero added latency for the early head partition**
- **very low effective latency and high scalability for long IR tails**

## 8.3 IR Requirements

Support:

- mono IR
- stereo IR
- dual-mic blends
- room IR layers
- drag-and-drop import
- curated factory IR library
- sample-rate conversion on load
- normalization modes
- phase alignment tools
- minimum-phase conversion option
- zero-crossing trim / auto-head detection tools

IR lengths should cover practical guitar and room use cases up to long tails without freezing the UI.

---

## 8.4 Parametric Speaker Layer

Pure IR playback is static. Add a dynamic speaker layer above or around IR playback.

Model at least:

- cone breakup emphasis
- cabinet resonance
- damping behavior
- open-back vs. closed-back low-end character
- center vs. edge mic voicing

### Cabinet resonance

A resonant low-frequency structure can be approximated with a tuned resonant filter layer whose:

- center frequency
- Q
- damping
- open/closed character

map to cabinet geometry and style.

### Cone breakup

Model frequency-dependent nonlinear behavior above the main low-frequency body, especially in upper mids / highs.

This can be implemented as:

- selective band-limited saturation
- speaker-mode excitation layers
- capture-informed correction curves

---

## 8.5 Back-EMF / Load Interaction

To avoid sterile cabinet behavior, add a feedback path from cabinet impedance behavior back into the power amp damping model.

Practical goal:

- low-E hits should generate cabinet-induced feedback behavior
- power amp should react differently at resonant regions
- perceived result should be “thump” instead of flat post-EQ low end

This does not require a full electro-mechanical loudspeaker simulation, but the interaction must be dynamic.

---

# 9. Neural Capture Engine

## 9.1 Role

Neural playback is for **snapshot realism**:

- exact amp settings
- pedal captures
- channel-specific states
- outboard saturation captures
- hard-to-model devices

Circuit models remain preferable for:

- deep parameter exposure
- topology edits
- internal dynamics tuning
- Lab-level engineering workflows

## 9.2 Compatibility Strategy

Implement Grinder as:

- **fully compatible with current mainstream NAM/A1-style model playback**
- **ready for A2-style evolution**
- architected so that model-family support can expand without rewriting the DSP core

Do not hard-wire the system to a single neural-architecture assumption.

---

## 9.3 WaveNet-Style Inference

Primary high-quality capture playback should support **causal dilated convolutional networks**.

Typical characteristics:

- dilated causal layers
- receptive field spanning thousands of samples
- accurate temporal modeling of distortion / filtering behavior
- causal operation suitable for real-time playback

Implementation requirements:

- direct Rust inference path
- no dependence on heavyweight runtimes in the audio thread
- deterministic memory ownership
- pre-allocated weight and state buffers
- ability to run at audio rate on desktop-class CPUs

---

## 9.4 Recurrent / LSTM Capture Tier

Add a lower-cost recurrent tier for simpler nonlinear devices.

Best use cases:

- overdrive pedals
- distortion pedals
- simple preamp captures
- mobile / low-power deployments

Requirements:

- persistent hidden and cell state
- graceful bypass and re-enable behavior
- explicit reset rules on preset reload
- clear latency reporting

---

## 9.5 Model Tiers

Expose tiers such as:

- **Standard** — highest realism, highest CPU
- **Lite** — mid CPU, strong general use
- **Nano** — low CPU
- **Feather / Recurrent** — very low CPU for simple captures

Treat these as product tiers, not hard-coded architecture truths.

---

## 9.6 Inference Optimization

### Required optimizations

- pre-allocate all weights and activations
- ring buffers for dilated convolutions
- cache-friendly tensor layouts
- avoid heap traffic in the audio callback
- allow model warm-up before activation
- parameterize CPU budget / quality modes

### SIMD guidance

Do not recommend legacy `packed_simd` as the default approach.

Use one or more of:

- architecture-specific intrinsics through stable Rust where appropriate
- maintained SIMD abstraction crates
- optional nightly-only experiments isolated behind build flags
- scalar fallback path for portability and determinism

---

## 9.7 Slimmable Models

Provide a CPU-budget feature that can reduce effective model width or select a smaller subnetwork at runtime when the loaded model supports it.

Use cases:

- battery-constrained systems
- browser or embedded targets
- live-performance fallback mode
- oversubscription protection when multiple instances are active

Expose this in the UI as:

- CPU / Quality
- Model Width
- Eco / Balanced / Full

---

# 10. Anti-Aliasing Strategy

## 10.1 Design Goal

Distortion and clipping stages must avoid the harsh, metallic aliasing often perceived as digital fizz.

## 10.2 Local Oversampling

Apply oversampling **locally** around nonlinear stages rather than globally across the entire plugin.

Recommended targets:

- 2x / 4x for lighter stages
- 8x for critical high-gain stages
- selective high-pass / anti-imaging cleanup between nonlinear stages

Why local oversampling:

- lower CPU than full-chain oversampling
- better targeting of alias sources
- easier latency control

## 10.3 ADAA for Memoryless Nonlinearities

Support **Antiderivative Anti-Aliasing (ADAA)** for suitable memoryless nonlinear blocks.

For a nonlinearity $f(x)$ with antiderivative $F_1(x)$:

$$
\bar{f}(x[n], x[n-1]) = \frac{F_1(x[n]) - F_1(x[n-1])}{x[n] - x[n-1]}
$$

Use ADAA where appropriate for:

- waveshapers
- diode clip laws
- certain neural activation approximations
- compact nonlinearity blocks

Benefits:

- lower aliasing without extreme FIR oversampling
- lower CPU than brute-force high-rate oversampling in some cases

Use fallback handling for small denominators near $x[n] = x[n-1]$.

---

# 11. Pedalboard Framework

## 11.1 Architecture

Each pedal is a dedicated DSP object in `daw-dsp`.

Requirements:

- uniform pedal lifecycle
- host automation
- preset serialization
- graph insertion / removal
- internal oversampling where needed
- bypass mode with state policy:
    - true bypass equivalent
    - buffered bypass equivalent
    - tail-preserving bypass where relevant

## 11.2 Required Pedal Families

At minimum:

- noise gate
- compressor
- boost
- overdrive
- distortion
- fuzz
- wah
- modulation
- delay
- reverb
- EQ
- utility gain / splitter

---

## 11.3 Overdrive and Distortion Models

### Tube Screamer-style

Model as a non-inverting op-amp with anti-parallel diodes in the feedback loop.

Key characteristics:

- soft clipping through feedback-path diodes
- mid-focused voicing
- input high-pass behavior
- clipping-stage low-pass behavior

### RAT-style

Model as a gain stage followed by hard-clipping / shunt-diode behavior plus op-amp slew characteristics.

Key requirement:

- include a rate-limiting or slew-dependent behavior layer rather than only static clipping

### Fuzz

Model transistor-style bias-sensitive behavior.

Important qualities:

- choke under hot input
- cleanup with guitar volume
- bias sensitivity
- unstable / touchy edge-of-gating behavior

---

## 11.4 Power-Rail and Headroom Simulation

Even though the engine runs in floating point, pedal models should simulate finite supply behavior such as:

- 9V vs. 18V headroom
- bias collapse
- clipping threshold changes
- transistor choke behavior under stacked gain

This is essential for realistic pedal interaction.

---

# 12. Input Conditioning and Impedance

The input stage must support variable impedance because front-end loading materially affects pickups and certain pedals.

Support values such as:

- high impedance for passive pickups
- lower values for active pickups or buffered inputs
- pedal-dependent loading

Requirements:

- configurable input impedance
- pickup / source loading effect
- optional brightening / dulling behavior from source interaction
- re-amping mode with line-level calibration

Also include:

- calibration meter
- DI input level target
- instrument / line switch
- auto trim option

---

# 13. Routing Architecture

## 13.1 Core Graph Features

Support a dynamic graph with:

- serial routing
- split / merge
- stereo branches
- dual amps
- clean blend
- wet-dry-wet
- FX loop insert point
- cabinet bypass for external IR workflows
- re-amp send / return style logic

## 13.2 Gain Staging

Provide high-resolution meters at critical stages:

- input
- pre-pedal output
- preamp input
- preamp output
- FX loop send / return
- power amp input
- cab output
- final output

Goal:

- prevent accidental clipping
- make gain staging legible
- help users understand interaction between boost pedals and amp input

## 13.3 Phase-Coherent Blending

Parallel paths must support:

- latency compensation
- polarity inversion
- phase alignment aids
- equal-power dry/wet blending

Equal-power crossfade:

$$
g_1(k) = \sqrt{0.5 + 0.5\cos(\pi k)}
$$

$$
g_2(k) = \sqrt{0.5 - 0.5\cos(\pi k)}
$$

Where $k \in [0, 1]$ is blend position.

---

# 14. Snapshots, Presets, and Gapless Switching

## 14.1 Distinction

### Preset

A preset may change:

- signal topology
- loaded models
- IRs
- pedal lineup
- routing

This can require reallocation and reinitialization.

### Snapshot / Scene

A snapshot changes:

- bypass states
- parameter values
- routing states within an already-loaded topology
- macro states

Snapshots should be **instant or near-gapless**.

## 14.2 Implementation Strategy

To support professional switching behavior:

- keep all blocks for a snapshot family preloaded
- swap parameter states instead of rebuilding the graph
- preserve delay / reverb tails where appropriate
- allow optional dual-path preload for live use

Possible modes:

- **Studio** — full preset changes allowed, larger gaps acceptable
- **Live** — preloaded scenes, limited topology change, faster switching
- **Setlist** — preload a bank for a performance set

---

# 15. UX Architecture

## 15.1 Core UX Principle

The UI must preserve the guitarist’s physical mental model while avoiding literal hardware clutter.

Use a **neo-skeuomorphic** approach:

- enough tactile familiarity to feel like gear
- clean enough to avoid visual noise
- performance-critical controls always easy to find

## 15.2 Cognitive Goal

Everyday tasks should generally remain within **1–2 interaction depths** even though the full system exposes deeper engineering layers.

The deeper levels are for specialists, not for routine tone selection.

---

# 16. Five-Level Progressive Disclosure

## Level 1 — Play

Purpose:

- immediate creativity
- minimal friction
- “plug in and go”

Show:

- photorealistic or clean amp-head view
- Gain
- Bass
- Mid
- Treble
- Master
- Cab selector
- preset / scene browser
- tuner and input meter if needed

The user should be able to make music here without touching deeper levels.

---

## Level 2 — Shape

Purpose:

- quick refinement of tone

Show:

- model-specific switches
- Bright
- Fat
- Channel select
- presence / resonance if relevant
- a small tray of essential pedals:
    - gate
    - drive
    - compressor

This level should still feel fast and musical.

---

## Level 3 — Build

Purpose:

- rig construction

Show:

- drag-and-drop pedal chain
- amp block
- cabinet block
- mic room
- dual amp setup tools
- blend / mix routing
- cab and mic selection
- IR browser

Cabinet editing should allow:

- mic selection
- center/edge movement
- distance control
- dual mic blending
- room amount

---

## Level 4 — Route

Purpose:

- advanced topology control

Show:

- split / merge blocks
- stereo and dual-amp routing
- wet-dry-wet layouts
- insert points
- phase tools
- per-stage meters
- latency / alignment warnings

This is the architectural view.

---

## Level 5 — Lab

Purpose:

- component-level engineering

Expose:

- tube bias
- sag depth and recovery
- transformer saturation / hysteresis
- power amp damping / feedback behavior
- input impedance calibration
- model diagnostics
- NAM loader and capture inspector
- anti-aliasing mode
- oversampling controls
- developer / diagnostic views

Lab mode differentiates Grinder from ordinary consumer amp sims.

---

# 17. Cabinet and Mic UX

## 17.1 Spatial Metaphor

Mic positioning should map acoustic behavior to intuitive space.

Represent:

- center vs. edge position
- on-axis vs. off-axis
- distance from grill
- dual-mic blend
- room mic position

## 17.2 Virtual Mic Room

A WebGPU-driven cab view should let the user move mics over a speaker cone or speaker set.

Supported mic families:

- dynamic
- ribbon
- condenser
- room

Support polar-pattern-aware UI if the mic model includes it:

- cardioid
- omni
- figure-8
- hyper-cardioid

The user does not need full acoustics education, but the interaction should make the main consequences obvious:

- center = more bite
- edge = warmer / rounder
- farther = less proximity, more room
- off-axis = smoother top end

---

# 18. Visualization Architecture

## 18.1 WebGPU Usage

Use WebGPU for:

- real-time metering
- speaker / mic room rendering
- frequency visualization
- saturation / hysteresis curves
- optional GPU-side FFT analysis
- spectrograms

## 18.2 Buffer Strategy

Do not depend on a mapped GPU buffer being available to GPU commands at the same time.

Use safe staged approaches such as:

- ring-buffered CPU-to-GPU uploads
- staging buffers
- double / triple buffering
- queue writes
- periodic analysis snapshots rather than synchronous per-sample UI transfer

## 18.3 Real-Time UI Constraints

Visualization must never compromise audio stability.

Rules:

- UI reads snapshots of analysis state
- audio thread owns real-time truth
- heavy graph redraws are interruptible / deferrable
- no blocking synchronization from UI into audio

---

# 19. React 19 Usage Pattern

Use React 19 for control responsiveness and concurrent UI updates.

Guidelines:

- urgent knob movement stays immediate
- background visualization refreshes are lower priority
- model / IR loading uses async flows with pending states
- do not let expensive UI renders stall parameter interaction
- optimistic preset / scene naming is acceptable if reconciled cleanly

Recommended split:

- urgent lane: knobs, switches, drag controls
- transition lane: graphs, analyzer updates, large list changes
- async transitions: model loading, IR imports, preset fetches

---

# 20. Performance Targets

## 20.1 Latency

Target feel:

- end-to-end system feel appropriate for live guitar use
- practical goal: stay under the range where latency becomes obviously sluggish for performers
- at common live buffers, Grinder should remain subjectively immediate

## 20.2 Audio Thread Rules

- no allocations
- no locks
- no blocking file I/O
- no heavy model parsing
- no FFT plan construction
- no GPU waits

## 20.3 Background Work

Allowed on worker threads:

- IR parsing
- resampling on load
- neural model loading
- preset preprocessing
- spectrogram accumulation
- large-FFT tail convolution preparation
- browser / library indexing

---

# 21. Comparative Product Positioning

Grinder’s design target is a hybrid that combines:

- capture realism associated with neural systems
- tweakability associated with circuit modelers
- dynamic feel associated with high-end power-amp modeling
- routing flexibility associated with professional live rigs
- curated ease-of-use through progressive disclosure

This is a positioning goal, not a requirement to mirror any specific competitor architecture.

---

# 22. Implementation Plan

## Phase 1 — Real-Time Core

1. Rust DSP runtime
2. graph execution
3. parameter smoothing
4. lock-free UI/DSP bridge
5. input conditioning
6. meters
7. output safety limiter

## Phase 2 — Core Amp Path

1. preamp triode model
2. grid conduction
3. coupling-cap blocking behavior
4. tone stack DK-method
5. power sag
6. transformer saturation block
7. cabinet convolution engine

## Phase 3 — Pedals

1. gate
2. compressor
3. Tube Screamer-style OD
4. RAT-style distortion
5. fuzz
6. wah
7. delay / reverb essentials

## Phase 4 — Neural

1. A1-compatible NAM playback
2. recurrent low-cost tier
3. model tiering and CPU quality modes
4. slimmable path where supported
5. capture browser integration

## Phase 5 — Advanced UX

1. 5-level disclosure shell
2. drag-and-drop rig builder
3. mic room
4. route view
5. Lab diagnostics
6. snapshot / scene workflow

## Phase 6 — Refinement

1. anti-aliasing upgrades
2. cabinet back-EMF interaction
3. dual-path live switching
4. setlist preload
5. GPU analyzer refinement
6. mobile / embedded profile modes

---

# 23. Validation and QA

## 23.1 DSP Validation

Validate:

- triode monotonicity and numerical stability
- bias-shift behavior under hard attacks
- sag recovery curves
- tone-stack interaction
- transformer state continuity
- oversampling / ADAA alias reduction
- cabinet partition integrity
- phase-coherent parallel summing
- neural-model state continuity
- snapshot switching without pops

## 23.2 UX Validation

Validate:

- Level 1 is usable with no manual reading
- common tasks stay shallow in the hierarchy
- deep tools remain discoverable
- mic movement correlates with audible expectation
- scene switching is clear and safe
- gain staging is visible and understandable

## 23.3 Performance Validation

Validate:

- stable operation at low buffer sizes
- bounded CPU spikes on preset loads
- no UI-induced crackles
- no audio dropouts from tail-convolution scheduling
- graceful CPU fallback when neural or IR load is too high

---

# 24. Foundational Equations Summary

| Function          | Algorithm / Equation                             |
| ----------------- | ------------------------------------------------ |
| Triode Simulation | Koren phenomenological model                     |
| Tone Stack        | Nodal analysis via DK-method                     |
| Grid Conduction   | Piecewise nonlinear current + coupling-cap state |
| Power Sag         | First-order differential rail model              |
| Transformer       | WDF + smooth hysteresis / saturation             |
| Neural Inference  | Causal dilated-convolution forward pass          |
| Recurrent Capture | LSTM / recurrent state update                    |
| Anti-Aliasing     | ADAA + local oversampling                        |
| IR Convolution    | Non-uniform partitioned head/tail convolution    |
| Blend Law         | Equal-power crossfade                            |
| Input Loading     | Variable source / buffer impedance model         |

---

# 25. Minimal Build Summary

If an AI agent needs the shortest faithful implementation brief, use this:

1. Build Grinder as a Rust-based graph DSP engine with React 19 + WebGPU UI.
2. Combine circuit modeling and neural capture playback rather than choosing only one.
3. Make the preamp dynamic: Koren-style triode, grid conduction, coupling-cap bias shift, Miller effect.
4. Model tone stacks as interactive passive networks, not independent EQ bands.
5. Model the power amp with sag, transformer saturation, and cabinet-load interaction.
6. Use non-uniform partitioned convolution for cabinets, with a short time-domain head and FFT tail.
7. Add a dynamic speaker layer for resonance, breakup, and thump.
8. Support A1-compatible NAM playback and keep the architecture ready for newer model families.
9. Use local oversampling and ADAA to reduce fizz and aliasing.
10. Build a modular pedalboard with realistic headroom and stacking behavior.
11. Support snapshots/scenes for fast switching and live workflows.
12. Expose the system through a 5-level progressive-disclosure UI: Play, Shape, Build, Route, Lab.

---
