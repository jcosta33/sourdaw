import { createHandler } from '#/utils/createHandler';

import { splitClip } from '../../useCases/clipEditing/splitClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSplitClip = createHandler<'splitClip'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(splitClip(alpha.payload.clipId, alpha.payload.beat) !== null);
    },
    describe: () => ({ label: 'Split clip' }),
    undoable: true,
});
