import { createHandler } from '#/utils/createHandler';

import { fitClipToBeats } from '../../useCases/clipStretch/fitClipToBeats';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleFitClipToBeats = createHandler<'fitClipToBeats'>({
    execute: (action) => {
        return toHandlerExecutionResult(fitClipToBeats(action.payload.clipId, action.payload.targetBeats));
    },
    describe: (alpha) => ({ label: `Fit clip to ${alpha.payload.targetBeats} beats` }),
    undoable: true,
});
