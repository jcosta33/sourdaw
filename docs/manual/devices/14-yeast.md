# Yeast — MIDI FX

Yeast is a MIDI rack. It sits on a MIDI track and rewrites notes and CC before they reach an
instrument. It does not make sound on its own.

The panel is labelled **Note rack**. It opens on **Play**. The left rail heading is **Rack frame**.

**Type** MIDI effect · **Category** MIDI FX · **Load from** Sidebar → Effects → Yeast

The Effects card reads **Arpeggiator · Chord Generator · Scale Filter**.

A new device has an empty rack. Add processors from **Sprout**, **Build**, **Route**, or **Lab**.

## At a glance

- Five decks: **Play**, **Shape**, **Build**, **Route**, **Lab**.
- **Phrase view** shows upcoming rack output as a scrolling note picture.
- **Arp On** adds an Arpeggiator; **Build** and **Lab** hold the rest of the chain.
- Groove extraction from a MIDI clip, with **Straight** as the no-op template.

## First moves

1. Add Yeast to a MIDI track that already has an instrument after it, or add the instrument next.
2. Click **Arp On** on **Play**, hold a chord, and start the transport.
3. Watch **Phrase view**. If it says to select a MIDI track, select the track that holds Yeast.
4. Open **Shape** to set **Gate**, **Swing**, and **Octaves**.

<!-- ac: SPEC-yeast/AC-001, SPEC-yeast/AC-002, SPEC-yeast/AC-018, SPEC-yeast/AC-024 -->

## Phrase view

Heading **Phrase view**. Subtitle **Read-only preview of upcoming rack output.** Pitch is up the
picture, time runs left to right, duration is width, velocity is brightness, and probability is
opacity. Events fade as they meet the playhead.

| Tile            | Shows                                                  |
| --------------- | ------------------------------------------------------ |
| **Preview**     | **Initializing**, **Unavailable**, **Error**, or live. |
| **p95 latency** | Scheduling lag in milliseconds, or **—**               |
| **Processors**  | `N active · N enabled · N bypassed · N failed`         |

<!-- ac: SPEC-yeast/AC-011, SPEC-yeast/AC-025 -->

Bypassed processors stay dark in the picture. **On** / **Off** on a rack row is that bypass.

Unavailable copy includes **Select a MIDI track to preview Yeast output.**, **The selected MIDI
track is unavailable.**, **The selected track has no Yeast device.**, **Canvas preview is
unavailable.**, and **The Yeast runtime is unavailable.**

The picture is not a control.

## Play, Shape, Build, Route, Lab

**Rack frame** rows: **Play** / **Sprout**, **Shape** / **Drift**, **Build** / **Rack**, **Route** /
**Notes**, **Lab** / **Mutate**. They change how much of the panel you see. They do not bypass the
rack. The choice is this session only — it is not stored in the project.

| Chip      | Heading           | What you get                                                  |
| --------- | ----------------- | ------------------------------------------------------------- |
| **Play**  | **Note flow**     | **Arp On** / **Arp Off**, **Mode**, **Rate**, **Latch**.      |
| **Shape** | **Phrase shape**  | **Gate**, **Swing**, **Octaves**, **Velocity**.               |
| **Build** | **Rack build**    | Full chain, **Arp Pattern**, add chips through feel tools.    |
| **Route** | **Note activity** | **Keyboard** of sounding notes, chain, plus **CC Generator**. |
| **Lab**   | **Pattern lab**   | Generative chips, **Pattern Editor**, **Keyboard**.           |

Header tiles: **Flow** (how many processors), **Deck** (the chip name), **Chord** (**On** if a
Chord Generator is in the rack).

**Sprout** adds **Arpeggiator**, **Chord Generator**, **Scale Quantizer**, **Harmonizer**,
**Transposer**, and **Chord Memory**.

**Rack read** lists every processor as **Live** or **Bypass**. An empty list reads **No processors
yet. Add one from the sprout shelf and the note lanes will wake up.**

## Play

These four controls sit on **Play** whether or not an Arpeggiator is in the rack. They only write
when **Arp On** is showing.

