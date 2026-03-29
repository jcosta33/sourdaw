# Yeast — Arpeggiator / MIDI Effects Rack

A complete implementation guide for a modular MIDI effects rack in **Sourdaw**.

Yeast is a **MIDI processor**, not an audio effect. It sits between MIDI input and the instrument, transforms the event stream, and outputs a new stream of notes, velocities, timing offsets, CCs, and pitch bends. The goal is to combine the immediacy of Ableton’s MIDI Effects, the flexibility of Logic’s MIDI FX, the modulation friendliness of Bitwig Note FX, the chord-memory workflow of Cthulhu, the step detail of BlueARP, and the groove-oriented simplicity of openDAW’s Zeitgeist.

---

## 1. Design Goals

Yeast should satisfy six constraints at once:

1. **Fast to play immediately** — enable arp, pick a mode, turn the rate knob, done.
2. **Deep enough for power users** — per-step pattern editing, scale-aware harmonization, groove templates, probabilistic sequencing.
3. **Safe on the audio thread** — deterministic, bounded work, no allocations in hot paths if avoidable.
4. **Chainable** — each processor transforms MIDI and passes it along.
5. **Transport-aware** — tempo sync, swing, bar resets, groove alignment, looping.
6. **Musical, not robotic** — overlap, microtiming, per-note variation, phrase logic, latch behavior, pattern memory.

---

## 2. Rack Architecture

## 2.1 Processing Model

The rack is a serial pipeline:

```text
[MIDI input / clip / keyboard]
    -> [Processor 1]
    -> [Processor 2]
    -> [Processor 3]
    -> [Instrument]
```

Each processor receives a slice of incoming events for the current block, appends transformed events into an output buffer, and the rack feeds the next processor from that output.

Canonical interface:

```rust
fn process_midi(
    &mut self,
    events_in: &[MidiEvent],
    events_out: &mut Vec<MidiEvent>,
    transport: &TransportState,
)
```

This interface supports four classes of transformation:

- **Add events** — arpeggiator, chord generator, repeater, CC LFO
- **Remove events** — note filter, probability mute
- **Modify events** — pitch, velocity, quantizer, harmonizer
- **Delay or retime events** — humanizer, groove, strum, echo

## 2.2 Event Representation

Use a single internal event format for all processors.

```rust
pub enum MidiEventKind {
    NoteOn { channel: u8, note: u8, velocity: u8 },
    NoteOff { channel: u8, note: u8 },
    CC { channel: u8, cc: u8, value: u8 },
    PitchBend { channel: u8, value: i16 },
    ChannelPressure { channel: u8, value: u8 },
}

pub struct MidiEvent {
    pub time_samples: i64,
    pub kind: MidiEventKind,
}
```

Notes:

- `time_samples` should be **absolute sample time** or **sample offset from global timeline**, not just block-local offset.
- Absolute time makes delayed scheduling and cross-block event carry straightforward.
- Keep events sorted by time before passing to the next processor.

## 2.3 Transport State

Tempo-aware processors need more than BPM.

```rust
pub struct TransportState {
    pub sample_rate: f64,
    pub bpm: f64,
    pub ppq_position: f64,
    pub is_playing: bool,
    pub bar_index: u64,
    pub beat_in_bar: f64,
    pub time_sig_num: u8,
    pub time_sig_den: u8,
    pub loop_enabled: bool,
    pub loop_start_ppq: f64,
    pub loop_end_ppq: f64,
}
```

Useful derived values:

```rust
fn samples_per_beat(t: &TransportState) -> f64 {
    t.sample_rate * 60.0 / t.bpm
}

fn ppq_to_samples(ppq: f64, t: &TransportState) -> f64 {
    ppq * samples_per_beat(t)
}
```

## 2.4 Scheduled Event Queue

Processors that emit future events cannot be limited to the current block. The rack should own a queue of scheduled outgoing events.

