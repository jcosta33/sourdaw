import { afterEach, describe, expect, it } from 'vitest';

import { createTestSample, createTestTag } from '../../../__tests__/createTestSample';
import { type SampleDatabaseState, type SampleEntry } from '../../../models/SampleEntry';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { getFilteredSamples } from '../getFilteredSamples';

function seed(samples: SampleEntry[], partial: Partial<SampleDatabaseState> = {}): void {
    sampleDatabaseStore.set({
        samples,
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
        ...partial,
    });
}

describe('getFilteredSamples', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('should return all samples sorted by name ascending by default', () => {
        seed([createTestSample({ id: 'b', name: 'Beta' }), createTestSample({ id: 'a', name: 'Alpha' })]);
        expect(getFilteredSamples().map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    });

    it('should reverse order for descending direction', () => {
        seed([createTestSample({ id: 'a', name: 'Alpha' }), createTestSample({ id: 'b', name: 'Beta' })], {
            sortDirection: 'desc',
        });
        expect(getFilteredSamples().map((s) => s.name)).toEqual(['Beta', 'Alpha']);
    });

    it('should match the search query against name, path and tags', () => {
        seed(
            [
                createTestSample({ id: 'a', name: 'Warm Pad', path: '/x.wav' }),
                createTestSample({ id: 'b', name: 'Cold', path: '/warm-folder/y.wav' }),
                createTestSample({ id: 'c', name: 'Other', path: '/z.wav', tags: [createTestTag('warm')] }),
                createTestSample({ id: 'd', name: 'Nope', path: '/none.wav' }),
            ],
            { searchQuery: 'warm' }
        );
        expect(
            getFilteredSamples()
                .map((s) => s.id)
                .sort()
        ).toEqual(['a', 'b', 'c']);
    });

    it('should require every active tag filter to be present', () => {
        seed(
            [
                createTestSample({ id: 'a', tags: [createTestTag('drum'), createTestTag('kick')] }),
                createTestSample({ id: 'b', tags: [createTestTag('drum')] }),
            ],
            { activeFilters: ['drum', 'kick'] }
        );
        expect(getFilteredSamples().map((s) => s.id)).toEqual(['a']);
    });

    it('should filter by category using the precomputed category-tag map', () => {
        // Fix 5: 'kicks' category maps to tags ['kick','drum','low-end'].
        seed(
            [
                createTestSample({ id: 'a', name: 'A', tags: [createTestTag('kick')] }),
                createTestSample({ id: 'b', name: 'B', tags: [createTestTag('vocal')] }),
            ],
            { categoryFilter: 'kicks' }
        );
        expect(getFilteredSamples().map((s) => s.id)).toEqual(['a']);
    });

    it('should return nothing for a category that maps to no sample tags', () => {
        seed([createTestSample({ id: 'a', tags: [createTestTag('kick')] })], { categoryFilter: 'vocals' });
        expect(getFilteredSamples()).toEqual([]);
    });

    it('should restrict to favourites when favoritesOnly is set', () => {
        seed(
            [
                createTestSample({ id: 'a', name: 'A', favorite: true }),
                createTestSample({ id: 'b', name: 'B', favorite: false }),
            ],
            { favoritesOnly: true }
        );
        expect(getFilteredSamples().map((s) => s.id)).toEqual(['a']);
    });

    it('should return an empty array when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(getFilteredSamples()).toEqual([]);
    });

    it('should return a frozen array so a caller cannot corrupt the shared cache', () => {
        seed([createTestSample({ id: 'a', name: 'Alpha' })]);
        const result = getFilteredSamples();
        expect(Object.isFrozen(result)).toBe(true);
        expect(() => result.push(createTestSample({ id: 'z', name: 'Zulu' }))).toThrow(TypeError);
        // The cache the next caller sees is unchanged by the failed mutation.
        expect(getFilteredSamples().map((s) => s.name)).toEqual(['Alpha']);
    });
});
