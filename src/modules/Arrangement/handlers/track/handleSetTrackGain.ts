import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { createHandler } from '#/utils/createHandler';
import { setTrackGain } from '../../useCases/setTrackGainPan/setTrackGain';

export const handleSetTrackGain = createHandler<'setTrackGain'>({
    execute: (action) => {
        setTrackGain(action.payload.trackId, action.payload.gain);
    },
    describe: (a) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        return {
            label: 'Set track gain',
            inverseAction: prev
                ? { type: 'setTrackGain', payload: { trackId: a.payload.trackId, gain: prev.gain } }
                : null,
        };
    },
    undoable: true,
});
