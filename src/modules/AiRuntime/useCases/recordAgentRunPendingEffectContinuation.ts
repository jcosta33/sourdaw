import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type CommandBatch = Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

/** Records the exact recovery capability before the owning project transaction commits. */
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
        continuation: {
            authority: structuredClone(input.commandBatch.authority),
            batchId: input.receipt.batchId,
            effects: structuredClone(input.receipt.pendingEffects),
            lastError: null,
            recovery: input.receipt.pendingEffects.some(({ remediation }) => remediation === 'manual-repair')
                ? 'manual-repair'
                : 'reconcile-batch',
            receiptIdentity: `${input.receipt.schemaVersion}:${input.receipt.runId}:${input.receipt.batchId}:${input.receipt.outcome}`,
            serializedBatch: input.commandBatch.serialized,
        },
    });
}
