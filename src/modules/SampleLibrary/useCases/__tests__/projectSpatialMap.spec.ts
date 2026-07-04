import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type SampleRecord } from '../../models/LibraryTypes';
import { embeddingStore } from '../../stores/embeddingStore';
import { libraryStore } from '../../stores/libraryStore';
import { projectSpatialMap } from '../projectSpatialMap';

const mocks = vi.hoisted(() => ({
    persist_samples: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('../../repositories/libraryPersistence/persistSamples', () => ({
    persistSamples: mocks.persist_samples,
}));

function create_sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
    return {
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
        ...overrides,
    };
}

function install_library(samples: SampleRecord[]): void {
    libraryStore.set({
        samples,
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
}

describe('projectSpatialMap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.persist_samples.mockReset();
        mocks.persist_samples.mockResolvedValue(undefined);
        embeddingStore.set({
            embeddings: new Map([['s1', new Float32Array([1, 1])]]),
            modelStatus: 'ready',
        });
        install_library([create_sample()]);
    });

    it('should assign coordinates based on embeddings and persist the updated samples', async () => {
        await projectSpatialMap();

        const sample = libraryStore.value?.samples[0];
        expect(sample?.spatialMap).toBeDefined();
        expect(typeof sample?.spatialMap?.x).toBe('number');
        expect(typeof sample?.spatialMap?.y).toBe('number');
        expect(mocks.persist_samples).toHaveBeenCalledTimes(1);
    });

    it('should not persist when embeddings are unavailable', async () => {
        embeddingStore.set(null);

        await projectSpatialMap();

        expect(mocks.persist_samples).not.toHaveBeenCalled();
    });

    it('should not persist when library state is unavailable', async () => {
        libraryStore.set(null);

        await projectSpatialMap();

        expect(mocks.persist_samples).not.toHaveBeenCalled();
    });

    it('should not persist when no samples receive coordinates', async () => {
        embeddingStore.set({
            embeddings: new Map([['other', new Float32Array([1, 1])]]),
            modelStatus: 'ready',
        });

        await projectSpatialMap();

        expect(libraryStore.value?.samples[0]?.spatialMap).toBeUndefined();
        expect(mocks.persist_samples).not.toHaveBeenCalled();
    });

    it('should not persist when samples already have coordinates', async () => {
        install_library([create_sample({ spatialMap: { x: 0.1, y: 0.2 } })]);

        await projectSpatialMap();

        expect(libraryStore.value?.samples[0]?.spatialMap).toEqual({ x: 0.1, y: 0.2 });
        expect(mocks.persist_samples).not.toHaveBeenCalled();
    });
});
