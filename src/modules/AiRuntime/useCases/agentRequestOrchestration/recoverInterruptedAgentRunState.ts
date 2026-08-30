import { type AgentRun, type AgentRunState } from '../../models/AgentRun';
import { normalizeAgentFailure } from '../agentErrorAndSaga';

import { reduceAgentRunTransition } from './reduceAgentRunTransition';

const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled', 'partially-completed']);

export function recoverInterruptedAgentRunState(
    state: AgentRunState,
    recoveredAt: number
): { state: AgentRunState; recoveredRunIds: string[] } {
    const recoveredRunIds: string[] = [];
    const runs = state.runs.map((run): AgentRun => {
        const hasUnsettledLease = run.workLeases.some((lease) => lease.terminalState === null);
        const hasLiveTemporaryAsset = run.temporaryAssets.some((asset) => asset.status === 'live');
        const hasUnsettledSaga = run.saga.steps.some(
            (step) =>
                step.state === 'pending' ||
                step.state === 'external-pending' ||
                step.state === 'uncompensated' ||
                step.state === 'manual-repair'
        );
        if (
            (TERMINAL_PHASES.has(run.phase) && !hasUnsettledLease && !hasLiveTemporaryAsset && !hasUnsettledSaga) ||
            (run.phase === 'paused' && !hasUnsettledLease && !hasLiveTemporaryAsset && !hasUnsettledSaga)
        ) {
            return run;
        }
        recoveredRunIds.push(run.runId);
        const retainedEffectBatchIds = new Set(
            [
                ...run.pendingEffectContinuations,
                ...(state.pendingEffectRecoveryLedger ?? []).filter((recovery) => recovery.runId === run.runId),
            ].map((continuation) => continuation.batchId)
        );
        const orphanedWorkIds = [
            ...run.workLeases
                .filter((lease) => lease.terminalState === null && !retainedEffectBatchIds.has(lease.workId))
                .map((lease) => lease.workId),
            ...run.saga.steps
                .filter(
                    (step) =>
                        (step.state === 'pending' ||
                            step.state === 'external-pending' ||
                            step.state === 'uncompensated') &&
                        !(step.state === 'external-pending' && retainedEffectBatchIds.has(step.workId))
                )
                .map((step) => step.workId),
        ];
        const uniqueOrphanedWorkIds = [...new Set(orphanedWorkIds)];
        const requiresManualResume = uniqueOrphanedWorkIds.length > 0 || hasLiveTemporaryAsset;
        const recoveryError = requiresManualResume
            ? normalizeAgentFailure({
                  category: 'internal',
                  source: 'restart-recovery',
                  occurredAt: recoveredAt,
                  related: {
                      workIds: uniqueOrphanedWorkIds,
                      receiptIdentities: run.saga.steps
                          .filter(
                              (step) =>
                                  step.receiptIdentity !== null &&
                                  step.state !== 'committed' &&
                                  !(step.state === 'external-pending' && retainedEffectBatchIds.has(step.workId))
                          )
                          .map((step) => step.receiptIdentity)
                          .filter((receiptIdentity): receiptIdentity is string => receiptIdentity !== null),
                  },
                  retry: uniqueOrphanedWorkIds.every((workId) =>
                      run.retriableWork.some((work) => work.workId === workId && work.idempotent && work.retriable)
                  )
                      ? 'owner-proven-idempotent'
                      : 'never',
                  compensation: run.saga.steps.some(
                      (step) => step.state === 'external-pending' && !retainedEffectBatchIds.has(step.workId)
                  )
                      ? 'manual-repair'
                      : 'not-needed',
                  knownDomain: true,
              })
            : null;
        return {
            ...run,
            phase: reduceAgentRunTransition(run.phase, { type: 'recovery-resolved', requiresManualResume }),
            workLeases: run.workLeases.map((lease) =>
                lease.terminalState === null ? { ...lease, terminalState: 'orphaned', settledAt: recoveredAt } : lease
            ),
            temporaryAssets: run.temporaryAssets.map((asset) =>
                asset.status === 'live' ? { ...asset, status: 'cleanup-pending' } : asset
            ),
            manualResume: {
                required: requiresManualResume,
                reason: requiresManualResume
                    ? 'The application restarted before this run finished. Its exact continuation is unavailable; start a new run from the retained request and receipts.'
                    : null,
                workIds: uniqueOrphanedWorkIds,
                requiredAt: requiresManualResume ? recoveredAt : null,
            },
            errors: recoveryError ? [...run.errors, recoveryError] : run.errors,
            saga: {
                schemaVersion: 1,
                steps: run.saga.steps.map((step) =>
                    step.state === 'external-pending' && !retainedEffectBatchIds.has(step.workId)
                        ? { ...step, state: 'manual-repair', updatedAt: recoveredAt }
                        : step
                ),
            },
            updatedAt: recoveredAt,
        };
    });
    return { state: { ...state, runs }, recoveredRunIds };
}
