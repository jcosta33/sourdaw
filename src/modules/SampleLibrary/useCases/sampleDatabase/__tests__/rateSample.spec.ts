import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSample } from '../../../__tests__/createTestSample';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { rateSample } from '../rateSample';

function seed(rating: number): void {
    sampleDatabaseStore.set({
        samples: [createTestSample({ id: 's1', rating })],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

function ratingOf(id: string): number | undefined {
    return sampleDatabaseStore.value?.samples.find((s) => s.id === id)?.rating;
}

describe('rateSample', () => {
    beforeEach(() => seed(0));
    afterEach(() => sampleDatabaseStore.clear());

    it('should set an in-range rating', () => {
        rateSample('s1', 3);
        expect(ratingOf('s1')).toBe(3);
    });

    it('should clamp ratings above 5 down to 5', () => {
        rateSample('s1', 9);
        expect(ratingOf('s1')).toBe(5);
    });

    it('should clamp negative ratings up to 0', () => {
        seed(4);
        rateSample('s1', -2);
        expect(ratingOf('s1')).toBe(0);
    });

    it('should collapse NaN to 0 instead of writing NaN', () => {
        // Fix 2: Math.max(0, Math.min(5, NaN)) is NaN — without the finite
        // guard, NaN passed straight through into stored state.
        seed(3);
        rateSample('s1', Number.NaN);
        expect(ratingOf('s1')).toBe(0);
        expect(Number.isNaN(ratingOf('s1'))).toBe(false);
    });

    it('should collapse Infinity to 0', () => {
        seed(2);
        rateSample('s1', Number.POSITIVE_INFINITY);
        expect(ratingOf('s1')).toBe(0);
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => rateSample('s1', 4)).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
