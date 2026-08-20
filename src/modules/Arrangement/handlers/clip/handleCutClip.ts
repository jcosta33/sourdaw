import { createHandler } from '#/utils/createHandler';

import { cutSelectedClip } from '../../useCases/clipboard/cutSelectedClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleCutClip = createHandler<'cutClip'>({
    execute: () => {
        return toHandlerExecutionResult(cutSelectedClip());
    },
    describe: () => ({ label: 'Cut clip' }),
    undoable: false,
});
