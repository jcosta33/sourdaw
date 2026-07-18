import { afterEach, describe, expect, it } from 'vitest';

import { createTestSample, createTestTag } from '../../../__tests__/createTestSample';
import { type SampleEntry } from '../../../models/SampleEntry';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { getAllTags } from '../getAllTags';

function seed(samples: SampleEntry[]): void {
    sampleDatabaseStore.set({
        samples,
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

describe('getAllTags', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('should return the sorted union of tag names across all samples', () => {
        seed([
            createTestSample({ id: 'a', tags: [createTestTag('snare'), createTestTag('drum')] }),
            createTestSample({ id: 'b', tags: [createTestTag('kick'), createTestTag('drum')] }),
        ]);
        expect(getAllTags()).toEqual(['drum', 'kick', 'snare']);
    });

    it('should deduplicate tag names shared across samples', () => {
        seed([
            createTestSample({ id: 'a', tags: [createTestTag('drum')] }),
            createTestSample({ id: 'b', tags: [createTestTag('drum')] }),
        ]);
        expect(getAllTags()).toEqual(['drum']);
    });

    it('should return the same cached array while the samples array is unchanged', () => {
        // Fix 6: memoised on state.samples identity.
        seed([createTestSample({ id: 'a', tags: [createTestTag('drum')] })]);
        const first = getAllTags();
        const second = getAllTags();
        expect(second).toBe(first);
    });

    it('should recompute after the samples array is replaced', () => {
        seed([createTestSample({ id: 'a', tags: [createTestTag('drum')] })]);
        const first = getAllTags();
        seed([createTestSample({ id: 'b', tags: [createTestTag('bass')] })]);
        const second = getAllTags();
        expect(second).not.toBe(first);
        expect(second).toEqual(['bass']);
    });

    it('should return an empty array when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(getAllTags()).toEqual([]);
    });

    it('should return a frozen array so a caller cannot corrupt the shared cache', () => {
        seed([createTestSample({ id: 'a', tags: [createTestTag('drum')] })]);
        const result = getAllTags();
        expect(Object.isFrozen(result)).toBe(true);
        expect(() => result.push('mutated')).toThrow(TypeError);
        // The cache the next caller sees is unchanged by the failed mutation.
        expect(getAllTags()).toEqual(['drum']);
    });
});
