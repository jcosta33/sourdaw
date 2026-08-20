# Levain — Orchestra

Levain is a sampled orchestra instrument. It sits on a MIDI track, plays a chosen section from
disk, and mixes close, tree, and room mics.

**Type** Instrument · **Category** Orchestra · **Load from** Sidebar → Instruments → Levain

The Instruments card reads **Sample playback · Legato · Expression · Multi-mic**.

The left rail heading is **Lineup**. The centre heading is **Phrase stage**. The right rail heading
is **Quick read**.

Each Levain on a track keeps its own section, knobs, and sound. A second Levain is not a second
view of the first.

<!-- ac: SPEC-levain-multi-instance/AC-005, SPEC-levain-multi-instance/AC-011, SPEC-orchestra-daw-integration/AC-001 -->

## At a glance

- Pick a section in **Lineup**, a technique in **Articulation rail**, then play MIDI on that track.
- **Phrase** is dynamics, vibrato, and legato. **Lift** is transition timing. **Spread** is
  humanize. **Stage** is the three mics. **Handles** are eight performance knobs. **Desk** is
  **Master** plus two tail chips.
- MIDI **CC1** is dynamics, **CC11** is expression, **CC2** is vibrato. The **Dynamics**,
  **Expression**, and **Vibrato** handles send those.
- **Find a section** and the family chips (**All**, **Strings**, **Brass**, **Woodwinds**,
  **Percussion**) stay with this session.

## First moves

1. Add Levain from the Instruments sidebar. It opens on **Solo Violin**.
2. Wait until the amber LED reads **Ready** and **Load** reads **Ready**.
3. Play MIDI on that track.
4. Click **Cellos** (or another section) if you want a different line, then play again.

<!-- ac: SPEC-levain-multi-instance/AC-004, SPEC-levain-multi-instance/AC-009 -->

## Lineup

Heading **Lineup**, title **Levain**. The LED is **Ready** or **Loading**.

Search placeholder **Find a section**. Family chips: **All**, **Strings**, **Brass**, **Woodwinds**,
**Percussion**. Only sections with samples appear.

| Family         | Sections                                                            |
| -------------- | ------------------------------------------------------------------- |
| **Strings**    | **Solo Violin**, **Violins II**, **Violas**, **Cellos**, **Basses** |
| **Brass**      | **Trumpets**, **Horns**, **Trombones**, **Tuba**                    |
| **Woodwinds**  | **Flutes**, **Piccolo**, **Oboes**, **Clarinets**, **Bassoons**     |
| **Percussion** | **Timpani**, **Glockenspiel**, **Marimba**                          |

Default section is **Solo Violin**. A fresh Levain has not loaded samples yet; **Load** stays
**Ready** until a load is in flight, then shows a percentage, or **Error** and the failure text.

## Articulation rail

Heading **Articulation rail**, list heading **Articulations**. Click a row to choose the technique.
The right-hand note is the keyswitch, when the family has one.

**Phrase stage** tiles **Artic** (technique name) and **Legato** (**On** / **Off**) follow the rail
and the **Legato On** / **Legato Off** toggle on **Phrase**.

<!-- ac: SPEC-orchestra-progressive-disclosure-ux/AC-005 -->

Strings (including **Solo Violin**) start on **Long**, keyswitch **C1**:

| Name             | Keyswitch |
| ---------------- | --------- |
| **Long**         | C1        |
| **Long (nv)**    | C#1       |
| **Tremolo**      | D1        |
| **Trill (half)** | D#1       |
| **Spiccato**     | E1        |
| **Staccato**     | F1        |
| **Pizzicato**    | F#1       |
| **Legato**       | G1        |
| **Portamento**   | G#1       |
| **Con sordino**  | A1        |
| **Flautando**    | A#1       |
| **Col legno**    | B1        |

Brass starts **Long**, **Long (nv)**, **Staccato**, **Marcato**, **Sforzando**, **Legato**,
**Flutter**, **Muted** from **C1**. Woodwinds start **Long**, **Staccato**, **Legato**,
**Trill (half)**, **Flutter** from **C1**. Percussion is a single **Hit** with no keyswitch.

## Phrase

Section **Phrase**. Inner heading **Expression**. Curve chips **Linear**, **S-Curve**,
**Logarithmic**. Default **S-Curve**. Toggle **Legato On** / **Legato Off**, default **On**.

The picture is labelled **CC1 → Dynamics**, with **pp** **p** **mp** **mf** **f** **ff**, and the
crossfade time as `Nms xfade`.

| Control       | Range         | Default | What it does                                        |
| ------------- | ------------- | ------- | --------------------------------------------------- |
| **Xfade**     | 20 to 300 ms  | 100 ms  | How long a CC1 move takes to change dynamic layer   |
| **Vib Depth** | 0 to 50 ct    | 40 ct   | Maximum vibrato depth                               |
| **Rate Min**  | 2.0 to 7.0 Hz | 4.0 Hz  | Slowest vibrato rate. Cannot go above **Rate Max**. |
| **Rate Max**  | 2.0 to 9.0 Hz | 7.0 Hz  | Fastest vibrato rate. Cannot go below **Rate Min**. |
| **Onset**     | 0 to 500 ms   | 200 ms  | Delay before vibrato starts on a new note           |

