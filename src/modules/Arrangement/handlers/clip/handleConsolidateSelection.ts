import { createHandler } from '#/utils/createHandler';
import { type HandlerCommitValidation } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { bounceSelection } from '../../useCases/freezeBounce/bounceSelection';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleConsolidateSelection = createHandler<'consolidateSelection'>({
    execute: async (alpha, context) => {
        const target = resolveEligibleClipWriteTarget({ trackId: alpha.payload.trackId });
        if (target.status !== 'eligible') {
            return toHandlerExecutionResult(false);
        }

        let publish: (() => void) | undefined;
        let commitValidation: HandlerCommitValidation | undefined;
        const didWrite = await bounceSelection(target.trackId, alpha.payload.startBeat, alpha.payload.endBeat, {
            signal: context?.signal,
            deferUndoEntry: (effect) => {
                publish = effect;
            },
            onCommitValidation: (validation) => {
                commitValidation = validation;
            },
        });
        if (!didWrite || !publish) {
            return toHandlerExecutionResult(didWrite);
        }
        return { status: 'written', commitValidation, afterCommit: publish, afterAmbiguousCommit: publish };
    },
    describe: () => ({ label: 'Consolidate selection' }),
    undoable: false,
});
