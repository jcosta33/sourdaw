import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { setTagFilter } from '../setTagFilter';

function seed(activeFilters: string[] = []): void {
    sampleDatabaseStore.set({
        samples: [],
        searchQuery: '',
        activeFilters,
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

describe('setTagFilter', () => {
    beforeEach(() => seed());
    afterEach(() => sampleDatabaseStore.clear());

    it('should replace the active tag filters', () => {
        setTagFilter(['drum', 'kick']);
        expect(sampleDatabaseStore.value?.activeFilters).toEqual(['drum', 'kick']);
    });

    it('should clear the filters when given an empty array', () => {
        seed(['drum']);
        setTagFilter([]);
        expect(sampleDatabaseStore.value?.activeFilters).toEqual([]);
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => setTagFilter(['drum'])).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
