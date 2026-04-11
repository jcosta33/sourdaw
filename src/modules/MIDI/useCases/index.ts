// MIDI/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Arpeggiator ───────────────────────────────────────────────────────────────
export { arpeggiate } from './arpeggiator';
export type { ArpPattern, ArpRate } from './arpeggiator';

// ── Chord Stamps ──────────────────────────────────────────────────────────────
export { stampChord, removeNotesByIds, CHORD_TYPES, CHORD_TYPE_KEYS } from './chordStamps';
export type { ChordType } from './chordStamps';

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

// ── Groove Extraction ─────────────────────────────────────────────────────────
export { extractGrooveFromClip, applyGrooveToClip, restoreGrooveOriginals } from './grooveExtraction';
export type { GrooveTemplate } from './grooveExtraction';

// ── MIDI Events ───────────────────────────────────────────────────────────────
export { addMidiCC } from './midiEvent/addMidiCC';
export { addPitchBend } from './midiEvent/addPitchBend';
export { moveMidiCC } from './midiEvent/moveMidiCC';
export { movePitchBend } from './midiEvent/movePitchBend';
export { removeMidiCC } from './midiEvent/removeMidiCC';
export { removePitchBend } from './midiEvent/removePitchBend';
export { setNotePressure } from './midiEvent/setNotePressure';
export { setNoteSlide } from './midiEvent/setNoteSlide';

// ── MIDI Learn ────────────────────────────────────────────────────────────────
export {
    startMidiLearn,
    stopMidiLearn,
    completeMidiLearn,
    handleMidiMessage,
    findMappingForTarget,
    scaleMidiValue,
} from './midiLearn';

// ── MIDI Note CRUD ────────────────────────────────────────────────────────────
export { addMidiNote } from './midiNoteCrud/addMidiNote';
export { batchAddMidiNotes } from './midiNoteCrud/batchAddMidiNotes';
export { getNotesForClip } from './midiNoteCrud/getNotesForClip';
export { moveMidiNote } from './midiNoteCrud/moveMidiNote';
export { removeMidiNote } from './midiNoteCrud/removeMidiNote';
export { resizeMidiNote } from './midiNoteCrud/resizeMidiNote';
export { setNoteProbability } from './midiNoteCrud/setNoteProbability';
export { setNoteVelocity } from './midiNoteCrud/setNoteVelocity';
export { setNotesForClip } from './midiNoteCrud/setNotesForClip';
export { shiftClipMidiNotes } from './midiNoteCrud/shiftClipMidiNotes';

// ── MIDI Note Transforms ──────────────────────────────────────────────────────
export { humanizeNotes } from './midiNoteTransforms/humanizeNotes';
export { invertNotes } from './midiNoteTransforms/invertNotes';
export { quantizeNoteLengths } from './midiNoteTransforms/quantizeNoteLengths';
export { quantizeNotes } from './midiNoteTransforms/quantizeNotes';
export { retrogradeNotes } from './midiNoteTransforms/retrogradeNotes';
export { scaleAllVelocities } from './midiNoteTransforms/scaleAllVelocities';
export { scaleVelocities } from './midiNoteTransforms/scaleVelocities';
export { setAllVelocities } from './midiNoteTransforms/setAllVelocities';
export { transposeNotes } from './midiNoteTransforms/transposeNotes';

// ── Routing ───────────────────────────────────────────────────────────────────
export { setMidiOutput, clearMidiOutput } from './midiRouting';
export { getMidiRoutingHandlers } from './getMidiRoutingHandlers';

// ── Pattern Instances ─────────────────────────────────────────────────────────
export { getPatternInstanceHandlers } from './getPatternInstanceHandlers';

// ── Strum ─────────────────────────────────────────────────────────────────────
export { strumNotes, restoreStrumOriginals } from './strumNotes';
export type { StrumDirection } from './strumNotes';

// ── Chord Track Transposition ─────────────────────────────────────────────────
export { transposeForChordTrack } from './transposeForChordTrack';
