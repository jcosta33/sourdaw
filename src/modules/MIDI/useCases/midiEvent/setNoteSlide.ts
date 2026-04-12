import { midiStore } from '../../stores/midiStore';

export function setNoteSlide(clipId: string, noteId: string, slide: number): void {
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
            [clipId]: existing.map((n) => (n.id === noteId ? { ...n, slide: Math.max(0, Math.min(127, slide)) } : n)),
        },
    });
}
