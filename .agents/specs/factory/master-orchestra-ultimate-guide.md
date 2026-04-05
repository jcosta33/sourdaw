# The Orchestral Suite: Ultimate Implementation Guide

> **Codebase Annotation:** Levain currently exists in the codebase as a sampler plugin (`crates/daw-dsp/src/levain`), but it is a basic multi-sampler lacking the true legato engine, continuous expression modeling, spatial mic mixing, and physical modeling augmentation detailed below. The Orchestral Suite spec is **Partially Implemented (Foundation only)**.

## What this document is

This is the consolidated implementation guide for a world-class orchestral instrument engine. It merges deep research on reference libraries, DSP architecture, articulation systems, expression handling, physical modeling augmentation, and spatialization into a single source of truth. The UX follows the same progressive-disclosure philosophy as the master synth: complexity is always available, never forced.

**Critical distinction from the synth:** The orchestral suite is primarily a **sample playback and performance intelligence engine**, not a synthesis engine. The quality ceiling depends on (1) the quality of recorded samples (an asset problem, not a code problem) and (2) the intelligence of the playback engine — legato transitions, expression mapping, articulation switching, release triggers, round-robin management. The code must make great samples sound like a real performance.

The design centers around a **section + voice engine** where each voice can combine structured sampling, procedural layers, expressive control mapping, and space.

---

## Reference libraries: what makes each one best-in-class

### Spitfire Audio BBC Symphony Orchestra Professional

- **True recorded legato**: musicians physically play from note A to note B at multiple dynamics. The actual bowed/blown transition is recorded, not crossfaded.
- **344 articulation techniques** across all instruments — deepest articulation coverage in any single library. **45 legato patches** specifically.
- **12 microphone positions**: Close, Leader, Tree (Decca tree), Ambient, Outrigger, Gallery, Balcony, Spill, Stereo, plus section-specific positions.
- **Release triggers**: separate "key-off" samples — bow lift, finger release, key noise, breath stop.
- **Multiple dynamic layers** per articulation, crossfaded via CC1 for continuous dynamic control independent of velocity.
- **Round robins**: multiple recordings of the same note at the same dynamic, cycled to avoid the "machine gun" effect.
- **Expression model**: velocity = attack character; CC1 = sustained dynamic; CC11 = volume.

**Take**: true legato sampling methodology, release triggers, 5+ mic positions, velocity+CC1+CC11 expression model, round-robin cycling.

### Vienna Symphonic Library Synchron Player

- **Synchronized stage positioning**: all instruments recorded on the same stage with consistent spatial relationships.
- **Dimension control**: crossfade between section sizes (4 players to 8 to 14 to full).
- **Humanization engine**: automatic timing, tuning, and dynamic variations per note.
- **Mir Pro integration**: convolution reverb with measured IRs from real halls, with per-instrument positioning.

**Take**: consistent stage positioning, humanization engine, section size control, virtual stage with convolution reverb.

### Cinematic Studio Series (CSS/CSB/CSW)

- **Playability**: the legato engine is widely considered the most natural-feeling to play in real-time.
- **Adaptive legato**: transition speed varies based on playing speed. Fast passages use quick transitions; slow passages use longer, more expressive ones.
- **Simple, focused articulation set**: ~15 essential articulations per instrument that cover 90% of scoring needs.

- **First-chair / ensemble separation**: solo instruments and ensemble patches complement each other with consistent tone.

**Take**: adaptive legato based on playing speed, focused articulation set prioritizing playability, first-chair/ensemble tonal consistency.

### EastWest Hollywood Orchestra Opus

- **Deep sampling**: massive library with extensive chromatic coverage.
- **Diamond mic positions**: multiple mic position system for spatial control.
- **Comprehensive articulation coverage** across all orchestral families.

**Take**: deep sampling methodology, Diamond mic position concept as a reference for multi-mic architecture.

### CineOrchestra / CineSamples

- **Cinematic sound**: optimized for film/TV scoring use cases.
- **Kontakt-based**: reference for scripting and articulation switching patterns.

### Audio Modeling SWAM

- **Physical modeling, not sampling**: mathematical models of instrument acoustics (string vibration, bow interaction, tube resonance, reed behavior).
- **Infinite variation**: every note uniquely generated. No RR limits, no velocity layer boundaries.
- **Continuous expression**: every parameter responds in real-time — bow pressure, bow speed, vibrato depth/rate, breath pressure.
- **Tiny footprint**: ~100MB per instrument vs 20-100GB for sample libraries.
- **Limitations**: doesn't match timbral realism of top-tier samples for ensemble sounds. CPU-intensive.

**Take**: physical modeling as an augmentation layer for vibrato, bow noise, breath noise, and articulation transitions. Hybrid approach: samples provide core timbre, physical models add continuous variation.

### Logic Pro Studio Strings / Horns / Woodwinds

- **Deep DAW integration**: articulation sets, smart controls, Drummer integration.
- **Articulation ID system**: each note carries an articulation ID as metadata, not a separate MIDI event. Cleaner than raw keyswitching.
- **Studio Strings true legato** with portamento/fingered transitions, controlled by velocity on the overlapping note.
- **Good-enough quality for demos and many final productions** at zero additional cost — demonstrates why a built-in orchestral engine matters even with lower sample quality than premium libraries.

**Take**: articulation ID system (superior to raw keyswitching), tight DAW integration patterns, smart controls concept for macro knob design.

---

## Technology constraints

- Rust, compiles to native + WASM
- Lives in `daw-sampler` crate (or module within `daw-synth`), depends on `daw-dsp` for shared effects, `daw-core` for types
- Exposes: `fn process(midi_events: &[MidiEvent], output: &mut [&mut [f32]], block_size: usize)`
- No I/O in the processing path — sample data pre-loaded or streamed via background thread
- Audio hot path: allocation-free, lock-free, syscall-free
- WebAudio render quantum defaults to 128 frames; implementations caution that the size may be configurable in the future, so always treat block size as variable and read buffer length at runtime
- Native: `cpal` callback on a dedicated high-priority thread
- UI/control changes arrive via SPSC ring buffers (drop messages rather than block)

### Open-ended parameters (compile-time for WASM, runtime for native)

- Max polyphony: `MAX_VOICES_NATIVE` (e.g., 512) / `MAX_VOICES_WASM` (e.g., 32-64)
- Max mic positions per instrument: `MAX_MICS` (e.g., 2-8)
- Max velocity layers: `MAX_VEL_LAYERS` (e.g., 4-12)
- Round-robin count per articulation: `MAX_RR` (e.g., 2-12)
- Legato interval coverage: `MAX_INTERVALS` (e.g., +/-12 semitones; larger via DSP fallback)
- FFT sizes for analysis/resynthesis: 1024-8192 (quality tier dependent)
- IR lengths: up to tens of seconds; partition sizes product-tunable

### Native vs Web sample memory

- **Native**: DFD-style streaming. Load the attack (first 64-240KB) into RAM, stream the remainder from disk via background thread. `creek` crate or equivalent for async file reading.
- **Web/WASM**: No disk streaming inside AudioWorklet. Preload samples in memory, enforce hard caps via LOD strategies:
    - Mic LOD (disable ambient mics first)
    - Velocity layer LOD (reduce to 2-4)
    - RR LOD (reduce RR count)
    - Articulation LOD (disable interval transitions on large sections)
    - Alternative: progressive loading where samples are fetched and decoded incrementally as needed

---

## Crate architecture and real-time dataflow

### `daw-core`

- Newtypes: `SampleRate`, `Samples`, `Seconds`, `Beats`, `Decibels`, `Hertz`, `VoiceId`, `InstrumentId`, `ArticulationId`, `MicId`, `ZoneId`, `ParamId`
- Host timing abstraction: block timestamp and musical time mapping (tempo map, PPQ)

### `daw-dsp`

- Stateless math primitives plus stateful DSP objects, fixed-size and allocation-free once constructed:
    - Resamplers (linear / cubic Hermite / windowed-sinc tables)
    - Filters: RBJ biquad (using the W3C-hosted Audio EQ Cookbook), SVF (TPT/ZDF) and ladder-derived models informed by Vadim Zavalishin's "The Art of VA Filter Design" (rev 2.1.0)
    - Envelope and smoothing primitives (one-pole, piecewise exponential)
    - Delay lines, fractional delay interpolators (linear, Lagrange, Thiran)
    - STFT windows and overlap-add scaffolding
    - Fast oscillators for additive/resynthesis (recursive sin/cos updates)

