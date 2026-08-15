import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { agentRunControls } from '../getAgentRunControlProjection';

const {
    cancel: cancelAgentRun,
    registerTemporaryAssetCleanup: registerAgentRunTemporaryAssetCleanup,
    registerWorkCancellation: registerAgentRunWorkCancellation,
} = agentRunCancellation;

function createPlanningRun(runId: string): void {
    agentRunLifecycle.create({
        runId,
        request: 'Render and analyze the chorus, then apply the approved result.',
        mode: 'macro',
        createdRevision: 'heads-a',
        createdAt: 100,
    });
    agentRunLifecycle.transitionPhase({
        runId,
        phase: 'planning',
        revision: 'heads-a',
        transitionedAt: 101,
    });
}

function claimWork(input: {
    runId: string;
    workId: string;
    ownerKind: 'provider' | 'command' | 'render' | 'analysis';
    cleanupOwner: string;
}): Extract<ReturnType<typeof agentRunWorkLease.claim>, { status: 'claimed' }>['lease'] {
    const claimed = agentRunWorkLease.claim({
        ...input,
        idempotencyKey: `${input.workId}-key`,
        receiptIdentity: `${input.workId}-receipt`,
        idempotent: true,
        retriable: true,
        claimedAt: 110,
    });
    if (claimed.status !== 'claimed') {
        throw new Error(`Expected ${input.workId} to be claimed`);
    }
    return claimed.lease;
}

