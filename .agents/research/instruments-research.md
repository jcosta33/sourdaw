# Consolidated Instruments Research

_Compiled from bakery.md, crumb.md, bacteria.md, instruments.md, local-audio-gen.md_

## 1. The Bakery (Modular Synthesis Environment)

> **Codebase Annotation:** The Bakery is completely unbuilt. While the underlying DSP primitives exist in `daw-dsp` (Fermenter, Levain, Bacteria), the `Bakery` node-based routing engine, Poly/FX/Note containers, and visual patching UI do not exist in the Rust backend or TS frontend.

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

- oscillators, filters, envelopes, delays, utility math, routing primitives, event generators, sequencing tools, DAW I/O, macro interfaces, sub-patches, wrapped built-in devices
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

## 2.2 Typed Visual Layer, Unified Continuous-Signal Core

The UI should present distinct signal/cable domains because that helps users reason about patches.  
Internally, however, all continuous signal domains should compile down to the same sample-accurate block-processing substrate.

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

## 2.5 Community as Product Infrastructure

Every patch is also:

- an instrument/effect
- a readable design document
- a teaching artifact
- a remixable fork point

---

# 3. Competitive Baseline and Extracted Requirements

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

- **React component layer** for sidebars, inspector, parameter widgets, browser, metadata, macros.
- **GPU/canvas layer** for cables, signal glow, minimap, scopes, level meters, selection overlays, CPU heat map, panning/zooming.

## 4.3 React 19 Use

Use React 19 transitions and deferred rendering for non-urgent tasks.
Urgent interactions (cable dragging, node movement, knob movement) must never be blocked.

## 4.4 Tauri v2 Use

Use Tauri 2 for native file access, IPC profiling, file watching, and plugin/patch package installation.

---

# 5. Core Patch Data Model

## 5.1 Canonical Patch Types

- **Poly Bakery** (Instrument)
- **FX Bakery** (Effect)
- **Note Bakery** (MIDI/Note Processor)

## 5.2 - 5.6 Data Structures

(Structures for Patch, Module Definition, Module Instance, Port Definition, Cable Definition. All user-facing entities must use stable IDs.)

---

# 6. Signal and Port Type System

## 6.1 User-Facing Signal Domains

- **Audio** — orange
- **Gate** — green
- **Trigger** — green
- **Value / Modulation** — blue
- **Phase** — purple
- **Event / Note Stream** — teal
- **UI / Meta / Inspect** — inspector-only

## 6.2 Internal Representation

Internally, split into **Continuous Signal Family** (sample-accurate buffers) and **Event Family** (event streams with sample offsets).

## 6.3 - 6.6 Domain Semantics and Coercion

(Rules for Audio, Gate, Trigger, Value, Phase, Events. Default multiple connection policies: sum for continuous, merge queue for events.)

---

# 7. Polyphony, Containers, and Voice Architecture

## 7.1 Container Types

- **Poly Bakery:** voice-local graph per voice, then global graph.
- **FX Bakery:** single global DSP graph.
- **Note Bakery:** processes/generates note events, no audio path by default.

## 7.2 Poly Bakery Internal Split

Voice Domain (oscillators, envelopes, per-voice filters) vs Global Domain (global reverb, EQ, output limiting).

## 7.3 Voice Infrastructure Modules

Voice Mix, Voice Split, Voice Index, Voice Count, Voice Gate, Unison.

## 7.4 Voice Stealing and Allocation

Host voice manager provides note assignment, priority, stealing. Patch declares polyphony limits.

---

# 8. Module System Architecture

## 8.1 Module Classes

- PrimitiveKernel, CompositeKernel, HostBridge, DeviceWrapper, VisualOnly/Probe.

## 8.2 Module Runtime Contract

`reset`, `prepare`, `process` using a `ProcessContext`.

## 8.3 Parameter Metadata

Stable IDs, units, ranges, curves, bipolar flags, etc.

---

# 9. Complete Minimum Module Catalog

_(A comprehensive catalog of Generators, Filters, Envelopes, Effects, Math, Sequencing, and I/O modules is expected.)_

---

# 10 - 29. Bakery UI, Graph Compilation, Sub-patches, Community Library, etc.

