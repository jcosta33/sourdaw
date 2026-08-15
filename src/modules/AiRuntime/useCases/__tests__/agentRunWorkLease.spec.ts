import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';

const { cancel: cancelAgentRun, clear: clearAgentRuns, create: createAgentRun, get: getAgentRun } = agentRunLifecycle;
const {
    claim: claimAgentRunWorkLease,
    retry: retryAgentRunWorkLease,
    settle: settleAgentRunWorkLease,
} = agentRunWorkLease;

describe('agent run work leases', () => {
    beforeEach(() => {
        clearAgentRuns();
        createAgentRun({
            runId: 'run-lease',
            request: 'Analyze and render the chorus.',
            mode: 'macro',
            createdRevision: 'heads-a',
            createdAt: 100,
        });
    });

    it('binds immutable work authority and allows one exact terminal consume', () => {
        const claimed = claimAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'render-1',
            ownerKind: 'render',
            cleanupOwner: 'render-worker',
            idempotencyKey: 'render-key',
            receiptIdentity: 'render-receipt',
            idempotent: true,
            retriable: true,
            claimedAt: 110,
        });
        expect(claimed).toMatchObject({ status: 'claimed', lease: { cancellationGeneration: 0 } });
        expect(
            claimAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-1',
                ownerKind: 'render',
                cleanupOwner: 'other-worker',
                idempotencyKey: 'other-key',
                receiptIdentity: 'other-receipt',
                idempotent: true,
                retriable: true,
                claimedAt: 111,
            })
        ).toEqual({ status: 'already-claimed' });

        expect(
            settleAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-1',
                leaseId: 'run-lease:render-1:0',
                cancellationGeneration: 1,
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
                terminalState: 'failed',
                settledAt: 120,
            })
        ).toEqual({ status: 'stale' });
        expect(
            settleAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-1',
                leaseId: 'run-lease:render-1:0',
                cancellationGeneration: 0,
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
                terminalState: 'failed',
                settledAt: 120,
            })
        ).toEqual({ status: 'settled' });
        expect(
            settleAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-1',
                leaseId: 'run-lease:render-1:0',
                cancellationGeneration: 0,
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
                terminalState: 'failed',
                settledAt: 121,
            })
        ).toEqual({ status: 'already-settled' });

        expect(
            retryAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-1',
                ownerKind: 'render',
                cleanupOwner: 'render-worker',
                claimedAt: 130,
            })
        ).toMatchObject({
            status: 'retried',
            lease: {
                leaseId: 'run-lease:render-1:1',
                attempt: 2,
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
            },
        });
    });

    it('rejects late work after cancellation advances the generation', () => {
        expect(
            claimAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'analysis-1',
                ownerKind: 'analysis',
                cleanupOwner: 'analysis-worker',
                idempotencyKey: 'analysis-key',
                receiptIdentity: 'analysis-receipt',
                idempotent: true,
                retriable: true,
                claimedAt: 110,
            }).status
        ).toBe('claimed');

        cancelAgentRun({ runId: 'run-lease', reason: 'User cancelled', requestedAt: 115 });

        expect(getAgentRun('run-lease')?.cancellation.generation).toBe(1);
        expect(
            settleAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'analysis-1',
                leaseId: 'run-lease:analysis-1:0',
                cancellationGeneration: 0,
                idempotencyKey: 'analysis-key',
                receiptIdentity: 'analysis-receipt',
                terminalState: 'completed',
                settledAt: 120,
            })
        ).toEqual({ status: 'stale' });
    });

    it('rejects a delayed callback from an earlier retry attempt', () => {
        const firstAttempt = claimAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'render-retry',
            ownerKind: 'render',
            cleanupOwner: 'render-worker',
            idempotencyKey: 'render-key',
            receiptIdentity: 'render-receipt',
            idempotent: true,
            retriable: true,
            claimedAt: 110,
        });
        if (firstAttempt.status !== 'claimed') {
            throw new Error('Expected the first render attempt to claim a lease');
        }
        expect(
            settleAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-retry',
                leaseId: firstAttempt.lease.leaseId,
                cancellationGeneration: 0,
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
                terminalState: 'failed',
                settledAt: 120,
            })
        ).toEqual({ status: 'settled' });
        const retryAttempt = retryAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'render-retry',
            ownerKind: 'render',
            cleanupOwner: 'render-worker',
            claimedAt: 130,
        });
        if (retryAttempt.status !== 'retried') {
            throw new Error('Expected the render work to retry');
        }

        expect(
            settleAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-retry',
                leaseId: firstAttempt.lease.leaseId,
                cancellationGeneration: 0,
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
                terminalState: 'completed',
                settledAt: 140,
            })
        ).toEqual({ status: 'stale' });
        expect(
            settleAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'render-retry',
                leaseId: retryAttempt.lease.leaseId,
                cancellationGeneration: 0,
                idempotencyKey: 'render-key',
                receiptIdentity: 'render-receipt',
                terminalState: 'completed',
                settledAt: 141,
            })
        ).toEqual({ status: 'settled' });
    });

    it('never offers retry for work that was not declared idempotent', () => {
        expect(
            claimAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'provider-1',
                ownerKind: 'provider',
                cleanupOwner: 'provider-worker',
                idempotencyKey: 'provider-key',
                receiptIdentity: 'provider-receipt',
                idempotent: false,
                retriable: true,
                claimedAt: 110,
            }).status
        ).toBe('claimed');
        settleAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'provider-1',
            leaseId: 'run-lease:provider-1:0',
            cancellationGeneration: 0,
            idempotencyKey: 'provider-key',
            receiptIdentity: 'provider-receipt',
            terminalState: 'failed',
            settledAt: 120,
        });

        expect(
            retryAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'provider-1',
                ownerKind: 'provider',
                cleanupOwner: 'provider-worker',
                claimedAt: 130,
            })
        ).toEqual({ status: 'not-retriable' });
    });
});
