# Research Specification: The Orchestral Suite

## Purpose of this document

This is a research brief for an AI agent. Your job is to produce a **complete implementation guide** for building a world-class orchestral instrument suite — a sample-based orchestral engine with physical modeling augmentation that rivals Spitfire Audio's BBC Symphony Orchestra, EastWest Hollywood Orchestra, Vienna Symphonic Library, Cinematic Studio Series, and Logic Pro's Studio Strings/Brass/Woodwinds. The output must be detailed enough that an AI coding agent can implement the playback engine, articulation system, expression handling, and microphone routing from start to finish in Rust.

**Critical distinction from the synth/drum machine specs:** The orchestral suite is primarily a **sample playback and performance intelligence engine**, not a synthesis engine. The quality ceiling is determined by the quality of the recorded samples (which are an asset creation problem, not a code problem) and the intelligence of the playback engine (legato transitions, expression mapping, articulation switching, release triggers, round-robin management). The code must make great samples sound like a real performance — that's the entire challenge.

---

## What we are building

A multi-instrument orchestral playback engine that loads and plays deeply-sampled orchestral instruments with the articulation variety, dynamic response, legato transitions, and spatial positioning needed for professional film/TV/game scoring and classical composition. Each instrument section (strings, brass, woodwinds, percussion) is a separate loadable instrument within the DAW, sharing a common engine architecture.

**This must match or exceed:**

