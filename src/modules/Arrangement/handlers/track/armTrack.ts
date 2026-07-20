import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { armTrack } from '../../useCases/recording/armTrack';

export const handleArmTrack = createHandler<'armTrack'>({
    execute: (action) => {
        armTrack(action.payload.trackId, action.payload.armed);
    },
    describe: (alpha) => {
        // Re-arming an already-armed track is a forward no-op, so the inverse
        // restores the captured pre-state instead of negating the payload.
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: alpha.payload.armed ? 'Arm track' : 'Disarm track',
            inverseAction: prev ? { type: 'armTrack', payload: { trackId: prev.id, armed: prev.armed } } : null,
        };
    },
    undoable: true,
});
