// MIDI/events — public contract surface for domain event types.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export type { MidiOutPayload, MidiNoteOnPayload, MidiNoteOffPayload, MidiPedalCcPayload } from './MidiEvents';
