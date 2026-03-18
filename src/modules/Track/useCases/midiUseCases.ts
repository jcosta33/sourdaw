/**
 * Barrel re-export — all MIDI use cases split into focused files.
 * Import from the specific file when possible.
 */

// Note CRUD
export {
    addMidiNote,
    removeMidiNote,
    moveMidiNote,
    setNoteVelocity,
    getNotesForClip,
    duplicateNotes,
} from './midiNoteCrud';

// Note transforms
export {
    quantizeNotes,
    quantizeNoteLengths,
    quantizeNotesAndLengths,
    transposeNotes,
    humanizeNotes,
    invertNotes,
    retrogradeNotes,
    scaleVelocities,
    scaleAllVelocities,
    setAllVelocities,
} from './midiNoteTransforms';
export type { VelocityCurve } from './midiNoteTransforms';

// CC, PitchBend, MPE per-note properties
export {
    addMidiCC,
    removeMidiCC,
    moveMidiCC,
    addPitchBend,
    removePitchBend,
    movePitchBend,
    setNotePressure,
    setNoteSlide,
    setNotePitchBend,
} from './midiEventUseCases';
