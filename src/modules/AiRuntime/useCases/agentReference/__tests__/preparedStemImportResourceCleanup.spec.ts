import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAsset: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({ releaseStagedAsset: mocks.releaseStagedAsset }),
}));

import { agentRunLifecycle } from '../../agentRunLifecycle';
import { deleteAgentRunArtifacts } from '../../deleteAgentRunArtifacts';
import { preparedStemImportResources } from '../registerPreparedStemImportResources';

const stems = [
    {
        audioBufferId: 'decoded-buffer-1',
        assetLeaseId: 'staged-asset-1',
        assetHash: 'sha256:asset-1',
    },
] as never;

describe('prepared stem import resource cleanup', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        vi.clearAllMocks();
        mocks.releaseStagedAsset.mockResolvedValue({
            status: 'released',
            leaseId: 'staged-asset-1',
            hash: 'sha256:asset-1',
            assetRemoved: true,
            ownerRetained: false,
        });
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
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1', 'sha256:asset-1');
        expect(agentRunLifecycle.get('stem-delete')?.temporaryAssets).toEqual([]);
    });

    it('keeps cleanup ownership when durable lease release returns a typed failure', async () => {
        mocks.releaseStagedAsset.mockResolvedValue({ status: 'failed', reason: 'lease-hash-mismatch' });
        agentRunLifecycle.create({
            runId: 'stem-release-failure',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-release-failure', stems });

        await expect(deleteAgentRunArtifacts('stem-release-failure')).resolves.toEqual({
            status: 'partial',
            deletedAssetIds: [],
            failedAssetIds: ['decoded-buffer-1'],
        });
        expect(agentRunLifecycle.get('stem-release-failure')?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'decoded-buffer-1', status: 'cleanup-pending' }),
        ]);
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
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-committed')?.temporaryAssets).toEqual([]);
    });
});
