import { type AppAction } from '#/utils/handlerContract';

import { type MidiNote } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

/**
 * Projects the notes buckets produced by earlier guarded restore actions without
 * changing project state. Ordered undo validation uses this to validate each
 * restore against the state its predecessors will leave behind.
 */
export function projectMidiNotesByClipIdThroughRestores(actions: readonly AppAction[]): Record<string, MidiNote[]> {
    const notesByClipId: Record<string, MidiNote[]> = {};
    for (const [clipId, notes] of Object.entries(midiStore.value?.notesByClipId ?? {})) {
        notesByClipId[clipId] = notes.map((note) => ({ ...note }));
    }

    for (const action of actions) {
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
