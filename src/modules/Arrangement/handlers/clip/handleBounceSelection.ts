import { createHandler } from '#/utils/createHandler';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleBounceSelection = createHandler<'bounceSelection'>({
    execute: async (alpha) => {
        const target = resolveEligibleClipWriteTarget({ trackId: alpha.payload.trackId });
        if (target.status !== 'eligible') {
            return toHandlerExecutionResult(false);
        }

        const didWrite = await bounceSelection(target.trackId, alpha.payload.startBeat, alpha.payload.endBeat);
        return toHandlerExecutionResult(didWrite);
    },
    describe: () => ({ label: 'Bounce selection to audio' }),
    undoable: false,
});
