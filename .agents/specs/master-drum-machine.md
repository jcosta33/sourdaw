# Research Specification: The Master Drum Machine

## Purpose of this document

This is a research brief for an AI agent. Your job is to produce a **complete implementation guide** for building the ultimate drum machine plugin — one that combines the best features from every flagship drum machine, sampler, and drum synthesizer into a single instrument. The output must be detailed enough that an AI coding agent can implement it from start to finish in Rust.

This drum machine is a sibling to the Master Synth (see `master-synth-research-spec.md`). They share the `daw-dsp` crate for DSP algorithms and the `daw-core` crate for types. The drum machine lives in its own `daw-drum-machine` crate (or as a module within `daw-synth`) with the same constraints: no I/O, no threads, compiles to both native and `wasm32-unknown-unknown`.

---

## What we are building

A pad-based drum instrument where every pad is a full instrument channel: each pad can host any combination of sample playback, drum synthesis engines, and layered sources, with its own independent effect chain, its own modulation, its own mixer channel, and its own output routing. The instrument includes an integrated step sequencer with per-step probability, velocity, and micro-timing. It must handle everything from classic 808/909 electronic drums to layered acoustic kits to experimental sound design percussion.

**This must surpass:**

- Logic Pro's Drum Machine Designer (per-pad channel strips + Quick Sampler + Drum Synth)
- Ableton's Drum Rack (nested instrument/effect chains per pad, macro controls, choke groups)
- NI Battery 4 (128-cell grid, multi-layer sample cells, per-cell effects, 4 bus routing)
- FL Studio's FPC (16 pads, layering, velocity-sensitive switching)
- Bitwig's Drum Machine (per-pad device chains, nested FX, modulation per pad)
- openDAW's Playfield (per-pad independent effect chains)
- NI Maschine (pad performance, pattern sequencing, sampling workflow)
- Hardware references: Akai MPC, Roland TR-808/909, E-mu SP-1200, Elektron Digitakt

---

## Technology constraints (same as the master synth)

- Rust, no_std compatible DSP, compiles to native + WASM
- Shares `daw-dsp` for all DSP algorithms (filters, envelopes, effects are identical to those in the master synth — build once, use everywhere)
- Shares `daw-core` for newtypes (TrackId, Beats, Decibels, etc.)
- Exposes: `fn process(midi_events: &[MidiEvent], output: &mut [&mut [f32]], block_size: usize)`
- Native: runs as a node in daw-engine's compiled schedule via cpal
- Web: WASM in AudioWorkletProcessor, 128-sample blocks
- WebGPU for visualization (pad grid, waveform displays, step sequencer, meters)
- React 19 frontend with progressive disclosure UI matching the master synth's 5-level model
- Preset format: JSON, same serialization approach as the synth

---

## PART 1: REFERENCE DRUM MACHINES — WHAT MAKES EACH ONE BEST-IN-CLASS

For each reference, the research must identify the specific feature or architectural decision that makes it special — then specify how the master drum machine incorporates it.

### 1.1 Logic Pro — Drum Machine Designer + Drum Synth

**What makes it special:**

- Each pad is a **full DAW channel strip** with its own instrument slot and effects chain. This means any Logic instrument (Quick Sampler, Drum Synth, Alchemy, or any AU plugin) can be the sound source for any pad. No other drum machine is this open.
- **Drum Synth** provides dedicated synthesis engines per drum type: different models for kick, snare, clap, hi-hat, tom, percussion, each with parameters specifically tuned to that drum type (not generic oscillator+filter but purpose-built algorithms).
- **Quick Sampler** integration: drag any audio file onto a pad, it opens in Quick Sampler with one-shot mode, Flex Time, slice mode. Four playback modes: Classic (simple), One Shot, Slice, Recorder.
- **Drummer integration**: AI-driven pattern generation that adapts to the song. Not just a step sequencer — Drummer analyzes the arrangement and generates contextually appropriate patterns.
- **Track stack architecture**: the drum machine isn't a monolithic plugin, it's a track stack where each pad is a subtrack. This means the mixer sees individual channels for every drum piece.

**What to take:**

- Per-pad full instrument hosting (any synth engine as a pad source)
- Purpose-built drum synthesis engines per drum category
- Quick Sampler-like drag-and-drop with automatic one-shot setup
- The concept of a drum machine as a container for individual instrument channels, not a monolithic sampler

### 1.2 Ableton Live — Drum Rack

**What makes it special:**

- **Nested device chains per pad**: each pad can host a chain of instruments AND a chain of effects, with arbitrary nesting (you can put a Drum Rack inside a Drum Rack pad). This recursive architecture is extremely powerful for layering.
- **Chain selector with zones**: within a single pad, multiple chains can be triggered by velocity zones, key zones, or chain select ranges. This enables velocity-switched layering (soft hit = one sample, hard hit = another) without separate pad setup.
- **Choke groups**: assigning pads to choke groups so triggering one pad silences others in the same group (essential for open/closed hi-hat). Ableton's implementation is simple and visual.
- **16 macro knobs** mapped across all pads: one set of macros controls parameters across the entire kit, enabling kit-wide sweeps (e.g., a "Decay" macro that affects all pad envelopes simultaneously).
- **Simpler/Sampler per pad**: each pad can use Simpler (one-shot, loop, slice modes) or the full Sampler (multi-sample with zones). Simpler's warp modes allow tempo-synced playback of sliced loops.
- **Drum Rack as an Ableton ecosystem hub**: integrates with Push hardware, Session View clip launching, Follow Actions for generative patterns.

