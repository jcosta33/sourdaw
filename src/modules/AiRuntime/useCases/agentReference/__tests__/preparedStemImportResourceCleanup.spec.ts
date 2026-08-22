import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    releasePreviewAudioBuffer: vi.fn(),
    releaseStagedAssets: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    releasePreviewAudioBuffer: mocks.releasePreviewAudioBuffer,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        releaseStagedAssets: mocks.releaseStagedAssets,
    }),
}));

import { agentRunLifecycle } from '../../agentRunLifecycle';
import { deleteAgentRunArtifacts } from '../../deleteAgentRunArtifacts';
import { createStemImportConfirmationResourceLease } from '../createStemImportConfirmationResourceLease';
import { discardPreparedStemImportResources } from '../discardPreparedStemImportResources';
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
        mocks.releaseStagedAssets.mockResolvedValue({
            status: 'released',
            releases: [
                {
                    status: 'released',
                    leaseId: 'staged-asset-1',
                    hash: 'sha256:asset-1',
                    assetRemoved: true,
                    ownerRetained: false,
                },
            ],
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
        expect(mocks.releaseStagedAssets).toHaveBeenCalledExactlyOnceWith([
            { leaseId: 'staged-asset-1', expectedHash: 'sha256:asset-1' },
        ]);
        expect(agentRunLifecycle.get('stem-delete')?.temporaryAssets).toEqual([]);
    });

    it('keeps cleanup ownership when durable lease release returns a typed failure', async () => {
        mocks.releaseStagedAssets.mockResolvedValue({ status: 'failed', reason: 'lease-hash-mismatch' });
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
        expect(mocks.releaseStagedAssets).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-committed')?.temporaryAssets).toEqual([]);
    });

    it('retries a confirmation lease whose first hash-bound durable release is rejected', async () => {
        mocks.releaseStagedAssets
            .mockResolvedValueOnce({ status: 'failed', reason: 'missing-asset' })
            .mockResolvedValueOnce({
                status: 'released',
                releases: [
                    {
                        status: 'released',
                        leaseId: 'staged-asset-1',
                        hash: 'sha256:asset-1',
                        assetRemoved: true,
                        ownerRetained: false,
                    },
                ],
            });
        const lease = createStemImportConfirmationResourceLease([
            { type: 'importStemSet', payload: { stems } },
        ] as never);
        if (!lease) {
            throw new Error('Expected a stem import confirmation resource lease');
        }

        await expect(lease.release()).rejects.toThrow('Could not release staged stem assets: missing-asset');
        await expect(lease.release()).resolves.toBeUndefined();

        expect(mocks.releaseStagedAssets).toHaveBeenCalledTimes(2);
    });

    it('keeps every decoded buffer executable when atomic staged-lease cleanup rejects', async () => {
        const multipleStems = [
            stems[0],
            {
                audioBufferId: 'decoded-buffer-2',
                assetLeaseId: 'staged-asset-2',
                assetHash: 'sha256:asset-2',
            },
        ];
        mocks.releaseStagedAssets.mockResolvedValueOnce({ status: 'failed', reason: 'lease-hash-mismatch' });

        await expect(discardPreparedStemImportResources(multipleStems)).rejects.toThrow(
            'Could not release staged stem assets: lease-hash-mismatch'
        );

        expect(mocks.releaseStagedAssets).toHaveBeenCalledExactlyOnceWith([
            { leaseId: 'staged-asset-1', expectedHash: 'sha256:asset-1' },
            { leaseId: 'staged-asset-2', expectedHash: 'sha256:asset-2' },
        ]);
        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
    });
});
