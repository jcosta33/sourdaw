import { createHandler } from '#/utils/createHandler';

import { freezeTrack } from '../../useCases/freezeBounce/freezeTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleFreezeTrack = createHandler<'freezeTrack'>({
    execute: async (action) => {
        const didWrite = await freezeTrack(action.payload.trackId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: (action) => ({
        label: 'Freeze track',
        inverseAction: {
            type: 'unfreezeTrack',
            payload: { trackId: action.payload.trackId },
        },
        redoAction: action,
    }),
    undoable: true,
});
