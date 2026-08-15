import {
    type AgentRun,
    type AgentRunWorkLease,
    type AgentRunWorkOwnerKind,
    type AgentRunWorkTerminalState,
} from '../models/AgentRun';
import { persistAgentRunState, readAgentRunState } from '../stores/agentRunStore';

const TERMINAL_RUN_PHASES = new Set(['completed', 'failed', 'cancelled', 'partially-completed']);

function updateRun(runId: string, updatedAt: number, update: (run: AgentRun) => AgentRun): AgentRun | null {
    const state = readAgentRunState();
    const index = state.runs.findIndex((run) => run.runId === runId);
    if (index < 0) {
        return null;
    }
    const runs = [...state.runs];
    const next = { ...update(structuredClone(runs[index]!)), updatedAt };
    runs[index] = next;
    persistAgentRunState({ ...state, runs });
    return next;
}

type ClaimAgentRunWorkLeaseInput = {
    runId: string;
    workId: string;
    ownerKind: AgentRunWorkOwnerKind;
    cleanupOwner: string;
    idempotencyKey: string;
    receiptIdentity: string;
    idempotent: boolean;
    retriable: boolean;
    claimedAt?: number;
};

export type ClaimAgentRunWorkLeaseResult =
    | { status: 'missing-run' }
    | { status: 'terminal-run' }
    | { status: 'already-claimed' }
    | { status: 'claimed'; lease: AgentRunWorkLease };

function claimAgentRunWorkLease(input: ClaimAgentRunWorkLeaseInput): ClaimAgentRunWorkLeaseResult {
    const claimedAt = input.claimedAt ?? Date.now();
    let result: ClaimAgentRunWorkLeaseResult = { status: 'missing-run' };
    const updated = updateRun(input.runId, claimedAt, (run) => {
        if (TERMINAL_RUN_PHASES.has(run.phase)) {
            result = { status: 'terminal-run' };
            return run;
        }
        if (run.workLeases.some((lease) => lease.workId === input.workId)) {
            result = { status: 'already-claimed' };
            return run;
        }
        const lease: AgentRunWorkLease = {
            leaseId: `${input.runId}:${input.workId}:0`,
            runId: input.runId,
            workId: input.workId,
            attempt: 1,
            ownerKind: input.ownerKind,
            cancellationGeneration: run.cancellation.generation,
            idempotencyKey: input.idempotencyKey,
            receiptIdentity: input.receiptIdentity,
            cleanupOwner: input.cleanupOwner,
            idempotent: input.idempotent,
            retriable: input.retriable,
            claimedAt,
            terminalState: null,
            settledAt: null,
        };
        result = { status: 'claimed', lease: structuredClone(lease) };
        return {
            ...run,
            workLeases: [...run.workLeases, lease],
            retriableWork:
                input.idempotent && input.retriable
                    ? [
                          ...run.retriableWork.filter((work) => work.workId !== input.workId),
                          {
                              workId: input.workId,
                              idempotencyKey: input.idempotencyKey,
                              receiptIdentity: input.receiptIdentity,
                              idempotent: true,
                              retriable: true,
                          },
                      ]
                    : run.retriableWork,
        };
    });
    return updated === null ? { status: 'missing-run' } : result;
}

type RetryAgentRunWorkLeaseInput = {
    runId: string;
    workId: string;
    ownerKind: AgentRunWorkOwnerKind;
    cleanupOwner: string;
    claimedAt?: number;
};

export type RetryAgentRunWorkLeaseResult =
    | { status: 'missing-run' }
    | { status: 'not-retriable' }
    | { status: 'already-claimed' }
    | { status: 'retried'; lease: AgentRunWorkLease };

