import { midiStore } from '#/modules/Midi/stores/midiStore';

export function invertNotes(clipId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing || existing.length < 2) {
        return;
    }

    const pitches = existing.map((n) => n.pitch);
    const minPitch = Math.min(...pitches);
    const maxPitch = Math.max(...pitches);
    const axis = minPitch + maxPitch;

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({
                ...n,
                pitch: Math.max(0, Math.min(127, axis - n.pitch)),
            })),
        },
    });
}
