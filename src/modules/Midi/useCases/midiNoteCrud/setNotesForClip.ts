import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { type MidiNote } from '#/modules/MIDI/models/MidiNote';

export function setNotesForClip(clipId: string, notes: MidiNote[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: notes,
        },
    });
}
