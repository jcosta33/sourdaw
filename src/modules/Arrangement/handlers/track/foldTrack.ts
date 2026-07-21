import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { foldTrack } from '../../useCases/toggleTrackState/foldTrack';

export const handleFoldTrack = createHandler<'foldTrack'>({
    execute: (action) => {
        foldTrack(action.payload.trackId, action.payload.folded);
    },
    describe: (alpha) => {
        // Re-folding an already-folded track is a forward no-op, so the inverse
        // restores the captured pre-state instead of negating the payload. The
        // store field is `collapsed`; the action payload calls it `folded`.
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: alpha.payload.folded ? 'Fold track' : 'Unfold track',
            inverseAction: prev ? { type: 'foldTrack', payload: { trackId: prev.id, folded: prev.collapsed } } : null,
        };
    },
    undoable: true,
});
