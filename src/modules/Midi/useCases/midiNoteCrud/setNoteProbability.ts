import { midiStore } from '#/modules/Midi/stores/midiStore';

export function setNoteProbability(clipId: string, noteId: string, probability: number): void {
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
                n.id === noteId ? { ...n, probability: Math.max(0, Math.min(100, probability)) } : n
            ),
        },
    });
}
