import { createHandler } from '#/utils/createHandler';

import { bounceInPlace } from '../../useCases/freezeBounce/bounceInPlace';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleBounceInPlace = createHandler<'bounceInPlace'>({
    execute: async (action) => {
        const didWrite = await bounceInPlace(action.payload.trackId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: () => ({ label: 'Bounce in place' }),
    undoable: false,
});
