import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultLibraryState, libraryStore } from '../../stores/libraryStore';
import { searchSamples } from '../searchSamples';

function seedLibrary(searchQuery = ''): void {
    libraryStore.set({
        ...defaultLibraryState,
        roots: [],
        samples: [],
        folderTrees: {},
        searchQuery,
    });
}

describe('searchSamples', () => {
    beforeEach(() => {
        seedLibrary();
    });

    afterEach(() => {
        seedLibrary();
    });

    it('should write the query into the SampleLibrary store', () => {
        searchSamples('kick drum');

        expect(libraryStore.value?.searchQuery).toBe('kick drum');
    });

    it('should overwrite a previous query', () => {
        seedLibrary('snare');

        searchSamples('808');

        expect(libraryStore.value?.searchQuery).toBe('808');
    });

    it('should not throw or mutate when the library store is cleared', () => {
        libraryStore.clear();

        expect(() => searchSamples('hat')).not.toThrow();
        expect(libraryStore.value).toBeNull();
    });
});
