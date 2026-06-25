import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSample } from '../../../__tests__/createTestSample';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { recordUsage } from '../recordUsage';

function seed(): void {
    sampleDatabaseStore.set({
        samples: [
            createTestSample({ id: 's1', useCount: 2, lastUsedAt: null }),
            createTestSample({ id: 's2', useCount: 0, lastUsedAt: null }),
        ],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

function sampleOf(id: string) {
    return sampleDatabaseStore.value?.samples.find((s) => s.id === id);
}

describe('recordUsage', () => {
    beforeEach(seed);
    afterEach(() => sampleDatabaseStore.clear());

    it('should increment the use count of the targeted sample', () => {
        recordUsage('s1');
        expect(sampleOf('s1')?.useCount).toBe(3);
    });

    it('should set lastUsedAt to an ISO timestamp', () => {
        recordUsage('s2');
        const ts = sampleOf('s2')?.lastUsedAt;
        expect(ts).not.toBeNull();
        expect(() => new Date(ts as string).toISOString()).not.toThrow();
    });

    it('should leave other samples untouched', () => {
        recordUsage('s1');
        expect(sampleOf('s2')?.useCount).toBe(0);
        expect(sampleOf('s2')?.lastUsedAt).toBeNull();
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => recordUsage('s1')).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