```rust
pub struct ScheduledEventQueue {
    heap: BinaryHeap<Reverse<ScheduledMidiEvent>>,
}
```

Flow per audio block:

1. Collect incoming MIDI events for the block.
2. Drain scheduled events whose timestamps fall within this block.
3. Merge both streams and sort by timestamp.
4. Run through chain.
5. Any processor may push future events back into the queue.
6. Output final events for the instrument.

This queue is mandatory for:

- note repeater
- delayed strum
- humanizer with positive delay
- groove shifting
- arp gate extending beyond current block
- CC LFO scheduled emissions

## 2.5 Note Lifetime Tracking

The hardest bugs in MIDI FX come from broken Note Off handling.

Every processor that creates or transforms notes must preserve the invariant:

> Every sounding note must have exactly one eventual termination path.

Use note lifetime tracking:

```rust
pub struct ActiveGeneratedNote {
    pub source_id: u64,
    pub channel: u8,
    pub note: u8,
    pub off_time_samples: i64,
}
```

Track separately for each module. Rules:

- If a module **transposes** a note, Note Off must be transposed identically.
- If a module **duplicates** a note into multiple notes, Note Off must terminate all duplicates.
- If a module **filters out** a Note On, it must also suppress the matching Note Off.
- If a module **re-times** Note On, it must re-time Note Off consistently unless a later module owns duration.

## 2.6 Rack Management

Rack-level features:

- Add processor
- Remove processor
- Reorder processor
- Duplicate processor
- Enable/disable bypass
- Save/load presets
- Macro map processor parameters
- Expose parameters for host automation and modulation

Reordering matters musically:

- `Chord -> Arp` means arp traverses chord tones.
- `Arp -> Chord` means every arp note becomes a chord burst.
- `Scale -> Random` is different from `Random -> Scale`.

Each processor needs:

```rust
pub trait MidiProcessor {
    fn process_midi(&mut self, input: &[MidiEvent], output: &mut Vec<MidiEvent>, transport: &TransportState);
    fn reset(&mut self);
    fn set_bypass(&mut self, bypass: bool);
    fn latency_samples(&self) -> i32 { 0 }
}
```

---

## 3. Arpeggiator

The arpeggiator is Yeast’s flagship module.

Input: held notes, such as `C4 E4 G4`

Output: a timed pattern of note events derived from that held set.

## 3.1 Internal State

```rust
pub struct HeldNote {
    pub channel: u8,
    pub note: u8,
    pub velocity: u8,
    pub pressed_order: u64,
    pub held_since_samples: i64,
}

pub struct ArpState {
    pub held: Vec<HeldNote>,
    pub latched: Vec<HeldNote>,
    pub latch_enabled: bool,
    pub step_index: usize,
    pub free_run_phase_samples: f64,
    pub last_step_time_samples: i64,
    pub current_direction: i8,
    pub last_random_index: Option<usize>,
    pub active_notes: Vec<ActiveGeneratedNote>,
    pub rng: SmallRng,
}
```

Maintain multiple ordered views of held notes:

- sorted by pitch
- sorted by press order
- expanded across octave range

## 3.2 Rate and Timing

Supported rates:

- 1/1
- 1/2
- 1/4
- 1/8
- 1/16
- 1/32
- dotted variants
- triplet variants

Represent rate as a musical subdivision.

```rust
pub enum RateValue {
    Straight { denom: u32 },
    Dotted { denom: u32 },
    Triplet { denom: u32 },
}
```

Convert to beats:

```rust
fn rate_to_beats(rate: RateValue) -> f64 {
    match rate {
        RateValue::Straight { denom } => 4.0 / denom as f64,
        RateValue::Dotted { denom } => (4.0 / denom as f64) * 1.5,
        RateValue::Triplet { denom } => (4.0 / denom as f64) * (2.0 / 3.0),
    }
}
```

Then:

```rust
step_duration_samples = rate_to_beats(rate) * samples_per_beat(transport)
```

## 3.3 Trigger Modes

