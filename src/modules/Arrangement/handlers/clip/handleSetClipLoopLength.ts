import { createHandler } from '#/utils/createHandler';

import { setClipLoopLength } from '../../useCases/clipLoop/setClipLoopLength';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipLoopLength = createHandler<'setClipLoopLength'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(setClipLoopLength(alpha.payload.clipId, alpha.payload.loopLength));
    },
    describe: () => ({ label: 'Set clip loop length' }),
    undoable: true,
});
