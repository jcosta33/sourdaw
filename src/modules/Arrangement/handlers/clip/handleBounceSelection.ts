import { createHandler } from '#/utils/createHandler';

import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleBounceSelection = createHandler<'bounceSelection'>({
    execute: async (alpha) => {
        const didWrite = await bounceSelection(alpha.payload.trackId, alpha.payload.startBeat, alpha.payload.endBeat);
        return toHandlerExecutionResult(didWrite);
    },
    describe: () => ({ label: 'Bounce selection to audio' }),
    undoable: true,
});
