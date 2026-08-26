import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';
import { createAgentRunPendingEffectContinuation } from './createAgentRunPendingEffectContinuation';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type CommandBatch = Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

/** Admits the exact recovery capability after its owning project checkpoint is proven durable. */
export function recordAgentRunPendingEffectContinuation(input: {
    runId: string;
    receipt: VerifiedBatchReceipt;
    commandBatch: CommandBatch;
    recordedAt?: number;
}): void {
    if (input.receipt.pendingEffects.length === 0) {
        return;
    }
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: input.runId,
        recordedAt: input.recordedAt ?? Date.now(),
        continuation: createAgentRunPendingEffectContinuation(input),
    });
}
