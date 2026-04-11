// MIDI/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { midiLearnStore } from './midiLearnStore';
export type { MidiMappingTargetType, MidiMapping, LearningTarget, MidiLearnState } from './midiLearnStore';

export { midiStore } from './midiStore';
export type { MidiStoreState } from './midiStore';
