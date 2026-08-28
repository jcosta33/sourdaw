import { describe, expect, it, vi } from 'vitest';

import { type AgentRunWorkLease } from '../../../models/AgentRun';
import {
    AGENT_RUN_PROVIDER_PERSISTENCE_WARNING,
    AGENT_RUN_WORK_PERSISTENCE_WARNING,
    settleAgentRunWorkLeaseSafely,
} from '../settleAgentRunWorkLeaseSafely';

const PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
const PROVIDER_PERSISTENCE_WARNING =
    'Agent run provider response recovery state could not be persisted after execution. The retained response remains visible, but its lifecycle is not durably settled. Review it before retrying.';
const WORK_PERSISTENCE_WARNING =
    'Agent run work recovery state could not be persisted after execution. The retained work outcome remains visible, but its lifecycle is not durably settled. Review it before retrying.';
const STALE_FAILURE_WARNING =
    'Agent work failed after its run lease was cancelled or replaced. No successful artifact is claimed, and the terminal run was not reopened.';
const FAILURE_PERSISTENCE_WARNING =
    'Agent run failure recovery state could not be persisted. The work failed, and no successful artifact is claimed. Review the durable run state before retrying.';
const CANCELLATION_PERSISTENCE_WARNING =
    'Agent run cancellation recovery state could not be persisted. The work was cancelled, and no successful artifact is claimed. Review the durable run state before retrying.';
const CANCELLATION_RECEIPT_PERSISTENCE_WARNING =
    'Agent run cancellation recovery state could not be persisted. The verified cancellation receipt remains authoritative; review it before retrying.';

const lease: AgentRunWorkLease = {
    leaseId: 'lease-1',
    runId: 'run-1',
    workId: 'work-1',
    attempt: 1,
    ownerKind: 'command',
    cancellationGeneration: 4,
    idempotencyKey: 'idempotency-1',
    receiptIdentity: 'receipt-1',
    cleanupOwner: 'command-execution',
    idempotent: true,
    retriable: false,
    claimedAt: 1,
    terminalState: null,
    settledAt: null,
};

describe('settleAgentRunWorkLeaseSafely', () => {
    it.each(['completed', 'failed', 'cancelled'] as const)(
        'forwards the %s terminal state with the full lease identity',
        (terminalState) => {
            const settle = vi.fn(() => ({ status: 'settled' as const }));

            expect(
                settleAgentRunWorkLeaseSafely({
                    lease,
                    terminalState,
                    evidence: terminalState === 'completed' ? 'verified-command-receipt' : 'none',
                    settle,
                })
            ).toEqual({
                accepted: true,
                warning: null,
            });
            expect(settle).toHaveBeenCalledWith({
                runId: 'run-1',
                workId: 'work-1',
                leaseId: 'lease-1',
                cancellationGeneration: 4,
                idempotencyKey: 'idempotency-1',
                receiptIdentity: 'receipt-1',
                terminalState,
            });
        }
    );

    it.each(['missing-lease', 'missing-run', 'stale', 'already-settled'] as const)(
        'rejects a %s settlement without reopening the run',
        (status) => {
            expect(
                settleAgentRunWorkLeaseSafely({
                    lease,
                    terminalState: 'failed',
                    evidence: 'none',
                    settle: () => ({ status }),
                })
            ).toEqual({ accepted: false, warning: STALE_FAILURE_WARNING });
        }
    );

    it('keeps the durable receipt accepted and reports a persistence warning when settlement throws', () => {
        const error = new Error('storage unavailable');
        const reportFailure = vi.fn();

        expect(
            settleAgentRunWorkLeaseSafely({
                lease,
                terminalState: 'completed',
                evidence: 'verified-command-receipt',
                settle: () => {
                    throw error;
                },
                reportFailure,
            })
        ).toEqual({ accepted: true, warning: PERSISTENCE_WARNING });
        expect(reportFailure).toHaveBeenCalledWith(error);
    });

    it('does not claim a completed artifact when cancelled settlement persistence fails', () => {
        expect(
            settleAgentRunWorkLeaseSafely({
                lease,
                terminalState: 'cancelled',
                evidence: 'none',
                settle: () => {
                    throw new Error('storage unavailable');
                },
            })
        ).toEqual({ accepted: true, warning: CANCELLATION_PERSISTENCE_WARNING });
    });

    it('preserves verified cancellation receipt evidence when settlement persistence fails', () => {
        expect(
            settleAgentRunWorkLeaseSafely({
                lease,
                terminalState: 'cancelled',
                evidence: 'verified-command-receipt',
                settle: () => {
                    throw new Error('storage unavailable');
                },
            })
        ).toEqual({ accepted: true, warning: CANCELLATION_RECEIPT_PERSISTENCE_WARNING });
    });

    it('keeps non-command persistence warnings specific to visible unsettled work', () => {
        expect(AGENT_RUN_PROVIDER_PERSISTENCE_WARNING).toBe(PROVIDER_PERSISTENCE_WARNING);
        expect(AGENT_RUN_WORK_PERSISTENCE_WARNING).toBe(WORK_PERSISTENCE_WARNING);
        expect(AGENT_RUN_PROVIDER_PERSISTENCE_WARNING).not.toContain('command receipt');
        expect(AGENT_RUN_PROVIDER_PERSISTENCE_WARNING).not.toContain('authoritative');
        expect(AGENT_RUN_WORK_PERSISTENCE_WARNING).not.toContain('authoritative');
    });

    it.each([
        {
            ownerKind: 'provider' as const,
            evidence: 'visible-provider-output' as const,
            warning: PROVIDER_PERSISTENCE_WARNING,
        },
        {
            ownerKind: 'render' as const,
            evidence: 'visible-work-output' as const,
            warning: WORK_PERSISTENCE_WARNING,
        },
    ])(
        'reports the $ownerKind-specific completed-evidence warning when settlement throws',
        ({ ownerKind, evidence, warning }) => {
            expect(
                settleAgentRunWorkLeaseSafely({
                    lease: { ...lease, ownerKind },
                    terminalState: 'completed',
                    evidence,
                    settle: () => {
                        throw new Error('storage unavailable');
                    },
                })
            ).toEqual({ accepted: true, warning });
        }
    );

    it('does not claim a provider response when failed work has no retained output evidence', () => {
        expect(
            settleAgentRunWorkLeaseSafely({
                lease: { ...lease, ownerKind: 'provider' },
                terminalState: 'failed',
                evidence: 'none',
                settle: () => {
                    throw new Error('storage unavailable');
                },
            })
        ).toEqual({ accepted: true, warning: FAILURE_PERSISTENCE_WARNING });
    });
});