- Spitfire Audio BBC Symphony Orchestra Professional (344 techniques, 12 mic positions, true legato, 45 legato patches)
- EastWest Hollywood Orchestra Opus (deep sampling, massive library, Diamond mic positions)
- Vienna Symphonic Library Synchron Player (synchronized stage positioning, dimension control)
- Cinematic Studio Series (CSS, CSB, CSW — praised for playability and legato quality)
- Audio Modeling SWAM (physical modeling, infinite variation, tiny footprint)
- Logic Pro Studio Strings/Brass (Apple's built-in, good quality, deep DAW integration)
- CineOrchestra / CineSamples (cinematic sound, Kontakt-based)

---

## Technology constraints (same stack as the synth/drum machine)

- Rust, compiles to native + WASM
- Lives in `daw-sampler` crate (or module within `daw-synth`) — depends on `daw-dsp` for shared effects, `daw-core` for types
- Exposes: `fn process(midi_events: &[MidiEvent], output: &mut [&mut [f32]], block_size: usize)`
- No I/O in the processing path — sample data pre-loaded into memory or streamed via a background thread interface passed in at construction
- Native: disk streaming via `creek` crate for large libraries (preload first 64-240KB per sample, stream remainder from background thread)
- Web/WASM: entire sample set in memory (no disk streaming in AudioWorklet). Requires smaller "web edition" sample sets or progressive loading.
- Same effects from `daw-dsp` available as per-instrument inserts
- Same modulation sources as the synth available per instrument (LFO, envelope, MIDI CC mapping)

---

## PART 1: REFERENCE LIBRARIES — WHAT MAKES EACH ONE BEST-IN-CLASS

### 1.1 Spitfire Audio — BBC Symphony Orchestra Professional

**What makes it special:**

- **True recorded legato**: transitions captured by having musicians physically play from note A to note B at multiple dynamics. Not crossfaded — the actual bowed/blown transition is recorded. Includes slurred (fingered), portamento (slide), and speed-dependent runs.
- **344 articulation techniques** across all instruments — the deepest articulation coverage in any single library
- **12 microphone positions**: Close, Leader, Tree (Decca tree), Ambient, Outrigger, Gallery, Balcony, Spill, Stereo (mixed), plus section-specific positions. Each can be loaded/unloaded independently.
- **Release triggers**: when a note is released, a separate "key-off" sample plays — the sound of bow lift, finger release, key noise, breath stop. Critical for realism.
- **Multiple dynamic layers** per articulation, crossfaded via CC1 (Mod Wheel) for continuous dynamic control independent of velocity
- **Round robins**: multiple recordings of the same note at the same dynamic, cycled to avoid the "machine gun" effect on repeated notes
- **Expression mapping via velocity + CC**: velocity determines initial attack character; CC1 controls sustained dynamic level; CC11 controls volume

**What to take:** True legato sampling methodology, release triggers, 5+ mic positions, velocity+CC1+CC11 expression model, round-robin cycling

### 1.2 Vienna Symphonic Library — Synchron Player

**What makes it special:**

- **Synchronized stage positioning**: all instruments recorded on the same stage with consistent spatial relationships. When you load violins and cellos, they're already in correct orchestral seating positions.
- **Dimension control**: for ensemble patches, crossfade between different section sizes (4 players → 8 → 14 → full section). No other library does this.
- **Humanization engine**: automatic slight timing, tuning, and dynamic variations per note to avoid the "too perfect" sound of sample playback
- **Mir Pro integration**: convolution reverb with measured impulse responses from real concert halls, with per-instrument positioning on a virtual stage

**What to take:** Consistent stage positioning across all instruments, humanization engine, section size control, virtual stage with convolution reverb

### 1.3 Cinematic Studio Series (CSS/CSB/CSW)

**What makes it special:**

- **Playability**: the legato engine is widely considered the most natural-feeling to play in real-time. Notes connect smoothly without obvious transition artifacts.
- **Adaptive legato**: transition speed varies based on how fast you play. Fast passages use quick transitions; slow passages use longer, more expressive ones.
- **First-chair / ensemble separation**: solo instruments and ensemble patches complement each other with consistent tone
- **Simple, focused articulation set**: rather than 100+ techniques, CSS provides ~15 essential articulations per instrument that cover 90% of scoring needs. Quality over quantity.

**What to take:** Adaptive legato based on playing speed, focused articulation set that prioritizes playability over exhaustive coverage

### 1.4 Audio Modeling — SWAM (Synchronous Waves Acoustic Modeling)

**What makes it special:**

- **Physical modeling, not sampling**: uses mathematical models of instrument acoustics (string vibration, bow interaction, tube resonance, reed behavior) to generate sound in real-time. No samples at all.
- **Infinite variation**: every note is uniquely generated. No round-robin limits, no velocity layer boundaries, no sample memory.
- **Continuous expression**: every parameter responds in real-time — bow pressure, bow speed, vibrato depth/rate, breath pressure, embouchure — all modulated continuously, not stepped.
- **Tiny footprint**: ~100MB per instrument vs 20-100GB for sample libraries
- **Limitations**: doesn't quite match the timbral realism of top-tier samples for ensemble sounds. Solo instruments are more convincing. CPU-intensive.

**What to take:** Physical modeling as an augmentation layer for vibrato, bow noise, breath noise, and articulation transitions — hybrid approach where samples provide the core timbre and physical models add continuous variation

### 1.5 Logic Pro — Studio Strings / Studio Horns / Studio Woodwinds

**What makes it special:**

- **Deep DAW integration**: articulation sets, smart controls, Drummer integration
- **Articulation ID system**: MIDI-based articulation switching that's more organized than raw keyswitching — each note can carry an articulation ID, letting the DAW handle switching without cluttering the MIDI data with keyswitch notes
- **Studio Strings has true legato with portamento/fingered transitions**, controlled by velocity on the overlapping note
- **Good-enough quality for demos and many final productions** at zero additional cost

**What to take:** Articulation ID system (superior to raw keyswitching), tight DAW integration patterns

---

## PART 2: SAMPLE PLAYBACK ENGINE ARCHITECTURE

### 2.1 Sample Organization Hierarchy

```
Instrument (e.g., "Violins 1")
  ├── Articulation (e.g., "Legato", "Spiccato", "Tremolo")
  │   ├── Dynamic Layer (e.g., pp, mp, mf, f, ff — typically 3-5 layers)
  │   │   ├── Round Robin Group (e.g., RR1, RR2, RR3 — typically 3-6)
  │   │   │   ├── Sample Zone (key range + velocity range → specific .wav file)
  │   │   │   │   ├── sample_path: String
  │   │   │   │   ├── root_note: u8
  │   │   │   │   ├── lo_key: u8, hi_key: u8
  │   │   │   │   ├── lo_vel: u8, hi_vel: u8
  │   │   │   │   ├── sample_start: usize, sample_end: usize
  │   │   │   │   ├── loop_start: usize, loop_end: usize, loop_mode: LoopMode
  │   │   │   │   ├── loop_crossfade_length: usize
  │   │   │   │   └── tuning_offset_cents: f32
  │   │   │   └── ...more zones (one per recorded pitch)
  │   │   └── ...more round robins
  │   └── ...more dynamic layers
  ├── Legato Transitions (special)
  │   ├── Transition Type (slurred, portamento, runs)
  │   │   ├── Interval (semitones: -12 to +12, or wider)
  │   │   │   ├── Dynamic Layer
  │   │   │   │   └── Sample (the recorded transition from note A to note B)
  │   │   │   └── ...
  │   │   └── ...
  │   └── ...
  └── Release Triggers
      ├── Dynamic Layer
      │   └── Sample (the sound of note release at this dynamic)
      └── ...
```

### 2.2 Core Data Structures

Research and specify the Rust data structures for:

```rust
struct OrchestraInstrument {
    name: String,
    instrument_type: InstrumentType,     // Strings, Brass, Woodwind, Percussion
    articulations: Vec<Articulation>,
    legato_engine: LegatoEngine,
    release_triggers: ReleaseTriggerSet,
    mic_positions: Vec<MicPosition>,
    expression_config: ExpressionConfig,
    humanization: HumanizationConfig,
    key_range: (u8, u8),                 // MIDI note range this instrument covers
}

struct Articulation {
    id: ArticulationId,
    name: String,                         // "Long", "Staccato", "Tremolo", etc.
    keyswitch: Option<u8>,               // MIDI note that activates this articulation
    dynamic_layers: Vec<DynamicLayer>,
    is_looped: bool,                     // Sustaining articulation (long) vs one-shot (short)
    release_trigger: bool,               // Does this articulation have release samples?
    attack_time_ms: f32,                 // For crossfade timing
    default_cc_curve: CCCurve,           // How CC1 maps to dynamic layer crossfading
}

struct DynamicLayer {
    dynamic: Dynamic,                     // pp, p, mp, mf, f, ff
    velocity_range: (u8, u8),            // Velocity range that triggers this layer
    cc1_range: (f32, f32),               // CC1 range for crossfading (0.0-1.0)
    round_robins: Vec<RoundRobinGroup>,
}

struct RoundRobinGroup {
    index: usize,
    zones: Vec<SampleZone>,
}

struct SampleZone {
    sample_id: SampleId,                 // Reference to loaded sample data
    root_note: u8,
    lo_key: u8, hi_key: u8,
    sample_start: usize,
    sample_end: usize,
    loop_start: Option<usize>,
    loop_end: Option<usize>,
    loop_crossfade: usize,
    tuning_cents: f32,
    // Per-mic-position sample variants
    mic_samples: Vec<(MicPositionId, SampleId)>,
}

struct LegatoTransition {
    from_note: u8,
    to_note: u8,                         // Or just interval in semitones
    transition_type: TransitionType,      // Slurred, Portamento, Run
    dynamic: Dynamic,
    sample_id: SampleId,
    crossfade_in_ms: f32,                // How long to crossfade from sustain to transition
    crossfade_out_ms: f32,               // How long to crossfade from transition to new sustain
}

enum TransitionType {
    Slurred,      // Fingered — same bow, add/remove finger
    Portamento,   // Glide — slide between pitches
    Run,          // Fast passage — abbreviated transition
    Rip,          // Brass rip upward
    Fall,         // Brass fall downward
}
```

### 2.3 Sample Playback Algorithm

For each active note, per audio block:

1. **Determine current articulation** (from keyswitch state, articulation ID, or CC-based switching)
2. **Determine dynamic layer** from CC1 (mod wheel) position — NOT velocity. Velocity determines initial attack; CC1 determines sustained dynamic.
3. **Select round robin** — cycle through RR groups sequentially, or use random selection with repetition avoidance (don't repeat the same RR within the last N triggers)
4. **Find the correct sample zone** for the current MIDI note within the selected dynamic layer and RR group
5. **Read samples** with pitch interpolation (cubic Hermite) for notes between recorded pitches
6. **Apply dynamic crossfading**: when CC1 moves between dynamic layers, crossfade between the current layer's sample and the adjacent layer's sample. Crossfade time: 50-200ms to avoid obvious switching.
7. **Apply loop crossfading** for sustaining articulations: as the playback position approaches the loop end, crossfade to the loop start over the configured crossfade length (64-256 samples)
8. **Mix microphone positions** according to their individual volume/pan settings
9. **Apply per-instrument effects** (EQ, reverb send, etc.)

### 2.4 Disk Streaming (Native Only)

For libraries that can be 20-100GB+, loading everything into RAM is impractical:

- **Preload buffer**: load the first 64-240KB (configurable) of every sample into RAM. This covers the attack transient of any note with zero latency.
- **Background streaming thread**: when a note is triggered, the streaming thread begins reading the remainder of the sample from disk into a ring buffer.
- **Double-buffered**: two streaming buffers per voice. While one is being read by the audio thread, the other is being filled by the disk thread.
- **Priority queue**: the streaming thread prioritizes active voices that are about to exhaust their preloaded buffer.
- **SSD assumption**: modern SSDs can sustain 500MB/s+, supporting hundreds of simultaneous streams at 44.1kHz stereo (each stream = ~176KB/s).
- **`creek` crate** or equivalent for async file reading on a dedicated thread.
- **On WASM**: no disk streaming. Provide a "web edition" with reduced sample counts (fewer RRs, fewer dynamic layers, shorter loops) that fits in ~500MB-1GB of memory.

### 2.5 Sample Format

- **Source format**: WAV or FLAC (losslessly compressed, ~60% of WAV size)
- **Internal format**: decoded to 32-bit float PCM in memory
- **Sample rate**: 44.1kHz or 48kHz (matching the session). If samples are recorded at 48kHz and session is 44.1kHz, resample on load using `rubato`.
- **Channels**: mono or stereo per mic position. Multiple mic positions stored as separate mono/stereo files, mixed at playback time.
- **Metadata**: sample start/end, loop points, root note, tuning — stored in a JSON/TOML manifest file alongside the samples, or embedded in WAV metadata chunks.

---

## PART 3: ARTICULATION SYSTEM

### 3.1 Articulation Switching Methods

Research and specify three switching methods (all should be supported simultaneously):

**3.1.1 Keyswitching**

- Dedicated MIDI notes (below the instrument's playable range, typically C0-B0) switch the active articulation
- Latching: keyswitch stays active until another is pressed
- Momentary: articulation reverts when keyswitch is released (useful for brief trills or staccato passages)
- Visual feedback: the DAW UI should show the currently active articulation

**3.1.2 Articulation IDs (Logic Pro approach)**

- Each MIDI note-on carries an articulation ID as metadata (not a separate MIDI event)
- The playback engine maps articulation IDs to internal articulations via a user-configurable mapping table
- This is cleaner than keyswitching because it doesn't consume note data and survives transposition
- Implementation: encode articulation ID in a custom MIDI event or as a note attribute in the internal MIDI representation

**3.1.3 Velocity-based switching**

- Different velocity ranges trigger different articulations (e.g., vel 1-60 = legato, vel 61-100 = sustained, vel 101-127 = marcato)
- Useful for instruments where attack character naturally varies with playing force
- Configurable velocity split points per instrument

**3.1.4 CC-based switching**

- A dedicated MIDI CC (e.g., CC32) selects the articulation by value range
- Allows real-time switching without keyswitches cluttering the note data
- Combine with UACC (Universal Articulation Controller Channel) standard used by Spitfire

### 3.2 Essential Articulations Per Section

Research each articulation type in detail — what it sounds like, how it's played on the real instrument, and how it differs from related articulations:

**Strings (Violin, Viola, Cello, Double Bass — solo and ensemble):**

Sustained:

- **Long / Sustain**: standard bowed note with natural vibrato. The most fundamental articulation.
- **Long (non-vibrato)**: sustained without vibrato — colder, more exposed sound. Used for pp passages and contemporary music.
- **Long (con sordino / muted)**: with a mute on the bridge. Darker, softer, more intimate sound.
- **Flautando**: bowing near the fingerboard with light pressure. Glassy, ethereal, almost flute-like.
- **Sul tasto**: bowing over the fingerboard. Similar to flautando but slightly warmer.
- **Sul ponticello**: bowing near the bridge. Harsh, glassy, metallic — rich in upper harmonics. Common in film scoring for tension.
- **Harmonics**: natural or artificial harmonics. Pure, bell-like overtones.

Short:

- **Spiccato**: bouncing bow, short and articulate. The default "short note" for most contexts.
- **Staccato**: shorter and more defined than spiccato, bowed with a stop.
- **Staccatissimo**: extremely short, like a musical period.
- **Pizzicato**: plucked string. Completely different from bowed — uses a separate set of samples.
- **Bartók pizzicato (snap)**: string pulled up and snapped against the fingerboard. Violent, percussive.
- **Col legno**: hitting the string with the wood of the bow. Dry, percussive click.

Repeated/Rhythmic:

- **Tremolo**: rapid back-and-forth bowing on a single note. Measured (in tempo) or unmeasured (as fast as possible).
- **Trills**: rapid alternation between two adjacent notes. Half-step and whole-step variants.

Legato transitions:

- **Slurred (fingered)**: change note without changing bow direction.
- **Portamento**: slide between notes. Triggered by lower velocity or a dedicated CC.
- **Runs**: fast passages with abbreviated transitions.

**Brass (Trumpet, Horn, Trombone, Tuba — solo and ensemble):**

Sustained:

- **Long / Sustain**: standard sustained note with natural vibrato
- **Long (non-vibrato)**: no vibrato, more "military" or "heroic" character
- **Long (muted)**: with straight mute, cup mute, harmon mute (each a different mute type producing different timbres)
- **Crescendo / Decrescendo**: notes that swell or fade over time (recorded as complete gestures)
- **Sforzando (sfz)**: loud accent attack followed by immediate drop to sustain level

Short:

- **Staccato**: short, separated
- **Staccatissimo**: very short
- **Marcato**: strong, accented, with weight

Effects:

- **Rips**: upward glissando into a note (jazz/film)
- **Falls**: downward glissando away from a note
- **Shakes / Doits**: lip trills and bends
- **Flutter tongue**: rapid tongue-roll creating a growling tremolo effect
- **Muted variants**: straight mute, cup mute, harmon mute (with and without stem), plunger mute

Legato:

- **Slurred**: smooth transition between notes without re-tonguing
- **Tongued**: each note re-articulated with the tongue
- **Lip trills**: rapid alternation between adjacent harmonics

**Woodwinds (Flute, Oboe, Clarinet, Bassoon, Piccolo, English Horn, Bass Clarinet, Contrabassoon — solo and ensemble):**

Sustained:

- **Long**: standard sustained note
- **Long (vibrato / non-vibrato)**: woodwinds naturally use varying vibrato
- **Long (overblown)**: forced upper register, edgy
- **Multiphonics**: multiple pitches simultaneously (contemporary technique)

Short:

- **Staccato**: tongued short note
- **Staccatissimo**: very short
- **Kiss / Pop**: breathy attack for flute

Effects:

- **Flutter tongue**: rapid tongue roll (available on flute, clarinet)
- **Trills**: half-step and whole-step
- **Runs / Arpeggios**: recorded fast passages
- **Key clicks**: percussive sound of keys without blowing (contemporary)
- **Overblowing**: forced harmonics

Legato:

- **Slurred**: smooth connected notes
- **Tongued legato**: each note re-articulated but connected
- **Speed-dependent**: fast passages automatically use shorter transitions

**Percussion (Timpani, Snare, Bass Drum, Cymbals, Glockenspiel, Xylophone, Marimba, Vibraphone, Celesta, Tubular Bells, Tam-tam, Triangle, Castanets, Tambourine, etc.):**

- **Hit types per instrument**: varies by instrument. Timpani: soft mallet, hard mallet, roll, dampened. Snare: center hit, rimshot, rim click, buzz roll, flam.
- **Dynamic layers**: percussion requires many velocity layers (8-16) because the timbral change with dynamic is extreme (a soft timpani hit sounds completely different from a loud one — not just quieter).
- **Round robins**: essential for rolls and repeated hits.
- **Rolls**: recorded as sustained samples with loop points, or triggered as fast repeated hits.
- **Dampening / muting**: hand-dampened after hit, or allowed to ring. Release trigger for the dampening sound.

**Choir / Vocals:**

- **Vowel sounds**: Ah, Eh, Ee, Oh, Oo — each a separate articulation or crossfadable via CC
- **Syllables**: common choral syllables for building words
- **Humming**: closed-mouth sustained
- **Staccato syllables**: short vocal attacks
- **Dynamics**: choir dynamics are typically CC1-controlled with many (5+) layers
- **Divisi**: splitting sections (sopranos into Sop 1 and Sop 2) for harmonic parts
- **Word-builder** (stretch goal): assemble syllables into words via a text input — extremely complex, used by EastWest WordBuilder and Soundiron Requiem

### 3.3 Articulation Presets

Pre-configured articulation sets per instrument family that map keyswitches to the most common articulations:

Example for "Violins 1 — Standard":

```
C0  → Long (sustain with vibrato)
C#0 → Long (non-vibrato)
D0  → Tremolo
D#0 → Trills (half-step)
E0  → Spiccato
F0  → Staccato
F#0 → Pizzicato
G0  → Legato
G#0 → Legato (portamento)
A0  → Con sordino
A#0 → Flautando
B0  → Col legno
```

Users should be able to create custom articulation maps.

---

## PART 4: EXPRESSION AND DYNAMICS

### 4.1 The CC1/CC11/Velocity Model

This is the standard orchestral expression model used by virtually all professional libraries:

- **Velocity** (0-127): Controls the **attack character** — how the note begins. Higher velocity = more aggressive attack, not necessarily louder sustain. In some articulations (staccato, pizzicato), velocity IS the primary dynamic control. In sustained articulations, velocity affects the initial transient only.

- **CC1 (Mod Wheel)** (0-127): Controls the **sustained dynamic level** — crossfades between dynamic layers (pp→p→mp→mf→f→ff) in real-time. This is independent of velocity. You can have a gentle attack (low velocity) but a loud sustain (high CC1), or vice versa. This is the primary expressive control.

- **CC11 (Expression)** (0-127): Controls the **overall volume** as a multiplier on top of CC1. Used for phrase-level dynamics (crescendos, diminuendos) without changing the timbral layer. CC11 at 50% with CC1 at ff still sounds like ff timbrally, just quieter. CC1 at pp sounds like pp timbrally, regardless of CC11.

Research the exact crossfading algorithm:

- How to map CC1 (0-127) to dynamic layer blending. Not a hard switch — smooth crossfade between adjacent layers.
- Equal-power crossfade vs linear crossfade between layers. Equal-power prevents the "dip" in perceived volume during transitions.
- Crossfade width: how much overlap between adjacent dynamic layers? Typically 10-30% overlap.
- Response curve: should CC1 be linear, logarithmic, or custom? Most libraries use a slight S-curve.

### 4.2 Vibrato Control

- **Natural vibrato**: baked into the samples at the performed dynamic level. Most orchestral recordings include natural vibrato.
- **CC-controlled vibrato depth**: use CC2 or a dedicated CC to crossfade between vibrato and non-vibrato versions of the same articulation. This requires recording both variants.
- **Synthetic vibrato augmentation**: for fine vibrato control beyond what's baked into samples, apply a subtle pitch LFO (rate: 4-7Hz, depth: 10-40 cents depending on instrument and dynamic). This supplements rather than replaces natural sample vibrato.
- **Vibrato onset**: in real playing, vibrato starts after the note onset, not simultaneously. Delay vibrato by 100-300ms from note start for realism.

### 4.3 Humanization

Without humanization, sample-based orchestral playback sounds mechanical. The engine should apply per-note random variations:

- **Timing variation**: ±5-20ms per note (configurable). Ensemble instruments naturally have slight timing differences between players.
- **Tuning variation**: ±2-8 cents per note. Real players are not perfectly in tune, especially in large sections.
- **Dynamic variation**: ±3-10% per note. Subtle loudness differences between notes.
- **Vibrato variation**: ±10-20% on vibrato rate and depth per note.
- **Round-robin randomization**: don't just cycle sequentially — use weighted random selection with repetition avoidance.

These variations should be controllable with a single "Humanize" amount knob (0% = perfect machine, 100% = full natural variation) that scales all parameters proportionally.

### 4.4 Section Size Scaling (VSL-inspired)

For ensemble patches, allow crossfading between different section sizes:

- **Solo**: 1 player
- **Small**: 2-4 players
- **Medium**: 6-10 players
- **Large**: 12-18 players (full section)

This requires separate sample sets per section size OR intelligent layering of solo/small recordings with time-offset and tuning variation to simulate larger sections. The layering approach is more practical:

To simulate a section from a solo recording:

1. Duplicate the solo voice N times
2. Apply per-instance tuning offset (±2-5 cents Gaussian distribution)
3. Apply per-instance timing offset (±10-30ms)
4. Apply per-instance dynamic variation (±5%)
5. Pan each instance slightly differently across the stereo field according to orchestral seating

This won't match the quality of recorded ensemble sections but provides useful scalability.

---

## PART 5: LEGATO ENGINE

This is the most critical component for realism. Bad legato = immediately sounds fake.

### 5.1 True Legato (Sample-Based Transitions)

**How true legato libraries work:**

1. Musician plays note A at dynamic level D
2. While sustaining A, musician plays transition to note B
3. The transition sound (the actual bow movement / breath change from A to B) is recorded
4. For every combination of (interval, dynamic, transition type), a separate sample exists

**Coverage typically recorded:**

- Intervals: -12 to +12 semitones (one octave up and down)
- Dynamics: 2-3 layers (p, mf, f) — fewer than sustain because transitions are brief
- Transition types: slurred/fingered (default), portamento (triggered by low velocity or CC)
- Total per instrument: ~25 intervals × 3 dynamics × 2 types = ~150 transition samples

**Playback algorithm for legato:**

```
on note_on(new_note, velocity):
    if currently_sustaining(old_note):
        // Calculate interval
        interval = new_note - old_note

        // Select transition type based on velocity or CC
        transition_type = if velocity < 64: Portamento else: Slurred

        // Find the matching transition sample
        transition = find_transition(interval, current_dynamic, transition_type)

        // Crossfade: current sustain → transition → new note sustain
        // Phase 1: fade out current sustain over 30-80ms
        // Phase 2: play transition sample (typically 100-300ms)
        // Phase 3: crossfade from transition tail into new note sustain

        start_legato_crossfade(old_note, transition, new_note)
    else:
        // No legato — trigger normally with attack sample
        play_note_with_attack(new_note, velocity)
```

### 5.2 Adaptive Legato (CSS-inspired)

Make the legato response adapt to playing speed:

- **Slow legato** (>300ms between notes): full transition sample, portamento option, expressive
- **Medium legato** (100-300ms): standard slurred transition, moderate crossfade
- **Fast legato** (<100ms): abbreviated transition, quick crossfade, suitable for runs and fast passages

Implementation: measure the time between the previous note-on and the current note-on. Use this interval to select from multiple transition sample sets or to truncate the transition crossfade time proportionally.

### 5.3 Polyphonic Legato (Divisi Tracking)

For ensemble instruments playing chords, the engine needs to track which notes are "new" vs "sustained":

- When a chord changes from C-E-G to C-E-A, the C and E voices should sustain (no re-attack), and only the G→A transition should trigger a legato transition
- This requires voice tracking: maintain a list of currently held notes and their voice assignments
- When a new note arrives while others are held, determine which existing voice is closest in pitch and trigger a legato transition for that voice
- The remaining held notes continue sustaining unchanged

### 5.4 Synthetic Legato Fallback

When no recorded transition sample exists for a given interval (e.g., interval > 12 semitones), generate a synthetic transition:

1. Quick fade-out of old note (20-40ms)
2. Pitch slide from old note to new note using pitch-bend on the new sample during the first 50-100ms
3. Quick fade-in of new note
4. This sounds less natural than true legato but is better than a hard cut

---

## PART 6: MICROPHONE POSITIONS AND SPATIAL MIXING

### 6.1 Standard Orchestral Mic Positions

Research and specify the standard orchestral recording setup. Each position captures a different balance of direct sound vs room ambience:

- **Close**: positioned near the instruments (~1-3 meters). Dry, detailed, forward sound. Most direct, least room.
- **Decca Tree**: classic three-mic stereo configuration (L-C-R) positioned above and in front of the conductor position (~3-5 meters up, 2-3 meters in front). The "classic orchestral recording" sound.
- **Room / Ambient**: positioned further back in the hall (~10-20 meters). Captures mostly room reflections. Spacious, blended, less definition.
- **Outrigger**: wide stereo pair (left and right) beyond the orchestra boundaries. Adds width.
- **Balcony / Gallery**: very distant position. Huge reverb, minimal detail. Used for "epic" cinematic mixes.
- **Leader (section leader)**: close mic on the principal player. Detailed and soloistic.
- **Spot / Sectional**: close mic on a specific section (e.g., cellos, horns). For balance control.
- **Surround** (5.1/7.1): rear channels for immersive mixing.

### 6.2 Mic Position Mixing in the Engine

Each mic position is stored as a separate set of samples (or separate channels in the same file). The engine mixes them at playback time:

```rust
struct MicPosition {
    id: MicPositionId,
    name: String,                    // "Close", "Decca Tree", "Ambient"
    volume: f32,                     // 0.0 - 1.0
    pan: f32,                        // -1.0 (L) to +1.0 (R)
    delay_ms: f32,                   // Simulates distance (speed of sound: ~1ms per foot)
    enabled: bool,                   // Load/unload to save memory
    stereo_width: f32,               // For stereo mic positions, control width
}
```

Users can blend mic positions to create their desired sound:

- "Close + a touch of Room" = punchy, present
- "Decca Tree only" = classic film score
- "Decca Tree + Ambient + Outrigger" = massive, cinematic
- "Close only" = dry, suitable for external reverb processing

### 6.3 Virtual Stage Positioning

If true mic positions aren't available (e.g., with physically modeled or synthesized orchestral sounds), simulate positioning:

- **Panning**: place instrument at its standard orchestral seating position (violins left, cellos left-center, violas center, basses right, etc.)
- **Distance via convolution**: use a short room impulse response, with early reflection timing matching the instrument's distance from the mic
- **Distance via EQ**: attenuate high frequencies with a gentle lowpass (air absorption: ~1dB per 10 meters above 5kHz)
- **Distance via wet/dry**: more distant instruments have higher reverb-to-direct ratio

Standard orchestral seating positions (from audience perspective):

- Violin 1: far left
- Violin 2: center-left
- Violas: center
- Cellos: center-right
- Basses: far right (or behind cellos)
- Flutes: center-left, behind strings
- Oboes: center, behind strings
- Clarinets: center-right, behind strings
- Bassoons: center-right, behind woodwinds
- Horns: left, behind woodwinds
- Trumpets: center, behind horns
- Trombones: center-right, behind trumpets
- Tuba: right, behind trombones
- Timpani: center-right, far back
- Percussion: right, far back
- Harp: far left, near violins

---

## PART 7: PHYSICAL MODELING AUGMENTATION

### 7.1 Hybrid Approach: Samples + Physical Models

Pure sampling is limited: finite round robins, fixed vibrato, finite dynamic layers. Pure physical modeling lacks timbral realism for ensemble sounds. The hybrid approach uses samples for the core timbre and physical models to add continuous variation:

**7.1.1 Bow Noise / Breath Noise Layer**

- A separate noise layer simulating the physical sound of bow-on-string friction or air-through-tube turbulence
- Generated in real-time, continuously variable
- Intensity mapped to CC1 (louder playing = more bow noise / breath noise)
- Filter the noise to match the instrument's spectral characteristics
- Mix subtly with the sample playback (~-20 to -30dB below the main signal)

**7.1.2 Vibrato Modeling**

- Instead of relying entirely on baked-in sample vibrato, add a controllable vibrato layer:
    - Pitch LFO (rate: 4-7Hz, depth: 10-50 cents, controllable via CC2)
    - Amplitude LFO (subtle, ~1-3dB, slightly slower than pitch, simulating bow pressure variation)
    - Timbre LFO (modulate a formant filter to simulate the timbral change that accompanies real vibrato)
    - Vibrato onset delay (100-300ms from note start)
    - Per-note random variation in rate and depth

**7.1.3 Release Modeling**

- When release trigger samples aren't available, synthesize the release:
    - Exponential decay of the sustaining sample (~50-200ms)
    - Add a filtered noise burst for string lift / breath stop (~10-30ms)
    - Add room tail (short convolution reverb or algorithmic reverb)

**7.1.4 String Resonance (Sympathetic Vibration)**

- When a cello plays an open G, the other open strings (C, D, A) vibrate sympathetically
- Model this with a bank of bandpass filters tuned to the instrument's open string frequencies, excited by the main output
- Subtle but adds a sense of physical resonance that samples alone don't capture
- Controlled by a "Sympathetic Resonance" knob (0-100%)

### 7.2 Physical Modeling for Solo Instruments (Stretch Goal)

For solo string and wind instruments where continuous expression matters most, consider a full SWAM-like physical model as an alternative engine:

**Bowed string model:**

- Waveguide string (two delay lines for traveling waves)
- Bow-string interaction (friction model: Helmholtz motion with slip-stick behavior)
- Bridge + body resonance (pair of 2D waveguide meshes or transfer function from measured impulse response)
- Parameters: bow position, bow pressure, bow speed, vibrato, string selection

**Wind instrument model:**

- Bore model (cylindrical or conical tube waveguide)
- Reed/lip excitation model (mass-spring-damper system)
- Tone holes (open/closed state affects effective tube length)
- Parameters: breath pressure, embouchure tension, vibrato, key positions

These are research-intensive and CPU-expensive. Include in the architecture but mark as a later phase. The sample-based engine is the priority.

---

## PART 8: RELEASE TRIGGERS AND NOTE-OFF BEHAVIOR

### 8.1 What Are Release Triggers

When a real instrument stops playing, there's a characteristic sound:

- **Strings**: the bow lifts, creating a soft noise. Open strings continue resonating briefly.
- **Brass**: the embouchure relaxes, air stops, there may be a brief resonance tail.
- **Woodwinds**: breath stops, key noise may occur, the tube resonance decays.
- **Piano**: the damper returns to the string, creating a soft thud and brief resonance.

Release trigger samples capture these sounds. They play automatically on note-off.

### 8.2 Release Trigger Implementation

```
on note_off(note, velocity):
    // Start release phase of the main sample (ADSR release stage)
    voice.start_release()

    // Simultaneously trigger the release sample
    if articulation.has_release_triggers:
        release_sample = find_release_sample(note, current_dynamic)
        play_release_sample(release_sample, velocity=release_velocity)

    // Release sample volume should scale with:
    // 1. How long the note was held (longer = louder release, to some threshold)
    // 2. The current dynamic level (CC1)
    // 3. Release velocity if available (not all controllers send this)
```

### 8.3 Pedaling and Sustain

- **CC64 (Sustain Pedal)**: when on, notes continue sustaining after key release. Release triggers should NOT fire until the pedal is lifted.
- **Half-pedaling**: CC64 values between 0-127 control partial damping (more relevant for piano but applicable to sustained orchestral instruments in the sense of partial release behavior)
- When pedal is lifted, all sustained notes should fade out naturally with their release envelopes, and release triggers for all currently "pedaled" notes should fire in a slightly staggered fashion (±10-30ms) to avoid an obvious coordinated stop.

---

## PART 9: PERFORMANCE INTELLIGENCE

### 9.1 Auto-Divisi

When writing for a string ensemble (e.g., 16 violins) and playing a chord, a real orchestra doesn't have all 16 players play all chord notes. They divide (divisi):

- 2-note chord: 8 violins on each note
- 3-note chord: 5+5+6 distribution
- 4+ note chord: 4+4+4+4

The engine should detect polyphonic playing and automatically:

1. Reduce the volume of each note proportionally (divisi reduces the number of players per note)
2. Apply slight tuning and timing variation per divisi group
3. Optionally switch to a smaller section size sample for each note

### 9.2 Intelligent Articulation Selection

Beyond manual keyswitching, provide an "auto-articulate" mode:

- Short notes (< 200ms played duration) → staccato
- Medium notes (200-500ms) → sustain with short release
- Long notes (> 500ms) → sustain
- Overlapping notes → legato
- Repeated same note → use alternating round robins, potentially switch to spiccato if tempo is fast
- Very fast passages → runs/scales articulation

This is configurable with thresholds and can be overridden per note.

### 9.3 Ensemble Timing and Realism

Real orchestral sections don't play in perfect unison:

- **Attack spread**: when an ensemble section plays a note, individual players start ±5-20ms apart. The engine should apply random timing offsets per "virtual player."
- **Pitch convergence**: players start slightly out of tune and converge over ~200-500ms as they listen to each other. Start with ±5 cents random offset, smoothly correct toward unison.
- **Dynamic bloom**: ensemble dynamics "bloom" — the section starts together but the collective crescendo takes shape over 100-300ms as players respond to each other.

---

## PART 10: UI STRUCTURE

Same 5-level progressive disclosure as the synth and drum machine:

### Level 1 — Play

- Instrument selector (Violins 1, Cellos, Trumpets, etc.)
- Preset/patch browser
- Macro knobs (Dynamics, Vibrato, Space, Brightness, Attack, Release)
- Simple keyboard display showing playable range

### Level 2 — Shape

- Current articulation indicator
- Basic CC1/CC11 assignment display
- Simple EQ and reverb send
- Mic position blend (Close vs Room slider)

### Level 3 — Build

- Full articulation list with keyswitch assignments
- Dynamic layer visualization (shows current CC1 → layer mapping)
- Round robin count display
- Legato mode toggle and settings
- Per-articulation controls (attack, release, tuning)

### Level 4 — Route

- Full mic position mixer (individual volume/pan per mic)
- Output routing (stereo, multi-out per mic position)
- Send effects
- EQ and dynamics per mic position

### Level 5 — Lab

- Humanization controls (timing, tuning, dynamic variation amounts)
- Auto-divisi configuration
- Legato engine tuning (crossfade times, velocity thresholds)
- Physical modeling augmentation controls (bow noise, sympathetic resonance)
- Sample import / custom mapping tools
- Section size scaling

---

## PART 11: INTEGRATION WITH THE DAW

### 11.1 As a DAW Instrument

- Each orchestral instrument (Violins 1, Trumpets, Timpani, etc.) loads as a separate instance in the DAW's instrument slot
- Receives MIDI from the track, outputs audio to the mixer
- Full automation of all parameters from the DAW's automation lanes

### 11.2 Orchestral Template System

- Pre-built DAW templates with all standard orchestral sections loaded, routed, and positioned:
    - "Full Orchestra" (60+ tracks: all strings, brass, woodwinds, percussion)
    - "String Orchestra" (strings only: Vln1, Vln2, Vla, Vc, Cb, solo variants)
    - "Brass Section" (Hrn, Tpt, Tbn, Tba, solo and ensemble)
    - "Chamber Ensemble" (reduced instrumentation)
- Templates include mixer routing, bus processing, reverb sends, panning

### 11.3 Articulation Lane in Piano Roll

- The DAW's piano roll should support an **articulation lane** below the note data
- Each note can have an articulation assignment that overrides the current keyswitch state
- Visual color-coding per articulation type
- This is the modern approach (used by Cubase Expression Maps, Logic Articulation Sets, Dorico) — cleaner than scattering keyswitch notes in the MIDI data

### 11.4 Sharing Effects with the Master Synth and Drum Machine

- All effects from `daw-dsp` are available as per-instrument inserts
- The same reverb, EQ, compressor used in the synth's FX lanes can be inserted on an orchestral instrument channel
- Convolution reverb (from `daw-dsp`) with orchestral hall IRs is particularly important for the orchestral suite

---

## PART 12: SAMPLE CONTENT STRATEGY

### 12.1 What We Need to Record / Source

The engine is worthless without samples. Strategies for acquiring content:

**Option A: Record Original Samples**

- Hire orchestral musicians, book a scoring stage with good acoustics
- Record every instrument × every articulation × 3-5 dynamic layers × 3-6 round robins × chromatic sampling (every 1-3 semitones)
- This is extremely expensive ($100K-$1M+) and time-consuming (months of recording + editing)
- Produces the highest quality, uniquely owned content

**Option B: Use Open-Source / Creative Commons Samples**

- Several free orchestral libraries exist:
    - **Virtual Playing Orchestra** (creative commons, Sonatina Symphonic Orchestra-based)
    - **VSCO 2 Community Edition** (Versilian Studios, CC-BY)
    - **Iowa University Electronic Music Studios** (public domain instrument recordings)
    - **Philharmonia Orchestra Sound Samples** (educational use)
    - **SSO (Sonatina Symphonic Orchestra)** (CC-BY, basic but functional)
- Quality varies, but provides a starting point for a free tier

**Option C: AI-Generated / Resynthesized Samples (Experimental)**

- Use generative audio models (e.g., MusicGen, Stable Audio) trained on orchestral recordings to generate sample content
- Or use resynthesis: analyze a recording, extract the spectral characteristics, resynthesize as new content that's not a copy of the original
- Legal and quality concerns — this is a frontier area

**Recommended approach:** Start with Option B (free/CC samples) for the initial release, plan for Option A (original recordings) as the product matures. Build the engine first, fill it with content second.

### 12.2 Sample Specification for Recording

If recording original content, specify:

- **Pitches**: chromatically every minor third (C, Eb, F#, A) for most instruments; every semitone for solo instruments and legato transitions
- **Dynamic layers**: pp, mp, mf, f, ff (5 layers) for sustains; pp, mf, ff (3 layers) for shorts
- **Round robins**: 4 per dynamic layer for shorts (spiccato, staccato, pizzicato); 2-3 for sustains (less critical with looped samples)
- **Legato transitions**: every semitone interval from -12 to +12, at 3 dynamic levels, 2 transition types (slurred + portamento)
- **Release triggers**: 3 dynamic levels, 2 round robins each
- **Mic positions**: Close, Decca Tree, Room/Ambient, Spot (4 minimum)
- **Sample rate**: 48kHz, 24-bit
- **Format**: WAV, with metadata (root note, loop points) embedded

---

## DELIVERABLE FORMAT

1. **For the sample playback engine**: complete Rust data structures, zone selection algorithm, dynamic crossfading algorithm, loop crossfading, disk streaming architecture
2. **For the articulation system**: all switching methods, per-instrument articulation lists with descriptions, automatic articulation selection logic
3. **For the expression system**: CC1/CC11/velocity model, dynamic layer crossfading math, vibrato control, humanization parameters
4. **For the legato engine**: true legato crossfade algorithm, adaptive speed-based transitions, polyphonic divisi legato, synthetic legato fallback
5. **For mic positions**: mixing architecture, virtual positioning with panning/distance simulation, per-mic EQ and delay
6. **For physical modeling augmentation**: bow noise synthesis, breath noise synthesis, sympathetic string resonance, vibrato modeling
7. **For release triggers**: triggering logic, volume scaling based on note duration and dynamic
8. **For performance intelligence**: auto-divisi, auto-articulation, ensemble timing simulation
9. **For the UI**: how the 5-level progressive disclosure applies to orchestral instruments specifically

---

## RESEARCH SOURCES TO PRIORITIZE

- Spitfire Audio developer talks and documentation (BBC SO, Albion, Chamber Strings)
- Vienna Symphonic Library white papers on the Synchron Player engine
- Audio Modeling SWAM technical documentation (physical modeling approaches)
- Julius O. Smith III, "Physical Audio Signal Processing" (ccrma.stanford.edu) — bowed string models, wind instrument models
- Kontakt scripting references (many orchestral libraries publish their Kontakt scripts)
- Pianobook.co.uk community (insights into sampling methodology from creators)
- Christian Henson (Spitfire co-founder) YouTube videos on sampling techniques
- Native Instruments Kontakt manual — sample zone mapping, round robin, keyswitching
- SFZ format specification (sfzformat.com) — open standard for sample instrument definition
- Steinberg Expression Maps documentation — articulation management
- Logic Pro Articulation Set documentation
- "The Guide to MIDI Orchestration" by Paul Gilreath — standard reference for realistic MIDI orchestral programming
- Sound On Sound "Session Notes" and "Orchestral Sampling" features
- Orchestration textbooks (Adler, Blatter, Piston) — for understanding real instrument capabilities and limitations
- DAWproject specification — for orchestral template interoperability
- KVR forums — "what makes [library X] sound more realistic than [library Y]" discussions
- VI-Control.net forums — the primary community for orchestral composers and sample library users, extensive technical discussions about playback engines
