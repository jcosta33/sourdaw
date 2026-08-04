import { afterEach, describe, expect, it } from 'vitest';

import { createTestSample } from '../../../__tests__/createTestSample';
import { type SampleDatabaseState, type SampleEntry } from '../../../models/SampleEntry';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { getFilteredSamples } from '../getFilteredSamples';

/**
 * Deep specs for the sort switch arms. The existing spec only tests sortBy='name'.
 * These cover bpm, duration, rating, addedAt, lastUsedAt, useCount, and desc direction.
 */

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

describe('getFilteredSamples — sort by bpm', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('sorts ascending by bpm', () => {
        seed(
            [
                createTestSample({ id: 'fast', name: 'Fast', bpm: 140 }),
                createTestSample({ id: 'slow', name: 'Slow', bpm: 80 }),
                createTestSample({ id: 'mid', name: 'Mid', bpm: 120 }),
            ],
            { sortBy: 'bpm', sortDirection: 'asc' }
        );
        expect(getFilteredSamples().map((s) => s.bpm)).toEqual([80, 120, 140]);
    });

    it('treats null bpm as 0 (sorts first ascending)', () => {
        seed(
            [
                createTestSample({ id: 'known', name: 'Known', bpm: 90 }),
                createTestSample({ id: 'unknown', name: 'Unknown', bpm: null }),
            ],
            { sortBy: 'bpm', sortDirection: 'asc' }
        );
        expect(getFilteredSamples().map((s) => s.id)).toEqual(['unknown', 'known']);
    });

    it('sorts descending by bpm', () => {
        seed([createTestSample({ id: 'a', name: 'A', bpm: 80 }), createTestSample({ id: 'b', name: 'B', bpm: 140 })], {
            sortBy: 'bpm',
            sortDirection: 'desc',
        });
        expect(getFilteredSamples().map((s) => s.bpm)).toEqual([140, 80]);
    });
});

describe('getFilteredSamples — sort by duration', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('sorts by durationSec', () => {
        seed(
            [
                createTestSample({ id: 'long', name: 'Long', durationSec: 10 }),
                createTestSample({ id: 'short', name: 'Short', durationSec: 2 }),
            ],
            { sortBy: 'duration', sortDirection: 'asc' }
        );
        expect(getFilteredSamples().map((s) => s.durationSec)).toEqual([2, 10]);
    });
});

describe('getFilteredSamples — sort by rating', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('sorts by rating', () => {
        seed(
            [
                createTestSample({ id: 'low', name: 'Low', rating: 2 }),
                createTestSample({ id: 'high', name: 'High', rating: 5 }),
            ],
            { sortBy: 'rating', sortDirection: 'asc' }
        );
        expect(getFilteredSamples().map((s) => s.rating)).toEqual([2, 5]);
    });
});

describe('getFilteredSamples — sort by addedAt', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('sorts by addedAt string (localeCompare)', () => {
        seed(
            [
                createTestSample({ id: 'later', name: 'Later', addedAt: '2024-03-01' }),
                createTestSample({ id: 'earlier', name: 'Earlier', addedAt: '2024-01-01' }),
            ],
            { sortBy: 'addedAt', sortDirection: 'asc' }
        );
        expect(getFilteredSamples().map((s) => s.addedAt)).toEqual(['2024-01-01', '2024-03-01']);
    });
});

describe('getFilteredSamples — sort by lastUsedAt', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('sorts by lastUsedAt treating null as empty string', () => {
        seed(
            [
                createTestSample({ id: 'used', name: 'Used', lastUsedAt: '2024-06-01' }),
                createTestSample({ id: 'never', name: 'Never', lastUsedAt: null }),
            ],
            { sortBy: 'lastUsedAt', sortDirection: 'asc' }
        );
        // null → '' which sorts before any date string.
        expect(getFilteredSamples().map((s) => s.id)).toEqual(['never', 'used']);
    });
});

describe('getFilteredSamples — sort by useCount', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('sorts by useCount', () => {
        seed(
            [
                createTestSample({ id: 'rare', name: 'Rare', useCount: 1 }),
                createTestSample({ id: 'frequent', name: 'Frequent', useCount: 50 }),
            ],
            { sortBy: 'useCount', sortDirection: 'asc' }
        );
        expect(getFilteredSamples().map((s) => s.useCount)).toEqual([1, 50]);
    });
});

describe('getFilteredSamples — memo cache identity', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('returns the same frozen array reference for identical state', () => {
        seed([createTestSample({ id: 'a', name: 'Alpha' })]);
        const first = getFilteredSamples();
        const second = getFilteredSamples();
        expect(first).toBe(second);
    });

    it('returns a new array when sortBy changes', () => {
        seed([createTestSample({ id: 'a', name: 'Alpha', bpm: 120 })]);
        const first = getFilteredSamples();
        sampleDatabaseStore.set({
            ...sampleDatabaseStore.value!,
            sortBy: 'bpm',
        });
        const second = getFilteredSamples();
        expect(first).not.toBe(second);
    });

    it('the cached result is frozen (cannot be mutated)', () => {
        seed([createTestSample({ id: 'a', name: 'Alpha' })]);
        const result = getFilteredSamples();
        expect(Object.isFrozen(result)).toBe(true);
    });
});
