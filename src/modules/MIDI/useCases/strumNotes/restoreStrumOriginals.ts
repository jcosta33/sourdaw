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
            [clipId]: existing.map((node) => {
                const orig = originals.get(node.id);
                if (orig === undefined) {
                    return node;
                }
                return { ...node, startBeat: orig };
            }),
        },
    });
}
