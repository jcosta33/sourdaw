# The Bakery — Ultimate Implementation Guide and Technical Specification

## Purpose

The Bakery is Sourdaw’s built-in visual patching and modular synthesis environment. It must function as:

- a first-class **instrument**
- a first-class **audio effect**
- a first-class **note/MIDI processor**
- a first-class **learning environment**
- a first-class **community-sharing format**
- a first-class **native compiled runtime**

The core product promise is:

> A user patch in The Bakery compiles into the same optimized Rust audio graph infrastructure used by Sourdaw’s built-in devices.

This is the defining architectural difference from interpreted or externally hosted modular environments.

---

# 1. Product Definition

## 1.1 What The Bakery Is

The Bakery is a node-based modular environment built into Sourdaw, using the same DSP primitives as:

- Fermenter
- Toaster
- Levain
- Crumb-related sample-playback primitives
- the general `daw-dsp` module inventory
- the host audio graph scheduler

Users patch together:

- oscillators
- filters
- envelopes
- delays
- utility math
- routing primitives
- event generators
- sequencing tools
- DAW I/O
- macro interfaces
- sub-patches
- wrapped built-in devices

and the result runs as a compiled native device graph.

## 1.2 What It Is Not

The Bakery is **not**:

- a text scripting environment
- an interpreted patch runtime
- a separate engine running beside the DAW
- a sandboxed educational toy disconnected from the track chain
- a glorified preset macro page

## 1.3 Mission-Critical Product Goals

1. **Native-speed execution**
2. **Full DAW integration**
3. **Visual clarity**
4. **Shallow entry, deep ceiling**
5. **Sub-patch ecosystem and community flywheel**
6. **Compatibility with browser/WASM execution for patch sharing**
7. **Direct reuse of Sourdaw’s internal DSP building blocks**

---

# 2. Design Principles

## 2.1 Same Primitives, Same Engine

Every Bakery module should either be:

- a direct wrapper over an existing `daw-dsp` primitive
- a compiled composite made of those primitives
- a host bridge module
- a built-in Sourdaw device wrapper

There should be no “special user version” of oscillators, filters, or envelopes if the production devices already expose stable kernels.

## 2.2 Typed Visual Layer, Unified Continuous-Signal Core

The UI should present distinct signal/cable domains because that helps users reason about patches.  
Internally, however, all continuous signal domains should compile down to the same sample-accurate block-processing substrate.

This preserves:

- Bitwig-style audio-rate modulation freedom
- type clarity in the UI
- minimal runtime dispatch overhead

## 2.3 Compile Once, Run as a Flat Schedule

The patcher is edited as a graph, but executed as a compiled schedule:

- no graph walking on the audio thread
- no hash lookups
- no string dispatch
- no interpreted message passing
- no “patch runtime” layer above the DSP kernels

## 2.4 Progressive Disclosure

The same patch format must support:

- preset-player simplicity
- educational inspection
- full patch construction
- advanced routing
- performance analysis and developer debugging

without splitting into separate products.

## 2.5 Community as Product Infrastructure

Every patch is also:

- an instrument/effect
- a readable design document
- a teaching artifact
- a remixable fork point

This is product infrastructure, not a marketing add-on.

---

# 3. Competitive Baseline and Extracted Requirements

The Bakery should extract the strongest ideas from the leading modular systems while explicitly avoiding their recurring failure modes.

## 3.1 Bitwig The Grid — Keep

- device-chain-native integration
- clear signal/cable semantics
- Poly / FX / Note container split
- phase as a first-class signal domain
- audio-rate modulation as a default capability
- visual immediacy
- strong inspector and remote-control integration

## 3.2 Bitwig The Grid — Improve

- larger patch canvas
- stronger CPU efficiency
- more advanced granular/spectral modules
- easier copy/paste across patches and sub-patches
- deeper patch ecosystem and sharing model

## 3.3 Reaktor — Keep

- multiple abstraction layers
- sub-patch / macro hierarchy
- community library effect
- ability to build instruments, effects, sequencers, utilities, and unusual hybrids
- low-level building-block access

## 3.4 Reaktor — Improve

- modern UI
- clearer module browser and docs
- more direct modulation UX
- better CPU efficiency
- easier learning path
- better integration with DAW automation and preset browsing

## 3.5 Max / MSP / Gen — Keep

- infinite composability
- graph patching for control and signal
- compiled DSP path for performance
- patch-as-device philosophy

## 3.6 Max / MSP / Gen — Improve

- remove text-object lookup as the primary interaction
- label everything visually
- make ports explicit and readable
- reduce inlet/outlet ambiguity

## 3.7 VCV Rack — Keep

- hardware-modular familiarity
- vast module imagination
- beautiful module-centric UI
- patch-sharing mindset

## 3.8 VCV Rack — Improve

- global graph optimization
- built-in polyphony model
- stronger DAW embedding
- lighter CPU footprint
- better routing and state management inside a DAW session

## 3.9 Voltage Modular / Phase Plant / Softube Modular — Keep

- polished commercial-grade UI
- explicit polyphony helpers
- semimodular clarity where useful
- audio-rate cross-modulation on oscillator/generator domains
- the idea that “modular” does not have to mean unreadable spaghetti by default

---

# 4. Runtime and Frontend Architecture

## 4.1 Host Stack

- **Backend:** Rust
- **DSP crate:** `daw-dsp`
- **DAW engine integration:** same compiled `ProcessTask` schedule infrastructure as the rest of Sourdaw
- **Frontend:** React 19
- **Desktop shell:** Tauri v2
- **Browser/shared patch runner:** WASM build of the same DSP kernels where practical
- **Canvas rendering:** GPU-accelerated cables, scopes, minimap, and large-canvas rendering; DOM/React or hybrid scenegraph for module chrome

## 4.2 UI Partitioning

Use a hybrid rendering model:

- **React component layer** for:
    - sidebars
    - inspector
    - parameter widgets
    - browser
    - patch metadata
    - macro pages
    - automation bindings
- **GPU/canvas layer** for:
    - cables
    - signal glow
    - patch minimap
    - scope rendering
    - level meters
    - selection overlays
    - CPU heat map
    - large-scene panning/zooming

## 4.3 React 19 Use

Use React 19 transitions and deferred rendering for:

- module-browser filtering
- large patch selection changes
- scope-visibility toggles
- inspector recomputation
- minimap regeneration
- sub-patch tree expansion

Urgent interactions such as:

- cable dragging
- node movement
- knob movement
- transport/preview triggers

must never be blocked by expensive non-urgent React work.

## 4.4 Tauri v2 Use

Use Tauri 2 for:

