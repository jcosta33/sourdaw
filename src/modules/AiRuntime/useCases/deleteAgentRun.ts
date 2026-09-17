import { AGENT_RUN_TERMINAL_PHASES, type AgentRunState } from '../models/AgentRun';
import { persistAgentRunState, purgeAgentRunContent, readAgentRunState } from '../stores/agentRunStore';

import { deleteAgentRunArtifacts } from './deleteAgentRunArtifacts';

export type DeleteAgentRunResult =
    | { status: 'missing' }
    | { status: 'refused'; reason: 'run-active' | 'recovery-pending' }
    | { status: 'partial'; failedAssetIds: string[] }
    | { status: 'deleted' }
    | { status: 'purged' };

function isNamedByRecoveryLedger(state: AgentRunState, runId: string): boolean {
    const pendingEffectRecoveries = state.pendingEffectRecoveryLedger ?? [];
    const preparedStemImportRecoveries = state.preparedStemImportRecoveryLedger ?? [];
    return (
        pendingEffectRecoveries.some((recovery) => recovery.runId === runId) ||
        preparedStemImportRecoveries.some((recovery) => recovery.runId === runId)
    );
}

/**
 * Deletes what one agent run owns locally at the user's request. A run that still proposes work, or
 * that a recovery ledger names, is refused rather than partly dismantled; a run that committed work
 * to the project keeps that history and loses only its own content.
 */
export async function deleteAgentRun(runId: string, now: number = Date.now()): Promise<DeleteAgentRunResult> {
    const state = readAgentRunState();
    const run = state.runs.find((candidate) => candidate.runId === runId);
    if (!run) {
        return { status: 'missing' };
    }
    if (!AGENT_RUN_TERMINAL_PHASES.has(run.phase)) {
        return { status: 'refused', reason: 'run-active' };
    }
    if (isNamedByRecoveryLedger(state, runId)) {
        return { status: 'refused', reason: 'recovery-pending' };
    }
    const artifacts = await deleteAgentRunArtifacts(runId, now);
    if (artifacts.status === 'missing') {
        return { status: 'missing' };
    }
    if (artifacts.status === 'partial') {
        return { status: 'partial', failedAssetIds: artifacts.failedAssetIds };
    }
    const current = readAgentRunState();
    const cleanedRun = current.runs.find((candidate) => candidate.runId === runId);
    if (!cleanedRun) {
        // Only an uncommitted terminal run can leave during cleanup: age retention purges a run
        // holding committed work instead of removing it, so the record the user asked to delete is gone.
        return { status: 'deleted' };
    }
    if (cleanedRun.committedWork.length === 0) {
        persistAgentRunState({ ...current, runs: current.runs.filter((candidate) => candidate.runId !== runId) }, now);
        return { status: 'deleted' };
    }
    persistAgentRunState(
        {
            ...current,
            runs: current.runs.map((candidate) =>
                candidate.runId === runId ? { ...purgeAgentRunContent(candidate), updatedAt: now } : candidate
            ),
        },
        now
    );
    return { status: 'purged' };
}
