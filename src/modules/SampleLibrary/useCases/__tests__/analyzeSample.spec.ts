import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeSample } from '#/modules/SampleLibrary/useCases/analyzeSample';
import { libraryStore } from '#/modules/SampleLibrary/stores/libraryStore';
import { performMusicalAnalysis } from '#/modules/SampleLibrary/services/analysisService';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

vi.mock('../../services/analysisService', () => ({
    performMusicalAnalysis: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { get: vi.fn() },
}));

describe('analyzeSample', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        libraryStore.set({
            samples: [
                { id: 's1', displayName: 'S1', sync: { status: 'indexed', exists: true }, format: {}, tags: [], favorite: false, libraryRootId: 'r1', relativePath: 'p1', folder: '', ext: 'wav' }
            ],
            roots: [],
            folderTrees: {},
            activeRootId: null,
            currentFolder: null,
            searchQuery: '',
            tagFilter: null,
            favoritesOnly: false,
            sortField: 'name',
            sortDirection: 'asc',
            scanning: false,
            scanProgress: 0,
        });
    });

    it('should update sample status and metadata on success', async () => {
        vi.mocked(audioBufferCache.get).mockReturnValue({
            length: 44100,
            sampleRate: 44100,
            getChannelData: () => new Float32Array(100),
        } as unknown as AudioBuffer);
        vi.mocked(performMusicalAnalysis).mockResolvedValue({
            bpm: 125,
            key: 'Cm',
            descriptors: { rms: 0.1 },
        });

        await analyzeSample('s1');

        const sample = libraryStore.value?.samples[0];
        expect(sample?.sync.status).toBe('analyzed');
        expect(sample?.analysis?.bpm).toBe(125);
        expect(sample?.analysis?.key).toBe('Cm');
    });
});