- native file access for samples, IRs, and patch files
- high-throughput raw IPC for profiler/scope payloads when needed
- `convertFileSrc` for direct file-to-webview asset loading where that is the fastest path
- file watching (`watch` / `watchImmediate`) for patch library updates, shared preset folders, and sample-folder relinking
- plugin and patch package installation flows

---

# 5. Core Patch Data Model

## 5.1 Canonical Patch Types

Every patch is one of:

- **Poly Bakery**
- **FX Bakery**
- **Note Bakery**

```rust
pub enum BakeryContainerType {
    Poly,
    Fx,
    Note,
}
```

## 5.2 Patch Document Structure

```rust
pub struct BakeryPatch {
    pub id: PatchId,
    pub name: String,
    pub version: u32,
    pub container_type: BakeryContainerType,
    pub metadata: PatchMetadata,
    pub modules: Vec<ModuleInstance>,
    pub cables: Vec<Cable>,
    pub groups: Vec<VisualGroup>,
    pub macros: Vec<MacroBinding>,
    pub subpatch_defs: Vec<SubpatchDefinition>,
    pub canvas: CanvasState,
}
```

## 5.3 Module Definition vs Instance

```rust
pub struct ModuleDefinition {
    pub kind: ModuleKind,
    pub category: ModuleCategory,
    pub display_name: String,
    pub description: String,
    pub inputs: Vec<PortDefinition>,
    pub outputs: Vec<PortDefinition>,
    pub params: Vec<ParamDefinition>,
    pub capabilities: ModuleCapabilities,
}

pub struct ModuleInstance {
    pub id: ModuleId,
    pub def_id: ModuleDefinitionId,
    pub x: f32,
    pub y: f32,
    pub ui_state: ModuleUiState,
    pub param_values: ParamValueMap,
}
```

## 5.4 Port Definition

```rust
pub struct PortDefinition {
    pub id: PortId,
    pub name: String,
    pub domain: SignalDomain,
    pub lane_policy: LanePolicy,
    pub connection_policy: ConnectionPolicy,
    pub default_value: Option<DefaultPortValue>,
}
```

## 5.5 Cable Definition

```rust
pub struct Cable {
    pub id: CableId,
    pub from_module: ModuleId,
    pub from_port: PortId,
    pub to_module: ModuleId,
    pub to_port: PortId,
    pub visual_style: CableStyle,
    pub inserted_feedback_delay: bool,
}
```

## 5.6 Stable IDs Everywhere

All user-facing and compiler-facing entities must use stable IDs, never array indices, for:

- modules
- ports
- groups
- macros
- sub-patches
- cables
- wrapped device nodes

This makes:

- undo/redo safer
- copy/paste easier
- diffing more robust
- community patch merging possible
- content-addressed patch hashing simpler

---

# 6. Signal and Port Type System

## 6.1 User-Facing Signal Domains

The Bakery should expose these signal domains:

- **Audio** — orange
- **Gate** — green
- **Trigger** — green
- **Value / Modulation** — blue
- **Phase** — purple
- **Event / Note Stream** — teal
- **UI / Meta / Inspect** — no patch cable; inspector-only

## 6.2 Internal Representation

Internally, split into two families:

### Continuous Signal Family

Compiled as sample-accurate buffers:

- audio
- gate
- trigger
- value
- phase

### Event Family

Compiled as event streams with sample offsets within block:

- note on
- note off
- poly pressure / aftertouch
- MIDI CC-like parameter events
- tempo/grid events for Note Bakery

This yields the best of both worlds:

- audio-rate modulation everywhere
- clean event processing for note logic
- type-safe UI
- efficient compiled runtime

## 6.3 Domain Semantics

### Audio

- continuous sample stream
- nominal range: `[-1, 1]`, but must be treated as unbounded
- lane count: mono or stereo
- voice-local in Poly Bakery

### Gate

- binary or thresholded control stream
- represented as sample stream
- value convention: `0` / `1`

### Trigger

- one-sample or short-pulse control stream
- represented as sample stream
- often generated from events or comparators

### Value / Modulation

- continuous numeric stream
- may be unipolar or bipolar
- carries unit hints such as:
    - normalized
    - semitones
    - Hz
    - dB
    - percent
    - generic scalar

### Phase

- wrapped continuous stream in `[0,1)`
- special domain for oscillator building, sync, phase distortion, lookup indexing, phase-warping, and precise timing

### Event / Note Stream

- sparse event packets
- only available in Note Bakery or bridge modules that convert event streams to gate/pitch/velocity/value signals

## 6.4 Type Coercion Rules

The UI should present type-aware patching, but continuous domains should be interoperable.

### Allowed without warning

- Audio → Audio
- Audio → Value
- Value → Audio
- Value → Value
- Gate → Trigger
- Trigger → Gate
- Phase → Phase
- Value → Phase via explicit wrap module preferred, but direct patching allowed with warning
- Audio/Value/Gate/Trigger → utility/math modules

### Allowed with visual warning

- Gate → Audio
- Trigger → Audio
- Audio → Gate
- Phase → Audio
- Audio → Phase
- Value → Phase when not explicitly wrapped
- any event stream into continuous input without a bridge module
- continuous signal into event input without a detector/bridge

### Forbidden by default

- Event/Note Stream directly into continuous DSP ports
- continuous DSP ports directly into event-only modules

Use explicit bridge modules instead.

## 6.5 Multiple Connection Policy

### Continuous inputs

Default policy: **sum**

This preserves the modular expectation that multiple sources can drive one destination.

### Event inputs

Default policy: **merge queue**

### Special-case inputs

Some ports should define:

- `Override`
- `FirstConnectionOnly`
- `Mux`
- `Or`
- `Max`

Examples:

- comparator threshold input: `Override`
- audio mixer input: `Sum`
- selector input: `Override`
- gate combiner: `Max` or logical OR
- switch select input: `Override`

## 6.6 Cable Presentation

- Bezier or routed curves
- color-coded by domain
- highlight on hover
- endpoints glow when compatible
- opacity/thickness may optionally reflect live signal magnitude
- cable animation can be toggled off for performance
- invalid or coerced connections show warning striping or small badge
- feedback edges visually indicate inserted `z^-1`

---

# 7. Polyphony, Containers, and Voice Architecture

## 7.1 Container Types

### Poly Bakery

Instrument container.

- receives note input from DAW
- allocates voices
- runs voice-local graph per voice
- mixes voice outputs
- may have post-voice global graph

### FX Bakery

Audio effect container.

- receives track audio
- no voice allocator
- single global DSP graph
- can still use modulation, envelopes, followers, sidechain inputs

### Note Bakery