### `daw-synth` (orchestral engine module)

- Section/instrument racks, mic mixers, articulation script engine
- Voice allocator and voice stealing
- Modulation and expression mapping (MIDI CC + MPE)
- Pattern/phrase tools (SMF import, tempo map interpretation)
- FX routing and convolution engines
- Pure compute: `process(midi_events, output_buffers)` with no I/O

### `daw-engine`

- Native: `cpal` callback, real-time scheduling, ring buffers
- Web: AudioWorklet wrapper, ring buffer design patterns for WASM

### Control and parameter updates

- **Parameter registry**: table mapping `&'static str` to `ParamId` on UI side (perfect hash or sorted binary search). Never resolve strings on the audio thread.
- Audio side stores: `target[param_index]`, `smoothed[param_index]`, `dirty_flags[param_index]`
- Changes via SPSC queue: `SetParam { id: ParamId, value: f32 }`, `LoadPresetHandle { handle_id }`
- **Smoothing** (one-pole, per Smith's PAPS): `y[n] = y[n-1] + alpha * (x - y[n-1])`, `alpha = 1 - exp(-1/(tau * fs))`, tau tuned per parameter type (fast for modulation, slower for UI knobs)

---

## Sample organization and zone model

### Hierarchy

```
Instrument (e.g., "Violins 1")
  +-- Articulation (e.g., "Legato", "Spiccato", "Tremolo")
  |   +-- Dynamic Layer (pp, mp, mf, f, ff — typically 3-5)
  |   |   +-- Round Robin Group (RR1, RR2, RR3 — typically 3-6)
  |   |   |   +-- Sample Zone (key range + vel range -> .wav)
  |   |   |   |   root_note, lo_key, hi_key, lo_vel, hi_vel
  |   |   |   |   sample_start, sample_end, loop_start, loop_end
  |   |   |   |   loop_crossfade_length, tuning_offset_cents
  |   |   |   +-- ...more zones per recorded pitch
  |   |   +-- ...more round robins
  |   +-- ...more dynamic layers
  +-- Legato Transitions (special)
  |   +-- Transition Type (slurred, portamento, runs)
  |   |   +-- Interval (semitones: -12 to +12)
  |   |   |   +-- Dynamic Layer
  |   |   |   |   +-- Sample (recorded transition A->B)
  +-- Release Triggers
      +-- Dynamic Layer
          +-- Sample (note-off sound)
```

Zones are modeled with constraints similar to **SFZ** (because SFZ expresses many sampler invariants: region/group inheritance, ADSR opcodes, and round-robin sequencing via `seq_length`/`seq_position`). This allocation-free lookup approach mirrors the motivation behind allocation-free SMF parsing libraries like `midly`, which explicitly avoid allocations by referencing original bytes and separating I/O from parsing.

### Key dimension axes

- `note` (MIDI key)
- `velocity` (MIDI 0-127)
- `articulation_id` (sustain, staccato, spiccato, tremolo, trill, legato, etc.)
- `rr_index` (round robin)
- `mic_id` (close, tree, ambient, outriggers...)
- `variation` (optional: bow direction, breath noise variant)
- `release_trigger` (release sample vs sustain sample)

### Core data structures

```rust
pub type SampleId = u32;
pub type ZoneId = u32;
pub type ArticulationId = u16;
pub type MicId = u8;
pub type MicPositionId = u8;

#[derive(Clone, Copy)]
pub struct KeyRange { pub lo: u8, pub hi: u8 }
#[derive(Clone, Copy)]
pub struct VelRange { pub lo: u8, pub hi: u8 }

pub enum LoopMode { NoLoop, Forward, PingPong }

pub struct SampleRef {
    pub sample_id: SampleId,
    pub root_key: u8,
    pub tune_cents: i16,
    pub start: u32,
    pub end: u32,
    pub loop_mode: LoopMode,
    pub loop_start: u32,
    pub loop_end: u32,
    pub loop_crossfade: u32,
}

pub struct Zone {
    pub id: ZoneId,
    pub key: KeyRange,
    pub vel: VelRange,
    pub art: ArticulationId,
    pub rr_pos: u8,       // seq_position (SFZ semantics)
    pub rr_len: u8,       // seq_length
    pub mic: MicId,
    pub is_release: bool,
    pub sample: SampleRef,
    pub amp_env: AdsrParams,
    pub filter: FilterDefaults,
    // Per-mic-position sample variants
    pub mic_samples: [(MicPositionId, SampleId); MAX_MICS],
    pub mic_count: u8,
}

pub struct OrchestraInstrument {
    pub name: &'static str,
    pub instrument_type: InstrumentType,  // Strings, Brass, Woodwind, Percussion
    pub articulations: [Articulation; MAX_ARTICULATIONS],
    pub articulation_count: u16,
    pub legato_engine: LegatoEngine,
    pub release_triggers: ReleaseTriggerSet,
    pub mic_positions: [MicPosition; MAX_MICS],
    pub mic_count: u8,
    pub expression_config: ExpressionConfig,
    pub humanization: HumanizationConfig,
    pub key_range: (u8, u8),
}

pub struct Articulation {
    pub id: ArticulationId,
    pub name: &'static str,
    pub keyswitch: Option<u8>,
    pub dynamic_layers: [DynamicLayer; MAX_VEL_LAYERS],
    pub layer_count: u8,
    pub is_looped: bool,
    pub has_release_trigger: bool,
    pub attack_time_ms: f32,
    pub default_cc_curve: CCCurve,
}

pub struct DynamicLayer {
    pub dynamic: Dynamic,            // pp, p, mp, mf, f, ff
    pub velocity_range: VelRange,
    pub cc1_range: (f32, f32),       // for crossfading (0.0-1.0)
    pub round_robins: [RoundRobinGroup; MAX_RR],
    pub rr_count: u8,
}

pub struct LegatoTransition {
    pub interval: i8,                // semitones (new - old)
    pub transition_type: TransitionType,
    pub dynamic: Dynamic,
    pub sample_id: SampleId,
    pub crossfade_in_ms: f32,
    pub crossfade_out_ms: f32,
}

pub enum TransitionType {
    Slurred,      // Fingered: same bow, add/remove finger
    Portamento,   // Glide: slide between pitches
    Run,          // Fast passage: abbreviated transition
    Rip,          // Brass rip upward
    Fall,         // Brass fall downward
}

pub enum Articulation {
    Sustain, Staccato, Spiccato, Pizzicato,
    Tremolo, Trill { interval: i8 },
    Legato, Portamento, Marcato, Harmonics,
    // FX: flutter tongue, sul pont, sul tasto, col legno, etc.
}

pub struct ArticulationState {
    pub current: ArticulationId,
    pub keyswitch_map: [ArticulationId; 128],
    pub cc_map: [Option<ArticulationId>; 128],
    pub rr_counters: RrCounters,
}
```

### O(1) zone lookup

Build a precomputed LUT keyed by `(note, vel_bucket, articulation_id, mic_id)`:

```
zone_lut[art][mic][note][vel_bucket] -> ZoneListRef
```

`ZoneListRef` points into a preallocated zone list arena:

```rust
zone_list_arena: [ZoneId; MAX_ARENA]
zone_list_offsets: [u32; LUT_SIZE + 1]
```

On note-on:

1. Compute `vel_bucket`
2. Get slice of zone IDs
3. Pick round robin deterministically
4. Schedule voices

---

## Sample playback algorithm

For each active note, per audio block:

1. **Determine current articulation** from keyswitch state, articulation ID, or CC-based switching
2. **Determine dynamic layer** from CC1 (mod wheel) — NOT velocity. Velocity = initial attack character; CC1 = sustained dynamic level
3. **Select round robin** — cycle sequentially or weighted random with repetition avoidance
4. **Find sample zone** for current MIDI note within selected dynamic layer and RR group
5. **Read samples with pitch interpolation** (cubic Hermite default) for notes between recorded pitches
6. **Dynamic crossfading**: when CC1 moves between layers, crossfade between current and adjacent layer samples. Time: 50-200ms, equal-power curve
7. **Loop crossfading** for sustaining articulations: as playback approaches loop end, crossfade to loop start over 64-256 samples
8. **Mix mic positions** according to individual volume/pan settings
9. **Apply per-instrument effects** (EQ, reverb send, etc.)

### Resampling tiers

| Resampler     | Math                              | Quality | CPU     | Best use              | Anti-aliasing notes                 |
| ------------- | --------------------------------- | ------- | ------- | --------------------- | ----------------------------------- |
| Linear        | `y = (1-t)*x0 + t*x1`             | lowest  | lowest  | draft, noisy textures | droops HF; minimal ringing          |
| Cubic Hermite | 4-point polynomial                | high    | low-mid | default realtime      | good HF, stable                     |
| Windowed-sinc | `y = sum x[n]*sinc(pi(n-t))*w[n]` | best    | highest | offline render, solo  | can be bandlimited if designed well |

Smith's PAPS (Physical Audio Signal Processing) discussion of delay-line interpolation and windowed-sinc provides practical implementation details and highlights why naive interpolation affects frequency response. The interpolation taxonomy (linear, Lagrange/Farrow, windowed-sinc) is explicitly laid out there.

### Disk streaming (native only)

- **Preload buffer**: first 64-240KB (configurable) of every sample in RAM. Covers attack transient with zero latency.
- **Background streaming thread**: on note trigger, begins reading remainder into ring buffer.
- **Double-buffered**: two streaming buffers per voice. While one is read by audio thread, the other is filled by disk thread.
- **Priority queue**: streaming thread prioritizes active voices about to exhaust their preloaded buffer.
- **SSD assumption**: modern SSDs sustain 500MB/s+, supporting hundreds of simultaneous streams at 44.1kHz stereo (~176KB/s each).
- **WASM**: no disk streaming. "Web edition" with reduced samples (fewer RRs, fewer dynamic layers, shorter loops) fitting in ~500MB-1GB.

### Sample format

- Source: WAV or FLAC (losslessly compressed, ~60% of WAV size)
- Internal: decoded to 32-bit float PCM in memory
- Rate: 44.1kHz or 48kHz (matching session). Resample on load if mismatched using the `rubato` crate for high-quality sample rate conversion.
- Channels: mono or stereo per mic position, mixed at playback time
- Metadata: start/end, loop points, root note, tuning — stored in JSON/TOML manifest or embedded in WAV chunks

---

## Voice allocation

Orchestral voices are heavier than synth voices: multiple mic streams, crossfade layers, per-voice envelopes and filters.

### Voice pool

- WASM: small (32-64)
- Native: large (256-1024)

### Voice stealing priority

1. Voices in release tail beyond audibility threshold
2. Lowest-energy voices (RMS within last N samples)
3. Oldest voices

### Tail virtualization

When sustain pedal or long releases are active: freeze the tail into an auxiliary reverb send (or into a low-rate resynthesis tail) and free the voice earlier. Practical necessity under strict quantum budgets.

---

## Articulation system

### Switching methods (all supported simultaneously)

**Keyswitching**: dedicated MIDI notes (below playable range, typically C0-B0) switch active articulation. Supports latching (stays until another pressed) and momentary (reverts on release).

**Articulation IDs (Logic Pro approach)**: each MIDI note-on carries an articulation ID as metadata. Cleaner than keyswitching because it doesn't consume note data and survives transposition. Map IDs to internal articulations via configurable table. **Implementation**: encode articulation ID in a custom MIDI event or as a note attribute in the internal MIDI representation.

**Velocity-based switching**: different velocity ranges trigger different articulations (e.g., vel 1-60 = legato, vel 61-100 = sustained, vel 101-127 = marcato). Useful where attack character naturally varies with playing force. Configurable velocity split points per instrument.

**CC-based switching**: a dedicated CC (e.g., CC32) selects articulation by value range. Compatible with UACC (Universal Articulation Controller Channel) standard.

### Articulation scripting engine

A deterministic state machine running on the audio thread, driven by:

- MIDI events (note on/off)
- CC (mod wheel, expression, vibrato, bow pressure)
- Timers (time since last note, overlap duration)
- Velocity
- MPE per-note controls (optional)

### Essential articulations per section

**Strings (Violin, Viola, Cello, Double Bass — solo and ensemble)**

Sustained:

- **Long / Sustain**: standard bowed note with natural vibrato
- **Long (non-vibrato)**: colder, more exposed. For pp passages and contemporary music
- **Long (con sordino / muted)**: mute on bridge. Darker, softer, intimate
- **Flautando**: bowing near fingerboard with light pressure. Glassy, ethereal
- **Sul tasto**: over fingerboard. Similar to flautando but warmer
- **Sul ponticello**: near bridge. Harsh, glassy, metallic. Film scoring tension
- **Harmonics**: pure, bell-like overtones

Short:

- **Spiccato**: bouncing bow, short and articulate. Default "short note"
- **Staccato**: shorter and more defined than spiccato, bowed with stop
- **Staccatissimo**: extremely short
- **Pizzicato**: plucked string. Completely different timbre, separate samples
- **Bartok pizzicato (snap)**: string pulled and snapped against fingerboard. Violent, percussive
- **Col legno**: hitting string with bow wood. Dry, percussive click

Repeated/Rhythmic:

- **Tremolo**: rapid back-and-forth bowing. Measured (in tempo) or unmeasured
- **Trills**: rapid alternation between adjacent notes. Half-step and whole-step variants

Legato:

- **Slurred (fingered)**: change note without changing bow direction
- **Portamento**: slide between notes. Triggered by lower velocity or CC
- **Runs**: fast passages with abbreviated transitions

**Brass (Trumpet, Horn, Trombone, Tuba — solo and ensemble)**

Sustained:

- **Long / Sustain**: standard with natural vibrato
- **Long (non-vibrato)**: more "military" or "heroic"
- **Long (muted)**: straight mute, cup mute, harmon mute (with and without stem — each produces a different timbre), plunger mute
- **Crescendo / Decrescendo**: notes that swell or fade (recorded as complete gestures)
- **Sforzando**: loud accent attack followed by immediate drop to sustain

Short:

- **Staccato**, **Staccatissimo**, **Marcato**

Effects:

- **Rips**: upward glissando into a note
- **Falls**: downward glissando away
- **Shakes / Doits**: lip trills and bends
- **Flutter tongue**: rapid tongue-roll creating growling tremolo
- **Muted variants**: straight mute, cup mute, harmon mute (with and without stem), plunger mute — each produces a distinctly different timbre. Essential for jazz/film brass writing.

Legato:

- **Slurred**: smooth without re-tonguing
- **Tongued**: re-articulated with tongue
- **Lip trills**: rapid alternation between harmonics

**Woodwinds (Flute, Oboe, Clarinet, Bassoon, Piccolo, English Horn, Bass Clarinet, Contrabassoon)**

Sustained:

- **Long**, **Long (vibrato / non-vibrato)**, **Long (overblown)**, **Multiphonics**

Short:

- **Staccato**, **Staccatissimo**, **Kiss / Pop** (breathy attack for flute)

Effects:

- **Flutter tongue**, **Trills**, **Runs / Arpeggios**, **Key clicks**, **Overblowing**

Legato:

- **Slurred**, **Tongued legato**, **Speed-dependent** (fast passages auto-use shorter transitions)

**Percussion (Timpani, Snare, Bass Drum, Cymbals, Glockenspiel, Xylophone, Marimba, Vibraphone, Celesta, Tubular Bells, Tam-tam, Triangle, Castanets, Tambourine, etc.)**

- Hit types vary per instrument. Timpani: soft/hard mallet, roll, dampened. Snare: center, rimshot, rim click, buzz roll, flam.
- **8-16 velocity layers** required — timbral change with dynamic is extreme (soft timpani sounds completely different from loud, not just quieter)
- **Round robins essential** for rolls and repeated hits
- **Rolls**: recorded as sustained samples with loop points, or triggered as fast repeated hits
- **Dampening / muting**: hand-dampened after hit, or allowed to ring. Release trigger for dampening sound

**Choir / Vocals (stretch goal)**

- Vowel sounds (Ah, Eh, Ee, Oh, Oo) — each a separate articulation or crossfadable via CC for smooth vowel morphing
- Common choral syllables for building words; staccato syllables for short vocal attacks
- Humming (closed-mouth sustained)
- CC1-controlled dynamics with 5+ layers
- Divisi: splitting sections (e.g., sopranos into Sop 1 and Sop 2) for harmonic parts
- Word-builder (stretch goal): assemble syllables into words via text input — extremely complex; reference implementations include EastWest WordBuilder and Soundiron Requiem

### Articulation presets

Pre-configured maps per instrument. Example for "Violins 1 — Standard":

```
C0  -> Long (sustain with vibrato)
C#0 -> Long (non-vibrato)
D0  -> Tremolo
D#0 -> Trills (half-step)
E0  -> Spiccato
F0  -> Staccato
F#0 -> Pizzicato
G0  -> Legato
G#0 -> Legato (portamento)
A0  -> Con sordino
A#0 -> Flautando
B0  -> Col legno
```

Users should be able to create custom articulation maps.

---

## Expression and dynamics

### The CC1 / CC11 / Velocity model

This is the standard professional orchestral expression model:

- **Velocity** (0-127): **attack character** — how the note begins. Higher velocity = more aggressive attack, not necessarily louder sustain. For short articulations (staccato, pizzicato), velocity IS the primary dynamic control.
- **CC1 (Mod Wheel)** (0-127): **sustained dynamic level** — crossfades between dynamic layers (pp through ff) in real-time. Independent of velocity. You can have gentle attack (low velocity) with loud sustain (high CC1), or vice versa. This is the primary expressive control.
- **CC11 (Expression)** (0-127): **overall volume multiplier** on top of CC1. For phrase-level dynamics (crescendos, diminuendos) without changing timbral layer. CC11 at 50% with CC1 at ff still sounds ff timbrally, just quieter.

### Dynamic crossfading algorithm

Map CC1 (0-127) to dynamic layer blending:

- **Equal-power crossfade** between adjacent layers: `g0 = cos(pi/2 * a)`, `g1 = sin(pi/2 * a)` where `a` is the normalized position between two layers. Prevents the perceived volume dip during transitions.
- **Crossfade width**: 10-30% overlap between adjacent layers
- **Response curve**: slight S-curve (not linear, not fully logarithmic)
- **Crossfade time**: 50-200ms to avoid obvious switching when CC1 moves

### Vibrato control

- **Natural vibrato**: baked into samples at the performed dynamic level
- **CC-controlled vibrato depth**: CC2 or dedicated CC crossfades between vibrato and non-vibrato versions
- **Synthetic vibrato augmentation** for fine control beyond baked-in vibrato:
    - Pitch LFO: rate 4-7Hz typical (5-9Hz for string vibrato specifically), depth 10-40 cents depending on instrument and dynamic, controllable via CC2
    - Amplitude LFO: subtle ~1-3dB, slightly slower than pitch (bow pressure variation)
    - Timbre LFO: modulate a formant filter (timbral change accompanying real vibrato)
    - Vibrato onset delay: 100-300ms from note start (real players don't vibrate immediately)
    - Per-note random variation in rate and depth
- **Spectral envelope modulation (SEM)**: partial amplitudes change with vibrato due to body resonances. Perceptually important for bowed strings. Implement as subtle EQ tilt/formant shift, or spectral envelope interpolation in resynthesis domain.

### Humanization

Without humanization, sample playback sounds mechanical. Apply per-note random variations:

- **Timing**: +/-5-20ms per note (ensemble players have slight timing differences)
- **Tuning**: +/-2-8 cents per note (players aren't perfectly in tune)
- **Dynamic**: +/-3-10% per note
- **Vibrato**: +/-10-20% on rate and depth per note
- **RR randomization**: weighted random with repetition avoidance, not just sequential cycling
- **Start offset**: random within attack-safe range

All controlled by a single **Humanize** knob (0% = perfect machine, 100% = full natural variation) that scales all parameters proportionally. Use seeded RNG so renders are deterministic unless user changes seed.

### Section size scaling (VSL-inspired)

For ensemble patches, crossfade between section sizes:

- Solo (1 player), Small (2-4), Medium (6-10), Large (12-18, full section)

Requires separate sample sets per size, OR intelligent layering of solo/small recordings:

1. Duplicate the solo voice N times
2. Per-instance tuning offset (+/-2-5 cents, Gaussian)
3. Per-instance timing offset (+/-10-30ms)
4. Per-instance dynamic variation (+/-5%)
5. Pan each instance according to orchestral seating

---

## Legato engine

This is the most critical component for realism. Bad legato = immediately sounds fake.

### True legato (sample-based transitions)

Musicians play note A, then while sustaining play the transition to note B. The actual bowed/blown transition is recorded.

**Coverage typically recorded:**

- Intervals: -12 to +12 semitones
- Dynamics: 2-3 layers (p, mf, f)
- Types: slurred/fingered, portamento
- Total per instrument: ~25 intervals x 3 dynamics x 2 types = ~150 transition samples

**Playback algorithm:**

```
on note_on(new_note, velocity):
    if currently_sustaining(old_note):
        interval = new_note - old_note
        transition_type = if velocity < 64: Portamento else: Slurred

        transition = find_transition(interval, current_dynamic, transition_type)

        // Phase 1: fade out current sustain (30-80ms)
        // Phase 2: play transition sample (100-300ms)
        // Phase 3: crossfade from transition tail into new sustain
        start_legato_crossfade(old_note, transition, new_note)
    else:
        play_note_with_attack(new_note, velocity)
```

**Crossfade math:**

- `y = (1-a) * y_transition + a * y_sustain`
- Equal-power: `g0 = cos(pi/2 * a)`, `g1 = sin(pi/2 * a)`

### Adaptive legato (CSS-inspired)

Transition speed varies based on playing speed:

- **Slow legato** (>300ms between notes): full transition sample, portamento option, expressive
- **Medium legato** (100-300ms): standard slurred, moderate crossfade
- **Fast legato** (<100ms): abbreviated transition, quick crossfade, suitable for runs

Measure time between previous and current note-on. Use this to select transition sample sets or truncate crossfade time proportionally.

### Polyphonic legato (divisi tracking)

When an ensemble plays chords, track which notes are "new" vs "sustained":

- Chord changes C-E-G to C-E-A: C and E sustain (no re-attack), only G->A triggers legato
- Maintain voice list with pitch assignments
- New note: find closest existing voice in pitch, trigger legato for that voice
- Remaining held notes continue unchanged

### Synthetic legato fallback

When no recorded transition exists (e.g., interval > 12 semitones):

1. Quick fade-out of old note (20-40ms)
2. Pitch slide from old note to new note using pitch-bend during first 50-100ms
3. Quick fade-in of new note

For portamento curves:

- Linear in cents: `p(t) = 2^{(delta * (t/T)) / 12}`
- Exponential approach: `p(t) = 2^{(delta * (1 - exp(-t/tau))) / 12}`

---

## Microphone positions and spatial mixing

### Standard orchestral mic positions

- **Close** (~1-3m): dry, detailed, forward. Most direct, least room.
- **Decca Tree**: classic L-C-R stereo (~3-5m up, 2-3m in front of conductor). The "classic orchestral" sound.
- **Room / Ambient** (~10-20m): mostly room reflections. Spacious, blended.
- **Outrigger**: wide stereo pair beyond orchestra. Adds width.
- **Balcony / Gallery**: very distant. Huge reverb, minimal detail. "Epic" cinematic.
- **Leader**: close mic on principal player. Detailed, soloistic.
- **Spot / Sectional**: close mic on specific section. For balance control.
- **Surround** (5.1/7.1): rear channels for immersive mixing.

### Mic position mixing

```rust
pub struct MicPosition {
    pub id: MicPositionId,
    pub name: &'static str,
    pub volume: f32,             // 0.0-1.0
    pub pan: f32,                // -1.0 (L) to +1.0 (R)
    pub delay_ms: f32,           // distance simulation (~1ms per foot)
    pub enabled: bool,           // load/unload to save memory
    pub stereo_width: f32,
    pub phase_invert: bool,
}
```

Typical blends:

- "Close + touch of Room" = punchy, present
- "Decca Tree only" = classic film score
- "Decca Tree + Ambient + Outrigger" = massive, cinematic
- "Close only" = dry, suitable for external reverb

### Multi-mic phase alignment

Room mics are supposed to arrive later; fully aligning them to close mics destroys depth. But close mic arrays at slightly different distances can benefit from small alignment to avoid comb filtering.

**GCC-PHAT delay estimation (offline, UI thread):**

1. Take short analysis segment of both mics (first 50-200ms of sample)
2. Compute FFTs, cross-power spectrum, apply PHAT weighting, iFFT to correlation
3. Peak location gives sample delay estimate
4. Store per-zone: `mic_delay_samples[mic_id]`

Hot-path: apply integer delay lines (or fractional if needed) per mic. Delay changes must be static per loaded zone.

### Virtual stage positioning

Standard seating (from audience perspective):

- Violin 1: far left | Violin 2: center-left | Violas: center | Cellos: center-right | Basses: far right (or behind cellos — alternative seating)
- Flutes: center-left (behind strings) | Oboes: center | Clarinets: center-right | Bassoons: center-right
- Horns: left (behind woodwinds) | Trumpets: center | Trombones: center-right | Tuba: right
- Timpani: center-right (far back) | Percussion: right (far back) | Harp: far left

When true mic positions aren't available, simulate:

- **Panning**: orchestral seating position
- **Distance via convolution**: short room IR, early reflections matching distance
- **Distance via EQ**: attenuate HF (air absorption: ~1dB/10m above 5kHz)
- **Distance via wet/dry**: more distant = higher reverb-to-direct ratio

---

## Convolution reverb: partitioned convolution engine

Long orchestral IRs require partitioned convolution (direct convolution cost scales with IR length per sample, making it impractical for multi-second IRs).

**Foundational reference**: Gardner's "Efficient Convolution without Input-Output Delay" is the classic paper describing the hybrid approach combining direct-form and block FFT processing to achieve **zero input-output delay**. Smith's PAPS covers FDN reverberation structures, stability, and feedback matrices (Hadamard/Householder) with delay length choice heuristics.

### Uniform partitioned convolution

Split IR `h[n]` into partitions of length `L`:

- For each input block:
    1. FFT input block (overlap-save)
    2. Multiply spectrum with each partition spectrum
    3. iFFT and overlap-add

### Latency

Latency is near `L` samples for a pure uniform FFT convolver. Reduce perceived latency by making partition 0 small (head partition) and running it in time domain or with a tiny FFT. This hybrid "head + tail" philosophy follows Gardner's approach.

### Per-voice vs shared convolution

- **Per-voice early reflections**: cheap, applied per voice
- **Per-section convolution tail**: shared across voices in a section
- **Per-voice tail**: optional, high-end native only (cap voice count)

### Algorithmic reverb fallback (FDN)

Cheaper and tunable compared to convolution. Provides "glue" even when IRs are disabled. FDN with Hadamard/Householder feedback matrices and tuned delay lengths. Smith's PAPS explicitly covers FDN reverberation structures, including stability conditions, feedback matrices, and delay length choice heuristics.

---

## Physical modeling augmentation

The hybrid approach: samples provide core timbre, physical models add continuous variation. Physical models are implemented as **optional layers** and **thin augmentations** for sampling, based on the standard "nonlinear exciter + linear resonator" framework from digital waveguide modeling literature.

Full physical models (e.g., FDTD brass models) are too expensive for real-time use, though research environments exist for articulated brass using FDTD methods. The waveguide approach is the practical choice.

**Implementation priority**: the sample-based engine is the priority. Physical modeling augmentation should be included in the architecture but marked as a later phase. These components are research-intensive and CPU-expensive.

### Bow noise / breath noise layer

- Separate noise layer simulating bow-on-string friction or air-through-tube turbulence
- Generated in real-time, continuously variable
- Intensity mapped to CC1 (louder playing = more noise)
- Filtered to match instrument spectral characteristics
- Mixed subtly (~-20 to -30dB below main signal)

### Vibrato modeling layer

Supplements baked-in sample vibrato:

- Pitch LFO (4-7Hz typical, 5-9Hz for strings; depth 10-40 cents, CC2-controlled)
- Amplitude LFO (~1-3dB, slightly slower, bow pressure variation)
- Timbre LFO (formant filter modulation)
- Vibrato onset delay (100-300ms)
- Per-note random variation

### Release modeling

When release trigger samples aren't available:

- Exponential decay of sustaining sample (~50-200ms)
- Filtered noise burst for string lift / breath stop (~10-30ms)
- Room tail (short convolution or algorithmic reverb)

### String sympathetic resonance

When a cello plays open G, other open strings (C, D, A) vibrate sympathetically:

- Bank of bandpass filters tuned to open string frequencies, excited by main output
- Subtle but adds physical resonance that samples alone don't capture
- Controlled by "Sympathetic Resonance" knob (0-100%)

### Bowed string waveguide model (for solo instrument augmentation)

```rust
pub struct BowedStringModel {
    pub delay_pos: DelayLine,
    pub delay_neg: DelayLine,
    pub loss_filter: BiquadOrOnePole,
    pub body: ResonatorBank,   // modal body coloration
    pub bow: BowFriction,
    pub f0: f32,
}
```

- String resonator: bidirectional delay line (length ~ fs/f0) with frequency-dependent loss filter. Traveling waves `u+(n)` and `u-(n)` in delay lines; junction scattering at bridge/nut via reflection coefficients.
- Bow exciter: nonlinear friction curve `F = f(v_rel)` providing stick-slip (Helmholtz motion). Reference: Julius O. Smith III's "Synthesis of Bowed Strings."
- Body resonance: **two options** — (1) pair of 2D waveguide meshes for detailed body modeling, or (2) transfer function derived from measured impulse response (cheaper, often sufficient)
- Anti-aliasing: clamp bow nonlinearity and lowpass at Nyquist margin (draft); 2x oversample inside exciter loop (render)
- Purpose: blend low-level physical model under sustains for continuous energy changes under CC/MPE, defeating the "static sustain loop" problem

### Reed/lip tube model (for wind instrument augmentation)

```rust
pub struct ReedTubeModel {
    pub bore: DelayLine,
    pub bell_reflection: BiquadOrOnePole,
    pub reed: ReedNonlinearity,
    pub noise_breath: NoiseLayer,
    pub f0: f32,
}
```

- Bore: delay line (cylindrical or conical tube waveguide) + reflection filter at bell/open end
- Reed/lip: nonlinear excitation (mass-spring-damper system) — function of mouth pressure and bore pressure. Reference: Scavone's work on digital waveguide modeling of reed instruments and nonlinear excitations.
- Tone holes: open/closed state affects effective tube length (critical for woodwind modeling)
- Breath/turbulence: colored noise modulated by breath pressure, coupled into bore as excitation term
- Parameters: breath pressure, embouchure tension, vibrato, key positions

### Modal synthesis (percussion and body resonance)

Modal synthesis models an instrument body as a sum of damped modes, consistent with physical modeling formulations in Smith's PAPS and related modal synthesis literature. Useful for:

- Controllable resonance on short articulations
- Instrument body response under dynamics
- Subtle "room-body coupling" enhancement

---

## Release triggers and note-off behavior

### What release triggers capture

- **Strings**: bow lift, soft noise, open string resonance
- **Brass**: embouchure relaxes, air stops, brief resonance tail
- **Woodwinds**: breath stops, key noise, tube resonance decay
- **Piano**: damper returns, soft thud, brief resonance

### Implementation

```
on note_off(note, velocity):
    voice.start_release()

    if articulation.has_release_triggers:
        release_sample = find_release_sample(note, current_dynamic)
        play_release_sample(release_sample, release_velocity)

    // Volume scales with:
    // 1. How long the note was held (longer = louder, to threshold)
    // 2. Current dynamic level (CC1)
    // 3. Release velocity if available
```

### Pedaling and sustain

- **CC64 (Sustain Pedal)**: notes continue sustaining after key release. Release triggers do NOT fire until pedal is lifted.
- **Half-pedaling**: CC64 values 0-127 control partial damping (more relevant for piano but applicable to sustained orchestral instruments in the sense of partial release behavior).
- When pedal lifts, all sustained notes fade out with release envelopes. Release triggers fire staggered (+/-10-30ms) to avoid coordinated stop.

---

## Performance intelligence

### Auto-divisi

Real orchestras divide (divisi) when playing chords:

- 2-note chord: 8+8 violins
- 3-note chord: 5+5+6
- 4+ note chord: 4+4+4+4

Engine detects polyphonic playing and:

1. Reduces volume per note proportionally
2. Applies per-divisi-group tuning and timing variation
3. Optionally switches to smaller section size sample

### Intelligent articulation selection

"Auto-articulate" mode:

- Short notes (<200ms) -> staccato
- Medium (200-500ms) -> sustain with short release
- Long (>500ms) -> sustain
- Overlapping notes -> legato
- Repeated same note -> alternating RRs, potentially spiccato if tempo is fast
- Very fast passages -> runs/scales articulation

Configurable thresholds, overridable per note.

### Ensemble timing and realism

- **Attack spread**: ensemble section players start +/-5-20ms apart. Apply random timing offsets per "virtual player."
- **Pitch convergence**: start +/-5 cents out of tune, smoothly converge over ~200-500ms as players "listen to each other."
- **Dynamic bloom**: collective crescendo takes shape over 100-300ms.

---

## Score import and phrase tools

### SMF import

Parse MIDI/SMF as "score reference" for phrase assistance, articulation prediction, tempo mapping. Use `midly` crate — it explicitly avoids allocations by referencing original bytes via Rust lifetimes and separates I/O from parsing. SMF timing uses "ticks per quarter note" or SMPTE time formats per the MIDI file specification.

**Non-real-time**: parsing happens outside audio thread. Engine receives precompiled event stream.

### Tempo mapping

Read tempo meta-events, build piecewise tempo map, convert tick times to seconds for scheduling.

### Phrase humanization

- Microtiming: +/-5-20ms, scaled by tempo
- Velocity shaping: subtle random drift + phrase-based cresc/decresc models
- Articulation variation: inject occasional alternate RR or bow direction variants

---

## Spectral modeling synthesis (SMS)

For resynthesis, phrase morphing, vibrato SEM, and "texture layers":

### Analysis pipeline (offline or background thread)

1. STFT with Hann window, size 2048-8192, hop N/4
2. Peak picking per frame -> partial tracks
3. Estimate noise residual
4. Detect transients
5. Store: partial tracks (f_i(t), A_i(t)), stochastic spectral envelope, transient events (time, band-limited snapshots)

**Key implementation insights from Smith's Spectral Audio Signal Processing:**

- Sinusoidal models are highly effective for tonal instruments (strings, winds, brass)
- Noise-like components should be modeled as **filtered stochastic terms rather than many sinusoids** — the naive approach of using many sinusoids for noise is a common anti-pattern that wastes CPU
- Explicit transient models help preserve attacks during time-stretch

### Synthesis pipeline (realtime)

- Per partial track: oscillator bank (recursive sin/cos update, not calling sin() per sample)
- Add filtered noise shaped by stochastic envelope
- Inject transient waveforms at scheduled times (do not stretch transients)

### Transient detection

Onset detection function (ODF) families per Bello's tutorial and Dixon's evaluation work:

- Energy derivative (fast, coarse)
- Spectral flux (robust for musical changes)
- Complex-domain phase deviation ODF (better for tonal onsets, uses likely-phase deviation)
- Multi-band fusion (reduces false positives)

Post-processing ODFs for reliable onset picks follows best practices from Bello/Dixon.

### Time-stretch and pitch-shift

| Method              | Domain | Strengths               | Weaknesses                      | Best use                   | Reference                                     |
| ------------------- | ------ | ----------------------- | ------------------------------- | -------------------------- | --------------------------------------------- |
| Resampling          | time   | preserves transients    | changes duration with pitch     | per-note tuning            | Smith PAPS interpolation                      |
| WSOLA               | time   | preserves transients    | wobble on sustained harmonics   | rhythmic phrases, legato   | Driedger's thesis; enhanced WSOLA             |
| Phase vocoder       | freq   | strong harmonic sustain | transient smear ("phasiness")   | pads, long sustains        | Dolson's tutorial; phase locking improvements |
| Signalsmith Stretch | hybrid | strong general-purpose  | best for modest stretch factors | practical realtime control | MIT licensed; documents best ranges           |

---

## GPU compute and visualization

GPU is optional for audio generation (GPU readback latency and scheduling are not deterministic enough for the AudioWorklet hot path), but valuable for:

- Visualization (spectrograms, waveform overviews, phase meters)
- Offline/preview tasks (IR FFT preparation, peak computations)
- Heavy resynthesis previews (partial-bank rendering and noise spectral shaping can be offloaded to GPU, but realtime audio output stays on CPU because GPU readback/jitter risks glitching)

### API and shader language

- **WGSL** is standardized by the W3C and defines compute shaders, storage buffers, and workgroup semantics. WGSL buffer layout and storage interface constraints are specified in the WGSL spec.
- On native, use `wgpu` — a Rust implementation aligned with WebGPU that supports both native backends and WASM.

### Hard rule: audio thread never blocks on GPU

Audio thread writes analysis taps into SPSC buffer. UI/render thread consumes taps and schedules GPU work.

### GPU workloads

- **Spectrogram**: GPU FFT (Stockham radix-2) + magnitude texture
- **Waveform view**: min/max downsample per pixel column (GPU compute is ideal)
- **Mic phase meter**: compute cross-correlation or phase coherence between mic streams (CPU or GPU)
- **Articulation timeline**: display legato transitions and articulation states over time
- **Convolution tail partitions**: precompute FFT of each IR partition (offline), then per render tick: FFT input block, multiply-accumulate across partitions, iFFT and overlap-add
- **Additive synthesis preview**: partial-bank rendering (Lab mode)
- **Noise spectral shaping**: offload to GPU for resynthesis previews

### WGSL Stockham FFT stage (pseudocode)

```wgsl
struct Uniforms { N: u32, stage: u32 };

@group(0) @binding(0) var<storage, read_write> buf: array<vec2f>;
@group(0) @binding(1) var<uniform> u: Uniforms;

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}

@compute @workgroup_size(256)
fn fft_stage(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u.N/2u) { return; }

  // Read indices depend on stage in Stockham autosort
  let a = buf[index_a(i, u.stage)];
  let b = buf[index_b(i, u.stage)];
  let w = twiddle(i, u.stage, u.N); // e^{-j2*pi*k/N}
  let t = cmul(b, w);

  buf[out0(i, u.stage)] = a + t;
  buf[out1(i, u.stage)] = a - t;
}
```

---

## Presets and AI pipelines

### Preset format

JSON with:

- `format_version`
- Instrument racks (sections, articulations)
- Mic mixer state
- Routing and FX
- Macro controls
- Mapping tables (keyswitches, CC, MPE)
- Metadata (name, tags, authorship)

Migration: `migrate(version_old -> version_new)` on load. Audio thread receives handle to prevalidated state blob, swaps pointers at block boundary.

### Expression and MPE mapping

The MPE specification (defined by the MIDI Association) formalizes per-note pitch/timbre/pressure control.

- Global: CC1 mod wheel, CC11 expression, CC7 volume
- Per-note MPE: pitch bend -> intonation/portamento, pressure -> bow/breath/vibrato, "timbre" (CC74) -> brightness/noise/bow position
- Per-voice `ExpressionState` updated by MIDI events

### AI-assisted generation

1. Template-based generation (style-aware orchestral templates)
2. Quality scoring classifier (CNN on spectrograms)
3. Auto-tagging (spectral + dynamics features)
4. Text-to-preset/phrase (LLM outputs JSON schema)
5. Morphing and variation (interpolate articulations, dynamics curves, mic mixes)

**ONNX for classifiers**: ONNX IR and opsets are versioned with monotonically increasing numbers. Native inference uses the `ort` crate (Rust bindings for ONNX Runtime).

**Classifier architecture (practical)**:

- Input: 2-second audio render (per patch or phrase) -> mel-spectrogram image
- CNN: small 2D conv stack -> dense -> scalar score
- Dual outputs: "quality score" and "artifact risk" (e.g., transient smear, phasey mic issues)

---

## DAW integration

### As a DAW instrument

Each orchestral instrument loads as a separate instance in the DAW's instrument slot. Receives MIDI, outputs audio to mixer. Full automation of all parameters.

### Orchestral template system

Pre-built templates with all standard sections loaded, routed, and positioned:

- "Full Orchestra" (60+ tracks)
- "String Orchestra" (Vln1, Vln2, Vla, Vc, Cb, solos)
- "Brass Section" (Hrn, Tpt, Tbn, Tba)
- "Chamber Ensemble"

Templates include mixer routing, bus processing, reverb sends, panning.

### Articulation lane in piano roll

The DAW's piano roll supports an **articulation lane** below note data. Each note can have an articulation assignment overriding current keyswitch state. Visual color-coding per articulation type. This is the modern approach used by Cubase Expression Maps, Logic Articulation Sets, and Dorico — cleaner than scattering keyswitch notes in MIDI data.

### Shared effects

All effects from `daw-dsp` available as per-instrument inserts. Same reverb, EQ, compressor used in synth FX lanes. Convolution reverb with orchestral hall IRs is particularly important.

---

## Sample content strategy

### Phase 1: Free / CC samples (initial release)

- Virtual Playing Orchestra (Creative Commons, Sonatina-based)
- VSCO 2 Community Edition (Versilian Studios, CC-BY)
- Iowa University Electronic Music Studios (public domain)
- Philharmonia Orchestra Sound Samples (educational use)
- SSO (Sonatina Symphonic Orchestra, CC-BY)

### Phase 2: Original recordings (as product matures)

This is extremely expensive ($100K-$1M+) and time-consuming (months of recording + editing). Produces the highest quality, uniquely owned content.

Recording spec:

- Pitches: chromatic every minor third (C, Eb, F#, A); every semitone for solo/legato
- Dynamic layers: 5 for sustains (pp, mp, mf, f, ff); 3 for shorts (pp, mf, ff)
- Round robins: 4 per dynamic for shorts; 2-3 for sustains
- Legato transitions: every semitone -12 to +12, 3 dynamics, 2 types
- Release triggers: 3 dynamics, 2 RRs each
- Mic positions: Close, Decca Tree, Room, Spot (4 minimum)
- Sample rate: 48kHz, 24-bit WAV

### Phase 3: AI-generated / resynthesized (experimental)

Use generative audio models (e.g., MusicGen, Stable Audio) trained on orchestral recordings to generate sample content. Or use resynthesis: analyze a recording, extract spectral characteristics, resynthesize as new content that's not a copy of the original. Legal and quality concerns — this is a frontier area.

---

## WASM voice budget estimates

Runtime "quality governor" dynamically disables heavy components when nearing deadline.

| Patch archetype           | Mic count | WASM voices | Notes                              |
| ------------------------- | --------- | ----------- | ---------------------------------- |
| Solo violin sustain       | 1-2       | 16-32       | disable per-voice convolution      |
| Solo violin legato        | 1-2       | 8-16        | interval transitions = extra loads |
| String section (8 voices) | 2         | 8-12 total  | treat section as true polyphony    |
| Woodwind quartet          | 1-2       | 8-16 total  | depends on articulation density    |
| Full orchestra sketch     | 1         | 24-40 total | strict LOD + shared FX             |
| Cinematic full mix        | 3-6       | 8-16 total  | likely needs native or GPU-offline |

---

## Progressive-disclosure UX

The orchestral suite follows the same core philosophy as the master synth:

> Complexity is always available, but never forced.

These are **visibility layers in the same patch format**, not separate products or modes:

- **Level 1: Play**
- **Level 2: Shape**
- **Level 3: Build (Ensemble)**
- **Level 4: Arrange**
- **Level 5: Route (Mix)**
- **Level 6: Lab**

### Core UI philosophy

The instrument should feel like **one orchestral section that reveals depth on demand**. A film composer should be able to load "Violins 1," play expressively with macros, and never see the internals unless they want to. A sampling expert should be able to access every legato crossfade parameter, mic alignment tool, and physical modeling knob without fighting through a simplified shell.

The UI satisfies 4 goals:

1. **Composers can play and perform immediately**
2. **Sound designers can shape articulations and expression**
3. **Orchestrators can build multi-section ensembles**
4. **Engineers can route mics, tune legato, and mix in detail**

### Stable layout (5 zones)

#### 1. Top bar (persistent)

- Instrument selector / browser
- Preset browser (save / duplicate / compare / undo / redo)
- Complexity level switcher
- CPU / voice meter / quality status
- Articulation indicator (shows current active articulation prominently)
- Help / onboarding

#### 2. Macro strip (below top bar)

8 macro knobs with musical labels:

- **Dynamics** (CC1 mapped)
- **Expression** (CC11 mapped)
- **Vibrato** (depth/intensity)
- **Tightness** (humanization amount, inverse)
- **Space** (mic distance / reverb blend)
- **Tone** (brightness / EQ tilt)
- **Attack** (transient character)
- **Release** (tail length / behavior)

Optional XY pad (e.g., Dynamics vs Vibrato).

This is the **composer safe zone**. A user should be able to browse presets and get meaningful orchestral control without opening internals.

#### 3. Left panel: Section / Instrument Stack

Shows loaded instruments and their state:

- Instrument name and icon (Violin 1, Cellos, etc.)
- Current articulation badge
- Level meter
- Mute / solo
- Quick mic blend slider (Close vs Room)
- Color coding by instrument family

Purpose: the user always sees "what's loaded" before "how it's configured."

#### 4. Center panel: Context Inspector

Shows details for the currently selected thing:

- Instrument overview
- Articulation editor
- Legato tuning
- Expression curves
- Mic position mixer
- Humanization controls
- Physical modeling parameters

Structure every inspector page: Header (name, type, bypass, reset) -> Primary controls (4-8 most important) -> Secondary (collapsible) -> Advanced (collapsed by default except in Lab)

#### 5. Bottom dock: Performance / Modulation

- Expression curve displays (CC1, CC11, velocity)
- Envelope editor (amp, filter)
- LFO/modulation sources
- Articulation timeline (shows transitions over time)
- MIDI activity visualization

#### 6. Right panel: Mic Mixer / FX

- Per-mic-position faders (volume, pan, delay, width)
- EQ per mic position
- Convolution reverb controls
- Bus dynamics
- Send levels

---

### Level 1 — Play

Default first-run view. For the composer who wants to write music, not program an instrument.

**Visible:**

- Instrument selector (visual grid: Strings, Brass, Woodwinds, Percussion)
- Preset browser with musical categories
- Macro strip (Dynamics, Vibrato, Space, Brightness, Attack, Release)
- Current articulation indicator (large, clear)
- Simple keyboard showing playable range
- Basic output meter and oscilloscope

**Hidden:**

- Articulation editor internals
- Mic position details
- Legato tuning
- Humanization parameters
- Physical modeling
- All routing

**User goal:** load an instrument, play expressively, switch articulations with keyswitches, never feel punished by complexity.

**Rules:**

- Only musical labels (no "crossfade time," "GCC-PHAT," "waveguide")
- Every macro makes an obvious audible change
- Articulation switching should be obvious and immediate (visual feedback on keyswitch)
- Every preset ships with useful macros

---

### Level 2 — Shape

For users editing sound without needing architecture.

**Visible:**

- Current articulation detail panel
- CC1/CC11 assignment display and response curves
- Simple EQ and reverb send
- Mic blend slider (Close vs Room, single control)
- Legato mode toggle (on/off, speed sensitivity)
- Basic dynamics curve editor
- Macro strip remains visible

**Still hidden:**

- Per-mic-position mixer
- Deep legato parameters
- Humanization internals
- Physical modeling
- Full routing

**User goal:** adjust how an instrument responds to playing. Shape expression curves, tune the basic response.

**Rules:**

- Use large, high-value controls first (dynamics curve, vibrato depth, legato sensitivity)
- Advanced parameters behind disclosure groups
- "I want to shape how this instrument feels, not architect a system"

---

### Level 3 — Build (Ensemble)

The orchestral suite becomes visibly multi-instrument.

**Visible:**

- Full instrument stack with all loaded sections
- Add instrument from template (with musical descriptions)
- Per-instrument mixer (volume, pan, sends)
- Full articulation list with keyswitch assignments
- Dynamic layer visualization (CC1 -> layer mapping)
- Round robin count display
- Per-articulation controls (attack, release, tuning)
- Divisi configuration
- Section size scaling
- Humanization panel (single Humanize knob + disclosure for per-parameter control)

**Templates for adding instruments:**

- "Add Strings" (Vln1 + Vln2 + Vla + Vc + Cb, pre-panned)
- "Add Brass Section" (Hrn + Tpt + Tbn + Tba)
- "Add Solo Violin" (close mic, full legato, detailed expression)
- "Add Orchestral Percussion" (Timp + Perc, pre-routed)
- "Load Full Orchestra Template"

Each template: sensible defaults, preloaded routings, only important first controls exposed.

**Rules:**

- Creation is template-driven first, not a blank instrument list
- Musical intent first ("Add warm strings"), technical details second

---

### Level 4 — Arrange

Phrase-level editing and performance assembly.

**Visible:**

- Phrase tools: MIDI import preview, articulation timeline, tempo map overlay
- Phrase morphing controls
- Legato "glue" adjustments (transition timing, overlap behavior)
- Score-to-performance mapping (how MIDI data translates to articulation choices)
- Articulation prediction from playing patterns
- Humanization preview (hear before/after)

**User goal:** refine how a written passage translates to a performed passage. This is where MIDI becomes music.

**Rules:**

- Every change should be auditionable before committing
- Timeline visualization should clearly show articulation states over time
- Non-destructive: original MIDI data preserved alongside performance interpretation

---

### Level 5 — Route (Mix)

Architecture becomes explicit.

**Visible:**

- Full mic position mixer (individual volume/pan/delay per mic)
- Output routing (stereo, multi-out per mic position)
- Per-mic EQ and dynamics
- Convolution reverb controls (IR selection, wet/dry, pre-delay)
- Bus processing
- Send effects
- Signal path visualization (from instrument through mic mix through FX to output)
- Phase correlation meter between mic positions

**User goal:** deliberately shape the spatial mix. Control mic blends, tune the room, route to outputs.

**Rules:**

- Signal path must be visually traceable
- Selecting any node highlights what feeds it and what it feeds
- Route changes feel reversible and safe
- Not a free-cable patcher — semi-constrained guided routing

---

### Level 6 — Lab

High-complexity surface for sample developers and sound researchers.

**Visible:**

- Legato engine tuning (crossfade times, velocity thresholds, transition behavior)
- Humanization internals (per-parameter timing, tuning, dynamic, vibrato amounts)
- Physical modeling augmentation controls:
    - Bow noise synthesis (intensity, filtering, CC mapping)
    - Breath noise (wind instruments)
    - Sympathetic string resonance (0-100%)
    - Waveguide / modal resonator parameters
- Sample import and custom zone mapping tools
- Auto-divisi configuration
- Auto-articulation thresholds
- Ensemble timing tuning (attack spread, pitch convergence, dynamic bloom)
- GCC-PHAT mic alignment tool
- Spectral analysis / SMS editor
- AI generation and classifier debugging
- Parameter diff / compare tools

**User goal:** invention. System-level experimentation. Sound research.

**Rules:**

- Every heavy action needs status feedback
- Every multi-step process shows progress and is cancelable
- Every result previewable before commit
- Lab is quarantined from the beginner path

---

### Interaction model

**Selection drives detail**: click an instrument -> inspector shows overview. Click an articulation -> inspector shows articulation editor. Click a mic position -> inspector shows mic controls. The workspace stays stable while depth unfolds.

**Left side answers "what exists"**: how many instruments, what type, which is selected, which are audible, which have warnings.

**Center answers "what am I working on"**: prioritizes the most important controls first. Never a knob wall.

**Bottom answers "how it performs"**: expression curves, envelopes, modulation, articulation timeline.

**Right answers "how it sounds in space"**: mic mix, FX, routing, meters.

### Beginner onboarding

First launch, 3 choices:

- **Play an Orchestra** -> drops into Play level with a full template and macro-rich presets
- **Build an Ensemble** -> guided flow: choose family, choose instruments, choose character, land in Shape
- **Open Full Instrument** -> everything visible for advanced users

If the suite is empty, show actionable cards:

- Load Full Orchestra
- Start with Strings
- Start with Brass
- Import Custom Samples
- Open Tutorial Project

### Expert fast paths

- Keyboard search for any articulation, instrument, or function
- Right-click menus everywhere
- Hotkey to cycle articulations
- Hotkey to reveal full mic mixer
- Alt-drag to copy expression mappings
- Shift-drag for fine CC control
- Quick compare A/B presets
- Favorite articulation presets and mic blends

---

## Quality checklist

Non-negotiable quality drivers for best-in-class orchestral realism:

1. **Legato that breathes**: interval transitions where available; transient-aware crossfades; dynamic-dependent legato timing
2. **Dynamics that are continuous**: blend velocity layers with CC-based crossfades and spectral shaping; avoid "layer stepping" with smoothing and equal-power blending
3. **Human repetition control**: deterministic RR + subtle pitch/start jitter; no noticeable periodicity via seeded randomness
4. **Mic mixes that don't comb-filter**: optional close-mic alignment via GCC-PHAT; preserve room delays for depth
5. **Space that scales**: partitioned convolution with head/tail strategy; per-section shared tails; optional per-voice early reflections
6. **Hybrid layers that add life**: low-level waveguide/modal augmentation under samples; SMS-based SEM for vibrato timbre realism
7. **Predictable performance**: strict LOD governor keyed to quantum deadlines; WASM never attempts disk streaming; SPSC ring buffers for control
8. **Release triggers that complete the picture**: every note-off sounds real, not just "silence"
9. **Ensemble intelligence**: auto-divisi, pitch convergence, attack spread, dynamic bloom
10. **The UI disappears**: a composer at Level 1 should never know that Levels 3-6 exist unless they go looking

---

## One-sentence summary

**The perfect orchestral engine makes great samples sound like a living performance through intelligent legato, continuous expression, spatial realism, and physical modeling augmentation — all behind a UI where composers live in macros and articulation switching while engineers and sample developers access full depth on demand.**

---

## Key references and bibliography

An implementer should consult these sources for deep technical detail:

### DSP and synthesis foundations

- **Julius O. Smith III, "Physical Audio Signal Processing" (PAPS)** (ccrma.stanford.edu) — canonical reference for delay lines, comb/allpass, interpolation, waveguides, FDNs, bowed string synthesis, reed/wind models, modal synthesis, reverberation structures. The single most important reference for this engine.
- **Julius O. Smith III, "Spectral Audio Signal Processing"** (ccrma.stanford.edu, 2011 online edition) — SMS (sines+noise+transients), sinusoidal modeling, spectral envelope modulation, stochastic noise modeling.
- **Julius O. Smith III, "Synthesis of Bowed Strings"** — canonical waveguide bowed-string synthesis.
- **Vadim Zavalishin, "The Art of VA Filter Design" (rev 2.1.0)** — TPT SVF, ladder filters, virtual analog filter design.
- **Robert Bristow-Johnson, Audio EQ Cookbook** (W3C-hosted) — RBJ biquad filter implementations.
- **Gary Scavone** — digital waveguide modeling of reed instruments and nonlinear excitations.

### Time-stretch, onset detection, and convolution

- **William Gardner, "Efficient Convolution without Input-Output Delay"** — classic paper on hybrid head+tail partitioned convolution with zero input-output delay.
- **Bello et al., onset detection tutorial** — ODF families (energy, spectral flux, complex-domain).
- **Dixon, onset detection evaluation** — practical onset detection benchmarking.
- **Mark Dolson, phase vocoder tutorial** — phase vocoder fundamentals, artifacts ("phasiness," transient smear).
- **Driedger, WSOLA thesis** — WSOLA and transient-preserving improvements.
- **Phase vocoder improvement literature** — phase locking techniques and modern reviews.
- **Knapp & Carter** — GCC-PHAT time-delay estimation method.

### Standards and specifications

- **SFZ format specification** (sfzformat.com) — open standard for sample instrument definition. Region/group inheritance, ADSR opcodes, round-robin sequencing via `seq_length`/`seq_position`.
- **MIDI File Specification (SMF)** — timing in "ticks per quarter note" or SMPTE.
- **MPE Specification** (MIDI Association) — per-note pitch/timbre/pressure control.
- **WGSL Specification** (W3C) — compute shaders, storage buffers, workgroup semantics, buffer layout constraints.
- **ONNX Specification** — IR and opsets versioned with monotonically increasing numbers.
- **DAWproject specification** — orchestral template interoperability.

### Rust crates

- **`midly`** — allocation-free SMF parsing, lifetime-based borrows referencing original bytes.
- **`creek`** — async sample streaming from disk (native backend).
- **`rubato`** — high-quality sample rate conversion.
- **`wgpu`** — Rust WebGPU implementation, supports native backends and WASM.
- **`ort`** — Rust bindings for ONNX Runtime (inference).
- **`cpal`** — cross-platform audio I/O.
- **Signalsmith Stretch** — MIT-licensed time-stretch library with documented best ranges.

### Sampling and orchestration references

- Spitfire Audio developer talks and documentation (BBC SO, Albion, Chamber Strings)
- Vienna Symphonic Library white papers on the Synchron Player engine
- Audio Modeling SWAM technical documentation (physical modeling approaches)
- Native Instruments Kontakt manual — sample zone mapping, round robin, keyswitching
- Kontakt scripting references (many orchestral libraries publish their scripts)
- Steinberg Expression Maps documentation — articulation management
- Logic Pro Articulation Set documentation
- "The Guide to MIDI Orchestration" by Paul Gilreath — standard reference for realistic MIDI orchestral programming
- Orchestration textbooks: Adler, Blatter, Piston — real instrument capabilities and limitations
- Pianobook.co.uk community — sampling methodology insights
- Christian Henson (Spitfire co-founder) YouTube videos on sampling techniques
- Sound On Sound "Session Notes" and "Orchestral Sampling" features
- KVR forums — comparative discussions on library realism
- VI-Control.net forums — primary community for orchestral composers and sample library users