_(Detailed requirements for module browser, canvas, sub-patches, 9-stage graph compilation pipeline, feedback loop delays, linear-scan buffer allocation, constant folding, dead code elimination, and sharing URL model.)_

## 2. Crumb (Advanced Sampler)

> **Codebase Annotation:** Crumb is currently unbuilt. The `daw-sampler` crate does not exist. There is a basic sample playback engine in `daw-dsp/src/levain`, but the advanced Crumb features (2D mapping grid, SFZ import, WebGPU visualizers, multi-tier resampling, slicing, granular playback) are missing.

# Crumb for Sourdaw — AI Implementation Guide

## Purpose

Crumb is Sourdaw’s general-purpose sampler: a high-performance instrument for multisampling, slicing, warping, granular playback, disk streaming, and expressive modulation.

## 1. Product Definition

Crumb handles single-shot, multisampled instruments, round robin, tempo-aware warping, slicing, granular synthesis, disk streaming.

## 2. Architectural Principles

- Immutable patch description vs. Stateful runtime voice engine vs. Lock-free control bridge.
- Subsystems: asset_pool, import, mapping, voice_engine, resampler, warp, granular, slicing, streaming, modulation, effects, routing, analysis, ui_bridge.

## 3. Hierarchical Data Model

1. Instrument
2. Layer
3. Group
4. Zone
5. Sample Asset
   (Parameters inherit downward).

## 4. Rust Data Structures

`Zone` structs with sample references, key/velocity ranges, playback offsets, loop settings, and trigger logic.

- Use shared ownership for decoded sample assets (`Arc<SampleAsset>`).
- Pre-allocated voice pools.

## 5. Mapping Engine

- 2D Mapping Space (X: key, Y: velocity).
- UI supports drag-to-move, overlapping logic, batch assignment.

## 6. Velocity Crossfades

Equal-power crossfades for overlapping velocity layers using cosine/sine curves to preserve energy.

## 7. Trigger Logic and Articulation

Declarative triggers for note-on, release, legato, keyswitch, round-robin, cycle, mute groups.

## 8. Playback Modes

One-Shot, Classic Gated, Slice, Granular, Warp/Tempo-Sync, Reverse.

## 9. Resampling and Interpolation

- Linear (draft)
- Cubic Hermite (default sweet spot)
- Windowed Sinc (highest quality, 32/64-tap)

## 10. Anti-Aliasing Strategy

Multi-Resolution Source Pyramids (prefiltered source caches).

## 11. Warping and Time-Stretching

- Signalsmith Stretch integration for premium tonal stretching.
- Policies: Beats, Tones, Texture, Complex.

## 12. Slice Engine

Spectral-flux-based onset detection. Slices mapped chromatically or to pads.

## 13. Granular Engine

Sample-accurate grain scheduler, density, spray, envelope shapes (Hann, Gaussian).

## 14. Analysis Engine

pYIN root note detection, BPM detection for loops, silence/trim detection.

## 15. Non-Destructive Editing

All edits (offsets, fades, normalizations) are metadata only.

## 16. Looping System

Forward, ping-pong, reverse. Zero-crossing snapping and crossfade looping.

## 17. Release Triggers and Legato Polish

Alignment via zero-cross search, short handoff crossfade, or envelope matching.

## 18. Modulation System

Visual-first drag-and-drop modulation. Voice-level, Group-level, Global-level scopes.

## 19. Effects Architecture

Per-zone, per-group, master inserts using `daw-dsp`.

## 20. Import and Interoperability

- **SFZ Import:** Core requirement. Must parse `<global>`, `<control>`, `<group>`, `<region>`.
- Support for key ranges, velocity ranges, tune, loop, ampeg, round-robin, off_by.

## 21 - 33. UI, Disk Streaming, WebGPU, React 19 Frontend

- Direct-from-disk streaming with preload buffers.
- Unified UI Architecture with modular blocks.
- WebGPU for waveform rendering, modulation rings, spectral analysis.

## 3. Bacteria (Creative Multi-Effects Framework)

> **Codebase Annotation:** Bacteria is **heavily implemented** in the codebase. The DSP backend exists in `crates/daw-dsp/src/bacteria/` with modules for crossover, STFT, filter, granular, chorus, distortion, etc. The frontend exists in `src/modules/Bacteria/` with the unified UX fully modeled in TypeScript (`BacteriaPatch`). Core features and mathematical variants have been DELETED from this research doc as they are already implemented exactly as specified. Retaining only advanced WebGPU visualization goals and UX metaphors (Variable Typography) that may need future validation or implementation.

