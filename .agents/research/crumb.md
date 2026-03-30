# Crumb for Sourdaw — AI Implementation Guide

## Purpose

Crumb is Sourdaw’s general-purpose sampler: a high-performance instrument for multisampling, slicing, warping, granular playback, disk streaming, and expressive modulation.

It is designed to combine:

- the deep sample-mapping power expected from large library samplers
- the immediacy of one-sample workflow instruments
- modern hybrid playback modes
- fast visual editing
- stable real-time performance in both native and web-targeted builds

Crumb should be built with:

- a **Rust backend** in `daw-sampler`
- shared DSP infrastructure from `daw-dsp`
- a **React 19** frontend
- **WebGPU** for waveform, spectrum, mapping, and modulation visualization

---

# 1. Product Definition

Crumb is not just a file-triggering sampler. It is a layered instrument engine that must handle:

- single-shot sample playback
- multisampled instruments
- round robin and articulation logic
- tempo-aware warping
- slicing
- granular synthesis
- release triggers
- disk-streamed libraries
- modulation and effects
- multi-output routing

Core design goals:

1. **Fast to play**
2. **Deep to author**
3. **Safe on the audio thread**
4. **Non-destructive by default**
5. **Visually legible under heavy complexity**

---

# 2. Architectural Principles

## 2.1 Patch Model vs. Runtime State

Crumb should not treat the entire engine as literally stateless, because voices, envelopes, playback cursors, loop phases, grain schedulers, and stream readers all require runtime state.

Use this split instead:

- **Immutable or versioned patch description**  
  Instrument structure, mapping, modulators, effect routing, and metadata.
- **Stateful runtime voice engine**  
  Voice playback state, streaming state, envelopes, filters, grains, and modulators.
- **Lock-free control bridge**  
  UI writes parameter changes to the engine without blocking the audio thread.

This keeps authoring clean while preserving real-time correctness.

## 2.2 Core Modules

Recommended subsystem split:

- `asset_pool`
- `import`
- `mapping`
- `voice_engine`
- `resampler`
- `warp`
- `granular`
- `slicing`
- `streaming`
- `modulation`
- `effects`
- `routing`
- `analysis`
- `ui_bridge`

---

# 3. Hierarchical Data Model

Use a five-tier instrument structure:

1. **Instrument**
2. **Layer**
3. **Group**
4. **Zone**
5. **Sample Asset**

## 3.1 Responsibility by Tier

| Entity       | Role                         | Typical Parameters                                         |
| ------------ | ---------------------------- | ---------------------------------------------------------- |
| Instrument   | Top-level patch container    | master volume, macros, global FX, global routing           |
| Layer        | Parallel stack or split path | layer gain, pan, enable state, output routing              |
| Group        | Shared DSP and trigger logic | filter, ADSR, round robin, mute groups, articulation logic |
| Zone         | Mapping unit                 | key range, velocity range, root note, tune, loop, offsets  |
| Sample Asset | Audio source reference       | path, format, sample rate, channels, decoded handles       |

## 3.2 Inheritance Model

Parameters should inherit downward unless explicitly overridden.

Example inheritance flow:

- Instrument default amp envelope
- Layer overrides pan
- Group overrides filter and trigger logic
- Zone overrides key/velocity mapping and playback offsets

This avoids duplicated metadata and keeps large libraries manageable.

---

# 4. Rust Data Structures

Zones are the fundamental playback mapping units.

```rust
pub struct Zone {
    pub id: Uuid,
    pub sample: Arc<SampleAsset>,
    pub root_note: u8,
    pub tune_cents: i32,
    pub gain_db: f32,
    pub pan: f32,
    pub key_range: RangeInclusive<u8>,
    pub velocity_range: RangeInclusive<u8>,
    pub offsets: PlaybackOffsets,
    pub loop_settings: Option<LoopSettings>,
    pub trigger: ZoneTrigger,
    pub output_bus: OutputBusId,
}

pub struct PlaybackOffsets {
    pub start_frame: u64,
    pub end_frame: u64,
    pub fade_in_samples: u32,
    pub fade_out_samples: u32,
}

pub struct LoopSettings {
    pub start_frame: u64,
    pub end_frame: u64,
    pub mode: LoopMode, // Forward, PingPong, Reverse
    pub crossfade_samples: u32,
}

pub enum ZoneTrigger {
    NoteOn,
    NoteOff,
    Legato,
    Release,
    Keyswitch(u8),
    RandomRoundRobin,
}
```

