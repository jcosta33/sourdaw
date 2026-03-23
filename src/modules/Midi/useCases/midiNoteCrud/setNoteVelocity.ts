import { midiStore } from '#/modules/Midi/stores/midiStore';

export function setNoteVelocity(clipId: string, noteId: string, velocity: number): void {
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
                n.id === noteId ? { ...n, velocity: Math.max(0, Math.min(127, velocity)) } : n
            ),
        },
    });
}
