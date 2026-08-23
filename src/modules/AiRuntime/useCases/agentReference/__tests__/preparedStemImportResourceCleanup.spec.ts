import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    completeDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'completed' }),
    prepareDurableCleanupRecovery: vi.fn().mockResolvedValue({ status: 'prepared' }),
    releaseDurableStagedAsset: vi.fn().mockResolvedValue({ status: 'released' }),
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        completeDurableCleanupRecovery: mocks.completeDurableCleanupRecovery,
        prepareDurableCleanupRecovery: mocks.prepareDurableCleanupRecovery,
        releaseDurableStagedAsset: mocks.releaseDurableStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
    }),
}));

import { agentRunLifecycle } from '../../agentRunLifecycle';
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
});
