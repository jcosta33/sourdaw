import { readAgentRunState } from '../stores/agentRunStore';

import { recoverAgentRunPendingEffects } from './recoverAgentRunPendingEffects';

function getRetainedSectionRenderRecoveries(): Array<{ batchId: string; runId: string }> {
    return (readAgentRunState().pendingEffectRecoveryLedger ?? [])
        .filter(
            (recovery) =>
                recovery.recovery !== 'manual-repair' &&
                !recovery.effects.some(({ remediation }) => remediation === 'manual-repair') &&
                recovery.effects.some(({ operation }) => operation === 'renderProjectSections')
        )
        .map(({ batchId, runId }) => ({ batchId, runId }));
}

/** Reconciles only retained render continuations after interrupted-run state is hydrated. */
export async function recoverRetainedSectionRenderEffects(): Promise<void> {
    for (const recovery of getRetainedSectionRenderRecoveries()) {
        await recoverAgentRunPendingEffects(recovery);
    }
}
