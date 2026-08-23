import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cancelDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    commitDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'committed' }),
    completeDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
    completeDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
    prepareDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
    prepareDurablePromotionRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
    releaseDurableStagedAsset: vi.fn().mockResolvedValue({ status: 'released' }),
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
    transitionDurablePromotionRecoveryToCleanup: vi.fn().mockResolvedValue({ status: 'prepared' }),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        cancelDurablePromotionRecovery: mocks.cancelDurablePromotionRecovery,
        commitDurablePromotionRecovery: mocks.commitDurablePromotionRecovery,
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
        completeDurablePromotionRecovery: mocks.completeDurablePromotionRecovery,
        prepareDurableCleanupRecovery: mocks.prepareDurableCleanupRecovery,
        prepareDurablePromotionRecovery: mocks.prepareDurablePromotionRecovery,
        releaseDurableStagedAsset: mocks.releaseDurableStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
        transitionDurablePromotionRecoveryToCleanup: mocks.transitionDurablePromotionRecoveryToCleanup,
    }),
}));

import { agentRunLifecycle } from '../../agentRunLifecycle';
import { agentRunCancellation } from '../../cancelAgentRun';
import { deleteAgentRunArtifacts } from '../../deleteAgentRunArtifacts';
import { createStemImportConfirmationResourceLease } from '../createStemImportConfirmationResourceLease';
import { preparedStemImportCleanup } from '../discardPreparedStemImportResources';
import { preparedStemImportResources } from '../registerPreparedStemImportResources';

const stems = [
    {
        audioBufferId: 'decoded-buffer-1',
        assetHash: 'hash-staged-asset-1',
        assetLeaseId: 'staged-asset-1',
    },
] as never;

describe('prepared stem import resource cleanup', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        vi.clearAllMocks();
    });

    it('deletes decoded audio and journals staged cleanup through the registered production owner', async () => {
        agentRunLifecycle.create({
            runId: 'stem-delete',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-delete', stems });

        await expect(deleteAgentRunArtifacts('stem-delete')).resolves.toEqual({
            status: 'completed',
            deletedAssetIds: ['decoded-buffer-1'],
            failedAssetIds: [],
        });
        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]', [
            { leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' },
        ]);
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]');
        expect(mocks.releaseDurableStagedAsset).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-delete')?.temporaryAssets).toEqual([]);
    });

    it('hands committed stem resources to the project without deleting them later', async () => {
        agentRunLifecycle.create({
            runId: 'stem-committed',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-committed', stems });

        preparedStemImportResources.release({ runId: 'stem-committed', stems });

        await expect(deleteAgentRunArtifacts('stem-committed')).resolves.toEqual({
            status: 'completed',
            deletedAssetIds: [],
            failedAssetIds: [],
        });
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseDurableStagedAsset).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-committed')?.temporaryAssets).toEqual([]);
    });

    it('keeps failed confirmation cleanup executable until the durable lease releases', async () => {
        mocks.completeDurableCleanupRecovery
            .mockResolvedValueOnce({ status: 'failed', reason: 'transaction-aborted' })
            .mockResolvedValueOnce({ status: 'completed' });
        const lease = createStemImportConfirmationResourceLease([
            { type: 'importStemSet', payload: { stems } },
        ] as never);

        await expect(lease?.release()).rejects.toThrow('cleanup remains pending');
        await expect(lease?.release()).resolves.toBeUndefined();

        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledTimes(2);
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledTimes(2);
        expect(mocks.releaseDurableStagedAsset).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });

    it('makes prepared promotion executable only after the confirmation supplies commit proof', async () => {
        const lease = createStemImportConfirmationResourceLease(
            [{ type: 'importStemSet', payload: { stems } }] as never,
            'stem-promotion:receipt-bound'
        );

        await lease?.prepareForCommit?.();
        expect(mocks.commitDurablePromotionRecovery).not.toHaveBeenCalled();
        expect(mocks.completeDurablePromotionRecovery).not.toHaveBeenCalled();

        await lease?.commit?.();
        await lease?.retain?.();

        expect(mocks.prepareDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith('stem-promotion:receipt-bound', [
            { leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' },
        ]);
        expect(mocks.commitDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith('stem-promotion:receipt-bound');
        expect(mocks.completeDurablePromotionRecovery).toHaveBeenCalledExactlyOnceWith('stem-promotion:receipt-bound');
        expect(mocks.prepareDurablePromotionRecovery.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.commitDurablePromotionRecovery.mock.invocationCallOrder[0]!
        );
        expect(mocks.commitDurablePromotionRecovery.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.completeDurablePromotionRecovery.mock.invocationCallOrder[0]!
        );
    });

    it('uses one cleanup owner when run cancellation races confirmation cancellation', async () => {
        agentRunLifecycle.create({
            runId: 'stem-concurrent-cancel',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-concurrent-cancel', stems });
        const lease = createStemImportConfirmationResourceLease(
            [{ type: 'importStemSet', payload: { stems } }] as never,
            'stem-promotion:concurrent-cancel',
            'stem-concurrent-cancel'
        );
        await lease?.prepareForCommit?.();

        await Promise.all([
            agentRunCancellation.cancel({ runId: 'stem-concurrent-cancel', reason: 'User cancelled.' }),
            lease?.release(),
        ]);
        await vi.waitFor(() => expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalled());

        expect(mocks.prepareDurableCleanupRecovery).not.toHaveBeenCalled();
        expect(mocks.transitionDurablePromotionRecoveryToCleanup).toHaveBeenCalledExactlyOnceWith(
            'stem-promotion:concurrent-cancel',
            [{ leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' }]
        );
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledOnce();
        expect(agentRunLifecycle.get('stem-concurrent-cancel')?.temporaryAssets).toEqual([]);
    });

    it('persists exact cleanup ownership before a best-effort terminal path may swallow release failure', async () => {
        mocks.completeDurableCleanupRecovery.mockResolvedValueOnce({
            status: 'failed',
            reason: 'transaction-aborted',
        });

        await expect(preparedStemImportCleanup.discardBestEffort(stems)).resolves.toBeUndefined();

        expect(mocks.prepareDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]', [
            { leaseId: 'staged-asset-1', expectedHash: 'hash-staged-asset-1' },
        ]);
        expect(mocks.completeDurableCleanupRecovery).toHaveBeenCalledExactlyOnceWith('stem-cleanup:["staged-asset-1"]');
    });

    it('does not swallow failure to acquire durable cleanup ownership', async () => {
        mocks.prepareDurableCleanupRecovery.mockResolvedValueOnce({
            status: 'failed',
            reason: 'owner-handoff-conflict',
        });

        await expect(preparedStemImportCleanup.discardBestEffort(stems)).rejects.toThrow(
            'Could not preserve prepared stem cleanup'
        );

        expect(mocks.completeDurableCleanupRecovery).not.toHaveBeenCalled();
    });

    it('preserves the primary failure when durable cleanup ownership cannot be acquired', async () => {
        mocks.prepareDurableCleanupRecovery.mockResolvedValueOnce({
            status: 'failed',
            reason: 'owner-handoff-conflict',
        });
        const primary = new Error('stem decoding failed');

        const result = preparedStemImportCleanup.discardBestEffort(stems, undefined, primary);

        await expect(result).rejects.toThrow('stem decoding failed');
        await expect(result).rejects.toMatchObject({ errors: [primary, expect.any(Error)] });
    });
});
