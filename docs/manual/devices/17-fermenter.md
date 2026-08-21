# Fermenter — Synth

Fermenter is a MIDI instrument: wavetable and analog-style oscillators, a filter, envelopes, and
an effects bus on one panel.

**Type** Instrument · **Category** Synth · **Load from** Sidebar → Instruments → Fermenter

The Instruments card reads **Wavetable + VA oscillators · TPT filter · Mod matrix**.

The left rail heading is **Preset bench**. The centre headings follow the open section (**Oscillator
theater**, **Filter contour**, **Envelope and drift**, **Mod constellation**, **Effects bus**). The
right rail heading is **Macro rig**.

Each Fermenter on a track keeps its own patch and knobs. A second Fermenter is not a second view of
the first.

## At a glance

- Play MIDI on the track. A fresh Fermenter is patch **Init**, engine **Wavetable**, wave **Saw**.
- **Play**, **Shape**, **Build**, **Route**, and **Lab** change which blocks are on screen. They do
  not change the patch by themselves.
- Centre tabs are **Oscillator**, **Filter**, **Envelopes**, **Modulation**, and **Effects**.
- **Macro rig** is eight macros plus a pad labelled **Bright** / **Motion**. Moving a macro also
  writes the knobs it is assigned to.

<!-- ac: SPEC-fermenter-ui/AC-001 -->

## First moves

1. Add Fermenter from the Instruments sidebar. It opens on **Shape**, patch **Init**.
2. Play a MIDI note on that track.
3. Open **Filter** and drag **Cutoff**.
4. Drag the **Bright** / **Motion** pad if you want a larger move.

## Preset bench

Heading **Scenes**, title **Preset bench**. The LED is `N user`. Chips: **Play**, **Shape**,
**Build**, **Route**, **Lab**. A fresh Fermenter is **Shape**.

**Current scene** is the patch name. **Init** on a new device.

Save, reset to **Init**, and shuffle sit on that row. Shuffle writes a new patch named **Random**.

The list filters with search, category chips (**All**, **My Patches**, **Synth**, **Bass**, **Lead**,
**Pad**, **Keys**, **Strings**, **Drums**, **FX**), and tags. Search, category, and tag stay with
this session. Do not hunt the list for a catalogue; pick a row and play.

<!-- ac: SPEC-fermenter-presets/AC-003 -->

**Play** and **Shape** show the same centre and **Macro rig**. **Build** adds **Layers**. **Route**
adds a signal-flow diagram under the open section. **Lab** adds **Scene morph** and **Spectrum**.
The level chip stays with this session.

<!-- ac: SPEC-fermenter-ui/AC-002 -->

## Header and tiles

The header title is **Fermenter**. The eyebrow follows the level: **Scene**, **Voice**, **Stack**,
**Flow**, or **Bench**. The LED is the engine name. **voices** is how many notes are sounding.

Tiles: **Engine**, **Cutoff**, **Motion**, **Width**. **Motion** shows LFO rate and Macro A as a
percent. **Width** shows stereo width and the layer count.

**Quick read** repeats the engine, then **Master** as a percent and **Layer** as 1-based. That
**Master** percent is not the same number as the **Master** knob on **Effects** (Init knobs read
100%; Quick read reads 50%).

## Oscillator

Heading **Oscillator theater**, eyebrow **Engine**. Tab **Oscillator**.

Engine chips: **Wavetable**, **Analog**, **FM**, **String**, **Granular**, **Additive**, **Sampler**.
Wave chips: **Sine**, **Saw**, **Square**, **Triangle**. Init is **Wavetable** and **Saw**. The
**Engine** tile prints **Wave 2** for that Saw.

<!-- ac: SPEC-fermenter-virtual-analog/AC-003 -->

| Control    | Range        | Default | What it does                                      |
| ---------- | ------------ | ------- | ------------------------------------------------- |
| **Level**  | 0 to 1       | 0.8     | Oscillator level                                  |
| **Coarse** | −24 to 24    | 0       | Semitones                                         |
| **Fine**   | −100 to 100  | 0       | Cents                                             |
| **PW**     | 0.05 to 0.95 | 0.5     | Pulse width. Only when **Analog** and **Square**. |
| **Noise**  | 0 to 1       | 0       | Noise mix. **White**, **Pink**, **Brown**.        |

<!-- ac: SPEC-fermenter-virtual-analog/AC-002 -->

**Wavetable** and **Analog** show **Voices**, **Detune**, and **Spread** (unison). **FM**,
**String**, **Granular**, **Additive**, and **Sampler** replace that row with the engine's own
controls.

<!-- ac: SPEC-fermenter-wavetable/AC-006 -->

### Unison (Wavetable, Analog)

| Control    | Range    | Default | What it does  |
| ---------- | -------- | ------- | ------------- |
| **Voices** | 1 to 16  | 1       | Unison voices |
| **Detune** | 0 to 100 | 15      | Cents         |
| **Spread** | 0 to 1   | 0.7     | Stereo spread |

### FM Engine

