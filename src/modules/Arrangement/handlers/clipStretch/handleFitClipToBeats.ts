import { createHandler } from '#/utils/createHandler';

import { fitClipToBeats } from '../../useCases/clipStretch/fitClipToBeats';

export const handleFitClipToBeats = createHandler<'fitClipToBeats'>({
    execute: (action) => {
        fitClipToBeats(action.payload.clipId, action.payload.targetBeats);
    },
    describe: (alpha) => ({ label: `Fit clip to ${alpha.payload.targetBeats} beats` }),
    undoable: true,
});
