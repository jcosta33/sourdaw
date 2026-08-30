import { logger } from '#/infra/logger/appLogger';
import {
    executeVersionedCommandBatchEnvelope,
    getVersionedCommandBatchIdempotentReplay,
} from '#/modules/Command/useCases';

import { type AgentRunPendingEffect } from '../models/AgentRun';
import {
    getPendingEffectRecoveryPolicy,
    MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
} from '../models/GetPendingEffectRecoveryPolicy';

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

function hasExactPendingReceiptBinding(
    continuation: NonNullable<ReturnType<typeof agentRunLifecycle.getPendingEffectRecovery>>,
    receipt: NonNullable<Awaited<ReturnType<typeof getVersionedCommandBatchIdempotentReplay>>>
): boolean {
    const expectedPendingIdentity = `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:partially-committed`;
    if (continuation.receiptIdentity !== expectedPendingIdentity) {
        return false;
    }
    return (
        receipt.pendingEffects.length === 0 ||
        hasExactPendingEffects(continuation.effects, receipt.pendingEffects) ||
        hasIntentionalManualizedRuntimeGraphBinding(continuation, receipt.pendingEffects)
    );
}

function hasExactPendingEffects(
    continuationEffects: readonly AgentRunPendingEffect[],
    receiptEffects: readonly AgentRunPendingEffect[]
): boolean {
    return (
        continuationEffects.length === receiptEffects.length &&
        continuationEffects.every((effect, index) => {
            const receiptEffect = receiptEffects[index];
            return receiptEffect !== undefined && hasExactPendingEffect(effect, receiptEffect);
        })
    );
}

function hasExactPendingEffect(effect: AgentRunPendingEffect, receiptEffect: AgentRunPendingEffect): boolean {
    return (
        effect.commandId === receiptEffect.commandId &&
        effect.kind === receiptEffect.kind &&
        effect.operation === receiptEffect.operation &&
        effect.reason === receiptEffect.reason &&
        effect.remediation === receiptEffect.remediation &&
        effect.state === receiptEffect.state
    );
}

function hasIntentionalManualizedRuntimeGraphBinding(
    continuation: NonNullable<ReturnType<typeof agentRunLifecycle.getPendingEffectRecovery>>,
    receiptEffects: readonly AgentRunPendingEffect[]
): boolean {
    if (
        continuation.checkpoint !== 'durable' ||
        continuation.recovery !== 'manual-repair' ||
        continuation.lastError !== MISSING_EXACT_CHECKPOINT_RECOVERY_REASON ||
        continuation.effects.length !== receiptEffects.length
    ) {
        return false;
    }
    let hasManualizedRuntimeGraphEffect = false;
    for (const [index, effect] of continuation.effects.entries()) {
        const receiptEffect = receiptEffects[index];
        if (receiptEffect === undefined) {
            return false;
        }
        if (hasExactPendingEffect(effect, receiptEffect)) {
            continue;
        }
        const isManualizedRuntimeGraphEffect =
            effect.commandId === receiptEffect.commandId &&
            effect.kind === 'runtime-graph' &&
            receiptEffect.kind === 'runtime-graph' &&
            effect.operation === receiptEffect.operation &&
            effect.reason === receiptEffect.reason &&
            effect.remediation === 'repair' &&
            receiptEffect.remediation === 'retry' &&
            effect.state === receiptEffect.state;
        if (!isManualizedRuntimeGraphEffect) {
            return false;
        }
        hasManualizedRuntimeGraphEffect = true;
    }
    return hasManualizedRuntimeGraphEffect;
}

/** Resumes only persisted, receipt-backed effects; it never admits or replays project mutations. */
export async function recoverAgentRunPendingEffects(input: {
    runId: string;
    batchId: string;
}): Promise<RecoverAgentRunPendingEffectsResult> {
    const continuation = agentRunLifecycle.getPendingEffectRecovery(input);
    if (!continuation) {
        return { status: 'missing' };
    }
    let priorReceipt: Awaited<ReturnType<typeof getVersionedCommandBatchIdempotentReplay>>;
    try {
        priorReceipt = await getVersionedCommandBatchIdempotentReplay({
            authority: continuation.authority,
            serialized: continuation.serializedBatch,
        });
    } catch (error) {
        // Unreadable evidence is not absence: leave the continuation pending so a
        // later recovery pass can retry once the checkpoint store is readable again.
        const detail = error instanceof Error ? error.message : String(error);
        return {
            status: 'failed',
            reason: `The durable commit evidence for this pending-effect continuation could not be read: ${detail}`,
        };
    }
    if (!priorReceipt) {
        const reason = 'The durable project checkpoint for this pending-effect continuation is unavailable.';
        if (continuation.checkpoint === 'prepared') {
            agentRunLifecycle.discardPreparedPendingEffectContinuation(input);
        } else {
            agentRunLifecycle.failPendingEffectContinuation({ ...input, reason });
        }
        return { status: 'failed', reason };
    }
    if (priorReceipt.runId !== input.runId || priorReceipt.batchId !== input.batchId) {
        const reason = 'The durable project checkpoint does not match this pending-effect continuation.';
        agentRunLifecycle.failPendingEffectContinuation({ ...input, reason });
        return { status: 'failed', reason };
    }
    if (!hasExactPendingReceiptBinding(continuation, priorReceipt)) {
        const reason = 'The durable project checkpoint does not match the retained pending-effect proof.';
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
    if (continuation.checkpoint === 'prepared') {
        const recoveryPolicy = getPendingEffectRecoveryPolicy(priorReceipt.pendingEffects);
        agentRunLifecycle.recordPendingEffectContinuation({
            runId: input.runId,
            continuation: {
                authority: continuation.authority,
                batchId: continuation.batchId,
                effects: structuredClone(priorReceipt.pendingEffects),
                lastError: recoveryPolicy.reason,
                receiptIdentity: getReceiptIdentity(priorReceipt),
                recovery: recoveryPolicy.recovery,
                serializedBatch: continuation.serializedBatch,
            },
        });
    }
    const durableContinuation = agentRunLifecycle.getPendingEffectRecovery(input);
    if (!durableContinuation || durableContinuation.checkpoint !== 'durable') {
        return { status: 'failed', reason: 'The durable pending-effect continuation could not be promoted.' };
    }
    const recoveryPolicy = getPendingEffectRecoveryPolicy(durableContinuation.effects);
    if (recoveryPolicy.recovery === 'manual-repair') {
        const reason = recoveryPolicy.reason ?? 'The retained pending effect requires manual repair.';
        try {
            agentRunLifecycle.requirePendingEffectManualRepair({
                ...input,
                reason,
                preserveEffects: reason === MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
            });
        } catch (error) {
            logger.error(new Error('Pending-effect manual-repair state could not be persisted', { cause: error }));
        }
        return { status: 'failed', reason };
    }
    if (
        durableContinuation.recovery === 'manual-repair' ||
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
