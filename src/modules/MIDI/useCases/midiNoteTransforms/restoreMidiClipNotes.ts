import { midiStore } from '../../stores/midiStore';

import {
    getRestoreMidiClipNotesStatus,
    type GetRestoreMidiClipNotesStatusInput,
} from './getRestoreMidiClipNotesStatus';

export function restoreMidiClipNotes({
    clipId,
    notes,
    expectedNotes,
    notesBucketPresent,
    expectedNotesBucketPresent,
    allowMissingExpectedEmpty = false,
    articulationReplayGuard,
    noteTransformReplayGuard,
}: GetRestoreMidiClipNotesStatusInput): 'written' | 'no-write' | 'conflict' {
    const status = getRestoreMidiClipNotesStatus({
        clipId,
        notes,
        expectedNotes,
        notesBucketPresent,
        expectedNotesBucketPresent,
        allowMissingExpectedEmpty,
        articulationReplayGuard,
        noteTransformReplayGuard,
    });
    if (status !== 'written') {
        return status;
    }
    const state = midiStore.value;
    if (!state) {
        return 'conflict';
    }

    const notesByClipId = { ...state.notesByClipId };
    if (notesBucketPresent === false) {
        delete notesByClipId[clipId];
    } else {
        notesByClipId[clipId] = notes.map((note) => ({ ...note }));
    }
    midiStore.set({
        ...state,
        notesByClipId,
    });
    return 'written';
}
