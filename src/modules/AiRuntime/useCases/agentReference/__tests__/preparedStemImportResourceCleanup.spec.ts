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

    it.each(['discard', 'transfer'] as const)(
        'retains protected stems after cancellation until explicit %s recovery settles ownership once',
        async (recovery) => {
            const runId = `stem-protected-${recovery}`;
            agentRunLifecycle.create({
                runId,
                request: 'Import stems.',
                mode: 'plan',
                createdRevision: 'r1',
            });
            preparedStemImportResources.register({ runId, stems });
            preparedStemImportResources.protect({ runId, stems });

            await expect(
                agentRunCancellation.cancel({ runId, reason: 'Abort during post-commit effects.' })
            ).resolves.toMatchObject({
                status: 'cancelled',
                cleanupPendingAssetIds: ['decoded-buffer-1'],
                releasedAssetIds: [],
            });

            expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([
                expect.objectContaining({ assetId: 'decoded-buffer-1', status: 'cleanup-pending' }),
            ]);
            await expect(deleteAgentRunArtifacts(runId)).resolves.toEqual({
                status: 'partial',
                deletedAssetIds: [],
                failedAssetIds: ['decoded-buffer-1'],
            });
            expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();

            if (recovery === 'discard') {
                await preparedStemImportResources.discard({ runId, stems });
                expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledExactlyOnceWith('decoded-buffer-1');
                expect(mocks.releaseStagedAsset).toHaveBeenCalledExactlyOnceWith('staged-asset-1');
            } else {
                preparedStemImportResources.release({ runId, stems });
                expect(mocks.releasePreviewAudioBuffer).not.toHaveBeenCalled();
                expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
            }

            expect(agentRunLifecycle.get(runId)?.temporaryAssets).toEqual([]);
            await expect(deleteAgentRunArtifacts(runId)).resolves.toEqual({
                status: 'completed',
                deletedAssetIds: [],
                failedAssetIds: [],
            });
            expect(mocks.releasePreviewAudioBuffer).toHaveBeenCalledTimes(recovery === 'discard' ? 1 : 0);
            expect(mocks.releaseStagedAsset).toHaveBeenCalledTimes(recovery === 'discard' ? 1 : 0);
        }
    );
});
