import { midiStore } from '#/modules/MIDI/stores/midiStore';

/**
 * Restore notes to their original positions (undo groove application).
 */
export function restoreGrooveOriginals(
    clipId: string,
    originals: Map<string, { startBeat: number; velocity: number }>
): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const notes = state.notesByClipId[clipId];
    if (!notes) {
        return;
    }

    const restored = notes.map((note) => {
        const orig = originals.get(note.id);
        if (orig) {
            return { ...note, startBeat: orig.startBeat, velocity: orig.velocity };
        }
        return note;
    });

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: restored,
        },
    });
}