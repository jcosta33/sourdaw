import { createHandler } from '#/utils/createHandler';

import { unfreezeTrack } from '../../useCases/freezeBounce/unfreezeTrack';

export const handleUnfreezeTrack = createHandler<'unfreezeTrack'>({
    execute: (action) => {
        unfreezeTrack(action.payload.trackId);
    },
    describe: (action) => ({
        label: 'Unfreeze track',
        inverseAction: {
            type: 'freezeTrack',
            payload: { trackId: action.payload.trackId },
        },
        redoAction: action,
    }),
    undoable: true,
});