function retryAgentRunWorkLease(input: RetryAgentRunWorkLeaseInput): RetryAgentRunWorkLeaseResult {
    const claimedAt = input.claimedAt ?? Date.now();
    let result: RetryAgentRunWorkLeaseResult = { status: 'missing-run' };
    const updated = updateRun(input.runId, claimedAt, (run) => {
        if (run.cancellation.requestedAt !== null || run.phase === 'cancelled' || run.phase === 'completed') {
            result = { status: 'not-retriable' };
            return run;
        }
        const work = run.retriableWork.find((candidate) => candidate.workId === input.workId);
        const priorLeases = run.workLeases.filter((lease) => lease.workId === input.workId);
        const activeLease = priorLeases.find((lease) => lease.terminalState === null);
        if (activeLease) {
            result = { status: 'already-claimed' };
            return run;
        }
        const priorLease = priorLeases.at(-1);
        if (
            !work?.idempotent ||
            !work.retriable ||
            !priorLease ||
            (priorLease.terminalState !== 'failed' && priorLease.terminalState !== 'orphaned')
        ) {
            result = { status: 'not-retriable' };
            return run;
        }
        const attempt = priorLease.attempt + 1;
        const lease: AgentRunWorkLease = {
            leaseId: `${input.runId}:${input.workId}:${attempt - 1}`,
            runId: input.runId,
            workId: input.workId,
            attempt,
            ownerKind: input.ownerKind,
            cancellationGeneration: run.cancellation.generation,
            idempotencyKey: work.idempotencyKey,
            receiptIdentity: work.receiptIdentity,
            cleanupOwner: input.cleanupOwner,
            idempotent: true,
            retriable: true,
            claimedAt,
            terminalState: null,
            settledAt: null,
        };
        result = { status: 'retried', lease: structuredClone(lease) };
        const remainingManualWorkIds = run.manualResume.workIds.filter((workId) => workId !== input.workId);
        return {
            ...run,
            phase: 'executing',
            workLeases: [...run.workLeases, lease],
            manualResume: {
                required: remainingManualWorkIds.length > 0,
                reason: remainingManualWorkIds.length > 0 ? run.manualResume.reason : null,
                workIds: remainingManualWorkIds,
                requiredAt: remainingManualWorkIds.length > 0 ? run.manualResume.requiredAt : null,
            },
        };
    });
    return updated === null ? { status: 'missing-run' } : result;
}

type SettleAgentRunWorkLeaseInput = {
    runId: string;
    workId: string;
    leaseId: string;
    cancellationGeneration: number;
    idempotencyKey: string;
    receiptIdentity: string;
    terminalState: AgentRunWorkTerminalState;
    settledAt?: number;
};

export type SettleAgentRunWorkLeaseResult =
    | { status: 'missing-run' }
    | { status: 'missing-lease' }
    | { status: 'stale' }
    | { status: 'already-settled' }
    | { status: 'settled' };

function settleAgentRunWorkLease(input: SettleAgentRunWorkLeaseInput): SettleAgentRunWorkLeaseResult {
    const settledAt = input.settledAt ?? Date.now();
    let result: SettleAgentRunWorkLeaseResult = { status: 'missing-run' };
    const updated = updateRun(input.runId, settledAt, (run) => {
        const leaseIndex = run.workLeases.findIndex(
            (lease) => lease.workId === input.workId && lease.leaseId === input.leaseId && lease.terminalState === null
        );
        if (leaseIndex < 0) {
            const activeLease = run.workLeases.find(
                (lease) => lease.workId === input.workId && lease.terminalState === null
            );
            if (activeLease) {
                result = { status: 'stale' };
                return run;
            }
            const settledLease = run.workLeases.findLast(
                (lease) => lease.workId === input.workId && lease.leaseId === input.leaseId
            );
            if (!settledLease) {
                result = run.workLeases.some((lease) => lease.workId === input.workId)
                    ? { status: 'stale' }
                    : { status: 'missing-lease' };
            } else if (
                run.cancellation.generation !== input.cancellationGeneration ||
                settledLease.cancellationGeneration !== input.cancellationGeneration ||
                settledLease.idempotencyKey !== input.idempotencyKey ||
                settledLease.receiptIdentity !== input.receiptIdentity
            ) {
                result = { status: 'stale' };
            } else {
                result = { status: 'already-settled' };
            }
            return run;
        }
        const lease = run.workLeases[leaseIndex]!;
        if (
            run.cancellation.generation !== input.cancellationGeneration ||
            lease.cancellationGeneration !== input.cancellationGeneration ||
            lease.idempotencyKey !== input.idempotencyKey ||
            lease.receiptIdentity !== input.receiptIdentity
        ) {
            result = { status: 'stale' };
            return run;
        }
        const workLeases = [...run.workLeases];
        workLeases[leaseIndex] = { ...lease, terminalState: input.terminalState, settledAt };
        result = { status: 'settled' };
        return { ...run, workLeases };
    });
    return updated === null ? { status: 'missing-run' } : result;
}

export const agentRunWorkLease = {
    claim: claimAgentRunWorkLease,
    retry: retryAgentRunWorkLease,
    settle: settleAgentRunWorkLease,
} as const;
