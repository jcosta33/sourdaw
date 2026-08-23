import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    importStemSetToProject: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    promoteDurableStagedAsset: vi.fn(),
    promoteStagedAsset: vi.fn(),
    publishTrackAdded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        promoteDurableStagedAsset: mocks.promoteDurableStagedAsset,
        promoteStagedAsset: mocks.promoteStagedAsset,
    }),
}));
vi.mock('#/modules/MIDI/useCases', () => ({ serializeMidiStateForClips: vi.fn(() => ({})) }));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
}));
vi.mock('../../../useCases/publishTrackAdded', () => ({ publishTrackAdded: mocks.publishTrackAdded }));
vi.mock('../../../useCases/stemImport/importStemSetToProject', () => ({
    importStemSetToProject: mocks.importStemSetToProject,
}));
vi.mock('../../../useCases/stemImport/isImportedStemSetApplied', () => ({
    isImportedStemSetApplied: vi.fn(() => false),
}));

import { handleImportStemSet } from '../handleImportStemSet';

describe('handleImportStemSet durable asset promotion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.importStemSetToProject.mockReturnValue({
            folder: { id: 'folder-1', name: 'Stems', kind: 'folder', clips: [] },
            importedTracks: [{ id: 'track-1', name: 'Kick', kind: 'audio', clips: [] }],
        });
    });

    it('awaits a hash-bound promotion and retries a failed outcome', async () => {
        const action: Parameters<typeof handleImportStemSet.execute>[0] = {
            type: 'importStemSet',
            payload: {
                selectionId: 'selection-1',
                groupName: 'Stems',
                projectTempo: 120,
                folderId: 'folder-1',
                stems: [
                    {
                        stemId: 'stem-1',
                        sourceName: 'kick.wav',
                        role: 'kick',
                        sourceTempo: 120,
                        durationSeconds: 1,
                        sourceBytes: 4,
                        decodedBytes: 16,
                        audioBufferId: 'buffer-1',
                        assetHash: 'hash-kick',
                        assetLeaseId: 'lease-kick',
                        trackId: 'track-1',
                        trackName: 'Kick',
                        trackGain: 1,
                        trackPan: 0,
                        clipId: 'clip-1',
                    },
                ],
            },
        };
        mocks.promoteDurableStagedAsset
            .mockResolvedValueOnce({ status: 'failed', reason: 'lease-hash-mismatch' })
            .mockResolvedValueOnce({ status: 'promoted', leaseId: 'lease-kick', hash: 'hash-kick' });
        const result = await handleImportStemSet.execute(action);

        await expect(result?.afterCommit?.()).rejects.toThrow('lease-hash-mismatch');
        await expect(result?.afterCommit?.()).resolves.toBeUndefined();

        expect(mocks.promoteDurableStagedAsset).toHaveBeenCalledTimes(2);
        expect(mocks.promoteDurableStagedAsset).toHaveBeenNthCalledWith(1, 'lease-kick', 'hash-kick');
        expect(mocks.promoteDurableStagedAsset).toHaveBeenNthCalledWith(2, 'lease-kick', 'hash-kick');
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
    });
});