## 4.1 Sample Ownership

Use shared ownership for decoded sample assets:

- `Arc<SampleAsset>` or an equivalent pooled handle
- deduplicate identical assets across zones and patches
- keep immutable decode data separate from mutable streaming cursors

Do not duplicate sample memory per zone.

## 4.2 Voice Pooling

Use pre-allocated voice pools for real-time safety.

Requirements:

- no heap allocation in the audio callback
- fixed-capacity or grow-before-play voice arrays
- per-voice state reset on reuse
- predictable voice stealing policy

---

# 5. Mapping Engine

## 5.1 2D Mapping Space

The core mapping view is a two-dimensional grid:

- X axis: keyboard / pitch
- Y axis: velocity

Zones are rectangles on this grid.

The UI must support:

- drag-to-move
- drag-to-resize
- shaded crossfade regions
- overlap highlighting
- multi-select editing
- batch assignment
- automatic mapping from filenames and metadata

## 5.2 Overlapping Zones

When multiple zones overlap for the same note and velocity, selection is determined by:

- key/velocity match
- articulation state
- trigger condition
- round robin state
- randomization policy
- priority
- crossfade gains

Do not hard-switch unless explicitly requested.

---

# 6. Velocity Crossfades

Use equal-power crossfades for overlapping velocity layers.

For velocity `v` within crossfade range `[v_min, v_max]`:

$$
G_1(v) = \cos\left(\frac{\pi}{2} \cdot \frac{v - v_{min}}{v_{max} - v_{min}}\right)
$$

$$
G_2(v) = \sin\left(\frac{\pi}{2} \cdot \frac{v - v_{min}}{v_{max} - v_{min}}\right)
$$

Benefits:

- smoother transition between layers
- avoids the audible dip of linear fading
- preserves perceived energy across dynamic transitions

UI requirement:

- render crossfade areas as visible gradients between adjacent zones
- support independent fade-in and fade-out boundaries per zone

---

# 7. Trigger Logic and Articulation Control

Crumb should avoid relying on a scripting language for common instrument behavior.

Instead, use declarative trigger systems.

## 7.1 Required Trigger Behaviors

- note-on regions
- release-trigger regions
- legato-only regions
- keyswitch-based articulation
- round robin
- random choice with weighting
- cycle / sequence
- mute groups / choke groups
- velocity-conditioned alternates

## 7.2 Group-Level Trigger Logic

A `Group` or equivalent articulation container should own logic such as:

- `seq_length`
- `seq_position`
- random weighted alternatives
- `off_by` / choke-group behavior
- articulation filters
- repetition avoidance

---

# 8. Playback Modes

Crumb should support multiple playback modes, but they should share as much of the core voice engine as possible.

## 8.1 Required Modes

### One-Shot

- ignores note-off for transport until playback ends or special event occurs
- optionally still applies release envelope if explicitly configured

### Classic Gated

- sustain while key is held
- release on note-off through ADSR or release sample logic

### Slice

- single file divided into slice markers
- MIDI notes or pads trigger slices
- supports sequential and pitched slice modes

### Granular

- live grain scheduler over a source buffer
- adjustable grain size, density, spray, position, pitch, and envelope

### Warp / Tempo-Sync

- time-stretch and pitch handling decoupled
- host-tempo-aware if metadata or analysis provides timing

### Reverse / Alternate Direction

- reverse read or ping-pong loop modes where appropriate

---

# 9. Resampling and Interpolation

Resampling quality is one of the main determinants of sampler sound quality.

## 9.1 Quality Tiers

| Mode          | Mechanism                         | Primary Use                                            |
| ------------- | --------------------------------- | ------------------------------------------------------ |
| Linear        | 2-point interpolation             | lowest CPU, draft playback, extreme polyphony fallback |
| Cubic Hermite | 4-point polynomial interpolation  | default playback sweet spot                            |
| Windowed Sinc | band-limited kernel interpolation | highest quality, premium playback, offline or HQ mode  |

## 9.2 Linear

Pros:

- cheapest CPU
- simple
- stable

Cons:

