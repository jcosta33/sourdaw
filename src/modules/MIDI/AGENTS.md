# MIDI module — Agent Guidelines

Owns MIDI note data, CC/pitch-bend/articulation events, note transform algorithms (quantize, humanize, transpose, legato), chord track events, groove templates, step recording, and WebMIDI hardware input/MPE routing; does not own clip arrangement placement or track strips (Arrangement) or synth audio DSP (Synth / AudioEngine).

## Public Contract Surface

- `stores/`: `midiStore` (`MidiStoreState`), `grooveTemplateStore` (`GrooveTemplateState`, `GrooveTemplateAssignment`, `GrooveConsumerType`), `grooveTemplateProjectRevisionStore`, `chordTrackStore` (`ChordTrackState`), `stepRecordStore` (`StepRecordState`), `webMidiStore`.
- `useCases/`: Note CRUD (`addMidiNote`, `appendMidiNotes`, `batchAddMidiNotes`, `removeMidiNote`, `moveMidiNote`, `resizeMidiNote`, `setNoteVelocity`, `setNoteProbability`, `getNotesForClip`, `setNotesForClip`, `splitMidiNotesAtBeat`), note transforms (`quantizeNotes`, `quantizeNoteLengths`, `humanizeNotes`, `transposeNotes`, `invertNotes`, `retrogradeNotes`, `legatoNotes`, `scaleVelocities`, `strumNotes`, `snapClipToScale`), clip MIDI data (`duplicateMidiClipData`, `glueMidiClipData`, `prepareMidiClipSplit`), chord track (`addChordEvent`, `removeChordEvent`, `moveChordEvent`, `updateChordEvent`, `createChordPitchProjector`, `getChordAtBeat`, `transposeForChordTrack`), groove templates (`createGrooveTemplate`, `extractGrooveTemplate`, `applyGrooveTemplate`, `assignGrooveTemplate`, `previewGrooveTemplate`, `projectClipMidiEvents`), MIDI events (`addMidiCC`, `addPitchBend`, `setNotePressure`, `setNoteSlide`), step recording (`toggleStepRecording`, `stepRecordNoteOn`, `stepRecordNoteOff`, `stepRecordAdvance`), WebMIDI (`initWebMidi`, `selectMidiInput`, `setMidiInputTrack`, `panicLiveNotes`, `triggerLiveNoteOn`, `triggerLiveNoteOff`, `resolveLiveInputNoteReceiver`), file I/O (`readMidiFile`, `downloadMidiFile`), registry (`MIDI_EFFECT_FACTORIES`).
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
- **Recorded Channel Events:** While recording on an armed track, channel controllers (0..119, raw number and 7-bit value, including RPN/NRPN and data entry) and non-member-channel pitch bend are recorded for the recording clip at the beat and in the clip a note-on at that instant gets (`resolveRecordingPlacement`). Every message is kept in arrival order (the CC lane's `addMidiCC` dedups by beat, channel and controller and is for editing only). Controllers owned by a MIDI-learn mapping and MPE member-channel slide and bend stay out. The rows wait in `recordedControllerTakeState`, not in `midiStore`, because each store write reconciles the clip's whole row list and would stall every flush as the take grows; `flushRecordedControllers` writes them in one store write, with no undo entry, from `handleCommitRecording.describe` ahead of its snapshot read, so the commit snapshots them and a message arriving after that belongs to no take. A clip the recorder did not open (an overdub) flushes when the transport stops recording; a discarded take's buffer is dropped unwritten, and a new take never inherits one. A sustain, sostenuto or soft pedal already held when the take begins (`MidiChannelControllerState.heldPedals`, read at the transport's recording rising edge) leads the clip's list at beat 0 on its channel, unless the take records that controller and channel at beat 0 itself. `MidiPitchBend.value` is the signed 14-bit wire delta (-8192..8191, 0 = centre), the same unit as `MidiNote.pitchBend`.
- **Live Note Panic Safety:** `panicLiveNotes` must broadcast note-off messages across all 16 MIDI channels to prevent hanging audio synth voices.
- **Hardware Port Reconnection:** WebMIDI input listeners must handle hot-plugged devices and state teardown gracefully.

## Verification

```bash
pnpm vitest run src/modules/MIDI
pnpm deps:validate
```
