import {
    executeVersionedCommandBatchEnvelope,
    getVersionedCommandBatchIdempotentReplay,
} from '#/modules/Command/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';

type RecoverAgentRunPendingEffectsResult =
    { status: 'missing' } | { status: 'recovered' } | { status: 'failed'; reason: string };

function getReceiptIdentity(receipt: {
    schemaVersion: number;
    runId: string;
    batchId: string;
    outcome: string;
}): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

function getFailureReason(result: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>): string {
    if ('reason' in result && typeof result.reason === 'string') {
        return result.reason;
    }
    return 'The retained pending-effect reconciliation did not return a completed receipt.';
}

/** Resumes only persisted, receipt-backed effects; it never admits or replays project mutations. */
export async function recoverAgentRunPendingEffects(input: {
    runId: string;
    batchId: string;
}): Promise<RecoverAgentRunPendingEffectsResult> {
    const continuation = agentRunLifecycle
        .get(input.runId)
        ?.pendingEffectContinuations.find(({ batchId }) => batchId === input.batchId);
    if (!continuation) {
        return { status: 'missing' };
    }

    const priorReceipt = await getVersionedCommandBatchIdempotentReplay({
        authority: continuation.authority,
        serialized: continuation.serializedBatch,
    });
    if (!priorReceipt) {
        const reason = 'The durable project checkpoint for this pending-effect continuation is unavailable.';
        agentRunLifecycle.failPendingEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }
    if (priorReceipt.runId !== input.runId || priorReceipt.batchId !== input.batchId) {
        const reason = 'The durable project checkpoint does not match this pending-effect continuation.';
        agentRunLifecycle.failPendingEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }
    if (priorReceipt.pendingEffects.length === 0) {
        agentRunLifecycle.completePendingEffectContinuation({
            ...input,
            receiptIdentity: getReceiptIdentity(priorReceipt),
        });
        return { status: 'recovered' };
    }
    if (
        continuation.recovery === 'manual-repair' ||
        priorReceipt.pendingEffects.some(({ remediation }) => remediation === 'manual-repair')
    ) {
        const reason = 'At least one retained external effect requires manual repair and cannot be retried exactly.';
        agentRunLifecycle.failPendingEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }

    let result: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
    try {
        result = await executeVersionedCommandBatchEnvelope({
            authority: continuation.authority,
            serialized: continuation.serializedBatch,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        agentRunLifecycle.failPendingEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }
    if (result.status === 'idempotent-replay' && result.receipt.pendingEffects.length === 0) {
        agentRunLifecycle.completePendingEffectContinuation({
            ...input,
            receiptIdentity: getReceiptIdentity(result.receipt),
        });
        return { status: 'recovered' };
    }

    const reason = getFailureReason(result);
    agentRunLifecycle.failPendingEffectContinuation({ ...input, reason });
    return { status: 'failed', reason };
}
