import { createMidiNote } from '../models/MidiNote';

import { midiStore } from './midiStore';

/**
 * Clone all MIDI notes from `sourceClipId` into `destClipId`, shifting each
 * note by `beatDelta`. Lives on the stores side (not `useCases/`) so callers
 * from other modules (Arrangement's clip duplication) can write clone notes
 * without importing MIDI's broader use-case surface, which transitively pulls
 * MIDI learn into Arrangement's static graph.
 */
export function duplicateClipNotes(sourceClipId: string, destClipId: string, beatDelta: number): void {
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
        const safeStart = Math.max(0, note.startBeat + beatDelta);
        const safeDuration = Math.max(0.0625, note.duration);
        return createMidiNote(safePitch, safeStart, safeDuration, safeVelocity);
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
