// MIDI/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Arpeggiator ───────────────────────────────────────────────────────────────
export { arpeggiate } from './arpeggiator';
export type { ArpPattern, ArpRate } from './arpeggiator';

export { stampChord } from './chordStamps/stampChord';
export { removeNotesByIds } from './chordStamps/removeNotesByIds';
export { CHORD_TYPE_KEYS } from './chordStamps/CHORD_TYPE_KEYS';

// ── Chord Track ───────────────────────────────────────────────────────────────
export { addChordEvent } from './chordTrack/addChordEvent';
export { clearChordTrack } from './chordTrack/clearChordTrack';
export { getChordAtBeat } from './chordTrack/getChordAtBeat';
export { moveChordEvent } from './chordTrack/moveChordEvent';
export { removeChordEvent } from './chordTrack/removeChordEvent';
export { toggleChordTrack } from './chordTrack/toggleChordTrack';
export { updateChordEvent } from './chordTrack/updateChordEvent';

export { getChordTrackHandlers } from './getChordTrackHandlers';

// ── Note Creation ─────────────────────────────────────────────────────────────
export { appendRecordedMidiNote } from './appendRecordedMidiNote';
export { createMidiNote } from './createMidiNote';

// ── File I/O ──────────────────────────────────────────────────────────────────
export { downloadMidiFile } from './exportMidiFile';
export { readMidiFile } from './importMidiFile';

// ── Formatting ────────────────────────────────────────────────────────────────
export { formatChordName } from './formatChordName';

// ── State Accessors ───────────────────────────────────────────────────────────
export { getMidiLearnState } from './getMidiLearnState';
export { getMidiStoreState } from './getMidiStoreState';
export { setMidiStoreState } from './setMidiStoreState';

export { extractGrooveFromClip } from './grooveExtraction/extractGrooveFromClip';
export { applyGrooveToClip } from './grooveExtraction/applyGrooveToClip';
export { restoreGrooveOriginals } from './grooveExtraction/restoreGrooveOriginals';

// ── MIDI Events ───────────────────────────────────────────────────────────────
export { addMidiCC } from './midiEvent/addMidiCC';
export { addPitchBend } from './midiEvent/addPitchBend';
export { moveMidiCC } from './midiEvent/moveMidiCC';
export { movePitchBend } from './midiEvent/movePitchBend';
export { removeMidiCC } from './midiEvent/removeMidiCC';
export { removePitchBend } from './midiEvent/removePitchBend';
export { setNotePressure } from './midiEvent/setNotePressure';
export { setNoteSlide } from './midiEvent/setNoteSlide';
export { setNotePitchBend } from './midiEvent/setNotePitchBend';

export { startMidiLearn } from './midiLearn/startMidiLearn';
export { stopMidiLearn } from './midiLearn/stopMidiLearn';
export { completeMidiLearn } from './midiLearn/completeMidiLearn';
export { clearAllMappings } from './midiLearn/clearAllMappings';
export { handleMidiMessage } from './midiLearn/handleMidiMessage';
export { findMappingForTarget } from './midiLearn/findMappingForTarget';

// ── MIDI Note CRUD ────────────────────────────────────────────────────────────
export { addMidiNote } from './midiNoteCrud/addMidiNote';
export { batchAddMidiNotes } from './midiNoteCrud/batchAddMidiNotes';
export { getNotesForClip } from './midiNoteCrud/getNotesForClip';
export { migrateAbsoluteMidiNotes } from './midiNoteCrud/migrateAbsoluteMidiNotes';
export { moveMidiNote } from './midiNoteCrud/moveMidiNote';
export { removeMidiNote } from './midiNoteCrud/removeMidiNote';
export { resizeMidiNote } from './midiNoteCrud/resizeMidiNote';
export { setNoteProbability } from './midiNoteCrud/setNoteProbability';
export { setNoteVelocity } from './midiNoteCrud/setNoteVelocity';
export { setNoteVelocities } from './midiNoteCrud/setNoteVelocities';
export { setNotesForClip } from './midiNoteCrud/setNotesForClip';
export { shiftClipMidiNotes } from './midiNoteCrud/shiftClipMidiNotes';
export { shiftMidiNotesAfterBeat } from './midiNoteCrud/shiftMidiNotesAfterBeat';
export { splitMidiNotesAtBeat } from './midiNoteCrud/splitMidiNotesAtBeat';

// ── MIDI Note Transforms ──────────────────────────────────────────────────────
export { humanizeNotes } from './midiNoteTransforms/humanizeNotes';
export { invertNotes } from './midiNoteTransforms/invertNotes';
export { joinNotes } from './midiNoteTransforms/joinNotes';
export { legatoNotes } from './midiNoteTransforms/legatoNotes';
export { quantizeNoteLengths } from './midiNoteTransforms/quantizeNoteLengths';
export { quantizeNotes } from './midiNoteTransforms/quantizeNotes';
export { retrogradeNotes } from './midiNoteTransforms/retrogradeNotes';
export { scaleAllVelocities } from './midiNoteTransforms/scaleAllVelocities';
export { scaleVelocities } from './midiNoteTransforms/scaleVelocities';
export { setAllVelocities } from './midiNoteTransforms/setAllVelocities';
export { splitNoteAtBeat } from './midiNoteTransforms/splitNoteAtBeat';
export { transposeNotes } from './midiNoteTransforms/transposeNotes';
export { snapClipToScale } from './snapClipToScale';

// ── Step Recording ────────────────────────────────────────────────────────────
export { toggleStepRecording } from './stepRecording/toggleStepRecording';
export { stepRecordNoteOn } from './stepRecording/stepRecordNoteOn';
export { stepRecordNoteOff } from './stepRecording/stepRecordNoteOff';
export {
    stepRecordAdvance,
    stepRecordRetreat,
    stepRecordStepUp,
    stepRecordStepDown,
} from './stepRecording/stepRecordNavigation';

export { getMidiNoteTransformHandlers } from './getMidiNoteTransformHandlers';
export { getMidiLearnHandlers } from './getMidiLearnHandlers';
export { setMidiLearnDependencies } from './midiLearn/midiLearnDependencies';
export type { MidiLearnDependencies } from './midiLearn/midiLearnDependencies';

// ── Pattern Instances ─────────────────────────────────────────────────────────
export { getPatternInstanceHandlers } from './getPatternInstanceHandlers';

export { strumNotes } from './strumNotes/strumNotes';
export { restoreStrumOriginals } from './strumNotes/restoreStrumOriginals';

// ── Hardware ─────────────────────────────────────────────────────────────────
export { exportHardwareMappings, importHardwareMappings } from './hardware/portableMappings';

// ── Chord Track Transposition ─────────────────────────────────────────────────
export { transposeForChordTrack } from './transposeForChordTrack';
