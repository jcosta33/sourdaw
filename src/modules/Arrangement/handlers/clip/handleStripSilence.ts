import { createHandler } from '#/utils/createHandler';

import { stripSilence } from '../../useCases/stripSilence';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleStripSilence = createHandler<'stripSilence'>({
    execute: (alpha) => {
        const didWrite = stripSilence(alpha.payload.clipId, alpha.payload.threshold, alpha.payload.minDuration);
        return toHandlerExecutionResult(didWrite);
    },
    describe: () => ({ label: 'Strip silence' }),
    undoable: false,
});