- duller high end
- more image/alias artifacts at larger pitch shifts
- poorer transient preservation

## 9.3 Cubic Hermite

Use a 4-point Hermite or Catmull-Rom-family interpolator as the default general-purpose mode.

Generic form:

$$
y(t) = a_0 t^3 + a_1 t^2 + a_2 t + a_3
$$

Where:

- `t` is the fractional position between source samples
- coefficients are derived from four neighboring points

This is the best everyday tradeoff between CPU and quality.

## 9.4 Windowed Sinc

Use a truncated sinc kernel with an appropriate window such as:

- Blackman-Harris
- Kaiser
- Hann

Guidelines:

- 32-tap or 64-tap kernels for real-time HQ
- larger kernels for offline rendering if needed
- polyphase tables recommended for speed

Use this as:

- premium playback mode
- offline bounce / freeze mode
- critical solo instrument mode

Do not describe sinc as free or universally required; it is the highest-quality option, not the only professional option.

---

# 10. Anti-Aliasing Strategy

Pitching samples upward can produce aliasing if the source is not adequately band-limited.

## 10.1 Multi-Resolution Source Pyramids

Use mip-style prefiltered source pyramids or multiband source caches where practical.

Concept:

- precompute lower-bandwidth versions of the source
- choose the appropriate source band for current playback ratio
- still run through quality interpolation on top

This substantially reduces aliasing risk, especially for large upward transpositions.

Do not claim it makes aliasing impossible by itself. It is part of a larger resampling strategy.

## 10.2 Offline vs. Real-Time Quality

Suggested modes:

- **Draft**: linear or cubic
- **Standard**: cubic with optional prefilter banks
- **High Quality**: sinc + source pyramids
- **Offline Render**: longest kernel / best-quality path

---

# 11. Warping and Time-Stretching

## 11.1 Engine Strategy

Crumb should support more than one warp strategy.

Recommended architecture:

- transient-oriented warp for drums and loops
- high-quality tonal/polyphonic engine for pitched material
- granular texture mode for ambient and experimental use

## 11.2 Signalsmith Stretch Integration

For premium tonal/polyphonic stretching, use **Signalsmith Stretch** or an equivalent engine with similar quality goals.

Implementation guidance:

- treat it as the high-quality warp path
- do not assume it is the right answer for every content type or every stretch factor
- strongest results are typically at moderate time-stretch ratios
- use separate policies for drums, vocals, tonal instruments, and textures

## 11.3 Warp Policies

Crumb can expose user-facing policies similar to:

- **Beats** — transient-oriented, rhythm-preserving
- **Tones** — stable monophonic or clearly pitched material
- **Texture** — smear-tolerant and granular/stochastic
- **Complex** — polyphonic material, best fidelity, highest CPU

These are user-facing behaviors; internally they may dispatch to different engines or parameter sets.

## 11.4 Tonality Limit

For pitch shifting, support a configurable tonality limit or equivalent top-end protection strategy.

Purpose:

- keep upper-frequency content closer to original positions
- reduce unnatural movement of hiss, sibilance, or brittle percussion detail
- preserve timbral realism during strong pitch moves

---

# 12. Slice Engine

## 12.1 Onset Detection

Use spectral-flux-based onset detection as the default auto-slice method.

$$
SF(t) = \sum_k |X(t, k) - X(t-1, k)|^2
$$

Where:

- `X(t, k)` is magnitude of bin `k` at frame `t`

This works well for:

- drums
- percussive loops
- transient-rich phrases

## 12.2 Slice Data Model

Each slice marker should store:

- frame index
- optional transient confidence
- optional tempo-grid anchor
- gain trim
- pad assignment
- output route
- playback mode override

## 12.3 Slice Triggering

Support:

- chromatic slice mapping
- pad mapping
- one-shot slice playback
- gated slice playback
- sequential step-through mode
- host-quantized triggering

---

# 13. Granular Engine

## 13.1 Core Parameters

- grain size
- density
- spray / randomness
- position
- position drift
- pitch offset
- grain envelope
- stereo spread
- direction
- freeze

## 13.2 Design Constraints

- grains must be envelope-shaped to avoid clicks
- scheduler must be sample-accurate or block-accurate with deterministic sub-block offsets
- CPU scaling must degrade gracefully at high densities
- freeze should work on both static sample assets and warped buffers

