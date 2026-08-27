import { type AgentRun, type AgentRunWorkLease, type AgentRunWorkOwnerKind } from '../../models/AgentRun';

import { reduceAgentRunTransition } from './reduceAgentRunTransition';

type RetryAgentRunWorkLeaseInput = {
    run: AgentRun;
    workId: string;
    ownerKind: AgentRunWorkOwnerKind;
    cleanupOwner: string;
    claimedAt: number;
};

export type RetryAgentRunWorkLeaseResult =
    { status: 'not-retriable' } | { status: 'already-claimed' } | { status: 'retried'; lease: AgentRunWorkLease };

export function retryAgentRunWorkLease(input: RetryAgentRunWorkLeaseInput): {
    run: AgentRun;
    result: RetryAgentRunWorkLeaseResult;
} {
    if (
        input.run.cancellation.requestedAt !== null ||
        input.run.phase === 'cancelled' ||
        input.run.phase === 'completed'
    ) {
        return { run: input.run, result: { status: 'not-retriable' } };
    }
    const work = input.run.retriableWork.find((candidate) => candidate.workId === input.workId);
    const priorLeases = input.run.workLeases.filter((lease) => lease.workId === input.workId);
    const activeLease = priorLeases.find((lease) => lease.terminalState === null);
    if (activeLease) {
        return { run: input.run, result: { status: 'already-claimed' } };
    }
    const priorLease = priorLeases.at(-1);
    if (
        !work?.idempotent ||
        !work.retriable ||
        !priorLease ||
        (priorLease.terminalState !== 'failed' && priorLease.terminalState !== 'orphaned')
    ) {
        return { run: input.run, result: { status: 'not-retriable' } };
    }
    const attempt = priorLease.attempt + 1;
    const lease: AgentRunWorkLease = {
        leaseId: `${input.run.runId}:${input.workId}:${attempt - 1}`,
        runId: input.run.runId,
        workId: input.workId,
        attempt,
        ownerKind: input.ownerKind,
        cancellationGeneration: input.run.cancellation.generation,
        idempotencyKey: work.idempotencyKey,
        receiptIdentity: work.receiptIdentity,
        cleanupOwner: input.cleanupOwner,
        idempotent: true,
        retriable: true,
        claimedAt: input.claimedAt,
        terminalState: null,
        settledAt: null,
    };
    const remainingManualWorkIds = input.run.manualResume.workIds.filter((workId) => workId !== input.workId);
    return {
        result: { status: 'retried', lease: structuredClone(lease) },
        run: {
            ...input.run,
            phase: reduceAgentRunTransition(input.run.phase, { type: 'work-retried' }),
            workLeases: [...input.run.workLeases, lease],
            manualResume: {
                required: remainingManualWorkIds.length > 0,
                reason: remainingManualWorkIds.length > 0 ? input.run.manualResume.reason : null,
                workIds: remainingManualWorkIds,
                requiredAt: remainingManualWorkIds.length > 0 ? input.run.manualResume.requiredAt : null,
            },
        },
    };
}