MIDI/note processor container.

- receives note/event stream
- processes/generates note events
- outputs note/event stream
- no audio path by default

## 7.2 Poly Bakery Internal Split

Poly Bakery should support two execution domains:

### Voice Domain

Modules upstream of `Voice Mix` run once per active voice:

- oscillators
- envelopes
- per-voice filters
- per-voice modulators
- per-voice FX

### Global Domain

Modules downstream of `Voice Mix` run once per patch:

- global reverb
- global EQ
- final width/pan
- output limiting
- macro-level meter taps

This is critical for CPU efficiency.

## 7.3 Voice Infrastructure Modules

Add infrastructure modules beyond the minimum list:

- **Voice Mix** — sum/poly-mix voices to stereo
- **Voice Split** — advanced per-voice/global branching
- **Voice Index** — current voice number
- **Voice Count** — active voice count
- **Voice Gate** — gate signal for current voice
- **Unison** — internal per-note duplication, detune, spread, pan distribution

## 7.4 Voice Stealing and Allocation

Voice allocation belongs to the DAW voice manager, not the patch.

The Bakery patch should declare:

- minimum and maximum voices
- release-tail behavior
- unison multiplier
- voice priority hints

The host voice manager provides:

- note assignment
- legato/mono mode
- steal policy
- release voice retirement

---

# 8. Module System Architecture

## 8.1 Module Classes

Modules should fall into these runtime classes:

### PrimitiveKernel

Direct wrapper over one `daw-dsp` primitive

Examples:

- one-pole filter
- add
- multiply
- phasor
- delay line

### CompositeKernel

Compiled combination of primitives shipped as one convenience module

Examples:

- Dattorro reverb
- compressor
- limiter
- pitch shifter
- stereo widener

### HostBridge

Module that interfaces with host/DAW state

Examples:

- Audio Input
- Audio Output
- Note Input
- Macro Knob
- DAW Parameter Input
- Modulation Output

### DeviceWrapper

Wraps an internal Sourdaw device or device section as a module

Examples:

- Fermenter oscillator block
- Levain reverb block
- Bakery patch as sub-patch module

### VisualOnly / Probe

No effect on audio result; taps or displays signals

Examples:

- Scope
- Meter
- Spectrum
- Value Readout
- Comment / annotation

## 8.2 Module Runtime Contract

```rust
pub trait BakeryKernel {
    fn reset(&mut self, sr: f32, max_block: usize);
    fn prepare(&mut self, ctx: &PrepareContext);
    fn process(&mut self, ctx: &mut ProcessContext);
}
```

`ProcessContext` should provide:

- input slices
- output slices
- event input/output queues where relevant
- voice context
- transport context if requested
- sample-accurate block length

## 8.3 Parameter Metadata

Each parameter needs:

- stable parameter ID
- display name
- unit
- default value
- range
- skew/curve
- step mode where applicable
- bipolar/unipolar flag
- macro-assignable flag
- modulatable flag
- automation flag
- smoothing policy

---

# 9. Complete Minimum Module Catalog

The following catalog is the minimum release set required for a serious modular environment. Every module listed below should be implemented unless marked clearly as phase-2 or convenience-only.

---

## 9.1 Generators

| Module               | Inputs                                                                    | Outputs                                                  | Key Parameters                                                          | Notes                                                                           |
| -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Oscillator           | pitch/value FM, phase reset/sync, PW/mod, hard sync, linear FM, phase mod | audio                                                    | waveform, coarse/fine tune, pulse width, stereo spread, anti-alias mode | Uses the same PolyBLEP/band-limited oscillator kernels as Sourdaw synth devices |
| Wavetable Oscillator | pitch, phase reset, wavetable position, warp, FM/PM                       | audio                                                    | table select/load, position, interpolation, unison spread               | Same wavetable engine class as Fermenter where possible                         |
| FM Operator          | pitch, phase modulation, feedback, amplitude modulation                   | audio, phase                                             | ratio, fine tune, level, feedback                                       | Optimized sine/PM operator for building FM networks                             |
| Noise                | color mod, seed/reset                                                     | audio                                                    | white/pink/brown, stereo decorrelation                                  | Same noise family as Fermenter                                                  |
| Sample Player        | trigger/gate, pitch, start, loop pos, reverse, rate                       | audio, end trigger                                       | sample file, root note, one-shot/loop, interpolation, warp mode         | Simplified Crumb-derived playback primitive                                     |
| Sub Oscillator       | pitch, pulse width                                                        | audio                                                    | sine/square, octave offset                                              | Convenience primitive                                                           |
| Impulse / Click      | trigger                                                                   | audio                                                    | amplitude, click shape, polarity                                        | Used for Karplus-Strong, excitation, edge testing                               |
| DC Source            | none or value mod                                                         | value/audio                                              | constant value                                                          | Used for offsets, biasing, thresholds                                           |
| Audio Input          | host audio in, optional sidechain selector                                | audio                                                    | input bus, pre/post host gain                                           | FX and hybrid patches                                                           |
| Note Input           | host note stream                                                          | pitch, gate, trigger, velocity, aftertouch, event stream | mono/poly mode, retrigger mode                                          | Primary bridge from host note events to voice/control signals                   |
| Pitch Input          | host pitch/note context                                                   | pitch/value                                              | octave, note, bend                                                      | Convenience note-domain splitter                                                |
| Transport Phase      | host transport                                                            | phase, trigger                                           | free/run/synced                                                         | Global phasor/transport source                                                  |

---

## 9.2 Filters

| Module                 | Inputs                             | Outputs                           | Key Parameters                            | Notes                                                           |
| ---------------------- | ---------------------------------- | --------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| SVF                    | audio, cutoff, resonance, morph    | audio                             | LP/HP/BP/Notch morph, drive, keytrack     | TPT/Zavalishin style state-variable filter                      |
| Ladder                 | audio, cutoff, resonance, drive    | audio                             | 4-pole mode, saturation, compensation     | Moog-like ladder from `daw-dsp`                                 |
| Comb                   | audio, delay/pitch, feedback, damp | audio                             | positive/negative feedback, interpolation | Resonator and physical-modeling building block                  |
| Allpass                | audio, delay, feedback             | audio                             | delay time, gain                          | Phaser/reverb building block                                    |
| Formant                | audio, vowel index, spread         | audio                             | vowel set, emphasis                       | Formant bank / vocal shaping                                    |
| EQ Band                | audio, freq, Q, gain               | audio                             | peak/low/high/shelf variants              | Parametric biquad band                                          |
| Crossover              | audio, split frequency, slope      | low / mid / high or multiple outs | mode, order, phase policy                 | Multiband splits for effects                                    |
| One-Pole               | audio/value, cutoff                | audio/value                       | LP/HP mode                                | Cheap smoother for CV/control and simple audio shaping          |
| Dome / Analytic Helper | audio                              | real, imag, mag, phase/value      | none/minimal                              | Inspired by complex-signal utility modules for advanced patches |
| Filter Bank            | audio, freq offsets, gains         | multiband or mixed audio          | band count, spacing, Q                    | Optional phase-2 but high value                                 |

