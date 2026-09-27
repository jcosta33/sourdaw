import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';
import { cloneMidiNoteForAdmission } from '../../transformers/cloneMidiNoteForAdmission';

export function setNotesForClip(clipId: string, notes: MidiNote[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: notes.map(cloneMidiNoteForAdmission),
        },
    });
}
