import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { disableTrack } from '../../useCases/toggleTrackState/disableTrack';

/**
 * Inverse of `disableTrack`, guarded against a newer edit. Only ever dispatched as an
 * inverse or redo action (with `skipUndo`) from the undo engine, so it is not itself
 * undoable.
 */
export const handleRestoreTrackDisabled = createHandler<'restoreTrackDisabled'>({
    execute: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track || track.disabled !== action.payload.expected) {
            return { status: 'conflict' };
        }
        if (track.disabled === action.payload.replacement) {
            return { status: 'no-write' };
        }
        disableTrack(track.id, action.payload.replacement);
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore track disabled state', inverseAction: null }),
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.disabled ===
        action.payload.replacement,
    undoable: false,
});
