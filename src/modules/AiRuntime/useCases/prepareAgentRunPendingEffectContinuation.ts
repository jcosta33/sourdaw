import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';
import { createAgentRunPendingEffectContinuation } from './createAgentRunPendingEffectContinuation';
import { recordAgentRunPendingEffectContinuation } from './recordAgentRunPendingEffectContinuation';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type CommandBatch = Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

export function prepareAgentRunPendingEffectContinuation(input: {
    runId: string;
    receipt: VerifiedBatchReceipt;
    commandBatch: CommandBatch;
    getFinalizedRevision?: () => string | undefined;
}): { promote: (result: { receipt: VerifiedBatchReceipt }) => void; discard: () => void } {
    if (input.receipt.pendingEffects.length === 0) {
        return { promote: () => undefined, discard: () => undefined };
    }
    agentRunLifecycle.preparePendingEffectContinuation({
        runId: input.runId,
        continuation: createAgentRunPendingEffectContinuation(input),
    });
    let settled = false;
    return {
        promote: ({ receipt }) => {
            if (settled) {
                return;
            }
            const sourceRevision = input.getFinalizedRevision?.();
            const requiresExactSourceRevision = receipt.pendingEffects.every(
                (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
            );
            if (requiresExactSourceRevision && sourceRevision === undefined) {
                return;
            }
            recordAgentRunPendingEffectContinuation({
                runId: input.runId,
                receipt,
                commandBatch: input.commandBatch,
                sourceRevision,
            });
            settled = true;
        },
        discard: () => {
            if (settled) {
                return;
            }
            agentRunLifecycle.discardPreparedPendingEffectContinuation({
                runId: input.runId,
                batchId: input.receipt.batchId,
            });
            settled = true;
        },
    };
}
