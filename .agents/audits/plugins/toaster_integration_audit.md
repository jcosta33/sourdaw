# Toaster Integration & Workflow Audit

This document identifies the remaining integration bugs between the Toaster drum machine and the wider Sourdaw DAW environment.

## 1. [FIXED] Preset Differentiation & DSP Fingerprinting

**Issue:** "I think the presets lack differentiation between them. The snares also still sound pretty odd for snares."
**Root Cause:** While the React UI manages distinct `engineParams` for each instrument model (e.g. tuning the 808 kick vs analog kick), `loadToasterKit.ts` **completely fails to forward these parameters to the Rust AudioWorklet**.

- In `loadToasterKitPreset`, the loop iterating over `kit.pads` skips `pad.engineParams`.
- Consequently, all drum engines load with factory default generic settings regardless of which preset is selected.

## 2. [FIXED] Sequencer MIDI Playback (The Silent Note Bug)

**Issue:** "Midi that I add manually to the midi clips on each track (like snare, kick etc) do not play any sound when I play the song."
**Root Cause:** The `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts` playback loop does not contain the logic necessary to route child-track MIDI into a parent track's `toaster` device.

- While `messageHandlers.ts` (live MIDI monitoring) correctly identifies a `toaster` parent and remaps the MIDI channel/pad target, the sequencer loop does not. The notes are scheduled blindly or skipped.

## 3. [x] Groove Creator "To Timeline" Empty Clips

**Issue:** "When I send 'To timeline' it adds some empty clips instead of adding the pattern properly."
**Root Cause:** In `exportPatternToTimeline.ts`, the exported `startBeat` for each note is calculated as an **absolute beat** (`insertAt + s * stepDurationBeats`) rather than a **clip-relative beat**.

- Because the `addMidiNote` API inherently expects note positions to be relative to the clip boundary, passing an absolute clock time results in notes that are placed _outside_ the duration of the clip. They exist in the data model, but are completely out of bounds and therefore render as empty.

## 4. [FIXED] Visual Layout (Drum Folder UI)

**Issue:** "Drum tracks just visually, with a different icon and color to differentiate from regular folders."
**Root Cause:** Sourdaw currently relies strictly on the `kind: 'folder'` state to render the track header UI. There is no concept of a "Drum Machine" specific folder.

- A simple check inside `TrackHeader.tsx` (and related arrangement views) for `track.devices.some(d => d.type === 'toaster')` can be used to swap the standard `Folder` icon for a `Drum` or `Grip` icon, and shift the background shading to better delineate drum clusters from generic grouping folders.
