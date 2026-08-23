import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    releaseDurableStagedAsset: vi.fn().mockResolvedValue({ status: 'released' }),
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        releaseDurableStagedAsset: mocks.releaseDurableStagedAsset,
        releaseStagedAsset: mocks.releaseStagedAsset,
    }),
}));

import { agentRunLifecycle } from '../../agentRunLifecycle';
import { deleteAgentRunArtifacts } from '../../deleteAgentRunArtifacts';
import { createStemImportConfirmationResourceLease } from '../createStemImportConfirmationResourceLease';
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

    it('deletes decoded audio and staged assets through the registered production owner before metadata removal', async () => {
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
        expect(mocks.releaseDurableStagedAsset).toHaveBeenCalledExactlyOnceWith(
            'staged-asset-1',
            'hash-staged-asset-1'
        );
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
        mocks.releaseDurableStagedAsset
            .mockResolvedValueOnce({ status: 'failed', reason: 'transaction-aborted' })
            .mockResolvedValueOnce({ status: 'released' });
        const lease = createStemImportConfirmationResourceLease([
            { type: 'importStemSet', payload: { stems } },
        ] as never);

        await expect(lease?.release()).rejects.toThrow('transaction-aborted');
        await expect(lease?.release()).resolves.toBeUndefined();

        expect(mocks.releaseDurableStagedAsset).toHaveBeenCalledTimes(2);
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
    });
});