---

## 9.3 Envelopes and Modulators

| Module                        | Inputs                      | Outputs              | Key Parameters                                 | Notes                                          |
| ----------------------------- | --------------------------- | -------------------- | ---------------------------------------------- | ---------------------------------------------- |
| ADSR Envelope                 | gate, retrigger             | value                | A, D, S, R, curve, one-shot/retrigger          | Standard amp/filter envelope                   |
| AD Envelope                   | trigger/gate                | value                | A, D, curve                                    | Percussion and transient modulation            |
| Multi-Segment Envelope (MSEG) | trigger, phase reset, sync  | value/phase          | arbitrary points, loop, sync, curve types      | Same MSEG family as Fermenter if possible      |
| LFO                           | phase reset, rate mod, sync | value/phase          | waveform, sync, free rate, depth, phase offset | Shared LFO behavior with other Sourdaw devices |
| Step Sequencer                | clock, reset, step select   | value, trigger, gate | step values, length, probability, glide        | 16/32+ step variant                            |
| Random                        | trigger, seed               | value                | distribution, bipolar/unipolar                 | Random source                                  |
| Sample & Hold                 | input, trigger              | value                | glide, hold mode                               | Utility and modulation primitive               |
| Envelope Follower             | audio                       | value, gate          | attack, release, gain, HP/LP sidechain         | Dynamics tracking                              |
| Slew / Lag                    | value                       | value                | rise, fall, shape                              | Portamento and smoothing                       |
| Chaos                         | trigger/reset               | value                | algorithm, rate, amount                        | Optional but valuable creative source          |
| Function Generator            | trigger/gate                | value, trigger       | attack/decay/loop/EOC                          | Patch-programmable envelope/LFO hybrid         |
| Probability Mod               | trigger/value               | trigger/gate/value   | chance, seed                                   | Control logic hybrid                           |

---

## 9.4 Effects and Processors

| Module                  | Inputs                        | Outputs                     | Key Parameters                                  | Notes                                              |
| ----------------------- | ----------------------------- | --------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Delay                   | audio, time, feedback, filter | audio                       | sync, ping-pong, feedback, damp                 | Core echo building block                           |
| Allpass Delay           | audio, time, feedback         | audio                       | interpolation, gain                             | For reverb/phasing structures                      |
| Reverb                  | audio                         | audio                       | size, decay, diffusion, tone, mix               | Convenience Dattorro or FDN module                 |
| Distortion / Waveshaper | audio, drive, bias, shape     | audio                       | clip/fold/curve modes, oversampling mode        | Includes custom-curve path eventually              |
| Bitcrusher              | audio, rate reduce, bits      | audio                       | sample rate, bit depth, dither                  | Lo-fi primitive                                    |
| Compressor              | audio, optional sidechain     | audio, gain reduction meter | threshold, ratio, attack, release, knee, makeup | Shared dynamics kernel where possible              |
| Limiter                 | audio                         | audio                       | ceiling, release, lookahead mode if used        | Brick-wall or safety limiter                       |
| Chorus / Flanger        | audio, rate, depth, feedback  | audio                       | stereo spread, feedback, delay                  | Modulated delay family                             |
| Ring Modulator          | audio A, audio B              | audio                       | mix, DC offset                                  | Simple multiply processor                          |
| Frequency Shifter       | audio, shift amount           | audio                       | up/down, stereo spread                          | Hilbert/SSB-based                                  |
| Convolver               | audio, IR load                | audio                       | IR file, mix, trim, latency policy              | IR-based processing                                |
| Pitch Shifter           | audio, pitch, grain           | audio                       | semitones, fine, grain, mix                     | Granular or frequency-domain backend               |
| Pan                     | audio, pan                    | stereo audio                | law, modulation                                 | Mono/stereo positioning                            |
| Width                   | stereo audio, width           | stereo audio                | mono→wide, MS width                             | Stereo utility                                     |
| Mid/Side Encode         | stereo audio                  | mid, side                   | none                                            | Routing utility                                    |
| Mid/Side Decode         | mid, side                     | stereo audio                | none                                            | Routing utility                                    |
| Saturator               | audio, drive, bias            | audio                       | tape/tube/soft clip                             | Convenience distinct from fully general waveshaper |
| Gate Processor          | audio, threshold/trigger      | audio                       | threshold, attack, release                      | Useful for drums and dynamics                      |

---

## 9.5 Math and Utility

| Module               | Inputs                  | Outputs                  | Key Parameters             | Notes                                               |
| -------------------- | ----------------------- | ------------------------ | -------------------------- | --------------------------------------------------- |
| Add                  | A, B                    | value/audio              | none                       | Arithmetic                                          |
| Subtract             | A, B                    | value/audio              | none                       | Arithmetic                                          |
| Multiply             | A, B                    | value/audio              | none                       | Arithmetic / ring-mod style                         |
| Divide               | A, B                    | value/audio              | safety mode                | Arithmetic                                          |
| Mix                  | N inputs                | value/audio              | gains, normalization       | Most-used utility                                   |
| Crossfade            | A, B, X                 | value/audio              | curve, equal-power         | Blend primitive                                     |
| Abs                  | input                   | value/audio              | none                       | Rectification                                       |
| Negate               | input                   | value/audio              | none                       | Inversion                                           |
| Invert (1-x)         | input                   | value                    | none                       | Unipolar inversion                                  |
| Min                  | A, B                    | value/audio              | none                       | Utility                                             |
| Max                  | A, B                    | value/audio              | none                       | Utility                                             |
| Clamp                | input, min, max         | value/audio              | none                       | Range limiting                                      |
| Quantize             | input, scale/mode       | value                    | step count, semitone/scale | Pitch or stepped modulation                         |
| Scale / Offset       | input, scale, offset    | value/audio              | none                       | Multiply-add fusion target                          |
| Comparator           | A, B                    | gate/value               | mode, hysteresis           | Logic thresholding                                  |
| Sample & Hold        | input, trigger          | value                    | smoothing                  | Duplicate listing acceptable if shared utility form |
| Switch / Router      | input(s), select        | routed signal(s)         | crossfade/hard switch      | Signal selection                                    |
| Meter                | input                   | visual only or value tap | peak/RMS/VU                | Probe only                                          |
| Scope                | input(s), trigger       | visual only              | timebase, freeze           | Probe only                                          |
| Spectrum             | up to N inputs          | visual only              | FFT size, smoothing        | Probe only                                          |
| XY Pad               | user gesture/value pair | two values               | range, smoothing           | UI/control module                                   |
| Note→Freq            | pitch/value             | value                    | tuning reference           | Conversion                                          |
| Freq→Note            | value                   | pitch/value              | tuning reference           | Conversion                                          |
| dB→Linear            | value                   | value                    | none                       | Conversion                                          |
| Linear→dB            | value                   | value                    | floor                      | Conversion                                          |
| Wrap                 | input                   | phase/value              | range                      | Useful for phase/value coercion                     |
| Slew Math            | input                   | output                   | rise/fall                  | For modulation utility patches                      |
| Value Readout        | input                   | visual                   | unit format                | Probe only                                          |
| Constant Array / LUT | phase/index             | value/audio              | table data                 | Important for custom oscillators/waveshaping        |

