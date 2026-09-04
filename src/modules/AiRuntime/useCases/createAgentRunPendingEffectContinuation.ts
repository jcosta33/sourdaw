import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { type AgentRunPendingEffectContinuation } from '../models/AgentRun';
import { getPendingEffectRecoveryPolicy } from '../models/GetPendingEffectRecoveryPolicy';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type CommandBatch = Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

export function createAgentRunPendingEffectContinuation(input: {
    receipt: VerifiedBatchReceipt;
    commandBatch: CommandBatch;
    sourceRevision?: string;
}): AgentRunPendingEffectContinuation {
    const recoveryPolicy = getPendingEffectRecoveryPolicy(input.receipt.pendingEffects, {
        ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
    });
    return {
        authority: structuredClone(input.commandBatch.authority),
        batchId: input.receipt.batchId,
        effects: structuredClone(input.receipt.pendingEffects),
        lastError: recoveryPolicy.reason,
        recovery: recoveryPolicy.recovery,
        receiptIdentity: `${input.receipt.schemaVersion}:${input.receipt.runId}:${input.receipt.batchId}:${input.receipt.outcome}`,
        serializedBatch: input.commandBatch.serialized,
        ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
    };
}
