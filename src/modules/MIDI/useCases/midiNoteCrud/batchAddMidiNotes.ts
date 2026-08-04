import { createMidiError } from '../../errors/MidiError';
import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';
import { normalizeMidiNoteInput } from '../../transformers/normalizeMidiNoteInput';

type NoteInput = {
    id?: string;
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

    const createdNotes = notes.map((node) =>
        normalizeMidiNoteInput({
            ...node,
            id: node.id ?? `note-${crypto.randomUUID()}`,
        })
    );

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: [...existing, ...createdNotes],
        },
    });

    return createdNotes;
}
