import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type SampleCategory } from '../../../models/SampleEntry';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { setCategoryFilter } from '../setCategoryFilter';

function seed(categoryFilter: SampleCategory | null = null): void {
    sampleDatabaseStore.set({
        samples: [],
        searchQuery: '',
        activeFilters: [],
        categoryFilter,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

describe('setCategoryFilter', () => {
    beforeEach(() => seed());
    afterEach(() => sampleDatabaseStore.clear());

    it('should set the active category', () => {
        setCategoryFilter('kicks');
        expect(sampleDatabaseStore.value?.categoryFilter).toBe('kicks');
    });

    it('should clear the category when given null', () => {
        seed('kicks');
        setCategoryFilter(null);
        expect(sampleDatabaseStore.value?.categoryFilter).toBeNull();
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => setCategoryFilter('kicks')).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
