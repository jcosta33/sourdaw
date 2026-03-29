import { midiStore } from '#/modules/MIDI/stores/midiStore';

export function removeMidiNote(clipId: string, noteId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.filter((n) => n.id !== noteId),
        },
    });
}
