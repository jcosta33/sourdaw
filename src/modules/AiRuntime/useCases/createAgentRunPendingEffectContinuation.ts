import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { type AgentRunPendingEffectContinuation } from '../models/AgentRun';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type CommandBatch = Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

export function createAgentRunPendingEffectContinuation(input: {
    receipt: VerifiedBatchReceipt;
    commandBatch: CommandBatch;
}): AgentRunPendingEffectContinuation {
    return {
        authority: structuredClone(input.commandBatch.authority),
        batchId: input.receipt.batchId,
        effects: structuredClone(input.receipt.pendingEffects),
        lastError: null,
        recovery: input.receipt.pendingEffects.some(({ remediation }) => remediation === 'manual-repair')
            ? 'manual-repair'
            : 'reconcile-batch',
        receiptIdentity: `${input.receipt.schemaVersion}:${input.receipt.runId}:${input.receipt.batchId}:${input.receipt.outcome}`,
        serializedBatch: input.commandBatch.serialized,
    };
}
