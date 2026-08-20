import { createHandler } from '#/utils/createHandler';

import { bounceToNewTrack } from '../../useCases/freezeBounce/bounceToNewTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleBounceToNewTrack = createHandler<'bounceToNewTrack'>({
    execute: async (action) => {
        const didWrite = await bounceToNewTrack(action.payload.trackId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: () => ({ label: 'Bounce to new track' }),
    undoable: false,
});
