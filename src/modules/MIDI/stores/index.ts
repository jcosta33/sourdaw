// MIDI/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { isValidMidiProbabilitySeed, LEGACY_MIDI_PROBABILITY_SEED, midiStore } from './midiStore';
export type { MidiStoreState } from './midiStore';

export {
    GROOVE_CONSUMER_TYPES,
    canonicalizeGrooveConsumerId,
    defaultGrooveTemplateState,
    grooveTemplateStore,
    isGrooveTemplateAssignment,
    isGrooveTemplateState,
    sanitizeGrooveTemplateState,
} from './grooveTemplateStore';
export type { GrooveConsumerType, GrooveTemplateAssignment, GrooveTemplateState } from './grooveTemplateStore';
export { grooveTemplateProjectRevisionStore } from './grooveTemplateProjectRevisionStore';

export { chordTrackStore, defaultChordTrackState } from './chordTrackStore';
export type { ChordTrackState } from './chordTrackStore';

export { stepRecordStore, defaultStepRecordState } from './stepRecordStore';
export type { StepRecordState } from './stepRecordStore';

export { webMidiStore, defaultWebMidiState } from './webMidiStore';
