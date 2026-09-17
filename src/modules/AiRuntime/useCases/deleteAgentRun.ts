import { AGENT_RUN_TERMINAL_PHASES, type AgentRun, type AgentRunState } from '../models/AgentRun';
import { persistAgentRunState, readAgentRunState } from '../stores/agentRunStore';

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
 * Blanks the content the run owns while keeping the evidence of what it committed to the project:
 * receipts, committed work, rendered and analysed artifact identities, revisions and timestamps.
 * Batches survive only where a retained receipt names them, which is what ties a committed work
 * entry back to the commands that produced it.
 */
function purgeAgentRunContent(run: AgentRun): AgentRun {
    const retainedReceiptIdentities = new Set([
        ...run.receipts.map((receipt) => receipt.receiptIdentity),
        ...run.committedWork.map((work) => work.receiptIdentity),
    ]);
    return {
        ...run,
        request: '',
        plan: null,
        decision: null,
        errors: [],
        analyses: [],
        contextEvidence: null,
        cancellation: { ...run.cancellation, reason: null },
        batches: run.batches.filter(
            (batch) => batch.receiptIdentity !== null && retainedReceiptIdentities.has(batch.receiptIdentity)
        ),
    };
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
    const artifacts = await deleteAgentRunArtifacts(runId);
    if (artifacts.status === 'missing') {
        return { status: 'missing' };
    }
    if (artifacts.status === 'partial') {
        return { status: 'partial', failedAssetIds: artifacts.failedAssetIds };
    }
    const current = readAgentRunState();
    const purgedRun = current.runs.find((candidate) => candidate.runId === runId);
    if (!purgedRun) {
        return { status: 'missing' };
    }
    if (purgedRun.committedWork.length === 0) {
        persistAgentRunState({ ...current, runs: current.runs.filter((candidate) => candidate.runId !== runId) }, now);
        return { status: 'deleted' };
    }
    persistAgentRunState(
        {
            ...current,
            runs: current.runs.map((candidate) =>
                candidate.runId === runId ? purgeAgentRunContent(candidate) : candidate
            ),
        },
        now
    );
    return { status: 'purged' };
}
