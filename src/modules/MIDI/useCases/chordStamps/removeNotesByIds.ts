import { midiStore } from '../../stores/midiStore';

/**
 * Remove multiple notes by IDs (for undo support).
 */
export function removeNotesByIds(clipId: string, noteIds: string[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.notesByClipId[clipId];
    if (!existing) {
        return;
    }

    const idSet = new Set(noteIds);
    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.filter((node) => !idSet.has(node.id)),
        },
    });
}
