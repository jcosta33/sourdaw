import { type AgentRun } from '../models/AgentRun';
import { persistAgentRunState, readAgentRunState } from '../stores/agentRunStore';

import { normalizeAgentFailure } from './agentErrorAndSaga';

const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled', 'partially-completed']);

export function recoverInterruptedAgentRuns(input?: { recoveredAt?: number }): { recoveredRunIds: string[] } {
    const recoveredAt = input?.recoveredAt ?? Date.now();
    const state = readAgentRunState();
    const recoveredRunIds: string[] = [];
    const runs = state.runs.map((run): AgentRun => {
        const hasUnsettledLease = run.workLeases.some((lease) => lease.terminalState === null);
        const hasLiveTemporaryAsset = run.temporaryAssets.some((asset) => asset.status === 'live');
        const hasUnsettledSaga = run.saga.steps.some(
            (step) => step.state === 'pending' || step.state === 'external-pending' || step.state === 'uncompensated'
        );
        if (
            (TERMINAL_PHASES.has(run.phase) && !hasUnsettledSaga) ||
            (run.phase === 'paused' && !hasUnsettledLease && !hasLiveTemporaryAsset && !hasUnsettledSaga)
        ) {
            return run;
        }
        recoveredRunIds.push(run.runId);
        const orphanedWorkIds = [
            ...run.workLeases.filter((lease) => lease.terminalState === null).map((lease) => lease.workId),
            ...run.saga.steps
                .filter(
                    (step) =>
                        step.state === 'pending' || step.state === 'external-pending' || step.state === 'uncompensated'
                )
                .map((step) => step.workId),
        ];
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
                reason: 'The application restarted before this run finished. Its exact continuation is unavailable; start a new run from the retained request and receipts.',
                workIds: [...new Set(orphanedWorkIds)],
                requiredAt: recoveredAt,
            },
            errors: [
                ...run.errors,
                normalizeAgentFailure({
                    category: 'internal',
                    source: 'restart-recovery',
                    occurredAt: recoveredAt,
                    related: {
                        workIds: [...new Set(orphanedWorkIds)],
                        receiptIdentities: run.saga.steps
                            .filter((step) => step.receiptIdentity !== null && step.state !== 'committed')
                            .map((step) => step.receiptIdentity)
                            .filter((receiptIdentity): receiptIdentity is string => receiptIdentity !== null),
                    },
                    retry: orphanedWorkIds.every((workId) =>
                        run.retriableWork.some((work) => work.workId === workId && work.idempotent && work.retriable)
                    )
                        ? 'owner-proven-idempotent'
                        : 'never',
                    compensation: run.saga.steps.some((step) => step.state === 'external-pending')
                        ? 'manual-repair'
                        : 'not-needed',
                    knownDomain: true,
                }),
            ],
            saga: {
                schemaVersion: 1,
                steps: run.saga.steps.map((step) =>
                    step.state === 'external-pending'
                        ? { ...step, state: 'manual-repair', updatedAt: recoveredAt }
                        : step
                ),
            },
            updatedAt: recoveredAt,
        };
    });
    if (recoveredRunIds.length > 0) {
        persistAgentRunState({ ...state, runs });
    }
    return { recoveredRunIds };
}
