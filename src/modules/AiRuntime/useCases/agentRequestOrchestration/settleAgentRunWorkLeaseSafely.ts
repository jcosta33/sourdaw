import { type AgentRunWorkLease, type AgentRunWorkTerminalState } from '../../models/AgentRun';

export const AGENT_RUN_PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
export const AGENT_RUN_PROVIDER_PERSISTENCE_WARNING =
    'Agent run provider response recovery state could not be persisted after execution. The retained response remains visible, but its lifecycle is not durably settled. Review it before retrying.';
export const AGENT_RUN_WORK_PERSISTENCE_WARNING =
    'Agent run work recovery state could not be persisted after execution. The retained work outcome remains visible, but its lifecycle is not durably settled. Review it before retrying.';
export const AGENT_RUN_COMPLETION_PERSISTENCE_WARNING =
    'Agent run completion recovery state could not be persisted. No completed artifact is claimed. Review the durable run state before retrying.';
export const AGENT_RUN_FAILURE_PERSISTENCE_WARNING =
    'Agent run failure recovery state could not be persisted. The work failed, and no successful artifact is claimed. Review the durable run state before retrying.';
export const AGENT_RUN_CANCELLATION_PERSISTENCE_WARNING =
    'Agent run cancellation recovery state could not be persisted. The work was cancelled, and no successful artifact is claimed. Review the durable run state before retrying.';
export const AGENT_RUN_STALE_COMPLETION_WARNING =
    'Agent work completed after its run lease was cancelled or replaced. The durable receipt was retained without reopening the terminal run.';
export const AGENT_RUN_STALE_FAILURE_WARNING =
    'Agent work failed after its run lease was cancelled or replaced. No successful artifact is claimed, and the terminal run was not reopened.';
export const AGENT_RUN_STALE_CANCELLATION_WARNING =
    'Agent work was cancelled after its run lease was cancelled or replaced. No successful artifact is claimed, and the terminal run was not reopened.';

type AgentRunWorkSettlementEvidence =
    'none' | 'verified-command-receipt' | 'visible-provider-output' | 'visible-work-output';

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
    evidence: AgentRunWorkSettlementEvidence;
    settle: (input: SettleAgentRunWorkLeaseInput) => { status: string };
    reportFailure?: (error: unknown) => void;
};

const COMPLETED_PERSISTENCE_WARNINGS = {
    none: AGENT_RUN_COMPLETION_PERSISTENCE_WARNING,
    'verified-command-receipt': AGENT_RUN_PERSISTENCE_WARNING,
    'visible-provider-output': AGENT_RUN_PROVIDER_PERSISTENCE_WARNING,
    'visible-work-output': AGENT_RUN_WORK_PERSISTENCE_WARNING,
} satisfies Record<AgentRunWorkSettlementEvidence, string>;

const COMPLETED_STALE_WARNINGS = {
    none: 'Agent work completed after its run lease was cancelled or replaced. No completed artifact is claimed, and the terminal run was not reopened.',
    'verified-command-receipt': AGENT_RUN_STALE_COMPLETION_WARNING,
    'visible-provider-output':
        'Agent provider work completed after its run lease was cancelled or replaced. The visible provider output was retained without reopening the terminal run.',
    'visible-work-output':
        'Agent work completed after its run lease was cancelled or replaced. The visible work output was retained without reopening the terminal run.',
} satisfies Record<AgentRunWorkSettlementEvidence, string>;

const FAILED_PERSISTENCE_WARNINGS = {
    none: AGENT_RUN_FAILURE_PERSISTENCE_WARNING,
    'verified-command-receipt':
        'Agent run failure recovery state could not be persisted. The verified failure receipt remains authoritative; review it before retrying.',
    'visible-provider-output':
        'Agent run provider failure recovery state could not be persisted. The visible partial response remains available, but it is not a completed response. Review the durable run state before retrying.',
    'visible-work-output':
        'Agent run work failure recovery state could not be persisted. The visible partial work output remains available, but it is not a completed outcome. Review the durable run state before retrying.',
} satisfies Record<AgentRunWorkSettlementEvidence, string>;

const FAILED_STALE_WARNINGS = {
    none: AGENT_RUN_STALE_FAILURE_WARNING,
    'verified-command-receipt':
        'Agent work failed after its run lease was cancelled or replaced. The verified failure receipt was retained without reopening the terminal run.',
    'visible-provider-output':
        'Agent provider work failed after its run lease was cancelled or replaced. The visible partial response was retained without reopening the terminal run.',
    'visible-work-output':
        'Agent work failed after its run lease was cancelled or replaced. The visible partial work output was retained without reopening the terminal run.',
} satisfies Record<AgentRunWorkSettlementEvidence, string>;

function getPersistenceWarning(input: SettleAgentRunWorkLeaseSafelyInput): string {
    if (input.terminalState === 'completed') {
        return COMPLETED_PERSISTENCE_WARNINGS[input.evidence];
    }
    if (input.terminalState === 'cancelled') {
        return AGENT_RUN_CANCELLATION_PERSISTENCE_WARNING;
    }
    return FAILED_PERSISTENCE_WARNINGS[input.evidence];
}

function getStaleWarning(input: SettleAgentRunWorkLeaseSafelyInput): string {
    if (input.terminalState === 'completed') {
        return COMPLETED_STALE_WARNINGS[input.evidence];
    }
    if (input.terminalState === 'cancelled') {
        return AGENT_RUN_STALE_CANCELLATION_WARNING;
    }
    return FAILED_STALE_WARNINGS[input.evidence];
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
            warning: settlement.status === 'settled' ? null : getStaleWarning(input),
        };
    } catch (error) {
        input.reportFailure?.(error);
        return { accepted: true, warning: getPersistenceWarning(input) };
    }
}
