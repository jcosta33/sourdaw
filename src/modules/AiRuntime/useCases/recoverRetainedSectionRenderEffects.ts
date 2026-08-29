import { type AgentRunPendingEffectRecovery } from '../models/AgentRun';
import { readAgentRunState } from '../stores/agentRunStore';

import { recoverAgentRunPendingEffects } from './recoverAgentRunPendingEffects';

function hasRetainedSectionRenderEffect(recovery: AgentRunPendingEffectRecovery): boolean {
    return recovery.effects.some(
        (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
    );
}

function getRetainedSectionRenderRecoveries(): Array<{ batchId: string; runId: string }> {
    return (readAgentRunState().pendingEffectRecoveryLedger ?? [])
        .filter(
            (recovery) =>
                hasRetainedSectionRenderEffect(recovery) &&
                (recovery.checkpoint === 'prepared' || recovery.recovery !== 'manual-repair')
        )
        .map(({ batchId, runId }) => ({ batchId, runId }));
}

/** Reconciles only retained render continuations after interrupted-run state is hydrated. */
export async function recoverRetainedSectionRenderEffects(): Promise<void> {
    for (const recovery of getRetainedSectionRenderRecoveries()) {
        await recoverAgentRunPendingEffects(recovery);
    }
}
