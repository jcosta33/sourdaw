// MIDI/events — public contract surface for domain event types.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export type { MidiOutPayload, MidiNoteOnPayload, MidiNoteOffPayload, MidiPedalCcPayload } from './MidiEvents';
export type {
    EditMidiNotesPayload,
    GrooveTemplateActionSnapshot,
    MidiNoteEditOperation,
    MidiNoteEditScope,
} from './midiAppActions';
export type { MidiCcSnapshot, MidiNotesSnapshot, MidiPitchBendSnapshot } from './midiAppActions';
export type {
    MidiClipCcSnapshot,
    MidiClipDataActionSnapshot,
    MidiClipNoteSnapshot,
    MidiClipPitchBendSnapshot,
    MidiTakeSourceSnapshot,
} from './midiClipDataSnapshots';
