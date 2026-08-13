import { midiStore } from '../../stores/midiStore';

import {
    getRestoreMidiClipNotesStatus,
    type GetRestoreMidiClipNotesStatusInput,
} from './getRestoreMidiClipNotesStatus';

export function restoreMidiClipNotes({
    clipId,
    notes,
    expectedNotes,
    allowMissingExpectedEmpty = false,
    articulationReplayGuard,
    noteTransformReplayGuard,
}: GetRestoreMidiClipNotesStatusInput): 'written' | 'no-write' | 'conflict' {
    const status = getRestoreMidiClipNotesStatus({
        clipId,
        notes,
        expectedNotes,
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

    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: notes.map((note) => ({ ...note })),
        },
    });
    return 'written';
}
