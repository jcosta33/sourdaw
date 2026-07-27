import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackGain } from '../../useCases/setTrackGainPan/setTrackGain';

export const handleSetTrackGain = createHandler<'setTrackGain'>({
    execute: (action) => {
        setTrackGain(action.payload.trackId, action.payload.gain);
    },
    isNoop: (action) =>
        getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.gain === action.payload.gain,
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: 'Set track gain',
            inverseAction: prev
                ? { type: 'setTrackGain', payload: { trackId: alpha.payload.trackId, gain: prev.gain } }
                : null,
        };
    },
    undoable: true,
});
