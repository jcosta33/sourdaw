import { midiStore } from '#/modules/Midi/stores/midiStore';

export function quantizeNotes(clipId: string, gridSize: number): void {
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
            [clipId]: existing.map((n) => ({
                ...n,
                startBeat: Math.round(n.startBeat / gridSize) * gridSize,
            })),
        },
    });
}
