import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { searchSamples } from '../searchSamples';

function seed(searchQuery = ''): void {
    sampleDatabaseStore.set({
        samples: [],
        searchQuery,
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

describe('searchSamples', () => {
    beforeEach(() => seed());
    afterEach(() => sampleDatabaseStore.clear());

    it('should write the query into the store', () => {
        searchSamples('kick');
        expect(sampleDatabaseStore.value?.searchQuery).toBe('kick');
    });

    it('should overwrite a previous query', () => {
        seed('old');
        searchSamples('new');
        expect(sampleDatabaseStore.value?.searchQuery).toBe('new');
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => searchSamples('kick')).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
