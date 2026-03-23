import { midiStore } from '#/modules/Midi/stores/midiStore';

export function resizeMidiNote(clipId: string, noteId: string, newStartBeat?: number, newDuration?: number): void {
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
            [clipId]: existing.map((n) => {
                if (n.id !== noteId) {
                    return n;
                }
                return {
                    ...n,
                    startBeat: newStartBeat !== undefined ? newStartBeat : n.startBeat,
                    duration: newDuration !== undefined ? Math.max(0.125, newDuration) : n.duration,
                };
            }),
        },
    });
}
