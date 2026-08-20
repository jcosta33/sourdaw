# Knead — Pitch correction

Knead retunes a monophonic audio clip while you play. It lives in the clip editor, not the
Instruments or Effects sidebar.

**Type** Audio effect · **Category** Pitch · **Load from** Clip editor → **Knead (Pitch)** →
**Enable Pitch Editor**

That button puts Knead on the track. The mixer lists it as **Knead**. There is no separate
faceplate; this page is the editor that opens with **Knead (Pitch)**.

Each audio clip keeps its own blobs and sliders. A second clip is not a second view of the first.

## At a glance

- Open an audio clip. Switch **Waveform** to **Knead (Pitch)**.
- Empty editor reads **Pitch Correction Disabled**. **Enable Pitch Editor** adds Knead and starts
  analysis.
- Blobs are detected notes. Drag them to retune. **Retune** sets how fast the pitch follows.
  **Formants** keeps the timbre from stretching with the pitch.

<!-- ac: SPEC-clip-pitch-editing/AC-002, SPEC-clip-pitch-editing/AC-003, SPEC-knead/AC-013 -->

## First moves

1. Select an audio clip on an audio track.
2. Click **Knead (Pitch)** next to **Waveform**.
3. Click **Enable Pitch Editor** if the overlay is up.
4. Wait for blobs, then drag one up or down and play the clip.

## Overlays

These cover the canvas until analysis has blobs.

| Overlay                              | When it shows                                         |
| ------------------------------------ | ----------------------------------------------------- |
| **Pitch Correction Disabled**        | No Knead on this track.                                   |
| **Enable Pitch Editor**              | The button on that overlay. Adds Knead to the track.  |
| **Analyzing pitch tracking data...** | Knead is on, analysis is running. A bar and percent.  |
| **No pitch detected in this clip.**  | Analysis finished and found no voiced pitch.          |
| **No pitch data analyzed.**          | Canvas empty message when there are no blobs to draw. |

## Toolbar

The bar is at the top of the editor. **Retune**, **Scale**, **Correct All**, **Human**, and
**Formants** appear only after blobs exist. **Zoom** is always there. **Bounce & Commit** appears
when the clip has both a contour and blobs.

| Control             | Range                                   | Default   | What it does                                                                |
| ------------------- | --------------------------------------- | --------- | --------------------------------------------------------------------------- |
| **Retune**          | 0 to 200                                | 25        | How quickly the pitch glides to the blob, in milliseconds.                  |
| **Scale** (key)     | C, C#, D, D#, E, F, F#, G, G#, A, A#, B | C         | Project key. Used by **Correct All**.                                       |
| **Scale** (mode)    | See below                               | chromatic | Project scale. Used by **Correct All**.                                     |
| **Correct All**     | —                                       | —         | Snaps every blob centre to the nearest note in that key and scale.          |
| **Human**           | 0 to 100                                | 40        | Stored with the clip.                                                       |
| **Formants**        | On / Off                                | On        | Keeps the vocal character when a blob is shifted.                           |
| **Bounce & Commit** | —                                       | —         | Renders the current shifts into a new audio file and points the clip at it. |
| **Zoom**            | 50 to 400                               | 100       | Horizontal zoom of the canvas. Stays with this session.                     |

**Scale** modes, as printed: major, minor, harmonic Minor, melodic Minor, dorian, phrygian, lydian,
mixolydian, pentatonic Major, pentatonic Minor, blues, whole Tone, diminished, chromatic.

The key and scale belong to the project, not to this clip. Changing them here changes them for the
project.

<!-- ac: SPEC-knead/AC-004 -->

> [!WARNING]
> **Not yet active.** **Human** moves and saves. It does not change the sound.

## Canvas

A faint line is the detected pitch. Coloured blobs are the notes Knead will retune. A white playhead
follows transport.

Hover a blob for handles. Drag:

| Grab                   | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| Upper half of the blob | Move pitch in semitone steps                         |
| Lower half of the blob | Move pitch in cents                                  |
| Left edge              | Move the start. The blob stays at least 0.05 s long. |
| Right edge             | Move the end. Same minimum length.                   |

<!-- ac: SPEC-clip-pitch-editing/AC-004, SPEC-clip-pitch-editing/AC-005 -->

> [!WARNING]
> **Not yet active.** The small circles on the top and bottom of a hovered blob do not change
> pitch or timing.

Playback uses the live blobs. The edit is not baked into the file until **Bounce & Commit**.

<!-- ac: SPEC-clip-pitch-editing/AC-008 -->

## Mixer

Knead on the track can be bypassed like any other device. Bypass is dry audio. There are no Knead
knobs on the mixer.

## Presets

There is no Knead preset browser.

Blobs, **Retune**, **Human**, and **Formants** save with the clip in the project. The key and scale
save with the project. **Zoom** does not.

## Automation and control

Knead has no automation lanes. Pitch is the blobs on this clip.

## See also

- [Concepts](../02-concepts.md) — clips, devices, and undo
- [Manual index](../README.md) — every chapter and device page