---

## 9.6 Sequencing and Logic

| Module           | Inputs                               | Outputs              | Key Parameters                  | Notes                   |
| ---------------- | ------------------------------------ | -------------------- | ------------------------------- | ----------------------- |
| Clock            | transport/sync                       | trigger, phase       | division, multiplier, free rate | Tempo-synced source     |
| Clock Divider    | trigger/clock                        | divided triggers     | ratios                          | Timing utility          |
| Clock Multiplier | trigger/clock                        | multiplied triggers  | ratios                          | Timing utility          |
| Gate             | note/event input or comparator input | gate                 | threshold, latch mode           | State signal            |
| Trigger          | note/event or gate                   | trigger              | pulse length                    | Event-to-trigger bridge |
| Counter          | trigger, reset                       | value, trigger       | max, wrap, direction            | Sequencing primitive    |
| Probability      | trigger                              | trigger/gate         | percent, seed                   | Random gate pass/block  |
| AND              | A, B                                 | gate                 | none                            | Logic                   |
| OR               | A, B                                 | gate                 | none                            | Logic                   |
| XOR              | A, B                                 | gate                 | none                            | Logic                   |
| NOT              | input                                | gate                 | none                            | Logic                   |
| Pattern          | clock, reset, step select            | value, gate, trigger | sequence storage, length        | Sequencing              |
| Euclidean        | clock, reset                         | trigger/gate         | steps, fills, rotation          | Rhythm primitive        |
| Transport Step   | transport phase                      | value/trigger        | bars, steps                     | Host-sync helper        |
| Gate Length      | trigger/gate                         | gate                 | pulse width                     | Timing utility          |
| Bernoulli Gate   | trigger                              | trigger A/B          | probability                     | Useful generative block |
| Logic Compare    | input                                | gate                 | ==, >, <, edge                  | Advanced utility        |

---

## 9.7 I/O and Host Bridge

| Module                   | Inputs                 | Outputs                               | Key Parameters                  | Notes                                      |
| ------------------------ | ---------------------- | ------------------------------------- | ------------------------------- | ------------------------------------------ |
| Audio Output             | audio                  | host output                           | bus, stereo mode, gain          | Final effect/instrument output             |
| Note/Gate/Velocity Input | host note stream       | pitch, gate, trigger, velocity, event | mono/poly/legato                | Primary synth bridge                       |
| Note Output              | event/note stream      | host note output                      | channel, pass-through mode      | Note Bakery output                         |
| Macro Knob               | host automation/UI     | value                                 | name, default, range, smoothing | 8 user-facing macros minimum               |
| Parameter Input          | host automation source | value                                 | parameter binding               | DAW automation into patch                  |
| Modulation Output        | value/audio            | host modulation bus                   | destination policy              | Sends modulation to other devices in chain |
| Sidechain Audio Input    | host sidechain         | audio                                 | bus select                      | FX use cases                               |
| Transport Input          | host tempo/position    | phase, trigger, value                 | beat/bar subdivision            | Sync source                                |
| MIDI CC Input            | host controller events | value/event                           | CC mapping                      | Optional but useful                        |
| MIDI CC Output           | value/event            | host controller stream                | CC mapping                      | Optional advanced control                  |
| Comment                  | none                   | none                                  | text, color                     | Visual annotation                          |
| Group Frame              | none                   | none                                  | label, color                    | Visual organization                        |

---

# 10. Module Browser and Discovery

## 10.1 Browser Requirements

- searchable by name
- searchable by alias/synonym
- categorized
- favorites
- recent
- last-used
- sub-patches mixed into browser results
- wrapped Sourdaw device modules visible where legal
- keyboard-driven placement
- hover preview with:
    - description
    - I/O summary
    - parameter count
    - category
    - “runs per voice” / “global only” flags where relevant

## 10.2 Categories

- Generators
- Filters
- Envelopes
- Modulators
- Effects
- Math
- Sequencing
- Logic
- I/O
- Visual / Probe
- Sub-Patches
- Wrapped Devices
- Favorites
- Recently Used

## 10.3 Placement UX

- right-click canvas → browser
- double-click canvas → quick add
- slash or hotkey → command palette browser
- enter to place
- drag from browser into canvas
- drag onto an existing module to replace when compatible

---

# 11. Visual Patching UI Specification

## 11.1 Canvas

- infinite scrollable canvas
- zoomable
- pan with space-drag / middle mouse
- zoom to cursor
- zoom to fit
- frame selection
- minimap
- snap-to-grid optional
- alignment guides
- patch overview search
- large-patch performance must remain acceptable at hundreds of modules

## 11.2 Selection Model

- single click select
- shift-click multi-select
- drag box select
- grouped move
- copy/paste with internal cables preserved
- duplicate selection
- isolate selection
- collapse selection to sub-patch
- delete selection or cable

## 11.3 Cable Creation

- drag from output to input
- drag from input to output also supported
- hover highlights compatible ports
- dropping on canvas can create a new receiving module via “quick place into cable”
- cable reconnection by dragging endpoint
- cable selection and delete
- cable reroute anchors optional but not required in v1

## 11.4 Module Presentation

Each module card can show:

- title
- category color
- ports with labels
- compact mini-visualization
- parameter knobs/sliders
- status badges:
    - voice-local
    - global
    - sub-patch
    - wrapped device
    - warning
    - feedback-delayed

## 11.5 Collapsed and Expanded States

### Collapsed

- name
- ports
- tiny indicator
- no internal parameter controls

### Expanded