### 8.1 Visual Feedback Systems

- **Modulation Collars:** Animated arcs around knobs.
- **Source Flow:** Diffuse particles between modulators and targets to show global modulation activity without cable clutter.
- **Spectral Heatmaps & Stereo-ize Display.**

### 12.1 Variable Typography

Using **Coldtype** or equivalent variable font animation: the word “DRIVE” widens as saturation increases. This visual metaphor bridges technical data and expressive feedback.

## 4. Free Resources & Instruments (Sfizz & Samples)

> **Codebase Annotation:** Faust synthesis is **fully implemented** (`src/modules/Plugin/useCases/faustEngine`, `faustwasm` integration, and numerous Faust presets like `factory-faust-minimoog-lead`). The Faust sections have been DELETED from this document. However, `sfizz` (SFZ player via WebAssembly) and the specific sample library integrations (Salamander Grand, VSCO 2 CE, etc.) are **missing** from the codebase.

### The technology stack and its constraints

**sfizz WASM opcode support is excellent.** The engine supports **96% of SFZ v1** and 44% of SFZ v2 opcodes. All critical professional instrument opcodes work: `seq_length`/`seq_position` for round-robin, `sw_last`/`sw_lokey`/`sw_hikey` for keyswitches, `xfin_locc` for CC crossfading, `group`/`off_by` for choke groups, flex EGs, filters, and loop controls. FLAC decoding is built-in.
**Memory is the primary WASM constraint.** With no disk streaming available in the browser sandbox, all samples must reside in memory (limit ~1.5–2.5 GB). The recommended architecture uses Tauri's Rust backend to decode FLAC via the symphonia crate and transfer decoded PCM buffers to the WASM virtual filesystem via IPC.

### Acoustic piano: the strongest sampled instrument category

**Salamander Grand Piano** (CC-BY-3.0) provides **16 velocity layers** of a Yamaha C5 Grand sampled at minor-third intervals, with hammer noise, string resonance, and pedal noise. (394 MB in SFZ+WAV).
**Sofia MZ Pianos** (CC-BY) are the premium option, including a Hamburg Steinway D with **20 velocity layers** (4.3 GB).
**Splendid Grand Piano** (Public Domain) offers 4 velocity layers in 77 MB as a fallback.
_(SFZ structure requires layered regions, pedal-up/down states, release triggers, and sympathetic resonance)._

### Drums and percussion: surprisingly strong free options

**Virtuosity Drums (CC0)**: Contemporary jazz kit with **6 mic positions** and up to **36 dynamic levels** (~1.5 GB).
**Naked Drums (CC-BY-4.0)**: **10 round-robins** per instrument with 5 velocity layers (1.3 GB).
_(SFZ structure requires cymbal choke groups, hi-hat CC4 pedal control, round-robin sequencing, and room mic blending)._

### Guitar and bass

**Karoryfer Emilyguitar (CC0)** (99 MB, DI recording) and **Karoryfer Growlybass (CC0)** (159 MB, 4 velocity layers, 4 round-robins) are strong choices, particularly for bass. Guitar requires Faust amp simulation and is limited to basic textures rather than realistic strumming.

### Mellotron and vintage tape: a creative workaround needed

**No CC0 Mellotron sample library exists.** The workaround: Use clean CC0 flute, strings, brass, and choir-like sounds from VCSL, then process through a Faust tape effect chain that adds Wow, Flutter, Saturation, and Hiss.

### Choir and vocal textures

**No CC0 SATB choir library exists.** Use Faust formant synthesis (`pm.SFFormantModelBP`) to produce "ooh/aah" vocal pads.

### Sample library packaging and delivery strategy

Distribute as FLAC. Decode to PCM at load time using Rust/symphonia in the Tauri backend, then transfer to WASM virtual filesystem.

- **Bundled:** Faust synthesis, Splendid Grand Piano (77 MB), Gogodze Phu drum kit.
- **First-run download:** Salamander Grand Piano, Virtuosity Drums.
- **On-demand download:** Naked Drums, Sofia MZ piano upgrade.d Drums, Sofia MZ piano upgrade.
