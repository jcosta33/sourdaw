import { type MidiNote } from '../models/MidiNote';
import { midiStore } from '../stores/midiStore';
import { cloneMidiNoteForAdmission } from '../transformers/cloneMidiNoteForAdmission';

type AppendRecordedMidiNoteInput = {
    clipId: string;
    note: MidiNote;
};

export function appendRecordedMidiNote({ clipId, note }: AppendRecordedMidiNoteInput): void {
    const midiState = midiStore.value;
    if (!midiState) {
        return;
    }

    const existing = midiState.notesByClipId[clipId] ?? [];
    midiStore.set({
        ...midiState,
        notesByClipId: {
            ...midiState.notesByClipId,
            [clipId]: [...existing, cloneMidiNoteForAdmission(note)],
        },
    });
}
