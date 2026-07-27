import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackColor } from '../../useCases/setTrackGainPan/setTrackColor';

export const handleSetTrackColor = createHandler<'setTrackColor'>({
    execute: (action) => {
        setTrackColor(action.payload.trackId, action.payload.color);
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: 'Set track color',
            inverseAction: prev
                ? { type: 'setTrackColor', payload: { trackId: alpha.payload.trackId, color: prev.color } }
                : null,
        };
    },
    isNoop: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return !track || track.color === action.payload.color;
    },
    undoable: true,
});