- full parameter controls
- scope/visual preview where useful
- macro assign controls
- modulation rings

### Inspector

The right-side inspector shows the full parameter set of the selected module(s), including hidden advanced parameters.

## 11.6 Module Visualizations

Examples:

- oscillator: waveform or wavetable slice
- envelope: curve
- LFO: shape/phase
- filter: frequency response
- delay: time/feedback mini graph
- sequencer: step row
- meter/scope: live meter or mini trace

## 11.7 Knob and Parameter System

Reuse Sourdaw’s design system:

- dome knobs
- modulation rings
- precise numeric entry
- double-click reset
- right-click context menu
- drag with modifier for fine mode
- external automation mapping
- parameter copy/paste

## 11.8 Vital-Style Modulation Rings

If a module output or macro modulates a parameter:

- ring appears around the destination knob
- base value and modulation range are visible
- multiple modulators stack or segment visually
- hovering highlights source cable/module

---

# 12. Progressive Disclosure Levels

## Level 1 — Play

- patch loaded as normal device
- user sees macros, core controls, preset browser
- no patch editing visible
- behaves like a native Sourdaw device

## Level 2 — Shape

- patch visible in read-only or parameter-tweak mode
- modules and signal flow visible
- user can inspect and tweak parameters
- no topology editing
- ideal for learning and light customization

## Level 3 — Build

- full canvas editing
- add/remove modules
- connect/disconnect cables
- browser access
- grouping
- copy/paste
- standard patch construction

## Level 4 — Route

- advanced routing surfaces
- sidechains
- parallel buses
- multi-output mapping
- feedback loops
- sub-patch interface definition
- voice/global split management

## Level 5 — Lab

- CPU heat map
- buffer-lifetime overlay
- constant-fold / dead-code visualization
- signal probes
- advanced debugging
- patch/package export
- developer module SDK workflows
- custom Rust module authoring hooks

---

# 13. Sub-Patches and Macros

## 13.1 Sub-Patch Creation

Flow:

1. select modules
2. choose “Create Sub-Patch”
3. define:
    - name
    - description
    - icon
    - category
    - exposed inputs
    - exposed outputs
    - exposed params
4. save into local patch library

## 13.2 Sub-Patch Rules

- sub-patches can contain other sub-patches
- recursive self-reference must be forbidden
- nested graph must inline at compile time or compile as a reusable compiled segment
- exposed interface uses explicit Subpatch In / Out boundary modules internally

## 13.3 Sub-Patch Storage

Sub-patches are saved as patch JSON with:

- stable content hash
- metadata manifest
- interface declaration
- dependency list (other sub-patches, wrapped devices, samples, IRs if any)

## 13.4 Macro System

Every Bakery patch exposes at least **8 macros** to the host.

Each macro supports:

- display name
- default value
- unipolar/bipolar mode
- automation and MIDI learn
- multiple targets
- independent min/max per target
- curve/skew per target
- optional inversion
- smoothing

## 13.5 Macro Binding Model

```rust
pub struct MacroBinding {
    pub macro_id: MacroId,
    pub name: String,
    pub assignments: Vec<MacroAssignment>,
}

pub struct MacroAssignment {
    pub module_id: ModuleId,
    pub param_id: ParamId,
    pub min: f32,
    pub max: f32,
    pub curve: MacroCurve,
    pub invert: bool,
}
```

---

# 14. Graph Compilation Pipeline

This is the most important system in The Bakery.

## 14.1 Compile Stages

### Stage 0 — Parse and Normalize

- load patch JSON
- resolve module definitions
- resolve sub-patches
- resolve wrapped devices
- canonicalize IDs
- validate container type rules

### Stage 1 — Port Resolution

- infer lane counts
- infer voice-local vs global execution domain
- validate connection types
- insert coercion adapters where necessary
- insert explicit mixers for multi-connection inputs if needed

### Stage 2 — Graph Build

- create typed module graph
- nodes = module instances
- edges = cable connections
- annotate edge domains, lane counts, feedback flags

### Stage 3 — Domain Split

Split into:

- event graph
- continuous-signal graph
- voice-local graph
- global graph

### Stage 4 — Feedback / SCC Analysis

- detect strongly connected components
- any cycle without explicit delay state gets a compiler-inserted one-sample feedback delay on the chosen feedback edge
- expose inserted `z^-1` in UI

### Stage 5 — Topological Schedule

- condense SCCs
- topologically sort DAG of compiled tasks
- establish processing order

### Stage 6 — Buffer Planning

- compute lifetimes of edge buffers
- allocate scratch buffers
- reuse buffers whose lifetimes do not overlap
- distinguish:
    - mono vs stereo
    - voice-local vs global
    - temporary constant blocks
    - decimated probe buffers

### Stage 7 — Optimization Passes

- constant folding
- dead code elimination
- arithmetic fusion
- parameter smoothing insertion
- bypass short-circuiting
- sub-patch inlining or compiled reuse
- zero-input module elision where legal

### Stage 8 — Schedule Emission

Emit flat schedule:

```rust
pub struct CompiledBakeryPatch {
    pub tasks: Vec<ProcessTask>,
    pub buffer_plan: BufferPlan,
    pub event_plan: EventPlan,
    pub profile_map: ProfileMap,
}
```

### Stage 9 — Runtime Swap

- compile off audio thread
- atomically swap compiled schedule into engine using existing lock-free infrastructure

---

# 15. Feedback Loops

## 15.1 Why They Matter

Feedback is essential for:

- comb filtering
- Karplus-Strong
- resonators
- self-modulating oscillators
- chaotic systems
- physical modeling
- aggressive distortion and delay networks

## 15.2 Digital Reality

A direct combinational cycle is undefined in a single-sample DSP graph.

## 15.3 Compiler Policy

Allow user feedback cables, but enforce a minimum feedback delay:

- explicit `Delay1` / `z^-1` module preferred
- if user creates illegal cycle, compiler inserts a one-sample delay on the feedback edge
- UI marks the edge as delayed
- sample-accurate feedback state is preserved across blocks

This matches the actual discrete-time reality and remains musically useful.

---

# 16. Buffer Allocation and Memory Model

## 16.1 Requirements

- no dynamic allocation on audio thread
- buffers preplanned at compile time
- lane-aware
- voice-aware
- reusable across tasks
- UI probes decimated and ring-buffered separately

## 16.2 Buffer Strategy

Use a linear-scan / liveness-based buffer allocator analogous to register allocation:

- compute first and last use of every edge result
- reuse scratch buffers when live ranges do not overlap
- keep constant buffers separate
- keep probe taps write-only and decimated

## 16.3 Lane Model

Internally support:

- mono
- stereo
- poly-voice indexed mono/stereo
- event queues

Do not force all Bakery signals to be stereo if that costs unnecessary CPU.  
Instead use auto-upmix/downmix policies and lane metadata.

---

# 17. Optimization Passes

## 17.1 Constant Folding

If all inputs to a module are compile-time constants:

- evaluate once
- replace with constant source node or baked parameter
- remove module task

Examples:

- DC → Scale → Bias
- fixed math graphs
- static quantizer tables
- constant comparator thresholds

## 17.2 Dead Code Elimination

Skip modules whose outputs:

- feed no audible result
- do not feed macro/readout/probe paths
- are not needed for event side effects

Visual-only probe modules should remain only if actively visible/armed.

## 17.3 Module Fusion

Fuse common chains such as:

- Multiply → Add → `ScaleOffset`
- Add → Clamp → optionally specialized utility
- repeated gains into mixer coefficients
- static panners into output gains
- utility math around parameter inputs

## 17.4 Bypass Short-Circuiting

For modules with true bypass semantics:

- compile direct wire-through path when bypassed
- avoid processing dead branches

## 17.5 Sub-Patch Inlining

For small or simple sub-patches:

- inline by default
- preserve debug/source map to original sub-patch

For large reusable sub-patches:

- optionally compile as reusable compiled segments if this improves compile or memory performance

## 17.6 SIMD / Vectorization

- process in blocks sized for host engine
- vectorize common kernels
- use lane-aware kernels
- keep task order cache-friendly
- avoid unnecessary deinterleave/reinterleave operations

---

# 18. Note Bakery Event Graph

## 18.1 Note Bakery Is Not Audio-Only

Note Bakery must process note/event streams as first-class data.

## 18.2 Event Primitives

Represent note streams as timestamped events inside block:

- note on/off
- pitch
- velocity
- channel/lane
- duration if known
- controller/mod values

## 18.3 Event-Graph Compilation

Compile Note Bakery graphs separately from continuous DSP graphs:

- topological event processing order
- sample offsets preserved within host block
- event merging and fan-out supported
- bridge modules can create gate/trigger/value streams from events

## 18.4 Host Integration

Note Bakery output can:

- feed instrument tracks
- feed Poly Bakery
- feed DAW note lanes
- feed external instruments

---

# 19. Performance Profiling and Telemetry

## 19.1 Per-Module CPU Profiling

Provide optional profiling mode that measures:

- inclusive CPU time per compiled module task
- voice-local vs global cost
- event-graph cost
- probe/render cost

Display:

- heat map overlay on modules
- sorted profiler list
- active voices
- per-voice CPU estimate

## 19.2 Signal Probe System

Probe modules should:

- tap compiled buffers
- decimate data
- write to lock-free UI ring buffers
- never block audio thread

## 19.3 Additional Debug Views

Level 5 can show:

- live task order
- constant-folded nodes
- dead-code-removed nodes
- inserted feedback delay edges
- buffer reuse coloring
- lane width
- voice/global partitioning

---

# 20. DAW Integration

## 20.1 Device Chain Integration

A Bakery patch is a normal Sourdaw device.

It must:

- sit in track/device chains
- support preset browsing
- support automation
- support freeze/bounce
- support project save/load
- expose macros like any other device
- participate in track latency compensation rules

## 20.2 Wrapped Internal Devices

Other Sourdaw devices can be exposed as Bakery modules where architecturally legal.

Preferred initial wrappers:

- oscillator blocks from Fermenter
- wavetable engine wrappers
- Levain reverb wrappers
- utility filters/saturators
- selected modulation modules

Treat wrapped devices as:

- metadata-rich composite modules
- optionally collapsible to reveal “open in source” where their internals are Bakery-native

## 20.3 Third-Party Plugin Hosting

Initial release should **not** require arbitrary VST/CLAP plugins inside Bakery patches.

Reason:

- separate threading/runtime concerns
- latency and automation complexity
- sandboxing and browser-share incompatibility

Support built-in Sourdaw device wrappers first.

## 20.4 Freeze and Bounce

Bakery patches should freeze/bounce like any other device:

- Poly Bakery to audio
- FX Bakery through rendered audio
- Note Bakery to MIDI or downstream rendered result

## 20.5 Export as Standalone Device

A Bakery patch can be promoted to a standalone Sourdaw device asset:

- appears in browser alongside built-in devices
- retains source patch link
- preserves macros and metadata
- content-addressed for sharing

---

# 21. Patch File Format and Sharing

## 21.1 Format

Use canonical JSON for patch documents.

Properties:

- stable ordering where needed for content hashing
- versioned schema
- compact but human-readable
- portable across desktop and browser runtimes where assets are available

## 21.2 Content Hash

Each patch should have a content hash derived from canonical serialization.

Uses:

- deduplication
- share URLs
- community feed IDs
- remix lineage
- offline caching

## 21.3 Share URL Model

Example concept:

- `sourdaw.app/patch/<content-hash>`

Behavior:

- open patch in browser
- run patch live via WASM where supported
- show Play / Shape / Build modes based on permissions/platform
- “View Source” always available for readable patches unless explicitly packaged as protected commercial content in a future product tier

## 21.4 Remix / Fork

Forking should preserve:

- parent hash
- remix lineage metadata
- user-defined title/description
- dependency list

No account should be required for local file sharing or content-addressable URL generation.  
Hosted community features can still exist as an optional service.

---

# 22. Community Library

## 22.1 Library Goals

The community library should turn Bakery into:

- a preset ecosystem
- a learning platform
- a reusable module ecosystem
- a discovery engine for novel instruments/effects

## 22.2 Essential Community Features

- featured patches
- newest patches
- category browser
- “study-friendly” patches
- favorites
- forks/remixes
- sub-patch pack sharing
- comments or annotations optional in later phases
- patch metadata:
    - type (instrument/effect/note tool)
    - tags
    - CPU class
    - dependencies
    - audio examples
    - screenshots or auto-rendered patch thumbnails

## 22.3 Learning Flywheel

Every public patch should support:

- open source inspection
- copy into user library
- save as variation
- reveal sub-patches
- reveal macro mappings
- example usage notes

This is essential to reproducing the best community effects of Reaktor and Max for Live while remaining easier to learn than either.

---

# 23. Custom Developer Modules (Level 5 / SDK)

## 23.1 Scope

For advanced developers, support custom Rust DSP modules as an SDK feature.

## 23.2 Important Constraint

Do **not** compile arbitrary user Rust on the audio thread or inside the running UI session.

## 23.3 Proposed Model

Developer modules are authored externally as Rust crates implementing a Bakery kernel trait, then packaged as:

- native dynamic module bundle for desktop dev mode
- optional WASM module build for browser-compatible sharing

## 23.4 SDK Requirements

Developer module package should define:

- manifest
- name
- version
- category
- port schema
- parameter schema
- host compatibility
- deterministic build target
- security/trust flags

## 23.5 Product Policy

- built-in and official community patches should rely on the stock module library
- developer SDK is a separate advanced layer
- unsupported developer modules should degrade gracefully when missing:
    - patch opens in safe mode
    - module shown as missing dependency
    - audio path bypassed or muted by policy

---

# 24. Patch Library and Asset Management

## 24.1 Patch Assets

A patch may depend on:

- sub-patches
- samples
- IRs
- wavetables
- wrapped-device versions
- custom developer modules

## 24.2 Asset Strategy

Use content-addressed or path-resolved manifests so that:

- patch portability is visible
- missing assets are detected cleanly
- browser-share runners can report missing dependencies explicitly
- local caches can reuse assets

---

# 25. UX and Accessibility

## 25.1 Accessibility Goals

- keyboard-first module browser access
- keyboard placement and navigation
- readable cable colors with colorblind-safe alternates
- port labels always available
- zoom and text scale support
- large hit areas
- touch-friendly mode where possible

## 25.2 Keyboard Shortcuts

At minimum:

- add module browser
- duplicate
- group
- sub-patch create
- delete
- undo/redo
- zoom to fit
- frame selection
- toggle collapsed
- inspector focus
- search modules

---

# 26. Performance Targets

## 26.1 Core DSP Target

A typical subtractive voice patch:

- 2 oscillators
- mixer
- filter
- amp envelope
- output

should be in the same general CPU class as an equivalent built-in Sourdaw synth patch built from the same primitives.

The modular graph must not incur a “modular tax” of 5x simply because it is patchable.

## 26.2 UI Target

- large patches remain navigable
- patch canvas remains smooth under pan/zoom/select operations
- cable rendering scales to dense patches
- minimap and heat map remain usable
- inspector updates do not stall drag operations

## 26.3 Compilation Target

Recompilation on patch edit should feel near-instant for common graphs.

Use:

- incremental recompilation where feasible
- compiled subgraph cache
- deferred low-priority optimization passes for very large patches
- optimistic preview of topology changes while compile finalizes

---

# 27. Suggested Internal Compiler IR

```rust
pub struct BakeryIr {
    pub nodes: Vec<IrNode>,
    pub edges: Vec<IrEdge>,
    pub sccs: Vec<SccId>,
    pub voice_domain: DomainGraph,
    pub global_domain: DomainGraph,
    pub event_domain: DomainGraph,
}

pub struct IrNode {
    pub id: ModuleId,
    pub kind: ModuleKind,
    pub kernel_class: KernelClass,
    pub params: ParamValueMap,
}

pub struct IrEdge {
    pub from: (ModuleId, PortId),
    pub to: (ModuleId, PortId),
    pub domain: SignalDomain,
    pub lanes: LaneCount,
    pub needs_coercion: bool,
    pub feedback_delayed: bool,
}
```

---

# 28. Recommended Implementation Phases

## Phase 1 — Core Runtime

- patch document schema
- module definitions
- continuous-signal graph
- Poly / FX / Note containers
- topological compile
- buffer allocation
- core modules:
    - oscillators
    - SVF
    - ADSR
    - math
    - mixers
    - audio I/O
    - macro
    - scopes/meters

## Phase 2 — Full Patching UX

- infinite canvas
- module browser
- cable creation
- copy/paste
- undo/redo
- minimap
- collapsed/expanded nodes
- inspector
- visual signal typing

## Phase 3 — Polyphony + Event Graph

- Note Bakery
- note bridges
- per-voice graphs
- Voice Mix
- unison
- host voice allocator integration

## Phase 4 — Advanced Modules

- wavetable
- sample player
- delay/reverb
- compressor/limiter
- frequency shifter
- convolver
- pitch shifter
- formant/filter-bank tools
- Euclidean/pattern sequencing

## Phase 5 — Optimizer + Debugging

- constant folding
- dead-code elimination
- fusion
- CPU profiler
- heat map
- inserted-feedback visualization
- buffer-lifetime overlay

## Phase 6 — Sub-Patches + Sharing

- sub-patch interface definition
- patch browser integration
- patch JSON versioning
- content hashing
- share URLs
- browser patch runner

## Phase 7 — Wrapped Devices + SDK

- wrap selected Sourdaw devices as modules
- standalone device export
- developer SDK for custom Rust modules

---

# 29. Minimal Success Criteria

The Bakery is successful when all of the following are true:

1. A user can build a full subtractive synth from primitives and it performs like a native device.
2. A user can build an audio effect patch and drop it into a track chain like any built-in effect.
3. A user can create a note-sequencing/generative Note Bakery patch that outputs MIDI-like events to the DAW.
4. A user can save part of a patch as a sub-patch and reuse it elsewhere.
5. A patch can be shared as JSON and opened in browser or desktop with the same topology and sound where assets are present.
6. The patch graph compiles into a flat task schedule with no audio-thread graph traversal.
7. Users can learn from shared patches without leaving Sourdaw.

---

# 30. Minimal Build Summary

If an AI agent needs the shortest faithful implementation brief, use this:

1. Build The Bakery as a native device-chain-integrated modular environment with three containers: Poly Bakery, FX Bakery, and Note Bakery.
2. Expose the same DSP primitives used by Sourdaw’s built-in devices as visual modules.
3. Present typed, color-coded cables in the UI, but compile all continuous domains as sample-accurate block signals internally.
4. Support at minimum the full generator, filter, envelope, effects, math, sequencing, and I/O catalog listed in this document.
5. Use a hybrid React + GPU/canvas UI: React for controls and inspectors, GPU/canvas for cables, scopes, minimap, and large-patch rendering.
6. Compile patches through graph normalization, SCC/feedback analysis, topological sort, buffer planning, optimization passes, and flat `ProcessTask` schedule emission.
7. Allow feedback loops by inserting or requiring a one-sample delay on cyclic edges.
8. Split Poly Bakery into per-voice and post-voice/global execution domains.
9. Expose 8 automatable macros, support sub-patches, and allow sub-patches to appear as modules in the browser.
10. Integrate Bakery patches as first-class DAW devices with preset browsing, freeze/bounce, automation, and export as standalone patch devices.
11. Treat shared patches as content-addressed JSON assets with optional browser execution and source inspection.
12. Add profiling, heat maps, and developer SDK features only after the core compiled-runtime patcher is solid.

---
