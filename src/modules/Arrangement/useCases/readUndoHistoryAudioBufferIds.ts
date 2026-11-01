import { undoHistoryStore } from '#/modules/Command/stores';

import { readUndoEntriesAudioBufferIds } from './readUndoEntriesAudioBufferIds';

/**
 * Every audio buffer id an undo or redo could bring back into the arrangement:
 * the ids of every entry on both stacks (`readUndoEntriesAudioBufferIds`). An
 * entry that leaves the history (cleared on a project change, dropped from
 * `future` by a new edit) stops contributing.
 *
 * The branching undo tree is not read: switching to a branch off the current
 * past/future path records a selection only and replays nothing
 * (`switchBranch`), so its entries cannot restore a clip.
 */
export function readUndoHistoryAudioBufferIds(): ReadonlySet<string> {
    const state = undoHistoryStore.value;
    if (!state) {
        return new Set();
    }
    return readUndoEntriesAudioBufferIds([...state.past, ...state.future]);
}
