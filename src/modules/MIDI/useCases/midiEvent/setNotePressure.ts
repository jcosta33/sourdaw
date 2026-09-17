import { clampMidiData7 } from '#/utils/midiData';

import { midiStore } from '../../stores/midiStore';

export function setNotePressure(clipId: string, noteId: string, pressure: number): void {
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
            [clipId]: existing.map((node) =>
                node.id === noteId ? { ...node, pressure: clampMidiData7(pressure) } : node
            ),
        },
    });
}
