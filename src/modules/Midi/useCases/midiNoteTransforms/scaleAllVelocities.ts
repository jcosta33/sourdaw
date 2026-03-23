import { midiStore } from '#/modules/Midi/stores/midiStore';

export function scaleAllVelocities(clipId: string, factor: number): void {
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
                velocity: Math.max(1, Math.min(127, Math.round(n.velocity * factor))),
            })),
        },
    });
}