> [!WARNING]
> **Not yet active.** **Linear**, **S-Curve**, and **Logarithmic** redraw the picture. Playback stays
> on **S-Curve**. The chips stay with this session.
> [#2418](https://github.com/jcosta33/sourdaw/issues/2418)

## Lift

Section **Lift**. Inner heading **Legato**. Toggle **Adaptive On** / **Adaptive Off**, default
**On**. The picture marks **Fast**, **Medium**, and **Slow**.

| Control       | Range         | Default | What it does                                        |
| ------------- | ------------- | ------- | --------------------------------------------------- |
| **Slow**      | 150 to 500 ms | 300 ms  | Notes held longer than this use the slow transition |
| **Fast**      | 30 to 200 ms  | 100 ms  | Notes closer than this use the fast transition      |
| **Porto Vel** | 0 to 127      | 64      | Velocity at and above this can portamento           |

> [!WARNING]
> **Not yet active.** **Adaptive Off** remembers the click. Transition timing still follows the
> adaptive engine whenever **Legato** is **On**.
> [#2419](https://github.com/jcosta33/sourdaw/issues/2419)

## Spread

Section **Spread**. Inner heading **Humanization**.

| Control      | Range        | Default | What it does                    |
| ------------ | ------------ | ------- | ------------------------------- |
| **Humanize** | 0 to 100%    | 50%     | How much the detail knobs apply |
| **Timing**   | ±0 to ±25 ms | ±15 ms  | Start-time scatter              |
| **Tuning**   | ±0 to ±10 ct | ±5 ct   | Pitch scatter                   |
| **Dynamic**  | ±0 to ±15%   | ±8%     | Level scatter                   |
| **Vib Var**  | ±0 to ±30%   | ±15%    | Vibrato scatter                 |

## Stage

Section **Stage**. Inner heading **Mic Positions**. Three columns: **Close**, **Decca Tree**,
**Room**. Each column has **ON** / **OFF**, a level fader, a pan knob, and the mic name.

| Control    | Range           | Default                                                               | What it does     |
| ---------- | --------------- | --------------------------------------------------------------------- | ---------------- |
| **ON/OFF** | **ON**, **OFF** | Close **ON**, Decca Tree **ON**, Room **OFF**                         | Include that mic |
| Level      | −70 to +6 dB    | Close about −9 dB, Decca Tree about −24 dB, Room −70 dB while **OFF** | Mic level        |
| Pan        | −1.00 to +1.00  | 0.00                                                                  | Left / right     |

**Quick read** **Space** is `3 mics` on a fresh patch.

## Handles

Eight knobs, 0 to 1. Every handle double-clicks to 0.50. A fresh patch is **Dynamics** 0.50,
**Expression** 1.00, **Vibrato** 0.00, and the rest 0.50.

**Dynamics**, **Expression**, **Vibrato**, **Tightness**, **Space**, **Tone**, **Attack**,
**Release**.

| Handle         | Default | What it does                             |
| -------------- | ------- | ---------------------------------------- |
| **Dynamics**   | 0.50    | Sends MIDI CC1                           |
| **Expression** | 1.00    | Sends MIDI CC11                          |
| **Vibrato**    | 0.00    | Sends MIDI CC2                           |
| **Tightness**  | 0.50    | Inverse of humanize amount at the engine |
| **Space**      | 0.50    | Close vs Room mix at the engine          |
| **Tone**       | 0.50    | Brightness                               |
| **Attack**     | 0.50    | Envelope attack scale                    |
| **Release**    | 0.50    | Envelope release scale                   |

The handle position stays with this session. It does not rewrite **Spread** or **Stage**, so those
faders can disagree with the last **Tightness** or **Space** move until you turn the granular
control again.

<!-- ac: SPEC-orchestra-progressive-disclosure-ux/AC-004 -->

## Desk

| Control           | Range     | Default | What it does              |
| ----------------- | --------- | ------- | ------------------------- |
| **Master**        | 0 to 200% | 80%     | Output level              |
| **Release tails** | Off / On  | On      | Release samples           |
| **Dynamic tails** | Off / On  | On      | Scale tails with dynamics |

> [!WARNING]
> **Not yet active.** **Release tails** and **Dynamic tails** remember the click. Note-off tails do
> not follow them.
> [#2420](https://github.com/jcosta33/sourdaw/issues/2420)

## Quick read

| Label          | What it shows                           |
| -------------- | --------------------------------------- |
| **Instrument** | Section name, e.g. **Solo Violin**      |
| **Family**     | Family id, e.g. `strings`               |
| **Phrase**     | Articulation name, e.g. **Long**        |
| **Humanize**   | **Spread** **Humanize** as a percentage |
| **Space**      | Mic count, `3 mics` on a fresh patch    |

**Phrase stage** also shows **Artic**, **Legato** (**On** / **Off**), and **Load** (**Ready**, a
percentage, or **Error**).

## Presets

Levain has no factory-preset drawer on this panel. Section, current articulation, Phrase knobs,
Lift knobs, Spread knobs, Stage mics, and Desk **Master** save with the project, per Levain.

**Handles**, **Find a section**, the family chips, and the **Linear** / **S-Curve** / **Logarithmic**
chips stay with this session.

<!-- ac: SPEC-levain-multi-instance/AC-010 -->

## Automation and control

**Master**, **Humanize**, **Vibrato**, and **Legato** appear as automation lanes.

**Master**, **Humanize**, and **Legato** follow the **Desk** **Master** knob, the **Spread**
**Humanize** knob, and **Legato On** / **Off**.

**Vibrato** is 0 to 1 and drives vibrato depth as a CC-style amount. It is not the **Vib Depth**
cents knob on **Phrase**.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
