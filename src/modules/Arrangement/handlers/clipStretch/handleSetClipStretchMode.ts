import { createHandler } from '#/utils/createHandler';

import { setClipStretchMode } from '../../useCases/clipStretch/setClipStretchMode';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipStretchMode = createHandler<'setClipStretchMode'>({
    execute: (action) => {
        return toHandlerExecutionResult(setClipStretchMode(action.payload.clipId, action.payload.mode));
    },
    describe: (alpha) => ({ label: `Set clip stretch mode to ${alpha.payload.mode}` }),
    undoable: true,
});