describe('cancelAgentRun', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('advances authority before cancelling exact work owners and cleaning safe temporary assets once', async () => {
        createPlanningRun('run-cancel');
        agentRunLifecycle.recordBatch({
            runId: 'run-cancel',
            batch: { batchId: 'batch-pending', commandIds: ['command-1'], status: 'planned', receiptIdentity: null },
            recordedAt: 102,
        });
        agentRunLifecycle.recordCommittedWork({
            runId: 'run-cancel',
            workId: 'batch-committed',
            receiptIdentity: 'receipt-committed',
            revertGroupId: 'undo-group-1',
            completesRun: false,
            committedAt: 103,
        });
        const providerLease = claimWork({
            runId: 'run-cancel',
            workId: 'provider-1',
            ownerKind: 'provider',
            cleanupOwner: 'provider-adapter',
        });
        const renderLease = claimWork({
            runId: 'run-cancel',
            workId: 'render-1',
            ownerKind: 'render',
            cleanupOwner: 'render-worker',
        });
        const analysisLease = claimWork({
            runId: 'run-cancel',
            workId: 'analysis-1',
            ownerKind: 'analysis',
            cleanupOwner: 'analysis-worker',
        });
        agentRunLifecycle.registerTemporaryAsset({
            runId: 'run-cancel',
            assetId: 'preview.wav',
            kind: 'render',
            cleanupOwner: 'render-worker',
            createdAt: 111,
        });

        const providerCancel = vi.fn(() => {
            expect(agentRunLifecycle.get('run-cancel')).toMatchObject({
                phase: 'partially-completed',
                cancellation: { generation: 1 },
            });
            return 'transport' as const;
        });
        const renderCancel = vi.fn(() => 'backend' as const);
        const cleanup = vi.fn(() => {
            expect(agentRunLifecycle.get('run-cancel')?.temporaryAssets).toMatchObject([
                { assetId: 'preview.wav', status: 'cleanup-pending' },
            ]);
        });
        registerAgentRunWorkCancellation({ lease: providerLease, cancel: providerCancel });
        registerAgentRunWorkCancellation({ lease: renderLease, cancel: renderCancel });
        registerAgentRunTemporaryAssetCleanup({
            runId: 'run-cancel',
            assetId: 'preview.wav',
            cleanupOwner: 'render-worker',
            cleanup,
        });

        await expect(
            cancelAgentRun({ runId: 'run-cancel', reason: 'User cancelled', requestedAt: 120 })
        ).resolves.toEqual({
            status: 'cancelled',
            phase: 'partially-completed',
            cancelledWorkIds: ['provider-1', 'render-1'],
            cleanupPendingAssetIds: [],
            releasedAssetIds: ['preview.wav'],
        });

        expect(providerCancel).toHaveBeenCalledOnce();
        expect(renderCancel).toHaveBeenCalledOnce();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get('run-cancel')).toMatchObject({
            phase: 'partially-completed',
            cancellation: {
                generation: 1,
                requestedAt: 120,
                consumerAcknowledgedAt: 120,
                transportAcknowledgedAt: 120,
                backendAcknowledgedAt: 120,
            },
            batches: [{ batchId: 'batch-pending', status: 'cancelled' }],
            committedWork: [
                { workId: 'batch-committed', receiptIdentity: 'receipt-committed', revertGroupId: 'undo-group-1' },
            ],
            workLeases: [
                { workId: 'provider-1', terminalState: 'cancelled' },
                { workId: 'render-1', terminalState: 'cancelled' },
                { workId: 'analysis-1', terminalState: 'cancelled' },
            ],
            temporaryAssets: [{ assetId: 'preview.wav', status: 'released' }],
        });
        expect(agentRunControls.get('run-cancel')?.committedReceipts).toEqual([
            { workId: 'batch-committed', receiptIdentity: 'receipt-committed', revertGroupId: 'undo-group-1' },
        ]);
        expect(
            agentRunWorkLease.settle({
                runId: 'run-cancel',
                workId: 'analysis-1',
                leaseId: analysisLease.leaseId,
                cancellationGeneration: analysisLease.cancellationGeneration,
                idempotencyKey: analysisLease.idempotencyKey,
                receiptIdentity: analysisLease.receiptIdentity,
                terminalState: 'completed',
                settledAt: 130,
            })
        ).toEqual({ status: 'stale' });
    });

    it('retains a receipt for a late durable owner effect without reanimating the cancelled run', async () => {
        createPlanningRun('run-late-effect');
        const commandLease = claimWork({
            runId: 'run-late-effect',
            workId: 'command-1',
            ownerKind: 'command',
            cleanupOwner: 'command-executor',
        });

        await cancelAgentRun({ runId: 'run-late-effect', reason: 'User cancelled', requestedAt: 120 });
        expect(
            agentRunWorkLease.settle({
                runId: 'run-late-effect',
                workId: 'command-1',
                leaseId: commandLease.leaseId,
                cancellationGeneration: commandLease.cancellationGeneration,
                idempotencyKey: commandLease.idempotencyKey,
                receiptIdentity: commandLease.receiptIdentity,
                terminalState: 'completed',
                settledAt: 130,
            })
        ).toEqual({ status: 'stale' });

        agentRunLifecycle.recordCommittedWork({
            runId: 'run-late-effect',
            workId: 'command-1',
            receiptIdentity: 'verified-late-receipt',
            revertGroupId: 'undo-late',
            completesRun: false,
            committedAt: 131,
        });

        expect(agentRunLifecycle.get('run-late-effect')).toMatchObject({
            phase: 'partially-completed',
            cancellation: { generation: 1 },
            committedWork: [
                { workId: 'command-1', receiptIdentity: 'verified-late-receipt', revertGroupId: 'undo-late' },
            ],
        });
    });

    it('leaves failed cleanup pending and prevents a second owner from claiming the same asset', async () => {
        createPlanningRun('run-cleanup-failure');
        agentRunLifecycle.registerTemporaryAsset({
            runId: 'run-cleanup-failure',
            assetId: 'temporary.wav',
            kind: 'render',
            cleanupOwner: 'render-worker',
            createdAt: 110,
        });
        registerAgentRunTemporaryAssetCleanup({
            runId: 'run-cleanup-failure',
            assetId: 'temporary.wav',
            cleanupOwner: 'render-worker',
            cleanup: () => {
                throw new Error('filesystem unavailable');
            },
        });
        expect(() =>
            registerAgentRunTemporaryAssetCleanup({
                runId: 'run-cleanup-failure',
                assetId: 'temporary.wav',
                cleanupOwner: 'other-worker',
                cleanup: vi.fn(),
            })
        ).toThrow('already has a cleanup owner');

        await expect(
            cancelAgentRun({ runId: 'run-cleanup-failure', reason: 'User cancelled', requestedAt: 120 })
        ).resolves.toMatchObject({
            status: 'cancelled',
            cleanupPendingAssetIds: ['temporary.wav'],
            releasedAssetIds: [],
        });
        expect(agentRunLifecycle.get('run-cleanup-failure')).toMatchObject({
            phase: 'cancelled',
            temporaryAssets: [{ assetId: 'temporary.wav', status: 'cleanup-pending' }],
            errors: [
                {
                    code: 'temporary-asset-cleanup-failed',
                    message: 'filesystem unavailable',
                    retriable: true,
                    workId: null,
                },
            ],
        });
    });
});