## 13.3 Recommended Grain Windows

- Hann
- Gaussian
- Tukey for sharper articulation if desired

---

# 14. Analysis Engine

## 14.1 Root Note Detection

Use automatic pitch analysis when imported samples lack usable metadata.

A practical option is **pYIN** or an equivalent robust F0 detector.

Requirements:

- confidence score
- monophonic-note suitability detection
- fallback to filename parsing or manual assignment
- avoid forcing root-note guesses onto clearly noisy or percussive material

## 14.2 Tempo and BPM Detection

For loop material:

- detect transient periodicity and BPM candidates
- allow user confirmation rather than silently forcing stretch assumptions
- support manual override at all times

## 14.3 Silence and Trim Detection

Auto-detect:

- leading silence
- trailing silence
- probable note start
- fade suggestions

All edits remain non-destructive.

---

# 15. Non-Destructive Editing

All destructive-sounding operations must actually be metadata edits unless the user explicitly renders or commits.

Store as metadata:

- start/end offsets
- fades
- reverse flags
- normalize gain
- gain trim
- loop points
- slice markers
- warp anchors
- phase-alignment hints

The original sample asset remains read-only.

---

# 16. Looping System

## 16.1 Loop Modes

Support:

- forward
- ping-pong
- reverse
- no loop

## 16.2 Zero-Crossing Assistance

Provide automatic snapping to nearby zero crossings, but do not rely on zero crossing alone as the only click-prevention method.

Use a hybrid strategy:

- zero-cross hinting
- short crossfade loops
- correlation-guided loop-point search
- optional waveform phase matching

## 16.3 Crossfade Looping

Support loop crossfades in a practical range such as:

- short: 16–128 samples
- medium: 128–1024 samples
- long: 1024+ when needed for difficult material

The UI should display:

- start point
- end point
- overlap length
- live audition
- phase/correlation assistance

---

# 17. Release Triggers and Legato Polish

Release behavior matters for realism.

## 17.1 Release Samples

Release samples should support:

- velocity-scaled release triggering
- pedal-aware logic
- random alternates
- articulation-aware routing

## 17.2 Release Alignment

Do not simply slam release samples at arbitrary waveform peaks.

Use one or more of:

- short zero-cross search window
- short handoff crossfade
- phase/correlation alignment
- envelope-matched release onset

Goal:

- avoid clicks and thumps
- avoid musically obvious note-off lag

## 17.3 Legato and Transition Logic

For monophonic articulations, optionally support:

- legato transition samples
- re-trigger suppression
- glide/portamento policy
- phrase-aware articulation switching

---

# 18. Modulation System

## 18.1 Philosophy

Use a drag-and-drop, visual-first modulation system.

Every modulated parameter should visibly indicate:

- modulation source
- range
- polarity
- current position

## 18.2 Scopes

Support modulation at three scopes:

- **Voice-level** — per-note envelopes/LFOs
- **Group-level** — shared articulation/group modulators
- **Global-level** — instrument-wide macros and modulators

## 18.3 Required Sources

- Amp ADSR
- Mod ADSR
- LFOs
- velocity
- key tracking
- random / per-note random
- mod wheel
- aftertouch
- macros
- round-robin index or alternation state
- tempo sync clock divisions

## 18.4 Parameter Transport

Use a lock-free or snapshot-safe parameter distribution model.

Requirements:

- UI changes must not block audio
- modulation targets resolve to precomputed target lists where possible
- smoothing applied where zipper noise would occur

---

# 19. Effects Architecture

Crumb should reuse shared DSP infrastructure from `daw-dsp`.

## 19.1 Effect Placement

Support:

- per-zone inserts
- per-group inserts
- master inserts
- send effects
- multi-output routing to DAW channels

## 19.2 Practical Defaults

Typical placements:

- Zone: corrective gain, rare sample-specific saturation or EQ
- Group: filter, drive, dynamics, character shaping
- Master: glue, spatialization, final protection

## 19.3 State Ownership

Effects themselves are DSP modules, but time-varying state should be owned in the runtime context that instantiates them.

For example:

- delay lines belong to active runtime processors
- filter coefficient caches belong to the instantiated processor state
- shared immutable config belongs to patch description

---

# 20. Import and Interoperability

