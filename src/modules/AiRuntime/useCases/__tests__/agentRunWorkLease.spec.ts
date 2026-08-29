import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';

const { cancel: cancelAgentRun, clear: clearAgentRuns, create: createAgentRun, get: getAgentRun } = agentRunLifecycle;
const {
    claim: claimAgentRunWorkLease,
    retry: retryAgentRunWorkLease,
    settle: settleAgentRunWorkLease,
    settleAndTerminalize: settleAndTerminalizeAgentRunWorkLease,
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
        // `created` has no edge to `executing`: production records a plan first,
        // so the tests below start from the phase a run actually holds when it
        // claims command or render work.
        agentRunLifecycle.transitionPhase({ runId: 'run-lease', phase: 'planning', transitionedAt: 101 });
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

    it('atomically settles a terminal lease with its batch and phase', () => {
        const claimed = claimAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'command-1',
            ownerKind: 'command',
            cleanupOwner: 'command-executor',
            idempotencyKey: 'command-key',
            receiptIdentity: 'command-receipt',
            idempotent: true,
            retriable: false,
            claimedAt: 110,
        });
        if (claimed.status !== 'claimed') {
            throw new Error('Expected command work to be claimed');
        }
        agentRunLifecycle.recordBatch({
            runId: 'run-lease',
            batch: {
                batchId: 'command-1',
                commandIds: ['command-1'],
                status: 'executing',
                receiptIdentity: null,
            },
            recordedAt: 111,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-lease', phase: 'executing', transitionedAt: 112 });

        expect(
            settleAndTerminalizeAgentRunWorkLease({
                runId: 'run-lease',
                workId: 'command-1',
                leaseId: claimed.lease.leaseId,
                cancellationGeneration: claimed.lease.cancellationGeneration,
                idempotencyKey: claimed.lease.idempotencyKey,
                receiptIdentity: claimed.lease.receiptIdentity,
                outcome: 'failed',
                settledAt: 120,
            })
        ).toEqual({ status: 'settled' });
        expect(getAgentRun('run-lease')).toMatchObject({
            phase: 'failed',
            batches: [{ batchId: 'command-1', status: 'failed' }],
            workLeases: [{ workId: 'command-1', terminalState: 'failed' }],
        });
    });

    it.each([
        ['failed', 'failed', 'failed', 'failed'],
        ['ambiguous', 'failed', 'failed', 'partially-completed'],
        ['no-op', 'completed', 'no-op', 'completed'],
    ] as const)(
        'derives the %s terminal lease, batch, and phase together',
        (outcome, terminalState, batchStatus, phase) => {
            const claimed = claimAgentRunWorkLease({
                runId: 'run-lease',
                workId: `command-${outcome}`,
                ownerKind: 'command',
                cleanupOwner: 'command-executor',
                idempotencyKey: `command-${outcome}-key`,
                receiptIdentity: `command-${outcome}-receipt`,
                idempotent: true,
                retriable: false,
                claimedAt: 110,
            });
            if (claimed.status !== 'claimed') {
                throw new Error('Expected command work to be claimed');
            }
            agentRunLifecycle.recordBatch({
                runId: 'run-lease',
                batch: {
                    batchId: `command-${outcome}`,
                    commandIds: [`command-${outcome}`],
                    status: 'executing',
                    receiptIdentity: null,
                },
                recordedAt: 111,
            });
            agentRunLifecycle.transitionPhase({ runId: 'run-lease', phase: 'executing', transitionedAt: 112 });

            expect(
                settleAndTerminalizeAgentRunWorkLease({
                    ...claimed.lease,
                    outcome,
                    settledAt: 120,
                })
            ).toEqual({ status: 'settled' });
            expect(getAgentRun('run-lease')).toMatchObject({
                phase,
                batches: [{ batchId: `command-${outcome}`, status: batchStatus }],
                workLeases: [{ workId: `command-${outcome}`, terminalState }],
            });
        }
    );

    it('keeps every durable field pre-operation when the atomic command write is refused', () => {
        const claimed = claimAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'command-atomic',
            ownerKind: 'command',
            cleanupOwner: 'command-executor',
            idempotencyKey: 'command-atomic-key',
            receiptIdentity: 'command-atomic-receipt',
            idempotent: true,
            retriable: false,
            claimedAt: 110,
        });
        if (claimed.status !== 'claimed') {
            throw new Error('Expected command work to be claimed');
        }
        for (const batchId of ['command-atomic', 'unrelated-command']) {
            agentRunLifecycle.recordBatch({
                runId: 'run-lease',
                batch: { batchId, commandIds: [batchId], status: 'executing', receiptIdentity: null },
                recordedAt: 111,
            });
        }
        agentRunLifecycle.transitionPhase({ runId: 'run-lease', phase: 'executing', transitionedAt: 112 });
        const durableBefore = window.localStorage.getItem('sourdaw-agent-runs');
        const persistenceFailure = new Error('storage refused command terminalization');
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw persistenceFailure;
        });

        expect(() =>
            settleAndTerminalizeAgentRunWorkLease({
                ...claimed.lease,
                outcome: 'failed',
                settledAt: 120,
            })
        ).toThrow('Agent run state could not be persisted locally');

        const live = readAgentRunState().runs.find((run) => run.runId === 'run-lease');
        expect(live).toMatchObject({
            phase: 'failed',
            batches: [
                { batchId: 'command-atomic', status: 'failed' },
                { batchId: 'unrelated-command', status: 'executing' },
            ],
            workLeases: [{ workId: 'command-atomic', terminalState: 'failed' }],
        });
        expect(window.localStorage.getItem('sourdaw-agent-runs')).toBe(durableBefore);
        setItem.mockRestore();
    });

    it('does not terminalize either batch or phase when the lease is stale or missing', () => {
        const claimed = claimAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'command-stale',
            ownerKind: 'command',
            cleanupOwner: 'command-executor',
            idempotencyKey: 'command-stale-key',
            receiptIdentity: 'command-stale-receipt',
            idempotent: true,
            retriable: false,
            claimedAt: 110,
        });
        if (claimed.status !== 'claimed') {
            throw new Error('Expected command work to be claimed');
        }
        for (const batchId of ['command-stale', 'unrelated-command']) {
            agentRunLifecycle.recordBatch({
                runId: 'run-lease',
                batch: { batchId, commandIds: [batchId], status: 'executing', receiptIdentity: null },
                recordedAt: 111,
            });
        }
        agentRunLifecycle.transitionPhase({ runId: 'run-lease', phase: 'executing', transitionedAt: 112 });

        expect(
            settleAndTerminalizeAgentRunWorkLease({
                ...claimed.lease,
                cancellationGeneration: claimed.lease.cancellationGeneration + 1,
                outcome: 'failed',
                settledAt: 120,
            })
        ).toEqual({ status: 'stale' });
        expect(
            settleAndTerminalizeAgentRunWorkLease({
                ...claimed.lease,
                runId: 'missing-run',
                outcome: 'failed',
                settledAt: 120,
            })
        ).toEqual({ status: 'missing-run' });
        expect(getAgentRun('run-lease')).toMatchObject({
            phase: 'executing',
            batches: [
                { batchId: 'command-stale', status: 'executing' },
                { batchId: 'unrelated-command', status: 'executing' },
            ],
        });
    });

    it('derives the terminal batch from work identity and refuses an unrelated batch', () => {
        const claimed = claimAgentRunWorkLease({
            runId: 'run-lease',
            workId: 'unknown-command',
            ownerKind: 'command',
            cleanupOwner: 'command-executor',
            idempotencyKey: 'unknown-command-key',
            receiptIdentity: 'unknown-command-receipt',
            idempotent: true,
            retriable: false,
            claimedAt: 110,
        });
        if (claimed.status !== 'claimed') {
            throw new Error('Expected command work to be claimed');
        }
        agentRunLifecycle.recordBatch({
            runId: 'run-lease',
            batch: {
                batchId: 'unrelated-command',
                commandIds: ['unrelated-command'],
                status: 'executing',
                receiptIdentity: null,
            },
            recordedAt: 111,
        });
        agentRunLifecycle.transitionPhase({ runId: 'run-lease', phase: 'executing', transitionedAt: 112 });

        expect(settleAndTerminalizeAgentRunWorkLease({ ...claimed.lease, outcome: 'failed', settledAt: 120 })).toEqual({
            status: 'missing-batch',
        });
        expect(getAgentRun('run-lease')).toMatchObject({
            phase: 'executing',
            batches: [{ batchId: 'unrelated-command', status: 'executing' }],
            workLeases: [{ workId: 'unknown-command', terminalState: null }],
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