**What to take:**

- Nested layering with velocity zones per pad (soft/medium/hard hit → different sources)
- Choke groups with visual assignment
- Kit-level macro controls that span all pads
- The recursive "anything can host anything" philosophy

### 1.3 NI Battery 4

**What makes it special:**

- **128-cell grid** (8×16): far more cells than any competitor, supporting large percussion kits, orchestral percussion maps, and full General MIDI drum layouts
- **Multi-layer cells**: each cell can stack up to 128 sample layers with velocity-sensitive crossfading between layers. This is the deepest sample layering of any drum machine.
- **Per-cell effects**: each cell has its own insert effects (EQ, compressor, filter, distortion, lo-fi, etc.) — not just volume/pan but full processing per sound
- **4 internal buses**: cells route to one of 4 buses (plus direct out), each bus with its own master effects chain. This enables group processing (all kicks → bus 1 → bus compression).
- **Sample editing**: per-cell waveform view with start/end markers, loop points, ADSR envelope, tuning, and reverse. Built-in sample editor that's good enough you don't need to leave the plugin.
- **Tag-based browser**: factory and user kits searchable by tags, with preview. The browser experience was ahead of its time.
- **Cell matrix operations**: copy/paste cells, swap cells, clear ranges, map cells to MIDI ranges. Bulk operations for kit building.

**What to take:**

- Large pad grid (at minimum 64 pads, ideally configurable up to 128)
- Multi-layer per pad with velocity crossfading (up to 16-32 layers per pad for our use case)
- Per-pad sample editing (start/end, loop, ADSR, tune, reverse)
- Internal bus routing (4+ buses with per-bus effects)
- Tag-based kit browser

### 1.4 FL Studio — FPC + Channel Rack drum workflow

**What makes it special:**

- **Dual-bank pad layout**: two pages of 16 pads (A/B) for 32 sounds, with each pad showing its waveform preview directly on the pad face
- **Per-pad layering**: up to 4 layers per pad with independent volume, pan, tuning, cutoff, and dedicated ADSR per layer
- **Step sequencer integration**: FL Studio's Channel Rack step sequencer is the fastest way to program drum patterns in any DAW. Each channel gets a row of step buttons with per-step velocity via right-click.
- **Performance mode**: velocity-sensitive pad triggering with configurable velocity curves per pad
- **Slice integration**: SliceX and DirectWave can feed into FPC pads for chopping loops into pads

**What to take:**

- Visual waveform preview on each pad face
- Fast per-layer controls (not hidden in menus — visible on the pad inspector)
- Tight step sequencer integration (the sequencer is part of the instrument, not a separate view)
- Per-pad velocity curves (some sounds need linear, others logarithmic, others S-curve)

### 1.5 Bitwig Studio — Drum Machine

**What makes it special:**

- **Full device chain per pad**: each pad can host any Bitwig instrument plus any chain of effects, identical to a full track's device chain. Not a simplified version — the real thing.
- **Modulation system applies per-pad**: Bitwig's modulator devices (LFO, envelope follower, step sequencer, random) work inside each pad's device chain, with the modulation halos visible on every knob.
- **Nested containers**: a Drum Machine pad can contain an FX Layer, an Instrument Layer, or even another Drum Machine (recursive nesting like Ableton).
- **Per-pad note receivers**: pads can receive MIDI from specific note ranges, enabling splits and zones.
- **Modulation at audio rate per pad**: the same audio-rate modulation system that powers The Grid works inside drum machine pads, enabling extreme sound design per hit.

**What to take:**

- Full modulation system per pad (not simplified — the same mod sources as the synth)
- Audio-rate modulation for per-pad sound design
- Nested instrument/effect containers per pad

### 1.6 Hardware References — What Hardware Gets Right That Software Often Misses

**Roland TR-808/TR-909:**

- Dedicated synthesis engines per drum type (the 808 kick is a specific bridged-T oscillator circuit, not a generic oscillator). Each drum sound has a unique circuit topology.
- The 808's kick uses a pitch envelope: a sine oscillator with a fast pitch sweep from ~300Hz down to ~50Hz over ~100ms. This is the most important drum synthesis algorithm in music history.
- The 909's kick layers an analog oscillator with a noise burst for the attack click.
- Accent: a global accent that boosts amplitude AND modifies tone (brighter, punchier) — not just volume but timbral change.

**Akai MPC (60, 2000, Live, One):**

