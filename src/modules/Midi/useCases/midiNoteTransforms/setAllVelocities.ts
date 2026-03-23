import { midiStore } from '#/modules/Midi/stores/midiStore';

export function setAllVelocities(clipId: string, velocity: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length === 0) {
        return;
    }

    const clamped = Math.max(1, Math.min(127, velocity));

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                velocity: clamped,
            })),
        },
    });
}