## 20.1 Primary Open Format: SFZ

SFZ is the main import target.

Required headers to support:

- `<global>`
- `<control>`
- `<group>`
- `<region>`

Required opcode families include at minimum:

- sample path
- key ranges
- velocity ranges
- root note / pitch center
- tune
- loop mode / start / end
- envelopes
- round robin sequence
- mute / choke groups
- release triggers
- crossfades where possible

## 20.2 SFZ Mapping

| SFZ Opcode                    | Internal Target              |
| ----------------------------- | ---------------------------- |
| `sample`                      | `sample` asset reference     |
| `lokey` / `hikey`             | key range                    |
| `lovel` / `hivel`             | velocity range               |
| `pitch_keycenter`             | root note                    |
| `tune`                        | tune cents                   |
| `loop_mode`                   | loop mode                    |
| `loop_start` / `loop_end`     | loop points                  |
| `seq_length` / `seq_position` | round-robin / sequence logic |
| `group` / `off_by`            | choke / exclusive groups     |
| `ampeg_*`                     | amp envelope                 |

Support inheritance correctly:

- `<global>` applies broadly
- `<group>` applies until replaced
- `<region>` overrides at leaf level

## 20.3 Other Imports

Best-effort import support should be provided for:

- EXS / Logic Sampler legacy mappings
- Decent Sampler-style XML definitions
- plain folder auto-map
- drag-and-drop WAV/AIFF/FLAC imports

These importers do not need to preserve every feature perfectly on first release, but the mapping fidelity for core ranges, loops, tuning, and trigger behavior should be strong.

---

# 21. Intelligent Automapping

## 21.1 Filename Parsing

Use filename heuristics to infer:

- note names
- velocity layers
- round-robin indices
- articulation tags
- BPM tags
- mic positions
- left/right channel markers

Examples of recognized patterns may include:

- note names like `C3`, `F#2`
- velocity tags like `v1`, `vel80`
- round-robin tags like `rr2`, `take3`
- tempo tags like `120bpm`

## 21.2 Automap Workflow

Dragging a folder into the mapping grid should optionally perform:

1. filename parse
2. metadata scan
3. root-note inference
4. tempo detection for loops
5. zone creation
6. suggested crossfades or layer groups

The user must be able to accept, inspect, and correct the result quickly.

---

# 22. Disk Streaming

## 22.1 Direct-From-Disk Strategy

Large libraries should use direct-from-disk playback with attack preloading.

Workflow:

- preload initial attack chunk into RAM
- begin playback immediately from preload region
- stream remainder asynchronously in the background
- maintain per-voice streaming state without blocking the audio thread

## 22.2 Preload Buffer

Use configurable attack preloads, for example:

- 64 KB
- 128 KB
- 256 KB

The correct size depends on:

- format
- compression
- expected drive performance
- instrument type

## 22.3 Buffering Strategy

Use:

- SPSC ring buffers or equivalent lock-free queues
- double-buffer or multi-buffer streaming per active voice or stream slot
- read-ahead scheduling
- underrun detection and graceful fallback

Do not perform file I/O on the real-time audio thread.

## 22.4 Sample Pooling

Use a global sample pool so that:

- repeated references to the same asset are not loaded repeatedly
- preload regions can be shared where safe
- decoded cache ownership is explicit

---

# 23. Web / WASM Considerations

Web-targeted builds should not assume native disk semantics.

Design the web path around:

- load-to-memory for small and medium assets
- chunked fetch or approved storage APIs where available
- explicit memory budgeting
- purge controls
- progressive decode/load indicators

The UI should expose:

- current memory usage
- purge unused assets
- unload inactive layers
- quality mode changes for constrained environments

---

# 24. Voice Management

## 24.1 Voice Count

Crumb should be engineered for very high voice counts, but the exact maximum depends on:

- playback mode
- interpolation quality
- effects
- warp/granular usage
- streaming load
- platform target

Do not promise a fixed extreme number independent of context.

## 24.2 Voice Stealing Policy

Use musically aware voice stealing.

Factors:

- envelope stage
- audibility
- age
- release state
- note priority
- sustain pedal state
- articulation importance

Common policy:

- steal quietest or oldest releasING voice first
- avoid stealing fresh attacks if possible

---

# 25. UI Architecture

## 25.1 Design Goal

