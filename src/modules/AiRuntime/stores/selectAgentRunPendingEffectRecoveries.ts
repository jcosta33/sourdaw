import {
    type AgentRunPendingEffect,
    type AgentRunPendingEffectContinuation,
    type AgentRunState,
} from '../models/AgentRun';

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

/** Public read projection for every user-actionable pending-effect recovery. */
export function selectAgentRunPendingEffectRecoveries(
    state: AgentRunState | null | undefined
): AgentRunPendingEffectRecoveryProjection[] {
    const byIdentity = new Map<string, AgentRunPendingEffectRecoveryProjection>();
    for (const run of state?.runs ?? []) {
        for (const continuation of run.pendingEffectContinuations) {
            byIdentity.set(recoveryIdentity(run.runId, continuation.batchId), {
                runId: run.runId,
                batchId: continuation.batchId,
                effects: structuredClone(continuation.effects),
                recovery: continuation.recovery,
                lastError: continuation.lastError,
            });
        }
    }
    for (const recovery of state?.pendingEffectRecoveryLedger ?? []) {
        if (recovery.checkpoint !== 'durable') {
            continue;
        }
        byIdentity.set(recoveryIdentity(recovery.runId, recovery.batchId), {
            runId: recovery.runId,
            batchId: recovery.batchId,
            effects: structuredClone(recovery.effects),
            recovery: recovery.recovery,
            lastError: recovery.lastError,
        });
    }
    return [...byIdentity.values()];
}
