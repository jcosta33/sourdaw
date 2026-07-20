import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { hideTrack } from '../../useCases/toggleTrackState/hideTrack';

export const handleHideTrack = createHandler<'hideTrack'>({
    execute: (action) => {
        hideTrack(action.payload.trackId, action.payload.hidden);
    },
    describe: (alpha) => {
        // Re-hiding an already-hidden track is a forward no-op, so the inverse
        // restores the captured pre-state instead of negating the payload.
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: alpha.payload.hidden ? 'Hide track' : 'Show track',
            inverseAction: prev ? { type: 'hideTrack', payload: { trackId: prev.id, hidden: prev.hidden } } : null,
        };
    },
    undoable: true,
});
