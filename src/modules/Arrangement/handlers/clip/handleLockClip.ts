import { createHandler } from '#/utils/createHandler';

import { lockClip } from '../../useCases/clipEditing/lockClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleLockClip = createHandler<'lockClip'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(lockClip(alpha.payload.clipId, alpha.payload.locked));
    },
    describe: (alpha) => ({ label: alpha.payload.locked ? 'Lock clip' : 'Unlock clip' }),
    undoable: true,
});
