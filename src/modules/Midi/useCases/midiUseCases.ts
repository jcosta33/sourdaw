/**
 * Barrel re-export — all MIDI use cases split into focused files.
 * Import from the specific file when possible.
 */

export type { MidiNote, MidiCC, MidiPitchBend } from '../models/MidiNote';
export { createMidiNote } from '../models/MidiNote';

// Note CRUD
export {
    addMidiNote,
    removeMidiNote,
    moveMidiNote,
    resizeMidiNote,
    setNoteVelocity,
    setNoteProbability,
    getNotesForClip,
} from './midiNoteCrud';

// Note transforms
export {
    quantizeNotes,
    quantizeNoteLengths,
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
} from './midiEventUseCases';
