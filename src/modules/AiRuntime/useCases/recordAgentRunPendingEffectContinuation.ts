import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { getPendingEffectRecoveryPolicy } from '../models/GetPendingEffectRecoveryPolicy';

import { agentRunLifecycle } from './agentRunLifecycle';
import { createAgentRunPendingEffectContinuation } from './createAgentRunPendingEffectContinuation';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type CommandBatch = Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

/** Admits the exact recovery capability after its owning project checkpoint is proven durable. */
export function recordAgentRunPendingEffectContinuation(input: {
    runId: string;
    receipt: VerifiedBatchReceipt;
    commandBatch: CommandBatch;
    sourceRevision?: string;
    recordedAt?: number;
}): void {
    if (input.receipt.pendingEffects.length === 0) {
        return;
    }
    const recoveryPolicy = getPendingEffectRecoveryPolicy(input.receipt.pendingEffects, {
        ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
    });
    agentRunLifecycle.recordPendingEffectContinuation({
        runId: input.runId,
        recordedAt: input.recordedAt ?? Date.now(),
        continuation: {
            ...createAgentRunPendingEffectContinuation(input),
            lastError: recoveryPolicy.reason,
            recovery: recoveryPolicy.recovery,
            ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
        },
    });
}
