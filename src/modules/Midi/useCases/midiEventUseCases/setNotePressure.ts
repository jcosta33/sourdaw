import { midiStore } from '#/modules/Midi/stores/midiStore';

export function setNotePressure(clipId: string, noteId: string, pressure: number): void {
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
            [clipId]: existing.map((n) =>
                n.id === noteId ? { ...n, pressure: Math.max(0, Math.min(127, pressure)) } : n
            ),
        },
    });
}
