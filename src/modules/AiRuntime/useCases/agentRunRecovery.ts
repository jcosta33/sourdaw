import { type AgentRun } from '../models/AgentRun';
import { persistAgentRunState, readAgentRunState } from '../stores/agentRunStore';

const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled', 'partially-completed']);

export function recoverInterruptedAgentRuns(input?: { recoveredAt?: number }): { recoveredRunIds: string[] } {
    const recoveredAt = input?.recoveredAt ?? Date.now();
    const state = readAgentRunState();
    const recoveredRunIds: string[] = [];
    const runs = state.runs.map((run): AgentRun => {
        if (TERMINAL_PHASES.has(run.phase) || run.phase === 'paused') {
            return run;
        }
        recoveredRunIds.push(run.runId);
        const orphanedWorkIds = run.workLeases
            .filter((lease) => lease.terminalState === null)
            .map((lease) => lease.workId);
        return {
            ...run,
            phase: 'paused',
            workLeases: run.workLeases.map((lease) =>
                lease.terminalState === null ? { ...lease, terminalState: 'orphaned', settledAt: recoveredAt } : lease
            ),
            temporaryAssets: run.temporaryAssets.map((asset) =>
                asset.status === 'live' ? { ...asset, status: 'cleanup-pending' } : asset
            ),
            manualResume: {
                required: true,
                reason: 'The application restarted while run work was active.',
                workIds: orphanedWorkIds,
                requiredAt: recoveredAt,
            },
            errors: [
                ...run.errors,
                {
                    code: 'interrupted-by-restart',
                    message: 'The application restarted before this run reached a terminal state.',
                    occurredAt: recoveredAt,
                    retriable: orphanedWorkIds.every((workId) =>
                        run.retriableWork.some((work) => work.workId === workId && work.idempotent && work.retriable)
                    ),
                    workId: null,
                },
            ],
            updatedAt: recoveredAt,
        };
    });
    if (recoveredRunIds.length > 0) {
        persistAgentRunState({ ...state, runs });
    }
    return { recoveredRunIds };
}
