import { createHandler } from '#/utils/createHandler';

import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleReverseClip = createHandler<'reverseClip'>({
    execute: (alpha) => {
        const didWrite = reverseClip(alpha.payload.clipId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: () => ({ label: 'Reverse clip' }),
    undoable: true,
});