### Free-running

The arp’s internal clock never resets. Notes enter an already-spinning pattern.

Musical result: stable groove, more like a sequencer.

### Restart on note

Any new Note On resets the pattern to step 1.

Musical result: predictable attack, better for live play.

### Restart on beat or bar

Pattern restarts on transport grid boundaries.

Musical result: locks to arrangement timing.

## 3.4 Held Note Source

Source note pool depends on latch state.

```rust
fn effective_held_notes(state: &ArpState) -> &[HeldNote] {
    if state.latch_enabled {
        if !state.held.is_empty() { &state.held } else { &state.latched }
    } else {
        &state.held
    }
}
```

## 3.5 Pattern Modes

### Up

Ascending by pitch:

`C E G C E G ...`

Implementation:

- sort by pitch
- index forward cyclically

### Down

Descending by pitch:

`G E C G E C ...`

### Up-Down

Ping-pong without duplicating endpoints:

`C E G E C E G ...`

Implementation uses a reflected index across the note list.

### Down-Up

Reverse ping-pong.

### Random

Choose a held note randomly each step.

Options:

- fully random
- avoid immediate repeats
- weighted by note position or velocity

### Order

Use press order rather than pitch order.

This feels more “performed” and is critical for live finger drumming and voicing-sensitive play.

### Chord

Emit the full held chord each rhythmic step.

Useful for rhythmic chord pumping, gated pads, and stabs.

### Pattern

Use a custom step sequence. This is the most important advanced mode.

## 3.6 Octave Range

Expand the note pool by octave transforms.

Parameters:

- number of octaves: 1–4 or more
- direction: up, down, up-down

Example for `C E G`, octaves up 2:

`C E G C+12 E+12 G+12`

Pattern modes operate on this expanded note list.

## 3.7 Gate

Gate is note length as a percentage of step duration.

```rust
note_length_samples = step_duration_samples * gate
```

Range:

- 1% to 200%

Important:

- `gate < 1.0` -> short, percussive
- `gate = 1.0` -> full step
- `gate > 1.0` -> overlap

Overlap is one of the main reasons good arpeggiators feel musical. Legato is not an accident; it is a feature.

## 3.8 Swing

Apply timing offset to alternating steps.

```rust
if step_index % 2 == 1 {
    step_start += swing_amount * swing_basis_samples;
}
```

Where `swing_basis_samples` is usually the current step duration or half-step duration.

Swing should be implemented as a special case of a more general groove engine so the arp can later use groove templates.

## 3.9 Velocity Modes

Supported modes:

- **Input** — use source note velocity
- **Fixed** — constant output velocity
- **Ramp Up** — increase across phrase
- **Ramp Down** — decrease across phrase
- **Random** — within min/max range
- **Per-step** — custom value from pattern editor
- **Accent map** — accent every nth step or per-step accent flag

Velocity is one of the fastest ways to make an arp feel alive.

## 3.10 Latch

Latch stores the last played chord and continues arp playback after release.

Two useful latch behaviors:

### Replace latch

Next played chord replaces the latched set.

### Toggle latch notes

Playing a currently latched pitch removes it; playing a new pitch adds it.

This second behavior is excellent for live performance because it lets the user build and subtract harmony gradually.

## 3.11 Custom Pattern Editor

This is the feature that moves Yeast from “basic arp” to “pattern generator”.

Pattern length: 1–32 steps initially, expandable later.

```rust
pub enum StepType {
    Off,
    Note,
    Rest,
    Tie,
    Chord,
    Random,
}

pub struct ArpStep {
    pub step_type: StepType,
    pub active: bool,
    pub note_selector: NoteSelector,
    pub velocity: u8,
    pub velocity_override: bool,
    pub gate_mul: f32,
    pub octave_offset: i8,
    pub semitone_offset: i8,
    pub probability: f32,
    pub ratchet: u8,
    pub mutate_lock: bool,
}

pub enum NoteSelector {
    Next,
    Previous,
    Index(usize),
    Random,
    Lowest,
    Highest,
    AsPlayed(usize),
}
```