Crumb must feel immediate for simple tasks and deep for expert tasks.

The interface should follow a strict progressive-disclosure model.

## 25.2 Interaction Principles

- keep casual workflows shallow
- make mapping visually obvious
- make advanced routing visible only when needed
- show modulation rather than hiding it in menus
- allow drag-and-drop import everywhere it makes sense

---

# 26. Five-Level Progressive Disclosure

## Level 1 — Play

Purpose:

- load and perform quickly

Show:

- waveform thumbnail or macro display
- preset browser
- 8 macros
- obvious playback controls
- basic amplitude controls
- performance-safe controls only

## Level 2 — Shape

Purpose:

- edit a single sound quickly

Show:

- large waveform
- start/end/loop markers
- amp envelope
- filter
- one or two core effect slots
- dominant zone only if the patch is complex

This should feel like a “single-sample instrument” view.

## Level 3 — Build

Purpose:

- create multisampled instruments

Show:

- 2D key/velocity mapping grid
- layer management
- group editor
- round robin controls
- automapping tools
- crossfade visuals
- batch-edit tools

## Level 4 — Route

Purpose:

- expose output and signal topology

Show:

- insert/send chains
- multi-output matrix
- per-group routing
- signal-path activity indicators
- output meter bridge

## Level 5 — Lab

Purpose:

- expert and diagnostic workspace

Show:

- resampler selection
- warp-engine options
- loop correlation tools
- release alignment diagnostics
- SFZ/XML editor
- vintage emulation / reduced-rate modes
- memory and streaming diagnostics
- developer-level import/debug views

---

# 27. WebGPU Visualization

## 27.1 Responsibilities

Use WebGPU for:

- waveform rendering
- min/max waveform decimation display
- spectrum and transient visualization
- mapping-grid rendering
- modulation rings
- loop-correlation overlays
- activity meters

## 27.2 Buffer Rules

Do not rely on mapped GPU buffers being simultaneously available for GPU commands.

Use:

- staging uploads
- queue writes
- double/triple buffering
- compact analysis snapshots from Rust
- decimated visual data instead of raw full-resolution PCM where appropriate

## 27.3 Modulation Ring Rendering

Knobs and modulation rings should be GPU-rendered primitives rather than DOM-heavy widgets where possible.

A fragment-shader or vector-based GPU approach is preferred for:

- smooth animation
- many simultaneous modulation indicators
- low CPU cost

Example structure:

```wgsl
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let dist = length(in.uv - vec2f(0.5, 0.5));
    let angle = atan2(in.uv.y - 0.5, in.uv.x - 0.5);

    let ring_mask =
        smoothstep(0.40, 0.41, dist) -
        smoothstep(0.45, 0.46, dist);

    let arc_mask = calculate_arc(angle, uniforms.mod_start, uniforms.mod_end);
    let mix_amount = arc_mask * ring_mask;

    return mix(uniforms.base_color, uniforms.mod_color, mix_amount);
}
```

This is illustrative; exact shader design can vary.

---

# 28. React 19 Frontend Strategy

Use React 19 for UI orchestration and progressive disclosure.

Guidelines:

- urgent knob and marker drags must stay responsive
- large waveform, browser, and mapping-grid updates can run in lower-priority paths
- import and analysis tasks should expose pending states without freezing interaction
- batch operations should be interruptible from the UI perspective when practical

Suggested split:

- urgent lane: drag handles, note audition, macro movement
- transition lane: waveform redraw, search results, grid refresh
- async lane: import, analysis, sample scan, disk/cache preparation

---

# 29. Secret-Sauce Polish

## 29.1 Loop Correlation Assistant

For hard-to-loop material:

- analyze similarity near loop start/end
- suggest small marker shifts to maximize correlation
- combine with short crossfades
- expose audition tools in place

## 29.2 Dynamic Velocity Curves

Support user-selectable velocity response curves:

- linear
- exponential
- logarithmic
- S-curve

These curves should be patch-configurable and optionally per-group.

## 29.3 Spectral Morphing Across Dynamics

Optionally provide a timbral-morph layer that interpolates between analyzed spectral fingerprints of different dynamic layers.

This can be used to:

- smooth dynamic changes
- create expressive macro-driven timbre motion
- compress the number of required velocity layers in some workflows

