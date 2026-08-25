# MIDI module — Agent Guidelines

Owns MIDI note data, CC/pitch-bend/articulation events, note transform algorithms (quantize, humanize, transpose, legato), chord track events, groove templates, step recording, and WebMIDI hardware input/MPE routing; does not own clip arrangement placement or track strips (Arrangement) or synth audio DSP (Synth / AudioEngine).

## Public Contract Surface

- `stores/`: `midiStore` (`MidiStoreState`), `grooveTemplateStore` (`GrooveTemplateState`, `GrooveTemplateAssignment`, `GrooveConsumerType`), `grooveTemplateProjectRevisionStore`, `chordTrackStore` (`ChordTrackState`), `stepRecordStore` (`StepRecordState`), `webMidiStore`.
- `useCases/`: Note CRUD (`addMidiNote`, `appendMidiNotes`, `batchAddMidiNotes`, `removeMidiNote`, `moveMidiNote`, `resizeMidiNote`, `setNoteVelocity`, `setNoteProbability`, `getNotesForClip`, `setNotesForClip`, `splitMidiNotesAtBeat`), note transforms (`quantizeNotes`, `quantizeNoteLengths`, `humanizeNotes`, `transposeNotes`, `invertNotes`, `retrogradeNotes`, `legatoNotes`, `scaleVelocities`, `strumNotes`, `snapClipToScale`), clip MIDI data (`duplicateMidiClipData`, `glueMidiClipData`, `prepareMidiClipSplit`), chord track (`addChordEvent`, `removeChordEvent`, `moveChordEvent`, `updateChordEvent`, `createChordPitchProjector`, `getChordAtBeat`, `transposeForChordTrack`), groove templates (`createGrooveTemplate`, `extractGrooveTemplate`, `applyGrooveTemplate`, `assignGrooveTemplate`, `previewGrooveTemplate`, `projectClipMidiEvents`), MIDI events (`addMidiCC`, `addPitchBend`, `setNotePressure`, `setNoteSlide`), step recording (`toggleStepRecording`, `stepRecordNoteOn`, `stepRecordNoteOff`, `stepRecordAdvance`), WebMIDI (`initWebMidi`, `selectMidiInput`, `setMidiInputTrack`, `panicLiveNotes`, `triggerLiveNoteOn`, `triggerLiveNoteOff`), file I/O (`readMidiFile`, `downloadMidiFile`), registry (`MIDI_EFFECT_FACTORIES`).
- `events/`: No public domain event payloads exported.
- `presentations/views/`: No views exported (piano roll UI lives in `TimelineEditor`).
- Handlers: `getChordTrackHandlers()`, `getMidiGrooveHandlers()`, `getMidiNoteTransformHandlers()`, `getPatternInstanceHandlers()`, `getWebMidiInputHandlers()`.

## Key Subsystems

- **Note & Expression Model:** Note start, duration, pitch, velocity, probability, and per-note MPE/expression data stored by clip ID.
- **Note Transformation Engine:** Algorithmic manipulations (quantize, humanize, retrograde, invert, legato, scale, strum).
- **Groove Engine:** Non-destructive groove template extraction, previewing, and live dynamic projection (`projectClipMidiEvents`).
- **Chord Track & Pitch Projector:** Harmonic progression model with dynamic scale/chord pitch conforming (`createChordPitchProjector`).
- **WebMIDI & Step Recording:** Low-latency WebMIDI hardware input with MPE channel routing, panic/all-notes-off, and step sequencer recording.

## Invariants & Traps

- **Relative Clip Coordinates:** Notes in `midiStore` are stored with clip-relative start beats (not absolute arrangement timeline beats).
- **Non-Destructive Grooves:** Groove template application dynamically projects note timing without mutating stored note timestamps unless explicitly committed.
- **Live Note Panic Safety:** `panicLiveNotes` must broadcast note-off messages across all 16 MIDI channels to prevent hanging audio synth voices.
- **Hardware Port Reconnection:** WebMIDI input listeners must handle hot-plugged devices and state teardown gracefully.

## Verification

```bash
pnpm vitest run src/modules/MIDI
pnpm deps:validate
```