| Control                  | Range                                                                                     | Default     | What it does                          |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------- | ------------------------------------- |
| **Arp On** / **Arp Off** | those two                                                                                 | **Arp Off** | Adds or removes the first Arpeggiator |
| **Mode**                 | **Up**, **Down**, **Up-Down**, **Down-Up**, **Random**, **Order**, **Chord**, **Pattern** | **Up**      | Arp walk                              |
| **Rate**                 | 1 to 32, readout `1/N`                                                                    | `1/8`       | Step rate as a note denominator       |
| **Latch**                | on / off                                                                                  | off         | Holds the chord after you release     |

## Shape

Same rule: knobs show the Arpeggiator values, and do nothing until **Arp On**.

| Control      | Range       | Default | What it does                                      |
| ------------ | ----------- | ------- | ------------------------------------------------- |
| **Gate**     | 0.01 to 2 × | 0.8 ×   | Note length as a multiple of the step             |
| **Swing**    | 0 to 100%   | 0%      | Shuffle on the arp                                |
| **Octaves**  | 1 to 4      | 1       | How many octaves the arp spans                    |
| **Velocity** | 1 to 127    | 100     | Fixed velocity (see **Vel Mode** on the rack row) |

## Build

Each rack row shows a number, the processor name, **↑** / **↓**, **On** / **Off**, and **✕**. Click
the row to expand its knobs. **On** is live; **Off** is bypass.

**Arp Pattern** appears when an Arpeggiator is in the rack. It binds the first Arpeggiator. Click a
step to toggle it. Drag in the cell for velocity. Cycle octave, step type (**Note**, **Rest**,
**Tie**, **Chord**, **Random**), and note selector (**Next**, **Previous**, **Lowest**, **Highest**,
**Random**).

Add chips on **Build** (level 3 and below): **Arpeggiator**, **Chord Generator**, **Scale
Quantizer**, **Harmonizer**, **Transposer**, **Chord Memory**, **Note Repeater**, **Velocity**,
**Humanizer**, **Groove**, **Note Filter**.

## Route

**Keyboard** lights sounding notes. It is not a split point.

Add chips include **CC Generator**.

## Lab

**Generative**: **Euclidean**, **Markov Chain**, **Mutation**. **Standard** repeats every other
add chip. **Pattern Editor** is the same arp grid. **Keyboard** is the same sounding-note strip.

## Processors

Expand a row to edit it. Names below are the add-chip names. Defaults are a fresh insert.

### Arpeggiator

| Control       | Range                             | Default     | What it does              |
| ------------- | --------------------------------- | ----------- | ------------------------- |
| **Mode**      | same eight as Play                | **Up**      | Walk                      |
| **Rate**      | 1 to 32                           | 8           | Denominator               |
| **Gate**      | 0.01 to 2                         | 0.8         | Length × step             |
| **Swing**     | 0 to 1                            | 0           | Shuffle                   |
| **Octaves**   | 1 to 4                            | 1           | Octave span               |
| **Oct Dir**   | **Up**, **Down**, **Up-Down**     | **Up**      | Octave walk               |
| **Vel Mode**  | **Input**, **Fixed**, **Random**  | **Input**   | Where velocity comes from |
| **Fixed Vel** | 1 to 127                          | 100         | Used when **Fixed**       |
| **Restart**   | **Free**, **On Note**, **On Bar** | **On Note** | When the pattern restarts |
| **Latch**     | (Play chip)                       | off         | Hold                      |

### Chord Generator

| Control       | Range                                                                                                                 | Default   | What it does    |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | --------- | --------------- |
| **Chord**     | **Major**, **Minor**, **Dim**, **Aug**, **Sus2**, **Sus4**, **Dom7**, **Maj7**, **Min7**, **Dim7**, **9th**, **11th** | **Major** | Chord quality   |
| **Voicing**   | **Close**, **Drop 2**, **Drop 3**, **Spread**                                                                         | **Close** | Spacing         |
| **Strum**     | 0 to 100 ms                                                                                                           | 0 ms      | Spread in time  |
| **Strum Dir** | **Up**, **Down**                                                                                                      | **Up**    | Strum direction |

