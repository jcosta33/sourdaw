import { describe, it, expect, beforeEach } from 'vitest';

import { embeddingStore } from '#/modules/SampleLibrary/stores/embeddingStore';
import { libraryStore } from '#/modules/SampleLibrary/stores/libraryStore';
import { projectSpatialMap } from '#/modules/SampleLibrary/useCases/projectSpatialMap';

describe('projectSpatialMap', () => {
    beforeEach(() => {
        embeddingStore.set({
            embeddings: new Map([['s1', new Float32Array([1, 1])]]),
            modelStatus: 'ready',
        });
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

    it('should assign coordinates based on embeddings', () => {
        projectSpatialMap();
        const sample = libraryStore.value?.samples[0];
        expect(sample?.spatialMap).toBeDefined();
        expect(typeof sample?.spatialMap?.x).toBe('number');
        expect(typeof sample?.spatialMap?.y).toBe('number');
    });
});
