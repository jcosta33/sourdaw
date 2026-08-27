import { describe, expect, it, vi } from 'vitest';

import { type AgentRunWorkLease } from '../../../models/AgentRun';
import {
    AGENT_RUN_PERSISTENCE_WARNING,
    AGENT_RUN_STALE_COMPLETION_WARNING,
    settleAgentRunWorkLeaseSafely,
} from '../settleAgentRunWorkLeaseSafely';

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
    it('settles the full lease identity and accepts a settled result without warning', () => {
        const settle = vi.fn(() => ({ status: 'settled' as const }));

        expect(settleAgentRunWorkLeaseSafely({ lease, terminalState: 'completed', settle })).toEqual({
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
            terminalState: 'completed',
        });
    });

    it.each(['missing-lease', 'stale', 'already-settled'] as const)(
        'rejects a %s settlement without reopening the run',
        (status) => {
            expect(
                settleAgentRunWorkLeaseSafely({
                    lease,
                    terminalState: 'failed',
                    settle: () => ({ status }),
                })
            ).toEqual({ accepted: false, warning: AGENT_RUN_STALE_COMPLETION_WARNING });
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
        ).toEqual({ accepted: true, warning: AGENT_RUN_PERSISTENCE_WARNING });
        expect(reportFailure).toHaveBeenCalledWith(error);
    });
});
