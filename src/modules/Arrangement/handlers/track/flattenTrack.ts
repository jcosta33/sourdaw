import { createHandler } from '#/utils/createHandler';

import { flattenTrack } from '../../useCases/freezeBounce/flattenTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleFlattenTrack = createHandler<'flattenTrack'>({
    execute: (action) => {
        const didWrite = flattenTrack(action.payload.trackId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: () => ({ label: 'Flatten track' }),
    undoable: false,
});
