import { type AgentRunWorkLease, type AgentRunWorkTerminalState } from '../../models/AgentRun';

export const AGENT_RUN_PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
export const AGENT_RUN_PROVIDER_PERSISTENCE_WARNING =
    'Agent run provider response recovery state could not be persisted after execution. The retained response remains visible, but its lifecycle is not durably settled. Review it before retrying.';
export const AGENT_RUN_WORK_PERSISTENCE_WARNING =
    'Agent run work recovery state could not be persisted after execution. The retained work outcome remains visible, but its lifecycle is not durably settled. Review it before retrying.';
export const AGENT_RUN_STALE_COMPLETION_WARNING =
    'Agent work completed after its run lease was cancelled or replaced. The durable receipt was retained without reopening the terminal run.';

type SettleAgentRunWorkLeaseInput = {
    runId: string;
    workId: string;
    leaseId: string;
    cancellationGeneration: number;
    idempotencyKey: string;
    receiptIdentity: string;
    terminalState: AgentRunWorkTerminalState;
};

type SettleAgentRunWorkLeaseSafelyInput = {
    lease: AgentRunWorkLease;
    terminalState: AgentRunWorkTerminalState;
    settle: (input: SettleAgentRunWorkLeaseInput) => { status: string };
    reportFailure?: (error: unknown) => void;
};

function getPersistenceWarning(lease: AgentRunWorkLease): string {
    if (lease.ownerKind === 'command') {
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
    if (lease.ownerKind === 'provider') {
        return AGENT_RUN_PROVIDER_PERSISTENCE_WARNING;
    }
    return AGENT_RUN_WORK_PERSISTENCE_WARNING;
}

export function settleAgentRunWorkLeaseSafely(input: SettleAgentRunWorkLeaseSafelyInput): {
    accepted: boolean;
    warning: string | null;
} {
    try {
        const settlement = input.settle({
            runId: input.lease.runId,
            workId: input.lease.workId,
            leaseId: input.lease.leaseId,
            cancellationGeneration: input.lease.cancellationGeneration,
            idempotencyKey: input.lease.idempotencyKey,
            receiptIdentity: input.lease.receiptIdentity,
            terminalState: input.terminalState,
        });
        return {
            accepted: settlement.status === 'settled',
            warning: settlement.status === 'settled' ? null : AGENT_RUN_STALE_COMPLETION_WARNING,
        };
    } catch (error) {
        input.reportFailure?.(error);
        return { accepted: true, warning: getPersistenceWarning(input.lease) };
    }
}
