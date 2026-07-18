// MIDI/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Arpeggiator ───────────────────────────────────────────────────────────────
export { arpeggiate } from './arpeggiator';

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
export { getMidiStoreState } from './getMidiStoreState';
export { mergeImportedMidiClipNotes } from './mergeImportedMidiClipNotes';
export { setMidiStoreState } from './setMidiStoreState';
export { duplicateMidiClipData } from './midiClipData/duplicateMidiClipData';
export { glueMidiClipData } from './midiClipData/glueMidiClipData';
export { removeMidiClipData } from './midiClipData/removeMidiClipData';
export { restoreMidiClipData } from './midiClipData/restoreMidiClipData';

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

// ── MIDI Note CRUD ────────────────────────────────────────────────────────────
export { addMidiNote } from './midiNoteCrud/addMidiNote';
export { appendMidiNotes } from './midiNoteCrud/appendMidiNotes';
export { batchAddMidiNotes } from './midiNoteCrud/batchAddMidiNotes';
export { duplicateClipNotes } from './midiNoteCrud/duplicateClipNotes';
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
export { stepRecordAdvance } from './stepRecording/stepRecordAdvance';
export { stepRecordRetreat } from './stepRecording/stepRecordRetreat';
export { stepRecordStepUp } from './stepRecording/stepRecordStepUp';
export { stepRecordStepDown } from './stepRecording/stepRecordStepDown';
export { setStepRecordBeat } from './stepRecording/setStepRecordBeat';
export { toggleStepRecordingForClip } from './stepRecording/toggleStepRecordingForClip';

export { getMidiNoteTransformHandlers } from './getMidiNoteTransformHandlers';

// ── Pattern Instances ─────────────────────────────────────────────────────────
export { getPatternInstanceHandlers } from './getPatternInstanceHandlers';

export { strumNotes } from './strumNotes/strumNotes';
export { restoreStrumOriginals } from './strumNotes/restoreStrumOriginals';

// ── Chord Track Transposition ─────────────────────────────────────────────────
export { transposeForChordTrack } from './transposeForChordTrack';

// ── WebMIDI Note Input ────────────────────────────────────────────────────────
export { initWebMidi } from './webMidiInput/initWebMidi';
export { setWebMidiRuntimeEventBus } from './webMidiInput/setWebMidiRuntimeEventBus';
export { setMidiInputTrack } from './webMidiInput/setMidiInputTrack';
export { selectMidiInput } from './webMidiInput/selectMidiInput';
export { resetMidiState } from './webMidiInput/resetMidiState';
export { triggerLiveNoteOn } from './triggerLiveNoteOn';
export { triggerLiveNoteOff } from './triggerLiveNoteOff';
export { getWebMidiInputHandlers } from './getWebMidiInputHandlers';

// ── MIDI Effect Plugins ───────────────────────────────────────────────────────
export { MIDI_EFFECT_FACTORIES } from './midiEffectPlugins/registry';
