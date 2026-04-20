import { midiStore } from '../../stores/midiStore';

/**
 * Restore original start beats (undo helper).
 */
export function restoreStrumOriginals(clipId: string, originals: Map<string, number>): void {
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
                const orig = originals.get(n.id);
                if (orig === undefined) {
                    return n;
                }
                return { ...n, startBeat: orig };
            }),
        },
    });
}
