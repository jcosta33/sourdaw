// Re-export types for cross-module consumption (DTO pattern)
export type { ChordEvent } from '../../models/ChordEvent';
export { formatChordName, ROOT_NAMES } from '../../models/ChordEvent';
export { type ChordType, CHORD_TYPE_KEYS } from '../chordStamps';

// Use cases
export { addChordEvent } from './addChordEvent';
export { removeChordEvent } from './removeChordEvent';
export { moveChordEvent } from './moveChordEvent';
export { updateChordEvent } from './updateChordEvent';
export { clearChordTrack } from './clearChordTrack';
export { toggleChordTrack } from './toggleChordTrack';
export { getChordAtBeat } from './getChordAtBeat';

// Transformers (re-exported for backward compat, consumers should migrate to Midi/transformers/)
export { transposeNoteToChord, transposeForChordTrack } from '#/modules/MIDI/transformers/chordTransposer';