Heading **FM Engine**. Algorithm menu (Init **Stack (4→3→2→1)**). **Op 1**–**Op 4** each have
ratio (0.5× to 16×, Init 1 / 2 / 3 / 4) and level (0 to 1, Init 1.0 / 0.8 / 0.5 / 0.3), plus
**Feedback** (0 to 1, Init 0) and **Depth** (0 to 4, Init 1).

### String Model

Heading **String Model**.

| Control        | Range     | Default | What it does                      |
| -------------- | --------- | ------- | --------------------------------- |
| **Damping**    | 0 to 0.99 | 0.5     | Higher is a darker, shorter pluck |
| **Brightness** | 0.1 to 1  | 0.7     | Brightness of the string          |

<!-- ac: SPEC-fermenter-physical-modeling/AC-004 -->

### Grain Cloud

Heading **Grain Cloud**.

| Control      | Range    | Default | What it does         |
| ------------ | -------- | ------- | -------------------- |
| **Density**  | 1 to 100 | 20      | Grains per second    |
| **Size**     | 5 to 500 | 50      | Grain length (ms)    |
| **Position** | 0 to 1   | 0       | Read position        |
| **Spray**    | 0 to 1   | 0.1     | Position scatter     |
| **Pitch ±**  | 0 to 12  | 0       | Pitch variation (st) |
| **Spread**   | 0 to 1   | 0.5     | Grain pan spread     |

### Additive

Heading **Additive**.

| Control      | Range    | Default | What it does          |
| ------------ | -------- | ------- | --------------------- |
| **Partials** | 1 to 64  | 32      | Number of partials    |
| **Tilt**     | −6 to 6  | 0       | Spectrum tilt (dB)    |
| **Odd**      | 0 to 1   | 0       | Odd-harmonic emphasis |
| **Inharm**   | 0 to 0.1 | 0       | Inharmonicity         |

<!-- ac: SPEC-fermenter-additive/AC-001, SPEC-fermenter-additive/AC-003, SPEC-fermenter-additive/AC-004 -->

### Sampler

Heading **Sampler**. Modes **One-Shot**, **Loop**, **Ping-Pong**. **Start** / **End** 0 to 100%,
Init 0% / 100%.

> [!NOTE]
> **Alpha.** Sampler plays an internal default wave. There is no control on this panel to load your
> own audio.

### Warp / Mod

Heading **Warp / Mod**. **Time-Domain Warp** chips: **Off**, **Sync**, **Quantize**, **Squeeze**,
**Bend**, **Formant**, **Fold**. Init **Off**. **Amount** (0 to 1, default 0) appears when warp is
not **Off**.

**Audio-Rate Mod** chips: **Off**, **Pitch (FM)**, **Amp (AM)**, **Filter**. **Rate** (0 to 5000 Hz)
and **Depth** (0 to 1) appear when the target is not **Off**.

## Filter

Heading **Filter contour**, eyebrow **Tone**. Tab **Filter**.

Model chips: **SVF (Clean)**, **Moog (Warm)**, **Diode (Acid)**, **Formant (Vowel)**,
**MS-20 (Grit)**, **SEM (Cream)**. Init **SVF (Clean)**.

Mode chips **Low Pass**, **High Pass**, **Band Pass**, **Notch** show only for **SVF (Clean)**.
Init **Low Pass**. Other models show a short caption instead of those chips.

| Control    | Range           | Default | What it does                        |
| ---------- | --------------- | ------- | ----------------------------------- |
| **Cutoff** | 20 Hz to 20 kHz | 5000 Hz | Cutoff. Readout uses `Nk` at 1 kHz. |
| **Reso**   | 0.5 to 20       | 1.0     | Resonance                           |
| **Drive**  | 0 to 10         | 0       | Filter drive                        |
| **Env**    | −1 to 1         | 0.5     | Filter envelope amount              |
| **Key**    | 0 to 1          | 0       | Key tracking                        |

Drag the response curve to set **Cutoff** and **Reso**.

## Envelopes

Heading **Envelope and drift**, eyebrow **Motion**. Tab **Envelopes**.

**Envelope** chips **AMP** and **FILTER** choose which ADSR you are editing. That chip stays with
this session; both envelopes still belong to the patch.

| Control | Range (time)  | Init AMP | Init FILTER | What it does |
| ------- | ------------- | -------- | ----------- | ------------ |
| **A**   | 0.001 to 5 s  | 0.01 s   | 0.01 s      | Attack       |
| **D**   | 0.001 to 5 s  | 0.2 s    | 0.3 s       | Decay        |
| **S**   | 0 to 1        | 0.7      | 0           | Sustain      |
| **R**   | 0.001 to 10 s | 0.3 s    | 0.3 s       | Release      |

Double-click **A**, **D**, or **R** jumps to 0.2 s, not the Init times. Double-click **S** jumps to
0.7 on both envelopes.

### LFO

Heading **LFO**. Shape chips print **Sin**, **Tri**, **Saw**, **Squ**. Init **Sin**.