- **16 Levels mode**: hit the same pad at different positions on a 4×4 grid, each position maps to a different parameter value (typically velocity, but also tuning, filter, decay). This turns one pad into 16 expressive variations.
- **Note Repeat**: hold a pad and it retriggers at a tempo-synced rate (1/4, 1/8, 1/16, 1/32). Essential for hi-hat rolls and fills.
- **Chop/Slice workflow**: load a loop, set slice markers, assign slices to pads. The MPC's slice workflow is the fastest in any hardware or software.
- **Pad sensitivity curves**: different physical response curves per pad (linear, logarithmic, exponential, fixed velocity).

**E-mu SP-1200:**

- 12-bit sampling at 26.04kHz: the deliberate low-fidelity character (aliasing, quantization noise) that defines golden-era hip-hop drums. The "crunch" is the feature.
- Analog filters on the output: each voice runs through a VCF after the DAC, adding warmth.
- The sound of downsampling and bit-reduction as a deliberate creative tool.

**Elektron Digitakt:**

- **Parameter locks**: per-step automation of any parameter. Every step in the sequencer can have unique filter, pitch, decay, effect settings. This turns the step sequencer into a per-step sound design tool.
- **Conditional trigs**: per-step probability (1%, 50%, 100%), fill trigs (only play when fill button held), first/not-first trigs, modular boolean logic per step.
- **Sound locks**: a single track/pad can play a different sample on each step, turning one sequencer track into a multi-sample instrument.
- **Retrig**: per-step retrigger count and rate (a single step can fire 1-16 micro-retrigs).

**What to take from hardware:**

- Dedicated per-category synthesis engines (808 kick model, 909 kick model, analog clap, etc.)
- 16 Levels mode for expressive pad performance
- Note Repeat for tempo-synced retriggering
- Parameter locks: per-step parameter automation in the step sequencer
- Conditional/probability trigs per step
- Sound locks: different source per step
- The SP-1200 lo-fi character as a built-in "vintage" mode (12-bit, reduced sample rate, analog filter emulation)

---

## PART 2: PAD ARCHITECTURE

### 2.1 Pad Grid

- Configurable grid size: 16 pads (4×4, default), 32 (4×8), 64 (8×8), up to 128 (8×16 à la Battery)
- Multiple pages/banks switchable (A/B/C/D)
- Each pad displays: name, color, waveform preview (thumbnail), assigned MIDI note, group badge, mute/solo state, activity indicator (flashes on trigger)
- Pads are drag-reorderable
- MIDI note assignment per pad (configurable, default follows GM drum map starting at C1)
- Each pad is an independent instrument channel — NOT a cell in a monolithic sampler

### 2.2 Pad Sound Source Architecture

Each pad can host **one or more sound sources (layers)**. Each layer is one of:

**2.2.1 Sample Player**

- Single sample with: start, end, loop start, loop end, loop mode (off, forward, ping-pong), crossfade length
- Root note, tuning (coarse semitones + fine cents)
- Playback modes: one-shot (ignore note-off), gated (release on note-off), loop, reverse, reverse one-shot
- Interpolation: cubic Hermite for real-time
- Waveform display with draggable start/end/loop markers
- Drag-and-drop: drop audio file → auto-detect one-shot setup (set end at silence threshold, normalize)
- ADSR envelope on amplitude
- Key tracking (optional — for melodic percussion like toms, congas)
- Velocity → volume mapping with configurable curve
- **Velocity zone**: this layer only triggers within a velocity range (lo_vel to hi_vel). Enables velocity-switched layering.

**2.2.2 Multi-Sample Player**

- Multiple samples mapped across velocity layers and/or note zones
- Round-robin: cycle through N samples on repeated triggers (avoid machine-gun effect)
- Velocity crossfading between adjacent layers (not hard switching — smooth blend over a configurable range)
- Same controls as single sample player per zone
- SFZ import for pre-mapped multi-sample instruments

**2.2.3 Drum Synth Engine**
Purpose-built synthesis algorithms per drum category. Each engine has parameters specifically tuned for that drum type — not generic oscillator+filter but dedicated models.

Research and fully specify each drum synth engine:

**Kick engines:**

- **808 Kick**: Sine oscillator with pitch envelope (start freq ~300Hz, end freq ~30-80Hz, decay ~50-200ms). Drive/saturation. Tone control (adjusts pitch envelope depth). Decay control. Click transient (noise burst or impulse at onset, ~1-5ms). The most important electronic drum sound — must be perfect.
- **909 Kick**: Layered sine oscillator (pitched) + noise transient (filtered). More aggressive attack than 808. Compression character.
- **Analog Kick**: Tunable sine/triangle oscillator, pitch envelope, optional noise layer, optional distortion. More generic than 808/909 but tunable across a wider range.
- **Acoustic Kick**: Physical model (membrane + air cavity) OR sample-based with resonance modeling. Beater type (felt, wood, plastic) affecting transient character.

**Snare engines:**

- **808 Snare**: Two oscillators (tuned) + filtered noise burst. Snap (noise amount) control. Tone (oscillator mix/tune) control.
- **909 Snare**: Similar structure but with different noise characteristics (sharper, brighter). Snappy/tone balance.
- **Analog Snare**: Tunable oscillator(s) + noise with independent envelopes. More tweakable than 808/909 presets.
- **Acoustic Snare**: Body resonance (modal synthesis: 2-3 resonant modes) + snare buzz (filtered noise modulated by body resonance) + shell ring. Complex but essential for realistic acoustic drums.

