import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAssetTransfer: vi.fn(),
    importStemSetToProject: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    publishTrackAdded: vi.fn(),
}));

vi.mock('#/modules/Collaboration/useCases', () => ({ getAssetTransfer: mocks.getAssetTransfer }));
vi.mock('../../../useCases/stemImport/importStemSetToProject', () => ({
    importStemSetToProject: mocks.importStemSetToProject,
}));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));
vi.mock('../../../useCases/publishTrackAdded', () => ({ publishTrackAdded: mocks.publishTrackAdded }));

import { handleImportStemSet } from '../handleImportStemSet';

const action: Parameters<typeof handleImportStemSet.execute>[0] = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-1',
        groupName: 'Imported Stems',
        projectTempo: 120,
        folderId: 'folder-1',
        stems: [
            {
                stemId: 'stem-1',
                sourceName: 'kick.wav',
                role: 'kick',
                sourceTempo: 120,
                durationSeconds: 1,
                sourceBytes: 1,
                decodedBytes: 4,
                audioBufferId: 'buffer-1',
                assetHash: 'sha256:kick',
                assetLeaseId: 'asset-stage-kick',
                trackId: 'track-1',
                trackName: 'Kick',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-1',
            },
        ],
    },
};

describe('handleImportStemSet staged asset reconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.importStemSetToProject.mockReturnValue({
            folder: { id: 'folder-1', name: 'Imported Stems', kind: 'folder' },
            importedTracks: [{ id: 'track-1', name: 'Kick', kind: 'audio' }],
        });
    });

    it('awaits hash-bound promotion and rejects afterCommit when durable promotion fails', async () => {
        const promoteStagedAsset = vi.fn().mockResolvedValue({ status: 'failed', reason: 'lease-hash-mismatch' });
        mocks.getAssetTransfer.mockReturnValue({ promoteStagedAsset });

        const result = handleImportStemSet.execute(action);
        if (!result || result instanceof Promise || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected an imported stem write with afterCommit reconciliation');
        }

        await expect(result.afterCommit()).rejects.toThrow(/lease-hash-mismatch/u);
        expect(promoteStagedAsset).toHaveBeenCalledExactlyOnceWith('asset-stage-kick', 'sha256:kick');
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledTimes(1);
        expect(mocks.publishTrackAdded).toHaveBeenCalledTimes(2);
    });

    it('rejects a staged lease with no expected asset hash instead of silently skipping promotion', async () => {
        const promoteStagedAsset = vi.fn();
        mocks.getAssetTransfer.mockReturnValue({ promoteStagedAsset });
        const missingHashAction = {
            ...action,
            payload: {
                ...action.payload,
                stems: action.payload.stems.map(({ assetHash: _assetHash, ...stem }) => stem),
            },
        };

        const result = handleImportStemSet.execute(missingHashAction);
        if (!result || result instanceof Promise || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected an imported stem write with afterCommit reconciliation');
        }

        await expect(result.afterCommit()).rejects.toThrow(/has no expected asset hash/u);
        expect(promoteStagedAsset).not.toHaveBeenCalled();
    });
});
