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
import { agentRunCancellation } from '../../cancelAgentRun';
import { deleteAgentRunArtifacts } from '../../deleteAgentRunArtifacts';
import { preparedStemImportResources } from '../registerPreparedStemImportResources';

const stems = [
    {
        audioBufferId: 'decoded-buffer-1',
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
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1');
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
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-committed')?.temporaryAssets).toEqual([]);
    });

    it('discards uncommitted stem resources and clears their run-owned records', async () => {
        agentRunLifecycle.create({
            runId: 'stem-discarded',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-discarded', stems });

        await preparedStemImportResources.discard({ runId: 'stem-discarded', stems });

        expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
        expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1');
        expect(agentRunLifecycle.get('stem-discarded')?.temporaryAssets).toEqual([]);

        expect(() => preparedStemImportResources.register({ runId: 'stem-discarded', stems })).not.toThrow();
        preparedStemImportResources.release({ runId: 'stem-discarded', stems });
        expect(agentRunLifecycle.get('stem-discarded')?.temporaryAssets).toEqual([]);
    });

    it('protects commit-prepared stems from cancellation cleanup until ownership transfers', async () => {
        agentRunLifecycle.create({
            runId: 'stem-protected',
            request: 'Import stems.',
            mode: 'plan',
            createdRevision: 'r1',
        });
        preparedStemImportResources.register({ runId: 'stem-protected', stems });
        preparedStemImportResources.protect({ runId: 'stem-protected', stems });

        await agentRunCancellation.cancel({ runId: 'stem-protected', reason: 'Abort during post-commit effects.' });

        expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('stem-protected')?.temporaryAssets).toEqual([
            expect.objectContaining({ assetId: 'decoded-buffer-1', status: 'released' }),
        ]);

        preparedStemImportResources.release({ runId: 'stem-protected', stems });
        expect(agentRunLifecycle.get('stem-protected')?.temporaryAssets).toEqual([]);
    });
});