### Scale Quantizer

| Control       | Range                                                                                                                                                                            | Default     | What it does             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| **Root**      | **C** … **B**                                                                                                                                                                    | **C**       | Tonic                    |
| **Scale**     | **Major**, **Minor**, **Harm Min**, **Mel Min**, **Dorian**, **Phrygian**, **Lydian**, **Mixolyd.**, **Pent Maj**, **Pent Min**, **Blues**, **Whole**, **Dimin.**, **Chromatic** | **Major**   | Allowed pitches          |
| **Remap**     | **Nearest**, **Up**, **Down**                                                                                                                                                    | **Nearest** | How off-scale notes move |
| **Transpose** | −7 to +7 deg                                                                                                                                                                     | 0 deg       | Scale-degree shift       |

### Harmonizer

| Control     | Range                                                                    | Default   | What it does       |
| ----------- | ------------------------------------------------------------------------ | --------- | ------------------ |
| **Root**    | **C** … **B**                                                            | **C**     | Tonic              |
| **Scale**   | **Major**, **Minor**, **Dorian**, **Mixolyd.**, **Pent.**, **Chromatic** | **Major** | Harmony scale      |
| **Voice 1** | −7 to +7 deg                                                             | 2 deg     | First extra voice  |
| **V1**      | **Off**, **On**                                                          | **On**    | Enable Voice 1     |
| **Voice 2** | −7 to +7 deg                                                             | 4 deg     | Second extra voice |
| **V2**      | **Off**, **On**                                                          | **Off**   | Enable Voice 2     |

### Transposer

| Control    | Range         | Default | What it does       |
| ---------- | ------------- | ------- | ------------------ |
| **Semi**   | −12 to +12 st | 0 st    | Semitones          |
| **Oct**    | −3 to +3      | 0       | Octaves            |
| **Random** | 0 to 12 st    | 0 st    | Random extra range |

### Chord Memory

| Control       | Range           | Default | What it does                      |
| ------------- | --------------- | ------- | --------------------------------- |
| **Learn**     | button          | —       | Capture the held chord            |
| **Transpose** | **Off**, **On** | **On**  | Shift the stored chord with input |
| **Clear All** | button          | —       | Forget stored chords              |

### Note Repeater

| Control     | Range         | Default | What it does          |
| ----------- | ------------- | ------- | --------------------- |
| **Repeats** | 1 to 16       | 3       | Extra hits            |
| **Rate**    | 1 to 32       | 16      | Repeat denominator    |
| **Decay**   | 0 to 1        | 0.7     | Level drop per repeat |
| **Gate**    | 0.01 to 2     | 0.5     | Repeat length × step  |
| **Pitch**   | −12 to +12 st | 0 st    | Pitch step per repeat |

### Velocity

| Control    | Range                                                                | Default    | What it does             |
| ---------- | -------------------------------------------------------------------- | ---------- | ------------------------ |
| **Mode**   | **Pass**, **Fixed**, **Compress**, **Expand**, **Curve**, **Random** | **Pass**   | Velocity law             |
| **Fixed**  | 1 to 127                                                             | 100        | Used when **Fixed**      |
| **Amount** | 0 to 3                                                               | 0.5        | Compress / expand amount |
| **Curve**  | **Linear**, **Soft**, **Hard**, **S-Curve**                          | **Linear** | Curve shape              |

### Humanizer

| Control         | Range                                                      | Default   | What it does      |
| --------------- | ---------------------------------------------------------- | --------- | ----------------- |
| **Feel**        | **Tight**, **Loose**, **Drunk**, **Rushed**, **Laid Back** | **Tight** | Starting feel     |
| **Time Jitter** | 0 to 30 ms                                                 | 5 ms      | Timing spread     |
| **Vel Jitter**  | 0 to 30                                                    | 8         | Velocity spread   |
| **Offset**      | −30 to +30 ms                                              | 0 ms      | Mean timing shift |

### Note Filter