| Control      | Range      | Default | What it does  |
| ------------ | ---------- | ------- | ------------- |
| **Rate**     | 0 to 20 Hz | 0 Hz    | LFO rate      |
| **→ Pitch**  | −1 to 1    | 0       | Pitch amount  |
| **→ Filter** | −1 to 1    | 0       | Filter amount |

## Modulation

Heading **Mod constellation**, eyebrow **Routes**. Tab **Modulation**.

| Control      | Range        | Default | What it does                   |
| ------------ | ------------ | ------- | ------------------------------ |
| **→ Filter** | −1 to 1      | 0       | Built-in MSEG amount to filter |
| **Rate**     | 0.5 to 20 Hz | 4.0 Hz  | Step sequencer rate            |
| **→ Pitch**  | −1 to 1      | 0       | Sequencer amount to pitch      |

There is no editor on this panel to draw MSEG breakpoints or sequencer steps. The amounts still
move filter and pitch from the built-in shapes.

**Glide** **Time** 0 to 2 s. Init **Off** (0).

## Effects

Heading **Effects bus**, eyebrow **Space**. Tab **Effects**. Sub-tabs: **Dist**, **Comp**,
**Reverb**, **Delay**, **Chorus/Phaser**, **EQ**, **Master**.

**Dist** Mix 0–1 (Init 0), Drive 0–10 (Init 0), Tone 0–1 (Init 0.5).

**Comp** Mix 0–1 (Init 0), Thresh −60 to 0 (Init −20), Ratio 1 to 20 (Init 4), Attack 0.1 to 100
(Init 10), Release 10 to 1000 (Init 100).

**Reverb** Mix 0–1 (Init 0.2), Decay 0–0.99 (Init 0.5), **Plate** / **FDN**. Init **Plate**.

**Delay** Mix 0–1 (Init 0), Time 10 to 2000 (Init 375), Feedback 0–0.95 (Init 0.35).

**Chorus** Mix 0–1 (Init 0), Rate 0.1 to 5 (Init 1.2), Depth 0–1 (Init 0.4). **Phaser** Mix 0–1
(Init 0), Rate 0.1 to 5 (Init 0.5), Depth 0–1 (Init 0.5).

**EQ** is a curve. Drag it. Init is flat: low 100 Hz, mid 1 kHz, high 8 kHz, 0 dB.

**Master** **Width** 0 to 2 (Init 1, readout 100%; below 0.01 reads **Mono**). **Master** 0 to 2
(Init 1, readout 100%).

<!-- ac: SPEC-fermenter-effects/AC-007 -->

## Macro rig

Heading **Performance**, title **Macro rig**, LED **8 macros**. Pad **Bright** / **Motion** (macros
**Brightness** and **Motion**). Knobs: **Brightness**, **Motion**, **Width**, **Dirt**, **Space**,
**Punch**, **Texture**, **Character**. Each 0 to 1, Init 0.5.

Until you move a macro, the oscillator, filter, and effects knobs keep their Init values. Moving a
macro writes its assigned knobs. On **Init**:

- **Brightness** → cutoff
- **Motion** → LFO **→ Filter**
- **Width** → **Width**
- **Dirt** → Dist **Drive** and **Mix**
- **Space** → Reverb **Mix**
- **Punch** → Comp **Mix** and **Thresh**
- **Texture** → Warp **Amount**
- **Character** → a chaos amount that has no dedicated knob

**Matrix** **Assign macro targets** edits those assignments: pick the macro, a target from the
menu, **Center**, **Depth**, **Min**, **Max**, then **Clear**.

## Layers

Visible from **Build**. Heading **Layers**. Plus/minus set 1 to 4 layers (Init 1). Click **Layer 1**
… **Layer 4** to choose which layer the knobs write. The selected row shows the current engine;
other rows show **—**.

| Control   | Range   | Default | What it does   |
| --------- | ------- | ------- | -------------- |
| **Level** | 0 to 1  | 1       | Selected layer |
| **Pan**   | −1 to 1 | 0       | Selected layer |

There is no mute, solo, or bounce on this stack.

## Lab

Visible from **Lab**. **Scene morph** / **Four corners** blends four factory corners. The puck
stays with this session; the blend writes the patch and names it **Transform**. **Spectrum** is a
readout.

## Presets

The knobs in the tables, including **Layers** **Level** / **Pan** and the layer count, save with the
project, per Fermenter. Moving a macro writes those knobs, so the sound you dialled in still comes
back.

**Brightness** through **Character**, **Matrix** assignments, and **Current scene** stay with this
session. They are included when you save into **My Patches**.

**Play** / **Shape** / **Build** / **Route** / **Lab**, the centre tab, **AMP** / **FILTER**,
**Preset bench** search, category, and tag, and the **Scene morph** puck stay with this session.

User patches save from the **Current scene** row into **My Patches**.

## Automation and control

The knobs in the tables on this page appear as automation lanes (engine and waveform included).
**Play** through **Lab**, tabs, search, and the morph puck do not.

Many knobs accept MIDI learn.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
