import { createHandler } from '#/utils/createHandler';

import { freezeStateSnapshotMatches } from '../../useCases/freezeBounce/freezeStateSnapshotMatches';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { updateTrack } from '../../useCases/updateTrack';

/**
 * Inverse and redo of `freezeTrack` and `unfreezeTrack`, guarded on the take the forward
 * action left behind. Restores the whole freeze aggregate rather than re-running either
 * operation: re-freezing would re-render and mint a different take, and a bare unfreeze
 * would collapse a `stale` or `error` state the freeze found. Failed Freeze also
 * settles its diagnostic through this action independently of its aborted render
 * transaction. Neither a replay nor a failed render creates another undo entry.
 */
export const handleRestoreFreezeState = createHandler<'restoreFreezeState'>({
    execute: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track || !freezeStateSnapshotMatches(track, action.payload.expected)) {
            return { status: 'conflict' };
        }
        if (freezeStateSnapshotMatches(track, action.payload.replacement)) {
            return { status: 'no-write' };
        }
        const replacement = action.payload.replacement;
        updateTrack(track.id, (candidate) => ({
            ...candidate,
            frozen: replacement.frozen,
            frozenBufferId: replacement.frozenBufferId,
            freezeState: {
                ...replacement.freezeState,
                ...(replacement.freezeState.renderSettings === undefined
                    ? {}
                    : { renderSettings: { ...replacement.freezeState.renderSettings } }),
            },
        }));
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore freeze state', inverseAction: null }),
    isNoop: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return track !== undefined && freezeStateSnapshotMatches(track, action.payload.replacement);
    },
    undoable: false,
});
