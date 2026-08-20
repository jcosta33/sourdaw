# Crumbs — Sample

Crumbs is a MIDI sampler. Drop a file on the panel, pick a mode, and play the track.

**Type** Instrument · **Category** Sample · **Load from** Sidebar → Instruments → Crumbs

The Instruments card reads **Quick · Drum · Slice · Warp — drag & drop any audio**.

The left rail headings are **Sample**, **Pad bay** (Drum), **Recorder** (Record), and **Status**.
The centre headings are **Waveform**, **Slices** (Slice), and **Loop**. The right rail heading is
**Controls**.

Each Crumbs on a track keeps its own sample, mode, and knobs. A second Crumbs is not a second view
of the first.

## At a glance

- Drop an audio file on the faceplate. Empty **Sample** reads **No sample loaded** / **Drop a
  sample to begin**. While you drag, the overlay reads **Drop sample here**.
- Modes: **Quick**, **Drum**, **Slice**, **Warp**, **Record**. A fresh Crumbs is **Quick**.
- Play MIDI on the track. **Quick** maps the sample chromatically. **Status** shows voice count and
  **Ready**, **Loading...**, or **Engine unavailable**.

<!-- ac: SPEC-slicer/AC-001, SPEC-unified-sampler-suite/AC-005 -->

## First moves

1. Add Crumbs from the Instruments sidebar.
2. Drop a WAV (or another audio file) onto the panel.
3. Play a MIDI note on that track.
4. Drag **Cutoff** or **Gain** on **Controls**.

Drop is a desktop path. The panel has no other load control.

## Sample

Heading **Sample**. The LED is the file name, or **No sample loaded**.

Tiles, after a drop:

| Tile         | What it shows                                       |
| ------------ | --------------------------------------------------- |
| **Rate**     | Sample rate as `Nk`                                 |
| **Duration** | Length in seconds                                   |
| **Root**     | Detected pitch, or **—**. MIDI 60 is **C4**.        |
| **BPM**      | Estimated tempo, or **—**.                          |
| **Type**     | **percussive**, **tonal**, **loop**, or **unknown** |

<!-- ac: SPEC-unified-sampler-suite/AC-006, SPEC-unified-sampler-suite/AC-038 -->

A drop also picks a mode: **percussive** → **Drum**, **loop** → **Slice**, otherwise **Quick**.

The loaded file path and the mode save with the project. Reload needs that path still on disk.

## Waveform

Heading **Waveform**. The loaded sample is drawn here. In **Slice**, markers sit on top of it.

## Controls

Heading **Controls**. Mode chips, then **Envelope**, **Filter & Output**, **Voice Stack**.

### Mode

**Quick**, **Drum**, **Slice**, **Warp**, **Record**. Init **Quick**. The chip saves with the
project.

**Warp** has no extra knobs on this panel. It still switches the engine into warp playback.

### Envelope

| Control  | Range         | Default | Readout                       |
| -------- | ------------- | ------- | ----------------------------- |
| **Atk**  | 0.001 to 2 s  | 0.001 s | ms below 0.01 s, else seconds |
| **Hold** | 0 to 2 s      | 0 s     | milliseconds                  |
| **Dec**  | 0.001 to 5 s  | 0.3 s   | seconds                       |
| **Sus**  | 0 to 1        | 1       | percent                       |
| **Rel**  | 0.001 to 10 s | 0.1 s   | seconds                       |

### Filter & Output

| Control    | Range           | Default | What it does          |
| ---------- | --------------- | ------- | --------------------- |
| **Cutoff** | 20 Hz to 20 kHz | 20.0k   | Filter cutoff         |
| **Reso**   | 0.5 to 20       | 1.0     | Resonance             |
| **Gain**   | 0 to 2          | 0.8     | Output. Readout 80%   |
| **Tune**   | −24 to +24      | 0       | Semitones             |
| **Pan**    | −1 to +1        | 0       | **C**, **L**n, **R**n |

### Voice Stack

<!-- ac: SPEC-unified-sampler-suite/AC-026 -->

| Control    | Range    | Default | What it does   |
| ---------- | -------- | ------- | -------------- |
| **Voices** | 1 to 8   | 1       | Stacked voices |
| **Detune** | 0 to 100 | 0       | Cents          |
| **Spread** | 0 to 1   | 0       | Stereo spread  |

These knobs save with the project and appear as automation lanes.

## Pad bay

Visible in **Drum**. Heading **Pad bay**. Sixteen pads, **Pad 1** … **Pad 16**. Pad 1 is MIDI
**C2**; each next pad is one semitone up. Drag a pad onto another to reorder. Reorder stays with
this session.

> [!WARNING]
> **Not yet active.** Clicking a pad flashes the button. It does not send a note into the track.
> Play MIDI on the track instead.

## Slices

Visible in **Slice**. Heading **Slices**, LED `N markers`. **Auto-detect slices** draws markers on
**Waveform**. Drag a marker to move it. Labels are **S1**, **S2**, … Markers stay with this
session.

> [!WARNING]
> **Not yet active.** The markers are a picture. They do not change which region a MIDI note plays.

## Loop

Visible when a sample is loaded. Heading **Loop**. **Detect loop points**.

> [!WARNING]
> **Not yet active.** The button does not change what the track plays, and the loop does not save
> with the project.

<!-- ac: SPEC-unified-sampler-suite/AC-020 -->

## Recorder

Visible in **Record**. Heading **Recorder**. LED **Idle** or **Recording...**. **Arm** / **Stop**.

<!-- ac: SPEC-unified-sampler-suite/AC-019 -->

> [!NOTE]
> **Alpha.** Arm and Stop talk to the desktop recorder. The take does not appear as a named file on
> **Sample**. Drop remains the way to load audio onto that card.

## Presets

Mode, the dropped file reference, and the knobs in the tables save with the project, per Crumbs.

**Pad bay** order, **Slices** markers, **Loop** detection, **Recorder** Idle/Recording, and the
drop overlay stay with this session.

## Automation and control

**Gain**, **Atk**, **Hold**, **Dec**, **Sus**, **Rel**, **Cutoff**, **Reso**, **Tune**, **Pan**,
**Voices**, **Detune**, and **Spread** appear as automation lanes.

## See also

- [Concepts](../02-concepts.md) — device chains, parameters, and automation
- [Manual index](../README.md) — every chapter and device page
