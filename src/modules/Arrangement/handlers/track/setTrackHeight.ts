import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackHeight } from '../../useCases/toggleTrackState/setTrackHeight';

export const handleSetTrackHeight = createHandler<'setTrackHeight'>({
    execute: (action) => {
        setTrackHeight(action.payload.trackId, action.payload.height);
    },
    describe: (alpha) => {
        // The forward setter clamps height to [30, 300], so the inverse restores
        // the captured pre-set height rather than deriving one from the payload.
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: 'Set track height',
            inverseAction: prev ? { type: 'setTrackHeight', payload: { trackId: prev.id, height: prev.height } } : null,
        };
    },
    undoable: true,
});
