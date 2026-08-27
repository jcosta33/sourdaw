import { type AgentRun, type AgentRunWorkTerminalState } from '../../models/AgentRun';

type SettleAgentRunWorkLeaseInput = {
    run: AgentRun;
    workId: string;
    leaseId: string;
    cancellationGeneration: number;
    idempotencyKey: string;
    receiptIdentity: string;
    terminalState: AgentRunWorkTerminalState;
    settledAt: number;
};

export type SettleAgentRunWorkLeaseResult =
    { status: 'missing-lease' } | { status: 'stale' } | { status: 'already-settled' } | { status: 'settled' };

export function settleAgentRunWorkLease(input: SettleAgentRunWorkLeaseInput): {
    run: AgentRun;
    result: SettleAgentRunWorkLeaseResult;
} {
    const leaseIndex = input.run.workLeases.findIndex(
        (lease) => lease.workId === input.workId && lease.leaseId === input.leaseId && lease.terminalState === null
    );
    if (leaseIndex < 0) {
        const activeLease = input.run.workLeases.find(
            (lease) => lease.workId === input.workId && lease.terminalState === null
        );
        if (activeLease) {
            return { run: input.run, result: { status: 'stale' } };
        }
        const settledLease = input.run.workLeases.findLast(
            (lease) => lease.workId === input.workId && lease.leaseId === input.leaseId
        );
        if (!settledLease) {
            const result = input.run.workLeases.some((lease) => lease.workId === input.workId)
                ? { status: 'stale' as const }
                : { status: 'missing-lease' as const };
            return { run: input.run, result };
        }
        if (
            input.run.cancellation.generation !== input.cancellationGeneration ||
            settledLease.cancellationGeneration !== input.cancellationGeneration ||
            settledLease.idempotencyKey !== input.idempotencyKey ||
            settledLease.receiptIdentity !== input.receiptIdentity
        ) {
            return { run: input.run, result: { status: 'stale' } };
        }
        return { run: input.run, result: { status: 'already-settled' } };
    }
    const lease = input.run.workLeases[leaseIndex]!;
    if (
        input.run.cancellation.generation !== input.cancellationGeneration ||
        lease.cancellationGeneration !== input.cancellationGeneration ||
        lease.idempotencyKey !== input.idempotencyKey ||
        lease.receiptIdentity !== input.receiptIdentity
    ) {
        return { run: input.run, result: { status: 'stale' } };
    }
    const workLeases = [...input.run.workLeases];
    workLeases[leaseIndex] = { ...lease, terminalState: input.terminalState, settledAt: input.settledAt };
    return { run: { ...input.run, workLeases }, result: { status: 'settled' } };
}
