import { type AppAction, type MidiNotesSnapshot } from '#/utils/handlerContract';

import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';
import { isMaterializedAddNotesArguments } from '../../transformers/isMaterializedAddNotesArguments';

/**
 * The removal snapshot carries the store's full note objects under the narrow
 * `MidiNotesSnapshot` declaration — the same contract-versus-runtime gap
 * `handleRestoreTrack` bridges when it replays the bucket through
 * `restoreMidiClipData`, which validates every row and would refuse a
 * note-less stub. Cloning keeps every field, which the guard's serialization
 * compares.
 */
function cloneSnapshotNotes(notes: MidiNotesSnapshot): MidiNote[] {
    const notesWithAllFields = notes as readonly MidiNote[];
    return notesWithAllFields.map((note) => ({ ...note }));
}

/**
 * Projects the notes buckets produced by earlier note writes without changing
 * project state. Ordered inverse validation uses this to validate each restore
 * against the state its predecessors will leave behind.
 */
export function projectMidiNotesByClipIdThroughRestores(actions: readonly AppAction[]): Record<string, MidiNote[]> {
    const notesByClipId: Record<string, MidiNote[]> = {};
    for (const [clipId, notes] of Object.entries(midiStore.value?.notesByClipId ?? {})) {
        notesByClipId[clipId] = notes.map((note) => ({ ...note }));
    }

    for (const action of actions) {
        if (action.type === 'addNotes') {
            if (!isMaterializedAddNotesArguments(action.payload)) {
                continue;
            }
            notesByClipId[action.payload.clipId] = [
                ...(notesByClipId[action.payload.clipId] ?? []),
                ...action.payload.notes.map((note) => ({ ...note })),
            ];
            continue;
        }
        if (action.type === 'restoreTrack') {
            // `restoreMidiClipData` replaces each bucket it replays, so the
            // snapshot's buckets become the projected state for their clip ids.
            for (const [clipId, notes] of Object.entries(action.payload.midiNotesByClipId)) {
                notesByClipId[clipId] = cloneSnapshotNotes(notes);
            }
            continue;
        }
        if (action.type !== 'restoreMidiClipNotes') {
            continue;
        }
        if (action.payload.notesBucketPresent === false) {
            delete notesByClipId[action.payload.clipId];
            continue;
        }
        notesByClipId[action.payload.clipId] = action.payload.notes.map((note) => ({ ...note }));
    }

    return notesByClipId;
}
