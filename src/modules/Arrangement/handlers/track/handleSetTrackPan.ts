import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackPan } from '../../useCases/setTrackGainPan/setTrackPan';

export const handleSetTrackPan = createHandler<'setTrackPan'>({
    execute: (action) => {
        setTrackPan(action.payload.trackId, action.payload.pan);
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.pan === action.payload.pan,
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: 'Set track pan',
            inverseAction: prev
                ? { type: 'setTrackPan', payload: { trackId: alpha.payload.trackId, pan: prev.pan } }
                : null,
        };
    },
    undoable: true,
});
