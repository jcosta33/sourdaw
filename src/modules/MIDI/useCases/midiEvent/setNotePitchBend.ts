import { midiStore } from '../../stores/midiStore';

export function setNotePitchBend(clipId: string, noteId: string, pitchBend: number): void {
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
                node.id === noteId ? { ...node, pitchBend: Math.max(-8192, Math.min(8191, pitchBend)) } : node
            ),
        },
    });
}
