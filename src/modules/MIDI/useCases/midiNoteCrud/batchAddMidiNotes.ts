import { midiStore } from '../../stores/midiStore';
import { createMidiNote, type MidiNote } from '../../models/MidiNote';
import { createMidiError } from '../../errors/MidiError';

type NoteInput = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity?: number;
};

/**
 * Insert multiple MIDI notes into a clip in a single store mutation.
 *
 * This avoids the O(N) CRDT flood caused by calling addMidiNote() in a loop,
 * which would trigger one full Automerge serialization and React reconciliation
 * per note. Batch insertion commits exactly once regardless of note count.
 */
export function batchAddMidiNotes(clipId: string, notes: NoteInput[]): MidiNote[] {
    const state = midiStore.value;
    if (!state) {
        throw createMidiError('MIDI store not initialized');
    }

    if (notes.length === 0) {
        return [];
    }

    const existing = state.notesByClipId[clipId] ?? [];

    const createdNotes = notes.map((n) => {
        const safePitch = Math.round(Math.max(0, Math.min(127, n.pitch)));
        const safeVelocity = Math.round(Math.max(1, Math.min(127, n.velocity ?? 100)));
        const safeStart = Math.max(0, n.startBeat);
        const safeDuration = Math.max(0.0625, n.duration);
        return createMidiNote(safePitch, safeStart, safeDuration, safeVelocity);
    });

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, ...createdNotes],
        },
    });

    return createdNotes;
}
