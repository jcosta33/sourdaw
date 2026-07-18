import { afterEach, describe, expect, it } from 'vitest';

import { createTestSample } from '../../../__tests__/createTestSample';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { getSampleCount } from '../getSampleCount';

function seed(count: number): void {
    sampleDatabaseStore.set({
        samples: Array.from({ length: count }, (_, i) => createTestSample({ id: `s${i}` })),
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

describe('getSampleCount', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('should return the number of stored samples', () => {
        seed(3);
        expect(getSampleCount()).toBe(3);
    });

    it('should return zero for an empty library', () => {
        seed(0);
        expect(getSampleCount()).toBe(0);
    });

    it('should return zero when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(getSampleCount()).toBe(0);
    });
});
