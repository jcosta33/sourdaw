import { createMidiNote } from '../models/MidiNote';

import { midiStore } from './midiStore';

export function duplicateClipNotes(sourceClipId: string, destClipId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }
    const sourceNotes = state.notesByClipId[sourceClipId] ?? [];
    if (sourceNotes.length === 0) {
        return;
    }

    const clonedNotes = sourceNotes.map((note) => {
        const safePitch = Math.round(Math.max(0, Math.min(127, note.pitch)));
        const safeVelocity = Math.round(Math.max(1, Math.min(127, note.velocity ?? 100)));
        const safeDuration = Math.max(0.0625, note.duration);
        return createMidiNote(safePitch, note.startBeat, safeDuration, safeVelocity);
    });

    const existing = state.notesByClipId[destClipId] ?? [];

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [destClipId]: [...existing, ...clonedNotes],
        },
    });
}
