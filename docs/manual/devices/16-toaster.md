# Toaster — Drums

Toaster is a sixteen-pad drum instrument with a step sequencer. It sits on a MIDI track, plays
synth drum voices, and can dump the pattern onto the timeline.

**Type** Instrument · **Category** Drums · **Load from** Sidebar → Instruments → Toaster

The Instruments card reads **808/909 synth engines · Step sequencer · 16 pads**.

The left rail headings are **Kit shelf** and **Pad bay**. The centre heading is **Pattern story**.
The right rail headings are **Transport**, **Pad mixer**, **Fill tools**, and **Groove**.

Each Toaster on a track keeps its own kit, pattern, and knobs. A second Toaster is not a second
view of the first.

## At a glance

- Sixteen pads. Click a pad to select it and to hit it. **Pad bay** knobs shape the selected pad.
- The step grid is one row per pad. Click a step to toggle it. Alt-drag a step up or down to set
  velocity.
- **Transport** **Play** runs Toaster's sequencer at the arrangement tempo. **To timeline** writes
  the pattern onto the track.
- **Straight** is the no-op groove. Do not hunt the Template menu for a catalogue; pick a feel and
  set **Amount**.

## First moves

1. Add Toaster from the Instruments sidebar. It opens on kit **Plain Bread**, pattern
   **Pattern A1**.
2. Click **Kick**, then click a few steps on the Kick row.
3. Click **Play** on **Transport**.
4. Drag **Master** on **Groove** if the kit is too loud.

## Kit shelf

Heading **Kit shelf**. Search placeholder **Find a loaf**. Click a row to load that kit. The loaded
kit stays highlighted. **Find a loaf** stays with this session.

A fresh Toaster is **Plain Bread**.

## Pad bay

Heading **Pad bay**. Sixteen pads. The selected pad shows its number (1–16), name, and engine label
under the grid.

On **Plain Bread**, Closed HH and Open HH show **C1** — they share a choke group, so hitting one
cuts the other.

<!-- ac: SPEC-drum-machine/AC-003, SPEC-drum-machine/AC-006 -->

| Control    | Range          | Default | What it does                                      |
| ---------- | -------------- | ------- | ------------------------------------------------- |
| **Hit**    | 0 to 100%      | 50%     | Decay                                             |
| **Tone**   | 0 to 100%      | 50%     | Brightness of the voice                           |
| **Crunch** | 0.0 to 10.0    | 0.0     | Drive                                             |
| **Level**  | 0 to 100%      | 80%     | Pad volume                                        |
| **Pan**    | −1.00 to +1.00 | 0.00    | Left / right                                      |
| **Bright** | 20 Hz to 20.0k | 20.0k   | Filter cutoff. Readout switches to `Nk` at 1 kHz. |

**Plain Bread** pad names, left to right, top to bottom: **Kick**, **Snare**, **Closed HH**,
**Open HH**, **Clap**, **Rim**, **Low Tom**, **Mid Tom**, **Hi Tom**, **Crash**, **Ride**,
**Cowbell**, **Clave**, **Shaker**, **Perc 1**, **Perc 2**. Kick is MIDI note 36; each next pad is
one semitone up.

A muted pad shows **Mute** over the button.

## Pattern story

Heading **Pattern story**. Title is the kit name. Tiles: **Pattern**, **Step** (playback cursor,
1-based), **Swing**, **Voices**.

With one pattern the **Pattern** tile reads **Pattern A1**. When a kit has more than one pattern,
chips named for those patterns switch the active lane.

The grid caption is **Click to toggle · Alt-drag a step up/down to set velocity**. Default grid is
16 steps, one bar. A new step is off, velocity 80% if you turn it on.

A white dot on an active step means probability is below 100%. A `N×` mark means retrigger. There
is no control on this panel to set those; they only show when a step already has them.

## Transport

| Control           | What it does                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| **Play**/**Stop** | Starts or stops Toaster's sequencer at the arrangement tempo. Disabled when the assigned groove is not usable. |
| **To timeline**   | Writes the pattern onto the track as MIDI notes. Same disable rule as **Play**.                                |

Status copy includes **Straight timing is active; no groove is assigned.** when nothing is assigned,
and **The assigned groove is compatible with this pattern.** when it is.

The LED reads `N voices`.

## Pad mixer

One strip per pad: volume, a pan indicator, **M**, **S**, truncated name.

| Control | Range     | Default | What it does                                     |
| ------- | --------- | ------- | ------------------------------------------------ |
| Volume  | 0 to 100% | 80%     | Same value as **Pad bay** **Level**              |
| **M**   | off / on  | off     | Mute                                             |
| **S**   | off / on  | off     | Solo. Any soloed pad silences pads that are not. |

The pan row is a picture of **Pad bay** **Pan**, not a second pan control. Mint and cyan dots on
the fader mean that pad has reverb or delay send in the kit; there is no send knob on this panel.

## Fill tools

Heading **Fill tools**. Two number fields with **of** between them, then **Toast**.

| Control   | Range   | Default | What it does                                         |
| --------- | ------- | ------- | ---------------------------------------------------- |
| Hits      | 0 to 32 | 4       | How many onsets **Toast** writes on the selected pad |
| Steps     | 1 to 64 | 16      | Cycle length **Toast** uses                          |
| **Toast** | —       | —       | Writes an even Euclidean rhythm onto that pad's row  |

Hits and Steps stay with this session.

<!-- ac: SPEC-drum-machine/AC-013 -->

## Groove

Heading **Groove**. Label **Template** (select **Pattern groove template**). Label **Amount** with a
percentage and a range 0 to 1, default 100% on **Straight**.

**Straight** does not move the steps. **Play** stays enabled for **Straight** and for a compatible
assigned groove.

<!-- ac: SPEC-drum-machine-groove-templates/AC-002 -->

| Control    | Range       | Default | What it does                    |
| ---------- | ----------- | ------- | ------------------------------- |
| **Swing**  | 0 to 100%   | 0%      | Delays even sequencer steps     |
| **Master** | 0 to 200%   | 100%    | Kit output                      |
| **Space**  | 0 to 100%   | 15%     | Global reverb mix               |
| **Spray**  | 0 to 100%   | 0%      | Global delay mix                |
| **Bits**   | 4 to 16 bit | 16 bit  | Lo-fi bit depth. 16 bit is off. |
| **Dust**   | 0 to 100%   | 0%      | Lo-fi mix                       |

<!-- ac: SPEC-drum-machine/AC-009 -->

## Presets

Kits, pad knobs, mixer mute/solo, the step grid, **Groove** knobs, and the Template assignment save
with the project, per Toaster.

**Find a loaf**, Fill **Hits** / **Steps**, stay with this session.

## Automation and control

**Master**, **Reverb**, **Delay**, and **Swing** appear as automation lanes.

**Master** and **Swing** follow the **Groove** knobs of those names. **Reverb** follows **Space**.
**Delay** follows **Spray**.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
