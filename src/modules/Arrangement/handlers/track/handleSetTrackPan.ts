import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { createHandler } from '#/utils/createHandler';
import { setTrackPan } from '../../useCases/setTrackGainPan/setTrackPan';

export const handleSetTrackPan = createHandler<'setTrackPan'>({
    execute: (action) => {
        setTrackPan(action.payload.trackId, action.payload.pan);
    },
    describe: (a) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        return {
            label: 'Set track pan',
            inverseAction: prev
                ? { type: 'setTrackPan', payload: { trackId: a.payload.trackId, pan: prev.pan } }
                : null,
        };
    },
    undoable: true,
});
