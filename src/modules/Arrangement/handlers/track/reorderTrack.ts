import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { reorderTrack } from '../../useCases/toggleTrackState/reorderTrack';

export const handleReorderTrack = createHandler<'reorderTrack'>({
    execute: (action) => {
        const tracks = getTrackStoreState()?.tracks;
        const currentIndex = tracks?.findIndex((track) => track.id === action.payload.trackId) ?? -1;
        const targetIndex = action.payload.newIndex;
        if (
            !tracks ||
            currentIndex < 0 ||
            !Number.isInteger(targetIndex) ||
            targetIndex < 0 ||
            targetIndex >= tracks.length
        ) {
            return { status: 'conflict' };
        }
        reorderTrack(action.payload.trackId, action.payload.newIndex);
        return { status: 'written' };
    },
    describe: (alpha) => {
        // Capture the pre-move index and reject stale provider indices instead of
        // letting the owner clamp them to a different position.
        const tracks = getTrackStoreState()?.tracks;
        const currentIndex = tracks?.findIndex((time) => time.id === alpha.payload.trackId) ?? -1;
        const targetIndexIsValid =
            tracks !== undefined &&
            Number.isInteger(alpha.payload.newIndex) &&
            alpha.payload.newIndex >= 0 &&
            alpha.payload.newIndex < tracks.length;
        return {
            label: 'Reorder track',
            inverseAction:
                currentIndex >= 0 && targetIndexIsValid
                    ? { type: 'reorderTrack', payload: { trackId: alpha.payload.trackId, newIndex: currentIndex } }
                    : null,
        };
    },
    isNoop: (action) => {
        const tracks = getTrackStoreState()?.tracks;
        if (!tracks) {
            return true;
        }
        const currentIndex = tracks.findIndex((track) => track.id === action.payload.trackId);
        if (currentIndex < 0) {
            return false;
        }
        const targetIndex = action.payload.newIndex;
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
            return false;
        }
        return currentIndex === targetIndex;
    },
    undoable: true,
});
