import { type AgentRun, type AgentRunWorkLease, type AgentRunWorkOwnerKind } from '../../models/AgentRun';
import { admitAgentRetry } from '../admitAgentRetry';

const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled', 'partially-completed']);

type ClaimAgentRunWorkLeaseInput = {
    run: AgentRun;
    workId: string;
    ownerKind: AgentRunWorkOwnerKind;
    cleanupOwner: string;
    idempotencyKey: string;
    receiptIdentity: string;
    idempotent: boolean;
    retriable: boolean;
    operation?: 'read' | 'write';
    claimedAt: number;
};

export type ClaimAgentRunWorkLeaseResult =
    { status: 'terminal-run' } | { status: 'already-claimed' } | { status: 'claimed'; lease: AgentRunWorkLease };

export function claimAgentRunWorkLease(input: ClaimAgentRunWorkLeaseInput): {
    run: AgentRun;
    result: ClaimAgentRunWorkLeaseResult;
} {
    if (TERMINAL_PHASES.has(input.run.phase)) {
        return { run: input.run, result: { status: 'terminal-run' } };
    }
    if (input.run.workLeases.some((lease) => lease.workId === input.workId)) {
        return { run: input.run, result: { status: 'already-claimed' } };
    }
    const retry = admitAgentRetry({
        operation: input.operation ?? 'write',
        ownerProvesIdempotent: input.idempotent && input.retriable,
        cancellationRequested: input.run.cancellation.requestedAt !== null,
        stale: false,
    });
    const admittedRetriable = retry !== 'never';
    const lease: AgentRunWorkLease = {
        leaseId: `${input.run.runId}:${input.workId}:0`,
        runId: input.run.runId,
        workId: input.workId,
        attempt: 1,
        ownerKind: input.ownerKind,
        cancellationGeneration: input.run.cancellation.generation,
        idempotencyKey: input.idempotencyKey,
        receiptIdentity: input.receiptIdentity,
        cleanupOwner: input.cleanupOwner,
        idempotent: input.idempotent || input.operation === 'read',
        retriable: admittedRetriable,
        claimedAt: input.claimedAt,
        terminalState: null,
        settledAt: null,
    };
    return {
        result: { status: 'claimed', lease: structuredClone(lease) },
        run: {
            ...input.run,
            workLeases: [...input.run.workLeases, lease],
            retriableWork: admittedRetriable
                ? [
                      ...input.run.retriableWork.filter((work) => work.workId !== input.workId),
                      {
                          workId: input.workId,
                          idempotencyKey: input.idempotencyKey,
                          receiptIdentity: input.receiptIdentity,
                          idempotent: input.idempotent || input.operation === 'read',
                          retriable: true,
                      },
                  ]
                : input.run.retriableWork,
        },
    };
}
