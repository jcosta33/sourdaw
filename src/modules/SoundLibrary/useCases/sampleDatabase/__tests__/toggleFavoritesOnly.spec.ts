import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { toggleFavoritesOnly } from '../toggleFavoritesOnly';

function seed(favoritesOnly = false): void {
    sampleDatabaseStore.set({
        samples: [],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly,
    });
}

describe('toggleFavoritesOnly', () => {
    beforeEach(() => seed());
    afterEach(() => sampleDatabaseStore.clear());

    it('should turn the favourites-only flag on', () => {
        toggleFavoritesOnly();
        expect(sampleDatabaseStore.value?.favoritesOnly).toBe(true);
    });

    it('should turn the favourites-only flag back off', () => {
        seed(true);
        toggleFavoritesOnly();
        expect(sampleDatabaseStore.value?.favoritesOnly).toBe(false);
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => toggleFavoritesOnly()).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
