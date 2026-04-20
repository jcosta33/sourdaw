import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

/**
 * Read-modify-write helper for a single clip's note array.
 *
 * Handles the boilerplate of reading the MIDI store, looking up the clip,
 * applying a mutation, and writing the result back.
 *
 * Returns `undefined` when the store or the clip has no notes.
 */
export function updateNotesForClip(clipId: string, updater: (notes: MidiNote[]) => MidiNote[]): void {
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
        notesByClipId: { ...state.notesByClipId, [clipId]: updater(existing) },
    });
}
