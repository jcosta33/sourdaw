import {
    type AgentRunPendingEffect,
    type AgentRunPendingEffectContinuation,
    type AgentRunState,
} from '../models/AgentRun';
import { getPendingEffectRecoveryPolicy } from '../models/GetPendingEffectRecoveryPolicy';

import { hasRetryableSectionRenderFollowUp } from './pendingActionConfirmationStore';

export type AgentRunPendingEffectRecoveryProjection = Pick<
    AgentRunPendingEffectContinuation,
    'batchId' | 'recovery' | 'lastError'
> & {
    runId: string;
    effects: AgentRunPendingEffect[];
};

function recoveryIdentity(runId: string, batchId: string): string {
    return `${runId}\u0000${batchId}`;
}

function projectRecovery(
    runId: string,
    continuation: AgentRunPendingEffectContinuation
): AgentRunPendingEffectRecoveryProjection {
    const policy = getPendingEffectRecoveryPolicy(continuation.effects);
    return {
        runId,
        batchId: continuation.batchId,
        effects: structuredClone(continuation.effects),
        recovery: policy.recovery,
        lastError: continuation.lastError ?? (policy.recovery === 'manual-repair' ? policy.reason : null),
    };
}

function isOwnedByRetryableSectionRenderFollowUp(
    runId: string,
    continuation: AgentRunPendingEffectContinuation
): boolean {
    return (
        continuation.recovery !== 'manual-repair' &&
        continuation.effects.some(
            (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
        ) &&
        hasRetryableSectionRenderFollowUp({
            runId,
            batchId: continuation.batchId,
            serializedBatch: continuation.serializedBatch,
        })
    );
}

/** Public read projection for every user-actionable pending-effect recovery. */
export function selectAgentRunPendingEffectRecoveries(
    state: AgentRunState | null | undefined
): AgentRunPendingEffectRecoveryProjection[] {
    const byIdentity = new Map<string, AgentRunPendingEffectRecoveryProjection>();
    for (const run of state?.runs ?? []) {
        for (const continuation of run.pendingEffectContinuations) {
            if (isOwnedByRetryableSectionRenderFollowUp(run.runId, continuation)) {
                continue;
            }
            byIdentity.set(recoveryIdentity(run.runId, continuation.batchId), projectRecovery(run.runId, continuation));
        }
    }
    for (const recovery of state?.pendingEffectRecoveryLedger ?? []) {
        if (recovery.checkpoint !== 'durable') {
            continue;
        }
        if (isOwnedByRetryableSectionRenderFollowUp(recovery.runId, recovery)) {
            continue;
        }
        byIdentity.set(recoveryIdentity(recovery.runId, recovery.batchId), projectRecovery(recovery.runId, recovery));
    }
    return [...byIdentity.values()];
}