### Per-step controls

Each step should support:

- active on/off
- velocity
- gate length multiplier
- octave offset
- semitone offset
- tie
- rest
- probability
- note choice from held set
- ratchet / sub-repeat count
- optional glide flag later

### Step semantics

- **Off** — ignore this step entirely
- **Rest** — advance time, emit no note
- **Tie** — extend previous note, no new Note On
- **Chord** — emit full held chord
- **Random** — choose held note randomly for this step

### Preserve melodic order option

One subtle but useful option:

If a step is disabled or becomes a rest, should the melodic note pointer still advance?

Two behaviors:

- **Advance on silent steps** — rhythm edits also change melodic phase
- **Preserve on silent steps** — rhythm changes without disturbing note traversal

Both are musically valid. Make it a switch.

## 3.12 Arp Scheduler

Pseudo-code:

```rust
fn advance_arp_until(now_samples: i64, state: &mut ArpState, params: &ArpParams, transport: &TransportState, out: &mut Vec<MidiEvent>) {
    let step_len = compute_step_len_samples(params.rate, transport);

    while state.last_step_time_samples + step_len as i64 <= now_samples {
        let step_time = state.last_step_time_samples + step_len as i64;
        let swing_offset = compute_swing_offset(state.step_index, params, step_len);
        let actual_time = step_time + swing_offset;

        let step = params.pattern.get(state.step_index % params.pattern.len());
        process_arp_step(step, actual_time, state, params, transport, out);

        state.last_step_time_samples = step_time;
        state.step_index = (state.step_index + 1) % params.pattern_len;
    }
}
```

## 3.13 Avoiding Stuck Notes

At each step:

1. Emit Note On(s)
2. Schedule Note Off(s) based on gate or tie logic
3. On transport stop, flush all active notes
4. On bypass enable, choose whether to flush or preserve tails

Mandatory rack-level panic:

```rust
fn all_notes_off(&mut self, out: &mut Vec<MidiEvent>)
```

---

## 4. Additional MIDI Modules

## 4.1 Chord Generator

Input: single note
Output: chord built from root

### Chord Types

- major
- minor
- diminished
- augmented
- sus2
- sus4
- dom7
- maj7
- min7
- dim7
- aug7
- 9th
- 11th
- 13th
- custom voicing

Represent chord formulas as semitone intervals or scale-degree formulas.

```rust
pub struct ChordFormula {
    pub intervals: SmallVec<[i8; 8]>,
}
```

### Voicing Modes

- close position
- open position
- drop 2
- drop 3
- spread

Implementation: generate chord tones, then transform voicing afterward.

### Strum

Offset chord notes in time.

Parameters:

- direction: up / down
- speed: ms or synced fraction
- random spread

```rust
note_time = root_time + i * strum_interval_samples
```

### Chord Memory

Cthulhu-style mode:

- store a full chord voicing per trigger key
- one finger recalls memorized voicing
- optionally transpose stored chord relative to root

```rust
HashMap<u8, StoredChord>
```

This is a major accessibility feature. It lets users perform complex harmony without knowing theory or fingering large voicings.

## 4.2 Scale Quantizer / Diatonic Transposer

Purpose:

- constrain incoming notes to a scale
- transpose by scale degrees instead of semitones

### Scale Representation

```rust
pub struct Scale {
    pub root: u8,
    pub allowed_pitch_classes: [bool; 12],
}
```

### Supported Scales

- major
- natural minor
- harmonic minor
- melodic minor
- dorian
- phrygian
- lydian
- mixolydian
- aeolian
- locrian
- pentatonic major
- pentatonic minor
- blues
- whole tone
- diminished
- chromatic
- custom

### Remap Modes

- nearest
- up
- down

Algorithm:

1. Determine input pitch class
2. If already in scale, pass through
3. Otherwise find candidate pitch classes in requested direction
4. Rebuild MIDI note nearest to original register

### Diatonic Transposition

Instead of `+N semitones`, move `+N scale degrees`.

This is especially useful for harmonizer voices and melody mutations because it preserves key center.

## 4.3 Harmonizer

Input: note
Output: note plus scale-aware harmony voices

Each voice has:

- interval in scale degrees
- direction up/down
- velocity offset
- timing offset
- probability

```rust
pub struct HarmonyVoice {
    pub degrees: i8,
    pub velocity_offset: i8,
    pub time_offset_samples: i32,
    pub enabled: bool,
}
```

Flow:

1. Quantize input to active scale if needed
2. Find scale degree index
3. Add degree offsets for enabled voices
4. Convert back to MIDI note numbers
5. Emit added Note On/Off pairs

## 4.4 Note Repeater / Echo

Input: Note On
Output: repeated Note On events at intervals

Parameters:

- repeat count
- rate
- decay
- gate
- pitch offset per repeat
- timing drift
- feedback

### Base Algorithm

```rust
for i in 0..repeat_count {
    let t = in_time + i as i64 * repeat_interval;
    let v = apply_decay(in_velocity, i);
    let note = in_note + i as i8 * pitch_step;
    emit_note(note, v, t)
}
```

### Feedback Mode

Feedback turns the repeater into a recursive generator.

Use a bounded recursion rule:

- max generations
- min velocity threshold
- hard max active scheduled repeats

Otherwise it can explode exponentially.

## 4.5 Velocity Processor

Functions:

- fixed velocity
- compress dynamic range
- expand dynamic range
- remap curve
- randomize
- velocity to CC

### Curve Remap

Use LUT or analytic function:

```rust
v_out = f(v_in_normalized)
```

Curves:

- linear
- logarithmic
- exponential
- S-curve
- custom

### Compress / Expand

```rust
center = 64.0;
v_out = center + (v_in - center) * amount;
```

- `amount < 1.0` compresses
- `amount > 1.0` expands

### Velocity-to-CC

For orchestral or expressive instruments that respond more musically to CC1 or CC11 than velocity.

Modes:

- emit CC on Note On only
- emit CC and preserve note velocity
- replace note velocity with fixed while using velocity as CC source

## 4.6 Humanizer

Humanization must be **per note**, not per bar block.

### Parameters

- timing jitter ±1–30 ms
- velocity jitter ±1–20
- pitch jitter in cents
- feel preset

### Statistical Model

Use **Gaussian** random deviation, not uniform, as default.

Why:

- uniform jitter sounds synthetic and flat
- Gaussian clusters near the center with occasional extremes, which is closer to real performance variation

```rust
timing_offset = gaussian(mean_ms, sigma_ms)
velocity_offset = gaussian(0.0, sigma_vel)
```

### Feel Presets

- **Tight** — low sigma, centered mean
- **Loose** — higher sigma
- **Drunk** — high sigma and slight alternating bias
- **Rushed** — negative timing mean
- **Laid Back** — positive timing mean

### Pitch Variation

For small pitch drift, emit pitch bend. This is easy monophonically but problematic polyphonically on one MIDI channel.

Options:

- monophonic only
- MPE/per-note channels later
- disable pitch humanize when polyphony conflicts

## 4.7 Note Filter

Filter criteria:

- note range
- velocity range
- whitelist pitch classes
- blacklist pitch classes
- invert mode

Example keyboard split:

- `C1-B2` -> bass chain
- `C3-C6` -> arp chain

The important implementation detail is state:

If a Note On is filtered out, record that fact so the Note Off is also filtered.

## 4.8 Pitch / Transposer

Simple but essential.

Parameters:

- semitone offset
- octave offset
- random semitone range
- clamp range

Algorithm:

```rust
out_note = in_note + semitone_offset + octave_offset * 12 + random_offset
```

Optional range wrapping:

- clamp
- wrap into range
- drop outside range

