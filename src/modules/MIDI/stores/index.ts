// MIDI/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { midiStore } from './midiStore';
export type { MidiStoreState } from './midiStore';

export { chordTrackStore, defaultChordTrackState } from './chordTrackStore';
export type { ChordTrackState } from './chordTrackStore';

export { stepRecordStore, defaultStepRecordState } from './stepRecordStore';
export type { StepRecordState } from './stepRecordStore';
