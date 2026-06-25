import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSample } from '../../../__tests__/createTestSample';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { toggleFavorite } from '../toggleFavorite';

function seed(): void {
    sampleDatabaseStore.set({
        samples: [createTestSample({ id: 's1', favorite: false }), createTestSample({ id: 's2', favorite: true })],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

function favOf(id: string): boolean | undefined {
    return sampleDatabaseStore.value?.samples.find((s) => s.id === id)?.favorite;
}

describe('toggleFavorite', () => {
    beforeEach(seed);
    afterEach(() => sampleDatabaseStore.clear());

    it('should flip a non-favourite to favourite', () => {
        toggleFavorite('s1');
        expect(favOf('s1')).toBe(true);
    });

    it('should flip a favourite back to non-favourite', () => {
        toggleFavorite('s2');
        expect(favOf('s2')).toBe(false);
    });

    it('should leave other samples untouched', () => {
        toggleFavorite('s1');
        expect(favOf('s2')).toBe(true);
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => toggleFavorite('s1')).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
