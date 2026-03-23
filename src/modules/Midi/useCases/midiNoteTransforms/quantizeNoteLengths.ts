import { midiStore } from '#/modules/Midi/stores/midiStore';

export function quantizeNoteLengths(clipId: string, gridSize: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                duration: Math.max(gridSize, Math.round(n.duration / gridSize) * gridSize),
            })),
        },
    });
}
