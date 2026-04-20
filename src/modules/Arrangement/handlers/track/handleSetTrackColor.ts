import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackColor } from '../../useCases/setTrackGainPan/setTrackColor';

export const handleSetTrackColor = createHandler<'setTrackColor'>({
    execute: (action) => {
        setTrackColor(action.payload.trackId, action.payload.color);
    },
    describe: (a) => {
        const prev = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.trackId);
        return {
            label: 'Set track color',
            inverseAction: prev
                ? { type: 'setTrackColor', payload: { trackId: a.payload.trackId, color: prev.color } }
                : null,
        };
    },
    undoable: true,
});
