import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSample } from '../../../__tests__/createTestSample';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { removeSample } from '../removeSample';

function seed(): void {
    sampleDatabaseStore.set({
        samples: [createTestSample({ id: 's1' }), createTestSample({ id: 's2' })],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

function ids(): string[] {
    return (sampleDatabaseStore.value?.samples ?? []).map((s) => s.id);
}

describe('removeSample', () => {
    beforeEach(seed);
    afterEach(() => sampleDatabaseStore.clear());

    it('should remove the sample with the matching id', () => {
        removeSample('s1');
        expect(ids()).toEqual(['s2']);
    });

    it('should leave the library unchanged for an unknown id', () => {
        removeSample('missing');
        expect(ids()).toEqual(['s1', 's2']);
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => removeSample('s1')).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
