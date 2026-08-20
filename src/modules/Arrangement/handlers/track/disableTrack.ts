import { createHandler } from '#/utils/createHandler';

import { disableTrack } from '../../useCases/toggleTrackState/disableTrack';

export const handleDisableTrack = createHandler<'disableTrack'>({
    execute: (action) => {
        disableTrack(action.payload.trackId, action.payload.disabled);
    },
    describe: (alpha) => ({
        label: alpha.payload.disabled ? 'Disable track' : 'Enable track',
        inverseAction: {
            type: 'disableTrack',
            payload: {
                trackId: alpha.payload.trackId,
                disabled: !alpha.payload.disabled,
            },
        },
        redoAction: alpha,
    }),
    undoable: true,
});