## 4.9 Groove / Swing Module (Zeitgeist-style)

Two main controls:

- **Amount**
- **Type / Feel**

Internally, groove is a timing offset table indexed by step position.

```rust
pub struct GrooveTemplate {
    pub offsets: Vec<f32>, // normalized offsets per step
}
```

Runtime:

```rust
time += groove_template.offsets[step_idx % len] * amount * step_len
```

Templates:

- straight
- MPC 16th swing
- triplet shuffle
- dotted
- late backbeat
- Dilla-style drunken pocket
- custom extracted groove

This module should be general enough that the arp, note repeater, and even CC LFO can use it.

## 4.10 CC Generator / LFO

Purpose:

- generate CC messages from a modulation source inside the MIDI rack

Parameters:

- rate (Hz or synced)
- shape
- CC number
- min/max
- phase
- retrigger on note
- free-run or transport-sync

Shapes:

- sine
- triangle
- square
- saw up
- saw down
- random sample-and-hold
- custom drawable shape later

Implementation:

```rust
value = shape.eval(phase)
cc_value = map_to_0_127(value, min, max)
```

Emission policies:

- every N samples
- every subdivision
- only when value changed by threshold

Throttle CC rate to avoid flooding.

---

## 5. Generative / Probabilistic Features

## 5.1 Per-Step Probability

Probability belongs at the step level.

Each step gets `0.0 .. 1.0` chance of triggering.

```rust
if rng.gen::<f32>() <= step.probability {
    play_step();
}
```

This keeps the identity of the pattern while allowing motion and surprise.

Use for:

- ghost notes
- unstable hi-hats
- evolving arp patterns
- chord stabs that occasionally skip

## 5.2 Random Note Injection

Between main steps, occasionally insert extra notes from the active scale or chord.

Parameters:

- injection probability
- source: chord tones / scale tones / non-chord scale tones
- rhythmic slot: pre-step, mid-step, post-step
- velocity bias

Example:

- 1/16 base arp
- 15% chance of 1/32 passing note between steps

This is a good source of “alive” ornamentation.

## 5.3 Mutation Engine

Slowly drift parameters over time.

Targets:

- velocity
- gate
- octave bias
- probability
- note selection weights
- groove amount

Mutation should be **bounded** and **damped**, not random chaos.

A good model is a constrained random walk:

```rust
param += gaussian(0, mutation_sigma)
param = clamp(param, min, max)
param = lerp(param, base_value, damping)
```

This creates motion while preserving musical identity.

## 5.4 Euclidean Rhythm Generator

Inputs:

- `hits`
- `steps`
- `rotation`

Output: binary mask distributed as evenly as possible.

Example:

- 5 hits across 8 steps -> `x . x . x . x x` variant depending on rotation

### Bjorklund Algorithm Outline

```rust
fn euclidean(hits: usize, steps: usize) -> Vec<bool> {
    // build groups of pulses and rests
    // repeatedly distribute smaller group into larger group
    // flatten
}
```

Use cases:

- replace active steps in arp pattern
- generate gate mask for chord mode
- drive note repeater accents
- build polymetric rhythm lanes

This is powerful because two numbers produce a rhythm that usually feels intentional rather than arbitrary.

## 5.5 Markov Chain Mode

A Markov arp chooses the next note based on the current one.

### State Choices

- held note index
- scale degree
- chord tone class
- custom symbolic states

### Transition Matrix

```rust
pub struct MarkovMatrix {
    pub probs: Vec<Vec<f32>>,
}
```

At each step:

1. Read current state row
2. Sample weighted next state
3. Map state to MIDI note
4. Emit note

### Why It Matters

Random mode is memoryless.
Markov mode creates recognizable behavior, motifs, and biases.

Examples:

- strong probability of moving to adjacent chord tones
- occasional leap to octave
- avoid repeating same state more than twice

## 5.6 Euclid + Markov + Probability Stack

These features become strongest when combined:

- **Euclidean mask** determines which steps are active
- **Markov chain** determines which note is chosen
- **Per-step probability** makes some hits disappear occasionally
- **Mutation** drifts weights and velocity over time

That combination turns a static chord into an evolving melodic engine.

---

## 6. UI / UX — 5 Levels of Progressive Disclosure

The UI should reveal complexity only when the user asks for it.

## Level 1 — Play

Goal: instant gratification.

Controls:

- arp on/off
- mode selector: Up / Down / Random / Chord
- rate knob
- latch toggle

Visuals:

- mini keyboard showing held notes
- simple note pulse indicator

This level should make sense in under 10 seconds.

## Level 2 — Shape

Goal: basic musical sculpting.

Controls:

- gate
- swing
- octave range
- octave direction
- velocity mode
- fixed velocity
- scale root and scale type
- chord type selector

Visuals:

- animated step pulse
- velocity bars
- octave spread display

## Level 3 — Build

Goal: compose an actual machine.

Controls:

- processor rack view
- add/remove/reorder modules
- custom arp pattern grid
- humanizer
- note repeater
- harmonizer

Visuals:

- step grid editor
- lane-based controls per step
- active note piano-roll preview

## Level 4 — Route

Goal: performance routing and modular behavior.

Controls:

- keyboard split zones
- per-zone rack assignment
- CC generator routing
- macro mapping
- per-module modulation assignment

Visuals:

- colored keyboard zones
- modulation overlays on controls
- event flow indicators between modules

## Level 5 — Lab

Goal: controlled experimentation.

Controls:

- Euclidean generator
- Markov matrix editor
- mutation depth
- probability lanes
- groove template editor
- custom scale builder
- scriptable/custom processor later

Visuals:

- probability heatmap
- transition matrix grid
- groove timing curve editor
- mutation trace over time

---

## 7. Visual Feedback and GPU Rendering

The arp should be visible, not just audible.

Recommended visual systems:

## 7.1 Keyboard View

- held notes glow in one color
- sounding notes flash in another
- harmonizer notes and chord-generated notes use distinct accents
- split zones colored by route

## 7.2 Piano Roll Preview

A horizontally scrolling mini-roll showing scheduled upcoming events.

Display:

- pitch vertical
- time horizontal
- note length by rectangle width
- velocity by brightness or height
- probability by opacity

## 7.3 Step Grid Animation

In pattern mode:

- current step playhead
- step probability as fill density
- gate as bar width
- octave offset as vertical position or badge
- ratchets as subdivisions inside the step cell

GPU rendering matters because these animations should stay smooth even with dense patterns and frequent updates.

---

## 8. What Makes Great MIDI FX Feel Musical

## 8.1 Overlap and Gate Matter More Than Fancy Algorithms

A rigid, non-overlapping arp sounds like a spreadsheet.
A gated, overlapping arp sounds like phrasing.

Why:

- real performers connect notes
- synth envelopes respond differently to overlap
- mono synths with glide become expressive when notes overlap

So gate > 100% is not a bonus feature. It is a core expressive control.

## 8.2 Style Variations Matter More Than Raw Complexity

Users often only touch:

- Up
- Down
- Random
- Chord
- Hold
- Gate

But the reason they keep using an arp is the combination of:

- restart behavior
- octave expansion
- overlap
- swing
- order mode
- note memory

The inspiring feeling comes from how these simple controls interact.

## 8.3 Chord Memory Is a Workflow Breakthrough

One-finger chord triggering changes who can use the tool.

Benefits:

- non-theorists can perform rich harmony
- live players can switch focus from fingering to rhythm and modulation
- arp becomes a performance layer rather than just a note recycler

This is one of the biggest “secret sauce” features Yeast should include.

## 8.4 Humanization Must Be Per-Note

Per-bar swing is useful, but real performance variation happens note-by-note.

If humanization is only applied in large blocks, it feels fake.
If timing and velocity vary per event with a natural distribution, it feels played.

