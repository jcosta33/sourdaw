import { createHandler } from '#/utils/createHandler';

import { normalizeClip } from '../../useCases/clipEditing/normalizeClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleNormalizeClip = createHandler<'normalizeClip'>({
    execute: (alpha) => {
        const didWrite = normalizeClip(alpha.payload.clipId, alpha.payload.mode, alpha.payload.targetDb);
        return toHandlerExecutionResult(didWrite);
    },
    describe: (alpha) => ({ label: `Normalize clip (${alpha.payload.mode ?? 'peak'})` }),
    undoable: true,
});