This is an advanced feature, not a first-release requirement.

## 29.4 Vintage Character Modes

Optional Lab features:

- reduced bit depth
- reduced sample rate
- simple converter coloration
- looped-memory emulation
- early-digital interpolation mode

These should be clearly separated from the high-fidelity default path.

---

# 30. Import, Analysis, and Authoring Workflow

The fastest end-to-end workflow should be:

1. drag samples into Crumb
2. auto-detect notes / tempo / slices where relevant
3. auto-place zones on the grid
4. suggest crossfades and groups
5. audition immediately
6. refine in Shape or Build view
7. save as reusable patch

The system should minimize manual clerical work.

---

# 31. Performance Requirements

## 31.1 Audio Thread

Never do the following on the audio thread:

- heap allocations
- file I/O
- blocking locks
- parser execution
- heavy sample decoding
- large FFT plan construction
- GPU waits

## 31.2 Background Work

Allowed on worker threads:

- sample decode
- waveform analysis
- pYIN / onset analysis
- import parsing
- mip/pyramid construction
- disk read-ahead
- large visual decimation
- preset indexing

## 31.3 Quality Scaling

Crumb must scale quality intelligently based on:

- platform
- voice count
- playback mode
- output buffer size
- streaming stress
- UI activity

Examples:

- downgrade sinc to cubic under overload if permitted
- reduce visual refresh rate before compromising audio
- switch web builds to memory-safe defaults

---

# 32. Validation and QA

## 32.1 DSP Validation

Validate:

- zone selection correctness
- crossfade energy continuity
- resampler quality and alias behavior
- loop click suppression
- slice onset accuracy
- warp timing integrity
- granular density stability
- release trigger alignment
- streaming underrun handling

## 32.2 UX Validation

Validate:

- Level 1 requires no expert knowledge
- common editing remains fast
- mapping overlaps are understandable visually
- automap is correct often enough to build trust
- advanced views are discoverable without cluttering beginner flow

## 32.3 Performance Validation

Validate:

- no audio-thread allocation
- stable behavior under high polyphony
- graceful degradation under memory pressure
- no UI-induced crackles
- web build stays within practical browser memory limits

---

# 33. Implementation Plan

## Phase 1 — Core Playback

1. asset pool
2. zone mapping
3. voice pool
4. linear + cubic resampling
5. ADSR
6. basic loop playback
7. one-shot and gated modes

## Phase 2 — Editing and Mapping

1. waveform editor
2. 2D key/velocity grid
3. automap
4. zero-cross and loop crossfades
5. root-note and onset analysis

## Phase 3 — Streaming and Scale

1. global sample pool
2. preload buffers
3. direct-from-disk streaming
4. voice stealing
5. multi-output routing

## Phase 4 — Advanced Modes

1. slicing
2. granular
3. warp / tempo sync
4. release triggers
5. round robin / articulation logic

## Phase 5 — Modulation and FX

1. drag-and-drop modulation
2. visual modulation rings
3. group/master FX
4. macros
5. output matrix

## Phase 6 — Interoperability and Lab

1. SFZ import
2. additional legacy/XML imports
3. Lab diagnostics
4. vintage modes
5. developer editors

---

# 34. Minimal Build Summary

If an AI agent needs the shortest faithful implementation brief, use this:

1. Build Crumb as a Rust sampler engine with immutable patch data and stateful runtime voices.
2. Use a five-level hierarchy: Instrument, Layer, Group, Zone, Sample Asset.
3. Build a 2D key/velocity mapping grid with overlap-aware equal-power crossfades.
4. Use cubic Hermite as the default resampler and windowed sinc as the highest-quality mode.
5. Support one-shot, gated, slice, granular, warp, and loop-based playback.
6. Add pYIN-style root-note detection, spectral-flux slicing, and filename-driven automapping.
7. Keep editing non-destructive and store trims/loops/warps as metadata.
8. Implement direct-from-disk streaming with attack preloads and lock-free buffering.
9. Support SFZ import as the main open format target.
10. Expose the system through progressive disclosure: Play, Shape, Build, Route, Lab.
11. Use WebGPU for waveform, mapping, and modulation visualization without compromising the audio thread.
12. Optimize for real-time safety first, then scale up with warp, granular, streaming, and premium-quality resampling.

---
