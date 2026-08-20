import { createHandler } from '#/utils/createHandler';

import { pasteClip } from '../../useCases/clipboard/pasteClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handlePasteClip = createHandler<'pasteClip'>({
    execute: () => {
        return toHandlerExecutionResult(pasteClip());
    },
    describe: () => ({ label: 'Paste clip' }),
    undoable: false,
});
