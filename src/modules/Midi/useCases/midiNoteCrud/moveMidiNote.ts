import { midiStore } from '#/modules/Midi/stores/midiStore';

export function moveMidiNote(clipId: string, noteId: string, newPitch: number, newStartBeat: number): void {
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
            [clipId]: existing.map((n) => (n.id === noteId ? { ...n, pitch: newPitch, startBeat: newStartBeat } : n)),
        },
    });
}
