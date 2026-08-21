import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackInput } from '../../useCases/setTrackInput';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

/**
 * Inverse of `setTrackInput`, guarded against a newer input change. Only ever dispatched
 * as an inverse or redo action (with `skipUndo`) from the undo engine, so it is not
 * itself undoable.
 */
export const handleRestoreTrackInput = createHandler<'restoreTrackInput'>({
    execute: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track || track.inputId !== action.payload.expected) {
            return { status: 'conflict' };
        }
        if (track.inputId === action.payload.replacement) {
            return { status: 'no-write' };
        }
        return toHandlerExecutionResult(setTrackInput(track.id, action.payload.replacement));
    },
    describe: () => ({ label: 'Restore track input', inverseAction: null }),
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.inputId ===
        action.payload.replacement,
    undoable: false,
});