**Hi-hat engines:**

- **808 Hi-hat**: 6 square wave oscillators at metallic (non-harmonic) frequencies mixed and filtered through a bandpass + highpass. Closed = short decay, open = long decay. The classic frequencies are approximate ratios like 1:1.4:1.68:2:2.4:2.82 (not exact harmonics — this is what makes it metallic).
- **909 Hi-hat**: Similar multi-oscillator approach but with different filtering and noise character.
- **Analog Hi-hat**: Metallic tone generator (ring mod, FM, or multi-oscillator) + noise + bandpass filter + amplitude envelope. Tune, color, decay controls.

**Clap engines:**

- **808/909 Clap**: Multiple noise bursts spaced ~10-30ms apart (creating the "multiple hands" effect) followed by a reverberant tail (filtered noise with longer decay). Spacing, count (3-7 bursts), tone, decay controls.
- **Acoustic Clap**: Similar multi-burst approach with room simulation.

**Tom engines:**

- **808 Tom**: Simple sine/triangle oscillator with pitch envelope. Very similar to 808 kick but higher pitched and shorter decay. Low/Mid/High variations by changing base pitch.
- **Analog Tom**: Tunable oscillator with configurable pitch envelope depth and decay.

**Cymbal/Crash/Ride engines:**

- Based on metallic multi-oscillator approach (like hi-hat) but with longer decay, lower filtering, and optional shimmer (chorus/modulation in the decay tail).
- Ride: distinct bell vs bow character.

**Percussion engines:**

- **Cowbell**: Two square oscillators at a minor third interval, gated with short envelope.
- **Clave/Rimshot**: Short resonant bandpass-filtered impulse or sine with very fast decay.
- **Shaker/Maracas**: Shaped noise bursts with envelope modulation (density parameter controls grain-like behavior).
- **Generic Percussion**: Flexible noise/tone blend with envelope and filter for creating custom percussion.

**For each drum synth engine, the research must provide:**

1. Block diagram / signal flow
2. The exact oscillator/noise configuration
3. Parameter list with ranges and musical descriptions
4. The per-sample algorithm in Rust pseudocode
5. What makes the BEST version of this engine sound authentic (e.g., for 808 kick: the specific pitch envelope curve shape, the subtle distortion at high drive, the sub-bass character)

**2.2.4 Synth Engine (from the Master Synth)**
Any pad can use a full instance of a master synth generator:

- Wavetable, VA, FM, granular, additive, noise — any synthesis mode from the master synth
- This turns the drum machine into an open-ended sound design tool
- Each pad gets a monophonic (typically) or polyphonic synth voice
- Reuses the exact same Rust structs from `daw-synth` — no code duplication

### 2.3 Per-Pad Processing Chain

After the sound source(s), each pad has its own processing chain:

1. **Layer mixer**: volume, pan, mute/solo per layer
2. **Filter**: one filter with type selection (LP, HP, BP, notch — same filters as the master synth, from `daw-dsp`). Envelope amount, key tracking, velocity tracking.
3. **Insert effects chain**: ordered list of effects from `daw-dsp` — same effects available in the master synth (EQ, compressor, distortion, delay, reverb, etc.). Reorderable, bypassable.
4. **Transient shaper**: attack/sustain controls for punching up or softening the transient. Dedicated because this is so commonly needed on drums.
5. **Output section**: volume, pan, output routing (master, bus 1-4, or direct out to DAW channel)

### 2.4 Choke Groups

- Pads assigned to the same choke group mutually silence each other when triggered
- Primary use: open hi-hat chokes when closed hi-hat is played
- Implementation: on note-on for pad P, check P's choke group. If any other pad in the same group has an active voice, send it an immediate rapid fade-out (5-10ms to avoid clicks), then free the voice.
- Multiple choke groups supported (at least 16)
- Visual: pads in the same choke group share a colored badge/outline

### 2.5 Voice Management (Pad-Level)

- Each pad has a configurable polyphony: 1 (monophonic — retrigger cuts previous), or N (polyphonic — multiple hits overlap)
- Most drum sounds are monophonic with retrigger
- Cymbals and effects are often polyphonic (let multiple hits ring out)
- Total voice pool shared across all pads: pre-allocated, 64-128 voices
- Voice stealing priority: same pad's oldest voice first, then oldest voice across all pads

---

## PART 3: INTEGRATED STEP SEQUENCER

The drum machine must include an integrated step sequencer that competes with Elektron's parameter locks and FL Studio's speed of use.

### 3.1 Pattern Structure

- **Pattern**: a grid of steps for all pads simultaneously
- Configurable step count per pattern: 16, 32, 48, 64 steps (default 16)
- Configurable step resolution: 1/4, 1/8, 1/16, 1/32 notes (default 1/16)
- **Per-pad step count**: each pad's row can have a different number of steps (polymetric patterns — if kick has 16 steps and hi-hat has 15, they cycle at different rates). This is the Elektron approach and creates evolving patterns.
- Multiple patterns (A, B, C, D...) with pattern chaining/arrangement
- Copy/paste patterns, duplicate, clear

