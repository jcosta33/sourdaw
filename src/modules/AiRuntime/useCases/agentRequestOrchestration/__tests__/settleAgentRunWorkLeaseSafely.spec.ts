import { describe, expect, it, vi } from 'vitest';

import { type AgentRunWorkLease } from '../../../models/AgentRun';
import {
    AGENT_RUN_PROVIDER_PERSISTENCE_WARNING,
    AGENT_RUN_WORK_PERSISTENCE_WARNING,
    settleAgentRunWorkLeaseSafely,
} from '../settleAgentRunWorkLeaseSafely';

const PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
const STALE_COMPLETION_WARNING =
    'Agent work completed after its run lease was cancelled or replaced. The durable receipt was retained without reopening the terminal run.';

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

            expect(settleAgentRunWorkLeaseSafely({ lease, terminalState, settle })).toEqual({
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
                    settle: () => ({ status }),
                })
            ).toEqual({ accepted: false, warning: STALE_COMPLETION_WARNING });
        }
    );

    it('keeps the durable receipt accepted and reports a persistence warning when settlement throws', () => {
        const error = new Error('storage unavailable');
        const reportFailure = vi.fn();

        expect(
            settleAgentRunWorkLeaseSafely({
                lease,
                terminalState: 'cancelled',
                settle: () => {
                    throw error;
                },
                reportFailure,
            })
        ).toEqual({ accepted: true, warning: PERSISTENCE_WARNING });
        expect(reportFailure).toHaveBeenCalledWith(error);
    });

    it.each([
        {
            ownerKind: 'provider' as const,
            warning: AGENT_RUN_PROVIDER_PERSISTENCE_WARNING,
        },
        {
            ownerKind: 'render' as const,
            warning: AGENT_RUN_WORK_PERSISTENCE_WARNING,
        },
    ])('reports the $ownerKind-specific persistence warning when settlement throws', ({ ownerKind, warning }) => {
        expect(
            settleAgentRunWorkLeaseSafely({
                lease: { ...lease, ownerKind },
                terminalState: 'failed',
                settle: () => {
                    throw new Error('storage unavailable');
                },
            })
        ).toEqual({ accepted: true, warning });
    });
});
