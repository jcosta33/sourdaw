import { createHandler } from '#/utils/createHandler';

import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleReverseClip = createHandler<'reverseClip'>({
    execute: (alpha) => {
        const didWrite = reverseClip(alpha.payload.clipId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: (alpha) => ({
        label: 'Reverse clip',
        inverseAction: {
            type: 'reverseClip',
            payload: { clipId: alpha.payload.clipId },
        },
        redoAction: alpha,
    }),
    undoable: true,
});
