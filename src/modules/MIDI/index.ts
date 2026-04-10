// ── Stores ────────────────────────────────────────────────────────────────────
export { midiLearnStore } from './stores/midiLearnStore';
export type { MidiMappingTargetType, MidiMapping, LearningTarget, MidiLearnState } from './stores/midiLearnStore';

export { midiStore } from './stores/midiStore';
export type { MidiStoreState } from './stores/midiStore';

// ── Use Cases: Arpeggiator ─────────────────────────────────────────────────────
export { arpeggiate } from './useCases/arpeggiator';
export type { ArpPattern, ArpRate } from './useCases/arpeggiator';

// ── Use Cases: Chord Stamps ───────────────────────────────────────────────────
export { stampChord, removeNotesByIds, CHORD_TYPES, CHORD_TYPE_KEYS } from './useCases/chordStamps';
export type { ChordType } from './useCases/chordStamps';

// ── Use Cases: Chord Track ────────────────────────────────────────────────────
export { addChordEvent } from './useCases/chordTrack/addChordEvent';
export { clearChordTrack } from './useCases/chordTrack/clearChordTrack';
export { getChordAtBeat } from './useCases/chordTrack/getChordAtBeat';
export { moveChordEvent } from './useCases/chordTrack/moveChordEvent';
export { removeChordEvent } from './useCases/chordTrack/removeChordEvent';
export { toggleChordTrack } from './useCases/chordTrack/toggleChordTrack';
export { updateChordEvent } from './useCases/chordTrack/updateChordEvent';

export { getChordTrackHandlers } from './useCases/getChordTrackHandlers';

// ── Use Cases: Note creation ──────────────────────────────────────────────────
export { createMidiNote } from './useCases/createMidiNote';

// ── Use Cases: File I/O ───────────────────────────────────────────────────────
export { exportMidiClip } from './useCases/exportMidiFile';
export { importMidiFile } from './useCases/importMidiFile';

// ── Use Cases: Formatting ─────────────────────────────────────────────────────
export { formatChordName } from './useCases/formatChordName';

// ── Use Cases: State accessors ────────────────────────────────────────────────
export { getMidiLearnState } from './useCases/getMidiLearnState';
export { getMidiStoreState } from './useCases/getMidiStoreState';
export { setMidiStoreState } from './useCases/setMidiStoreState';

// ── Use Cases: Groove Extraction ──────────────────────────────────────────────
export { extractGrooveFromClip, applyGrooveToClip, restoreGrooveOriginals } from './useCases/grooveExtraction';
export type { GrooveTemplate } from './useCases/grooveExtraction';

// ── Use Cases: MIDI Events ────────────────────────────────────────────────────
export { addMidiCC } from './useCases/midiEvent/addMidiCC';
export { addPitchBend } from './useCases/midiEvent/addPitchBend';
export { moveMidiCC } from './useCases/midiEvent/moveMidiCC';
export { movePitchBend } from './useCases/midiEvent/movePitchBend';
export { removeMidiCC } from './useCases/midiEvent/removeMidiCC';
export { removePitchBend } from './useCases/midiEvent/removePitchBend';
export { setNotePressure } from './useCases/midiEvent/setNotePressure';
export { setNoteSlide } from './useCases/midiEvent/setNoteSlide';

// ── Use Cases: MIDI Learn ─────────────────────────────────────────────────────
export {
    startMidiLearn,
    stopMidiLearn,
    completeMidiLearn,
    handleMidiMessage,
    findMappingForTarget,
    scaleMidiValue,
} from './useCases/midiLearn';

// ── Use Cases: MIDI Note CRUD ─────────────────────────────────────────────────
export { addMidiNote } from './useCases/midiNoteCrud/addMidiNote';
export { batchAddMidiNotes } from './useCases/midiNoteCrud/batchAddMidiNotes';
export { getNotesForClip } from './useCases/midiNoteCrud/getNotesForClip';
export { moveMidiNote } from './useCases/midiNoteCrud/moveMidiNote';
export { removeMidiNote } from './useCases/midiNoteCrud/removeMidiNote';
export { resizeMidiNote } from './useCases/midiNoteCrud/resizeMidiNote';
export { setNoteProbability } from './useCases/midiNoteCrud/setNoteProbability';
export { setNoteVelocity } from './useCases/midiNoteCrud/setNoteVelocity';
export { setNotesForClip } from './useCases/midiNoteCrud/setNotesForClip';
export { shiftClipMidiNotes } from './useCases/midiNoteCrud/shiftClipMidiNotes';

// ── Use Cases: MIDI Note Transforms ──────────────────────────────────────────
export { humanizeNotes } from './useCases/midiNoteTransforms/humanizeNotes';
export { invertNotes } from './useCases/midiNoteTransforms/invertNotes';
export { quantizeNoteLengths } from './useCases/midiNoteTransforms/quantizeNoteLengths';
export { quantizeNotes } from './useCases/midiNoteTransforms/quantizeNotes';
export { retrogradeNotes } from './useCases/midiNoteTransforms/retrogradeNotes';
export { scaleAllVelocities } from './useCases/midiNoteTransforms/scaleAllVelocities';
export { scaleVelocities } from './useCases/midiNoteTransforms/scaleVelocities';
export { setAllVelocities } from './useCases/midiNoteTransforms/setAllVelocities';
export { transposeNotes } from './useCases/midiNoteTransforms/transposeNotes';

// ── Use Cases: Routing ────────────────────────────────────────────────────────
export { setMidiOutput, clearMidiOutput } from './useCases/midiRouting';
export { getMidiRoutingHandlers } from './useCases/getMidiRoutingHandlers';

// ── Use Cases: Pattern Instances ──────────────────────────────────────────────
export { getPatternInstanceHandlers } from './useCases/getPatternInstanceHandlers';

// ── Use Cases: Strum ──────────────────────────────────────────────────────────
export { strumNotes, restoreStrumOriginals } from './useCases/strumNotes';
export type { StrumDirection } from './useCases/strumNotes';

// ── Use Cases: Chord Track Transposition ──────────────────────────────────────
export { transposeForChordTrack } from './useCases/transposeForChordTrack';
