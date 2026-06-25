import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type SampleDatabaseState } from '../../../models/SampleEntry';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { setSortBy } from '../setSortBy';

function seed(partial: Partial<SampleDatabaseState> = {}): void {
    sampleDatabaseStore.set({
        samples: [],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
        ...partial,
    });
}

describe('setSortBy', () => {
    beforeEach(() => seed());
    afterEach(() => sampleDatabaseStore.clear());

    it('should set the sort field and default the direction to asc', () => {
        seed({ sortBy: 'name', sortDirection: 'asc' });
        setSortBy('rating');
        expect(sampleDatabaseStore.value?.sortBy).toBe('rating');
        expect(sampleDatabaseStore.value?.sortDirection).toBe('asc');
    });

    it('should use an explicit direction argument verbatim', () => {
        setSortBy('bpm', 'desc');
        expect(sampleDatabaseStore.value?.sortDirection).toBe('desc');
    });

    it('should toggle asc to desc when re-selecting the active field without a direction', () => {
        // Fix 7: documented toggle — same field + current asc flips to desc.
        seed({ sortBy: 'rating', sortDirection: 'asc' });
        setSortBy('rating');
        expect(sampleDatabaseStore.value?.sortBy).toBe('rating');
        expect(sampleDatabaseStore.value?.sortDirection).toBe('desc');
    });

    it('should reset to asc when re-selecting the active field already at desc', () => {
        seed({ sortBy: 'rating', sortDirection: 'desc' });
        setSortBy('rating');
        expect(sampleDatabaseStore.value?.sortDirection).toBe('asc');
    });

    it('should reset to asc when selecting a different field while the active one is desc', () => {
        seed({ sortBy: 'rating', sortDirection: 'desc' });
        setSortBy('bpm');
        expect(sampleDatabaseStore.value?.sortBy).toBe('bpm');
        expect(sampleDatabaseStore.value?.sortDirection).toBe('asc');
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => setSortBy('rating')).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
