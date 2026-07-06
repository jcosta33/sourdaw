import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { performMusicalAnalysis } from '../../services/analysisService';
import { libraryStore } from '../../stores/libraryStore';
import { analyzeSample } from '../analyzeSample';

const mocks = vi.hoisted(() => ({
    persist_samples: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    logger_error: vi.fn(),
}));

vi.mock('../../services/analysisService', () => ({
    performMusicalAnalysis: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(),
}));

vi.mock('../../repositories/libraryPersistence/persistSamples', () => ({
    persistSamples: mocks.persist_samples,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.logger_error },
}));

describe('analyzeSample', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getCachedAudioBuffer).mockReset();
        vi.mocked(performMusicalAnalysis).mockReset();
        mocks.persist_samples.mockReset();
        mocks.persist_samples.mockResolvedValue(undefined);
        libraryStore.set({
            samples: [
                {
                    id: 's1',
                    displayName: 'S1',
                    sync: { status: 'indexed', exists: true },
                    format: {},
                    tags: [],
                    favorite: false,
                    libraryRootId: 'r1',
                    relativePath: 'p1',
                    folder: '',
                    ext: 'wav',
                },
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

    function install_cached_buffer(): void {
        vi.mocked(getCachedAudioBuffer).mockReturnValue({
            length: 44100,
            sampleRate: 44100,
            getChannelData: () => new Float32Array(100),
        } as unknown as AudioBuffer);
    }

    function resolve_analysis(): void {
        vi.mocked(performMusicalAnalysis).mockResolvedValue({
            bpm: 125,
            key: 'Cm',
            descriptors: { rms: 0.1 },
        });
    }

    it('should update sample status and metadata on success', async () => {
        install_cached_buffer();
        resolve_analysis();

        await analyzeSample('s1');

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 's1' });
        const sample = libraryStore.value?.samples[0];
        expect(sample?.sync.status).toBe('analyzed');
        expect(sample?.analysis?.bpm).toBe(125);
        expect(sample?.analysis?.key).toBe('Cm');
    });

    it('should persist after writing analyzed metadata so the edit survives reload', async () => {
        install_cached_buffer();
        resolve_analysis();
        mocks.persist_samples.mockImplementation(() => {
            expect(libraryStore.value?.samples[0]?.sync.status).toBe('analyzed');
            expect(libraryStore.value?.samples[0]?.analysis?.bpm).toBe(125);
            return Promise.resolve();
        });

        await analyzeSample('s1');

        expect(mocks.persist_samples).toHaveBeenCalledTimes(1);
    });

    it('should not persist when the sample cannot be analyzed', async () => {
        libraryStore.set(null);

        await analyzeSample('s1');

        expect(performMusicalAnalysis).not.toHaveBeenCalled();
        expect(mocks.persist_samples).not.toHaveBeenCalled();

        libraryStore.set({
            samples: [
                {
                    id: 's1',
                    displayName: 'S1',
                    sync: { status: 'indexed', exists: true },
                    format: {},
                    tags: [],
                    favorite: false,
                    libraryRootId: 'r1',
                    relativePath: 'p1',
                    folder: '',
                    ext: 'wav',
                },
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

        await analyzeSample('missing');
        expect(mocks.persist_samples).not.toHaveBeenCalled();

        const state = libraryStore.value;
        if (!state) {
            throw new Error('Expected library state');
        }
        const sample = state.samples[0];
        if (!sample) {
            throw new Error('Expected sample');
        }

        libraryStore.set({
            ...state,
            samples: [{ ...sample, sync: { status: 'analyzed', exists: true } }],
        });
        install_cached_buffer();

        await analyzeSample('s1');

        expect(performMusicalAnalysis).not.toHaveBeenCalled();
        expect(mocks.persist_samples).not.toHaveBeenCalled();
    });

    it('should not persist when the audio buffer is unavailable', async () => {
        await analyzeSample('s1');

        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 's1' });
        expect(performMusicalAnalysis).not.toHaveBeenCalled();
        expect(mocks.persist_samples).not.toHaveBeenCalled();
    });

    it('should log analysis errors without persisting', async () => {
        install_cached_buffer();
        const error = new Error('analysis failed');
        vi.mocked(performMusicalAnalysis).mockRejectedValue(error);

        await analyzeSample('s1');

        expect(mocks.logger_error).toHaveBeenCalledWith(error);
        expect(mocks.persist_samples).not.toHaveBeenCalled();
    });
});