### 3.2 Per-Step Data

Each step in the grid stores:

```rust
struct Step {
    active: bool,                    // Is this step triggered?
    velocity: f32,                   // 0.0-1.0, visualized as step height or brightness
    probability: f32,                // 0.0-1.0, chance of firing (1.0 = always)
    micro_timing: f32,               // -0.5 to +0.5 steps, nudge forward/back for swing and humanization
    retrigger_count: u8,             // 0 = normal, 1-16 = retrigger N times within the step duration
    retrigger_rate: f32,             // Speed of retrigs (1/2, 1/3, 1/4 of step duration)
    parameter_locks: Vec<ParamLock>, // Per-step parameter overrides (Elektron-style)
    sound_lock: Option<SoundId>,     // Override the pad's sound source for this step only
    condition: StepCondition,        // Conditional trigger (always, fill, probability, 1st, not-1st, A:B ratio)
}

struct ParamLock {
    parameter_path: String,          // e.g., "filter.cutoff", "layer[0].tune", "fx[0].mix"
    value: f32,                      // Override value for this step
}

enum StepCondition {
    Always,
    Fill,                            // Only trigger when Fill button is held
    NotFill,                         // Only trigger when Fill is NOT held
    Probability(f32),                // % chance
    FirstPlay,                       // Only on first playthrough of pattern
    NotFirstPlay,                    // Only on subsequent playthroughs
    Ratio(u8, u8),                   // Fire every A out of B times (e.g., 3:4 = fire 3 out of every 4 times)
}
```

### 3.3 Step Sequencer Features

**Swing/Groove:**

- Global swing amount: shifts every other step forward/backward in time
- Swing resolution: which steps are affected (typically every other 16th note)
- Groove templates: load timing offsets from classic groove templates (MPC swing, SP-1200 timing, TR-808 shuffle). These are stored as arrays of micro-timing offsets per step.
- Per-pad groove: each pad can have its own swing/groove independent of the global setting

**Humanization:**

- Random velocity variation (±N% per step)
- Random timing variation (±N ms per step)
- Random probability (apply a small random factor to velocity and timing to make patterns feel less rigid)

**Fill mode:**

- A "Fill" button that, when held, activates steps marked with the Fill condition and deactivates steps marked with NotFill
- Used for building drum fills that activate only when the performer presses the fill button during a live performance

**Pattern chaining:**

- Arrange patterns in sequence: A → A → B → A → A → B → C
- Loopable chain with configurable loop points
- One-shot chain mode (play through once and stop)

### 3.4 Step Sequencer UI

- Grid view: rows = pads, columns = steps. Click to toggle steps. Drag vertically on a step to set velocity.
- Velocity view: same grid but step heights represent velocity values
- Probability view: same grid but step opacity/color represents probability
- Parameter lock view: select a parameter, then the grid shows per-step values for that parameter with draggable points
- Micro-timing view: per-step timing offset visualization
- Real-time playback indicator: a moving cursor/highlight showing the current step
- Per-row (per-pad) step count adjustment: drag the row's end boundary to set different step counts per pad

---

## PART 4: PERFORMANCE FEATURES

### 4.1 Pad Performance Modes

- **Velocity-sensitive triggering**: pad input maps to velocity using a configurable curve per pad
- **16 Levels mode (MPC-style)**: select a pad, then the entire 4×4 grid becomes 16 velocity levels of that pad. Position on the grid determines velocity (or another parameter like tuning, filter, decay).
- **Note Repeat**: hold a pad and it retriggers at a configurable tempo-synced rate. Rate is adjustable in real-time (1/4, 1/8, 1/16, 1/32, triplet). With velocity ramp options (accelerating, decelerating, random).
- **Mute/Solo per pad**: instant mute/solo with visual feedback. Multiple pads can be soloed simultaneously.
- **Pad rolls**: rapidly re-trigger a pad with configurable speed and velocity envelope (crescendo roll, decrescendo roll).

### 4.2 Sampling / Recording into Pads

- **Record into pad**: arm a pad, play a sound or speak into the mic, the recording is captured and assigned to that pad as a new sample layer
- **Resample**: record the output of the entire drum machine (or a specific pad, or a bus) back into a new pad. Useful for bouncing processed drums.
- **Auto-chop**: load a drum loop, the machine detects transients and assigns each slice to a separate pad. Adjustable sensitivity threshold. This is the MPC/Recycle workflow.
- **Record quantize**: optionally quantize recorded pad hits to the grid after recording

### 4.3 Kit Macros

- 8 macro knobs (matching the master synth) with kit-wide scope
- Each macro can control parameters across multiple pads simultaneously
- Default macro assignments for common kit-wide adjustments:
    - Tune (pitch all pads up/down)
    - Decay (shorten/lengthen all pad envelopes)
    - Color (filter cutoff sweep across all pads)
    - Punch (transient shaper amount across all pads)
    - Space (send level to a shared reverb)
    - Drive (saturation amount across all pads)
    - Swing (global swing amount)
    - Dynamics (compress/expand velocity response across all pads)

