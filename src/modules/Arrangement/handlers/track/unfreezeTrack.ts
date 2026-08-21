import { createHandler } from '#/utils/createHandler';

import { captureFreezeStateSnapshot, UNFROZEN_SNAPSHOT } from '../../useCases/freezeBounce/freezeStateSnapshot';
import { unfreezeTrack } from '../../useCases/freezeBounce/unfreezeTrack';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleUnfreezeTrack = createHandler<'unfreezeTrack'>({
    execute: (action) => {
        unfreezeTrack(action.payload.trackId);
    },
    describe: (action) => {
        // Re-freezing is not the inverse: it re-renders the current source and mints a
        // new take, so the undone state is a different buffer with different metadata,
        // and the take the user actually had is gone. Capture the whole aggregate and
        // put it back verbatim.
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track) {
            return { label: 'Unfreeze track', inverseAction: null };
        }
        const previous = captureFreezeStateSnapshot(track);
        return {
            label: 'Unfreeze track',
            inverseAction: {
                type: 'restoreFreezeState',
                payload: { trackId: track.id, expected: UNFROZEN_SNAPSHOT, replacement: previous },
            },
            redoAction: {
                type: 'restoreFreezeState',
                payload: { trackId: track.id, expected: previous, replacement: UNFROZEN_SNAPSHOT },
            },
        };
    },
    // The use case returns early on an already-unfrozen track, so without this the
    // command layer recorded an undo entry for a write that never happened — and undoing
    // it would have frozen a track the action never unfroze.
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.freezeState.status ===
        'unfrozen',
    undoable: true,
});