| Control     | Range           | Default | What it does         |
| ----------- | --------------- | ------- | -------------------- |
| **Low**     | 0 to 127        | 0       | Lowest MIDI note     |
| **High**    | 0 to 127        | 127     | Highest MIDI note    |
| **Vel Min** | 0 to 127        | 0       | Lowest velocity      |
| **Vel Max** | 0 to 127        | 127     | Highest velocity     |
| **Invert**  | **Off**, **On** | **Off** | Keep the other notes |

### Groove

<!-- ac: SPEC-yeast/AC-004, SPEC-yeast/AC-005, SPEC-yeast/AC-006, SPEC-yeast/AC-007, SPEC-yeast/AC-008, SPEC-yeast/AC-009, SPEC-yeast/AC-013, SPEC-yeast/AC-014, SPEC-yeast/AC-016, SPEC-yeast/AC-019, SPEC-yeast/AC-020, SPEC-yeast/AC-026 -->

| Control    | Range   | Default      | What it does                    |
| ---------- | ------- | ------------ | ------------------------------- |
| Template   | library | **Straight** | Which feel to apply             |
| **Amount** | 0 to 1  | 0.5          | How far the template is applied |

**Straight** is a no-op. Deleting a user template drops processors that used it back to
**Straight**. Extraction does not rewrite the source clip.

On a Groove row: **Extraction subdivision** (`1/8`, `1/16`, `1/32`, `1/16T`, default `1/16`),
**Select a MIDI clip**, **Preview groove**, **Drop MIDI clip to extract groove**, then **Save
groove** or **Cancel**. A quantized clip previews as **This MIDI clip is already Straight.** An
empty clip reads **This MIDI clip has no notes.** User templates can be **Rename**d and **Delete
template**.

### CC Generator

| Control    | Range                                                      | Default  | What it does      |
| ---------- | ---------------------------------------------------------- | -------- | ----------------- |
| **CC #**   | 0 to 127                                                   | 1        | Controller number |
| **Shape**  | **Sine**, **Tri**, **Square**, **Saw↑**, **Saw↓**, **S&H** | **Sine** | Wave              |
| **Rate**   | 1 to 32                                                    | 4        | Denominator       |
| **Min**    | 0 to 127                                                   | 0        | Low value         |
| **Max**    | 0 to 127                                                   | 127      | High value        |
| **Retrig** | **Off**, **On**                                            | **Off**  | Restart the wave  |

### Euclidean

| Control    | Range     | Default | What it does       |
| ---------- | --------- | ------- | ------------------ |
| **Hits**   | 0 to 32   | 5       | How many onsets    |
| **Steps**  | 1 to 32   | 8       | Cycle length       |
| **Rotate** | 0 to 31   | 0       | Pattern rotation   |
| **Rate**   | 1 to 32   | 16      | Denominator        |
| **Gate**   | 0.01 to 2 | 0.5     | Note length × step |
| **Note**   | 0 to 127  | 60      | MIDI note          |
| **Vel**    | 1 to 127  | 100     | Velocity           |

### Markov Chain

| Control  | Range     | Default | What it does       |
| -------- | --------- | ------- | ------------------ |
| **Rate** | 1 to 32   | 8       | Denominator        |
| **Gate** | 0.01 to 2 | 0.7     | Note length × step |
| **Vel**  | 1 to 127  | 100     | Velocity           |

The row also prints **Hold notes to set states**.

### Mutation

| Control   | Range     | Default | What it does          |
| --------- | --------- | ------- | --------------------- |
| **Depth** | 0 to 1    | 0.5     | How far values wander |
| **Rate**  | 0.1 to 10 | 1       | How fast they wander  |

## Presets

Yeast has no factory-preset drawer on this panel. The rack, processor parameters, and groove
assignments save with the project.

**Play** / **Shape** / **Build** / **Route** / **Lab** stay with this session.

## Automation and control

**Arp Mode**, **Rate**, **Gate**, and **Swing** appear as automation lanes.

> [!WARNING]
> **Not yet active.** Those four lanes remember drawn values and do not move the Arpeggiator on
> **Play**, **Shape**, or an expanded rack row.
> [#2408](https://github.com/jcosta33/sourdaw/issues/2408)

Processor knobs on expanded rack rows save with the project. They are not extra lanes in that
list.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
