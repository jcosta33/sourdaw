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
    const policy = getPendingEffectRecoveryPolicy(continuation.effects, {
        ...(continuation.sourceRevision === undefined ? {} : { sourceRevision: continuation.sourceRevision }),
    });
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
    continuation: AgentRunPendingEffectContinuation,
    committedRevision: string | null
): boolean {
    // A confirmation can own a retained render only when its committed follow-up
    // revision is the exact source revision bound to that continuation.
    return (
        continuation.sourceRevision !== undefined &&
        continuation.sourceRevision === committedRevision &&
        continuation.effects.every(({ remediation }) => remediation !== 'manual-repair') &&
        continuation.effects.length === 1 &&
        continuation.effects[0]?.kind === 'external-effect' &&
        continuation.effects[0].operation === 'renderProjectSections' &&
        hasRetryableSectionRenderFollowUp({
            authority: continuation.authority,
            runId,
            batchId: continuation.batchId,
            commandId: continuation.effects[0].commandId,
            committedRevision,
            serializedBatch: continuation.serializedBatch,
        })
    );
}

/** Public read projection for every user-actionable pending-effect recovery. */
export function selectAgentRunPendingEffectRecoveries(
    state: AgentRunState | null | undefined
): AgentRunPendingEffectRecoveryProjection[] {
    const byIdentity = new Map<string, AgentRunPendingEffectRecoveryProjection>();
    const runsById = new Map((state?.runs ?? []).map((run) => [run.runId, run]));
    for (const run of state?.runs ?? []) {
        for (const continuation of run.pendingEffectContinuations) {
            if (isOwnedByRetryableSectionRenderFollowUp(run.runId, continuation, run.revisions.committed)) {
                continue;
            }
            byIdentity.set(recoveryIdentity(run.runId, continuation.batchId), projectRecovery(run.runId, continuation));
        }
    }
    for (const recovery of state?.pendingEffectRecoveryLedger ?? []) {
        if (recovery.checkpoint !== 'durable') {
            continue;
        }
        if (
            isOwnedByRetryableSectionRenderFollowUp(
                recovery.runId,
                recovery,
                runsById.get(recovery.runId)?.revisions.committed ?? null
            )
        ) {
            continue;
        }
        byIdentity.set(recoveryIdentity(recovery.runId, recovery.batchId), projectRecovery(recovery.runId, recovery));
    }
    return [...byIdentity.values()];
}