---

## PART 5: ROUTING AND MIXING

### 5.1 Internal Routing

```
Each Pad → [Layer Mix → Filter → Insert FX → Transient Shaper] → Output Selector
                                                                      ↓
                                                          ┌───── Master Bus ────── Master FX → Output
                                                          ├───── Bus 1 ──── Bus 1 FX → Output
                                                          ├───── Bus 2 ──── Bus 2 FX → Output
                                                          ├───── Bus 3 ──── Bus 3 FX → Output
                                                          ├───── Bus 4 ──── Bus 4 FX → Output
                                                          └───── Direct Out (to DAW track) → Output
```

- Each pad selects its output destination: master, bus 1-4, or direct out
- Each bus has its own insert effects chain (from `daw-dsp`)
- Master bus has its own insert effects chain
- Bus and master effects are shared across all pads routed to them — this is where group processing happens (e.g., all kicks through the same bus compressor)
- Direct out bypasses all internal mixing and sends the pad's output to a separate DAW mixer channel (via multi-output on native, or as separate AudioWorklet outputs on web)

### 5.2 Send Effects

- 2 global send effects (typically reverb and delay)
- Each pad has a send level per send (0-100%)
- Sends are post-fader (affected by pad volume)
- Send effects output is mixed into the master bus

### 5.3 Per-Pad Mixer

Each pad has a mini mixer channel:

- Volume fader
- Pan knob
- Mute / Solo buttons
- Output routing selector
- Send 1 and Send 2 levels
- Level meter (peak + clip indicator)

These are visible in a mixer view that shows all pads' channels side by side — matching the DAW's mixer aesthetic.

---

## PART 6: SAMPLE MANAGEMENT

### 6.1 Sample Browser