Default rule:

- groove = structural timing pattern
- humanize = local event variation

They should both exist and stack.

## 8.5 Groove Is in the Imperfections

A good groove engine is not just “delay every second 16th”.
It is a reusable map of timing offsets.

Best-case future feature:

- extract groove from MIDI performance
- store as template
- apply to arp, chord stabs, repeater, and note lanes

This is how Yeast moves from “clocked” to “pocket”.

## 8.6 Euclidean Rhythms Feel Grounded Because They Are Evenly Distributed

Euclidean masks often feel musical immediately because the spacing of hits is maximally even.
That creates rhythms that sound intentional and often culturally familiar.

This makes Euclidean generation ideal for the Lab level because it is mathematically generated but still musically grounded.

## 8.7 Markov Beats Pure Random for Long Listening

Pure random is exciting briefly and tiring quickly.
Markov transitions preserve memory and tendency.

So:

- Random mode = quick variation
- Markov mode = evolving identity

## 8.8 Simplicity Wins at the Top Level

Zeitgeist’s lesson is important: two knobs can be enough if the internal mapping is good.

Not every module should start as a lab instrument.

Recommended philosophy:

- top layer = blunt and musical
- deeper layers = precise and technical

That is how the device stays fun.

---

## 9. Suggested Processor Set for Yeast v1

A strong first release:

1. Arpeggiator
2. Chord Generator / Chord Memory
3. Scale Quantizer / Diatonic Transposer
4. Harmonizer
5. Note Repeater / Echo
6. Velocity Processor
7. Humanizer
8. Note Filter
9. Pitch / Transposer
10. Groove
11. CC Generator / LFO

That set already covers nearly all common MIDI FX workflows.

---

## 10. Suggested Build Order

## Phase 1 — Core Engine

- event queue
- rack architecture
- deterministic processor API
- all-notes-off safety
- bypass and reordering

## Phase 2 — Playable Core

- arpeggiator with Up/Down/Random/Chord
- gate
- swing
- latch
- octave range
- fixed/input/random velocity

## Phase 3 — Harmonic Tools

- chord generator
- scale quantizer
- harmonizer
- pitch/transposer

## Phase 4 — Feel Tools

- humanizer
- groove module
- note repeater
- velocity processor

## Phase 5 — Advanced Patterning

- custom pattern editor
- per-step velocity/gate/octave/probability
- ratchets
- tie/rest/chord step types

## Phase 6 — Lab Features

- Euclidean masks
- mutation engine
- Markov transitions
- groove template editor
- custom scale editor

---

## 11. Reference Rust Structures

```rust
pub struct MidiRack {
    pub processors: Vec<Box<dyn MidiProcessor>>,
    pub scheduled: ScheduledEventQueue,
}

pub struct ArpParams {
    pub mode: ArpMode,
    pub rate: RateValue,
    pub gate: f32,
    pub swing: f32,
    pub octave_range: u8,
    pub octave_mode: OctaveMode,
    pub velocity_mode: VelocityMode,
    pub latch: bool,
    pub restart_mode: RestartMode,
    pub pattern: Vec<ArpStep>,
    pub pattern_len: usize,
}

pub enum ArpMode {
    Up,
    Down,
    UpDown,
    DownUp,
    Random,
    Order,
    Chord,
    Pattern,
}
```

---

## 12. Final Product Positioning

Yeast should feel like this:

- **Ableton** in immediacy
- **Logic** in modular note processing
- **Bitwig** in modulation-readiness
- **Cthulhu** in harmonic accessibility
- **BlueARP** in pattern depth
- **Elektron** in step-level musical detail
- **openDAW Zeitgeist** in groove simplicity

If it does, it will not feel like a checkbox MIDI effect rack. It will feel like an instrument in its own right.

The central design principle is simple:

> Do not just transform notes. Transform static harmony into motion, feel, and behavior.

That is what makes Yeast worth using.
