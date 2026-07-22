import { createHandler } from '#/utils/createHandler';

import { copySelectedClip } from '../../useCases/clipboard/copySelectedClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleCopyClip = createHandler<'copyClip'>({
    execute: () => {
        return toHandlerExecutionResult(copySelectedClip());
    },
    describe: () => ({ label: 'Copy clip' }),
    undoable: false,
});
