import {
    executeVersionedCommandBatchEnvelope,
    getVersionedCommandBatchIdempotentReplay,
} from '#/modules/Command/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';

type RecoverAgentRunRuntimeEffectsResult =
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
    return 'The retained runtime recovery did not return a completed receipt.';
}

/** Resumes only a persisted, receipt-backed runtime continuation; it never admits new project work. */
export async function recoverAgentRunRuntimeEffects(input: {
    runId: string;
    batchId: string;
}): Promise<RecoverAgentRunRuntimeEffectsResult> {
    const continuation = agentRunLifecycle
        .get(input.runId)
        ?.runtimeEffectContinuations.find(({ batchId }) => batchId === input.batchId);
    if (!continuation) {
        return { status: 'missing' };
    }

    const priorReceipt = await getVersionedCommandBatchIdempotentReplay({
        authority: continuation.authority,
        serialized: continuation.serializedBatch,
    });
    if (!priorReceipt) {
        const reason = 'The durable project checkpoint for this runtime continuation is unavailable.';
        agentRunLifecycle.failRuntimeEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }
    if (priorReceipt.runId !== input.runId || priorReceipt.batchId !== input.batchId) {
        const reason = 'The durable project checkpoint does not match this runtime continuation.';
        agentRunLifecycle.failRuntimeEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }
    if (priorReceipt.pendingEffects.length === 0) {
        agentRunLifecycle.completeRuntimeEffectContinuation({
            ...input,
            receiptIdentity: getReceiptIdentity(priorReceipt),
        });
        return { status: 'recovered' };
    }

    let result: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
    try {
        result = await executeVersionedCommandBatchEnvelope({
            authority: continuation.authority,
            serialized: continuation.serializedBatch,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        agentRunLifecycle.failRuntimeEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }
    if (result.status === 'idempotent-replay' && result.receipt.pendingEffects.length === 0) {
        agentRunLifecycle.completeRuntimeEffectContinuation({
            ...input,
            receiptIdentity: getReceiptIdentity(result.receipt),
        });
        return { status: 'recovered' };
    }

    const reason = getFailureReason(result);
    agentRunLifecycle.failRuntimeEffectContinuation({ ...input, reason });
    return { status: 'failed', reason };
}