- Tag-based: category (kick, snare, hi-hat, clap, tom, percussion, cymbal, FX), genre (hip-hop, electronic, acoustic, cinematic, lo-fi, industrial), character (punchy, warm, bright, dirty, clean, long, short)
- Audio preview on hover / click (plays the sample at the browser, not through the pad's effect chain)
- Waveform thumbnail per sample
- Favorites, recently used
- Drag from browser to pad (assigns to that pad)
- Search by text: fuzzy match on filename, tags, metadata
- Factory library categories: classic machines (808, 909, LinnDrum, SP-1200, CR-78, DMX, Oberheim DMX), acoustic kits, cinematic percussion, foley, processed, textures
- User import: drag audio files from OS file browser or DAW browser

### 6.2 Kit Management

- Kit = complete state of all pads (sources, layers, effects, routing, macros, step patterns)
- Save / Load kits as JSON presets (same format approach as the synth)
- Kit browser with tag-based search
- Kit compare: A/B switch between two loaded kits
- Kit "starter templates" categorized by style: 808 Kit, 909 Kit, Acoustic Kit, Lo-Fi Kit, Cinematic Kit, Minimal Kit, Empty Kit

### 6.3 Sample Import Workflows

**Drag audio file to pad:**

1. Auto-detect: is it a one-shot or a loop? (by analyzing length and detecting repeating patterns)
2. One-shot: set as single sample, one-shot mode, trim silence from end, normalize
3. Loop: offer choices — play as loop, auto-slice to pads, use as granular source

**Drag drum loop to drum machine (not a specific pad):**

1. Transient detection → slice at transients
2. Assign each slice to a sequential pad
3. Create a step sequencer pattern that replays the original timing
4. User can now rearrange, replace individual slices, or modify the pattern

**Drag multi-sample folder (e.g., a folder of velocity-layered kicks):**

1. Detect velocity layers by filename convention (e.g., "kick_v1.wav" through "kick_v8.wav") or by loudness analysis
2. Assign all layers to a single pad with velocity crossfading auto-configured

---

## PART 7: VINTAGE CHARACTER MODES

### 7.1 Lo-Fi Processing

Inspired by the E-mu SP-1200 and early Akai samplers:

- **Bit depth reduction**: reduce from 32-bit float to 16/12/8-bit. At 12-bit (the SP-1200's resolution), quantization noise adds a characteristic "crunch" and harmonic distortion.
    - Algorithm: `output = round(input * (2^(bits-1))) / (2^(bits-1))`
    - Apply dithering (TPDF) before quantization to linearize the noise floor

- **Sample rate reduction**: reduce from 44.1/48kHz to 26.04kHz (SP-1200), 22.05kHz, 16kHz, or even 8kHz. Creates aliasing artifacts that add grit.
    - Algorithm: hold-and-release (sample-and-hold the output for N samples where N = currentRate / targetRate)

- **Analog filter emulation**: a gentle lowpass characteristic that simulates the analog reconstruction filters of vintage DACs. One-pole or two-pole lowpass with a cutoff around the reduced Nyquist frequency.

- **Tape saturation**: subtle harmonic distortion + high-frequency rolloff + slight compression. Reuse the tape saturation algorithm from the master synth's effects section.

- **Vinyl noise**: optional background noise layer (hiss, crackle, hum at 50/60Hz) at adjustable level

### 7.2 Classic Machine Emulation Presets

For each classic drum machine, provide a complete kit template that recreates its sonic character using the drum synth engines:

- **TR-808**: 808 kick, 808 snare, 808 closed/open hat, 808 clap, 808 toms (low/mid/high), 808 cowbell, 808 clave, 808 rimshot, 808 maracas, 808 congas
- **TR-909**: 909 kick, 909 snare, 909 closed/open hat, 909 clap, 909 ride, 909 crash, 909 toms
- **LinnDrum**: Sample-based recreation (LinnDrum samples are widely available and legal to use as they've been extensively sampled)
- **CR-78**: Early Roland rhythm machine, lower fidelity, distinctive character
- **Oberheim DMX**: Punchy 12-bit character
- **SP-1200**: Any kit processed through the lo-fi section at 12-bit/26.04kHz with the analog filter

Each template should specify the exact drum synth parameters that recreate the original machine's character.

---

## PART 8: MODULATION (PER-PAD)

Each pad has access to the same modulation system as the master synth, but scoped to that pad's parameters:

### 8.1 Per-Pad Modulation Sources

- **Velocity**: incoming MIDI velocity mapped to any pad parameter
- **Note number**: for melodic percussion (map pitch to filter cutoff, etc.)
- **Envelope 1** (amplitude — always present): ADSR controlling volume
- **Envelope 2** (auxiliary): ADSR routable to any parameter (typically filter cutoff or pitch)
- **LFO 1**: same LFO implementation as the master synth, syncable to tempo, all shapes
- **Random**: per-trigger random value for velocity variation, pitch variation, etc.
- **Macro 1-8**: the kit-level macros

### 8.2 Modulation UX

Same drag-and-drop interaction as the master synth:

- Drag modulation source → hover over pad parameter → preview → drop
- Colored rings on knobs show modulation depth
- Per-pad modulation summary popover

### 8.3 Key Modulation Routings for Drums

Default routing suggestions (auto-assigned in templates):

- Velocity → Volume (always)
- Velocity → Filter cutoff (optional, for velocity-sensitive brightness)
- Velocity → Pitch envelope depth (for kick drums: harder hits = more pitch sweep = more "thump")
- Velocity → Noise amount (for snares: harder hits = more snap)
- Envelope 2 → Pitch (for kick pitch sweep)
- Envelope 2 → Filter cutoff (for filter envelope on any sound)
- LFO → Pan (for auto-pan effects on percussion)

---

## PART 9: UI STRUCTURE

The drum machine follows the same 5-level progressive disclosure as the master synth:

### Level 1 — Play

- Pad grid with colors and names
- Hit pads to play sounds
- Kit browser
- Macro strip
- Pattern select buttons
- Play/stop

### Level 2 — Shape

- Selected pad's sound source controls (simplified)
- Basic filter and envelope
- One-knob transient shaper
- Basic sample editor (start/end)

### Level 3 — Build

- Full layer stack per pad (add layers, velocity zones)
- Step sequencer (basic: toggle steps, set velocity)
- Choke groups
- Output routing
- Per-pad effects chain

### Level 4 — Route

- Full routing view (pad → bus → master)
- Bus effects chains
- Send levels
- Multi-output configuration
- Per-pad mixer view (all channels visible)

### Level 5 — Lab

- Full drum synth engine parameters per pad
- Parameter locks in sequencer
- Conditional trigs
- Polymetric step counts
- Micro-timing editor
- Auto-chop/slice tools
- Resample workflow
- Lo-fi processing controls
- Advanced sample editing

### Layout Zones

Same 5-zone layout as the master synth:

1. **Top bar**: Kit name, kit browser, save/load, undo/redo, CPU/voice meter
2. **Macro strip**: 8 kit-wide macro knobs
3. **Left panel**: Pad grid (the primary interaction surface, replacing the synth's layer stack)
4. **Center panel**: Context inspector (shows selected pad's controls, step sequencer, or mixer)
5. **Bottom dock**: Step sequencer (when in Build/Lab mode) or modulation dock
6. **Right panel**: FX chains (per-pad inserts, bus effects, send effects)

The pad grid is the equivalent of the synth's layer stack — it shows "what exists" and clicking a pad drives the center inspector.

---

## PART 10: INTEGRATION WITH THE DAW

### 10.1 As a DAW Instrument

- The drum machine is a node in the DAW's audio graph (compiled schedule), just like the master synth
- It receives MIDI from the DAW's MIDI routing (track input, MIDI keyboard, step sequencer)
- Its audio output goes to the DAW's mixer (master out, or multi-out for per-pad DAW channels)
- Automation of any drum machine parameter from the DAW's automation system (automation lanes in the arrangement)

### 10.2 Multi-Output

- On native (cpal): the drum machine can output on multiple audio channels, allowing the DAW to create separate mixer channels per pad or per bus
- On web: multiple AudioWorklet outputs (one per bus + direct outs)
- Default: stereo master out. Advanced: 4 bus outs + N direct outs (one per pad that's set to direct out)

### 10.3 Drag and Drop with DAW

- Drag a sample from the DAW's browser → drop on a pad
- Drag an audio clip from the arrangement → drop on a pad (extracts audio, assigns to pad)
- Drag a MIDI pattern from the arrangement → drop on the sequencer (imports the MIDI pattern)
- Drag a step pattern from the sequencer → drop on the arrangement (creates a MIDI clip)
- Drag a pad's processed audio → drop on an arrangement track (bounces and places as audio clip)

### 10.4 The Step Sequencer vs the DAW's Piano Roll

Both can program drum patterns. They coexist:

- The built-in step sequencer is for quick pattern programming inside the instrument (Elektron-style workflow)
- The DAW's piano roll is for detailed MIDI editing on the arrangement timeline (FL Studio / Logic style)
- When the step sequencer is playing, it generates MIDI events that feed the drum machine's process() — identical to external MIDI input
- The step sequencer can be "printed" to a MIDI clip in the arrangement (one-way export)
- The user chooses whichever workflow suits them — the instrument doesn't force either

---

## PART 11: WHAT MAKES THIS DRUM MACHINE BETTER THAN EVERYTHING ELSE

Summarize the unique combination that no single competitor achieves:

1. **Every pad is a full instrument channel** (Logic DMD) — not a simplified cell
2. **Any synthesis engine or sampler as a pad source** (Bitwig) — including the master synth's generators
3. **Multi-layer velocity-switched samples per pad** (Battery) — up to 32 layers with crossfading
4. **Per-pad effect chains from the shared daw-dsp library** (openDAW's Playfield, Bitwig) — same effects as the master synth and the DAW mixer
5. **Dedicated per-category drum synth engines** (Logic Drum Synth, TR-808/909 circuits) — not generic oscillator patches
6. **Integrated step sequencer with parameter locks and conditional trigs** (Elektron Digitakt) — every step can have unique sound parameters
7. **16 Levels, Note Repeat, and performance modes** (Akai MPC) — hardware-inspired performance
8. **Internal bus routing with bus effects** (Battery) — group processing for cohesive kit sound
9. **Lo-fi vintage character modes** (SP-1200, MPC-60) — bit-crush, sample rate reduction, analog warmth
10. **Auto-chop/slice workflow** (MPC, Recycle) — drag a loop, get it sliced to pads instantly
11. **Full modulation per pad** (Bitwig) — same mod system as the master synth
12. **Shares all DSP with the master synth and DAW effects** — zero code duplication, consistent sound quality
13. **Progressive disclosure UI** — a beginner sees pads and plays; an expert sees parameter locks and polymetric sequencing

---

## DELIVERABLE FORMAT

Same as the master synth research spec:

1. **For every drum synth engine**: signal flow diagram, oscillator/noise configuration, parameter list with ranges, Rust pseudocode, and what makes the authentic version sound right
2. **For the sample player**: playback modes, interpolation, velocity mapping, zone management, loop modes
3. **For the step sequencer**: data structures, playback algorithm, pattern management, parameter lock implementation, conditional trig logic
4. **For the routing system**: bus architecture, send effects, multi-output configuration
5. **For performance features**: 16 Levels mode, Note Repeat, velocity curves, pad sensitivity
6. **For the lo-fi section**: bit reduction, sample rate reduction, analog filter emulation, tape saturation
7. **For each classic machine template**: exact drum synth parameters that recreate the original character
8. **For the UI**: how the pad grid, step sequencer, and inspector interact across the 5 progressive disclosure levels

The document should enable a coding agent to implement the drum machine in the `daw-synth` (or `daw-drum-machine`) Rust crate, reusing `daw-dsp` for all shared DSP algorithms.

---

## RESEARCH SOURCES TO PRIORITIZE

- Kurt Werner, "Virtual Analog Modeling of Audio Circuitry Using Wave Digital Filters" — 808/909 circuit analysis
- Gordon Reid, "Synth Secrets" series (Sound On Sound) — drum synthesis fundamentals
- The TR-808 and TR-909 service manuals — original circuit schematics
- Yofiel's 808 Analysis (yofiel.com) — detailed 808 kick circuit breakdown
- Aaron Lanterman's ECE4450/6450 lectures (Georgia Tech) — analog drum machine circuit analysis
- Battery 4 manual (native-instruments.com) — cell architecture, layering, routing
- Ableton Drum Rack documentation — chain architecture, velocity zones, macro mapping
- Elektron Digitakt manual — parameter locks, conditional trigs, sound locks, retrig
- Akai MPC documentation — 16 Levels, Note Repeat, auto-chop
- Apple Logic Pro documentation — Drum Machine Designer, Drum Synth, Quick Sampler
- openDAW Playfield source code (github.com/andremichelle/openDAW) — per-pad effect chains
- Sound On Sound, "The Secrets of Dance Music Production" — drum programming techniques
- "Attack Magazine" drum synthesis tutorials — practical drum sound design
- KVR forums, Gearspace, Reddit r/synthesizers — "what do you wish your drum machine had?" threads
