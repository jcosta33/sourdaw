# Scoring — Tuner

Scoring is a tuner. Add it to a track and play or sing through it. It listens; it does not change
the sound.

The panel is labelled **Tuning deck**. It opens on **Needle**. The left rail heading is **Scoring**.

**Type** Audio effect · **Category** Tuner · **Load from** Sidebar → Effects → Scoring

## At a glance

- **Needle**, **Strobe**, and **Poly** displays for the same pitch read.
- **Concert A** sets the reference, 400 to 490 Hz.
- Cents, detected pitch, and tracker confidence while a note is held.

## First moves

1. Add Scoring to the track you are tuning and play a note through it.
2. Leave **Display** on **Needle** unless you want **Strobe**.
3. Watch the big note and the cents readout. Green is within ±2 cents of the note; yellow is within
   ±10 cents; red is further out.
4. Turn **Concert A** only if you are not tuning to 440 Hz.

## Display

The three rows in **Display** change how **Main read** draws the same pitch. They do not bypass the
tuner. The device opens on **Needle**. The choice is this session only — it is not stored in the
project.

| Row        | Detail              | What you get                                      |
| ---------- | ------------------- | ------------------------------------------------- |
| **Needle** | Classic center read | A needle around 0 cents. Default.                 |
| **Strobe** | Motion lock         | Bars that drift until the pitch sits on the note. |
| **Poly**   | String spread       | Six guitar-string rows. See the warning below.    |

The selected row shows **Live**.

> [!WARNING]
> **Not yet active.** **Poly** lists **E2**, **A2**, **D3**, **G3**, **B3**, and **E4**, and reads
> **Strum all open strings**, but every string stays a dash. Needle and Strobe still follow the
> note. [#2383](https://github.com/jcosta33/sourdaw/issues/2383)

## Concert A

| Control       | Range         | Default | What it does                                      |
| ------------- | ------------- | ------- | ------------------------------------------------- |
| **Concert A** | 400 to 490 Hz | 440 Hz  | The A the cents and note names are measured from. |

The knob snaps to whole hertz. The number is also the **Reference** badge on that card.

## Main read

The heading is **Tuning deck**. While a pitch is found it shows the note name and octave (for
example **A4**). Otherwise it reads **Waiting for pitch**. The LED is **Tracking** or **Idle**.

| Readout | Shows                                                          |
| ------- | -------------------------------------------------------------- |
| Note    | Detected name, large, plus the octave underneath               |
| Cents   | Offset from that note, to one decimal. **—** with no pitch     |
| Hz      | Detected frequency, to one decimal. **No input** with no pitch |
| History | Cents over time, under the display                             |

Note and cents turn green within ±2 cents, yellow within ±10 cents, and red beyond that, matching
**Guide**.

## Quick read

| Row           | Shows                                          |
| ------------- | ---------------------------------------------- |
| **Mode**      | `needle`, `strobe`, or `poly`                  |
| **Reference** | Concert A, in Hz                               |
| **Status**    | **Locked** with a pitch, **Listening** without |

The card badge is **Signal up** or **No signal**.

## Guide

| Row             | Meaning                      |
| --------------- | ---------------------------- |
| **Tight zone**  | ±2c — the green band         |
| **Usable zone** | ±10c — still yellow, not red |

## Header meters

| Tile      | Detail   | Shows                              |
| --------- | -------- | ---------------------------------- |
| **Cents** | Offset   | Same cents as Main read            |
| **Pitch** | Detected | Same Hz as Main read               |
| **Conf**  | Tracker  | How sure the tracker is, 0 to 100% |

**Conf** still reads a percentage when there is no pitch.

## Presets

Scoring has no factory-preset list on this panel.

## Automation and control

**Concert A** saves with the project. It does not appear as an automation lane.

**Needle** / **Strobe** / **Poly** do not save with the project.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
