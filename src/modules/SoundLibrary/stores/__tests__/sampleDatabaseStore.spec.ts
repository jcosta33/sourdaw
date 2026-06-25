import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSample } from '../../__tests__/createTestSample';
import { sampleDatabaseStore } from '../sampleDatabaseStore';

describe('sampleDatabaseStore', () => {
    beforeEach(() => {
        sampleDatabaseStore.set({
            samples: [],
            searchQuery: '',
            activeFilters: [],
            categoryFilter: null,
            sortBy: 'name',
            sortDirection: 'asc',
            favoritesOnly: false,
        });
    });

    afterEach(() => sampleDatabaseStore.clear());

    it('should have initial empty state', () => {
        expect(sampleDatabaseStore.value?.samples).toHaveLength(0);
        expect(sampleDatabaseStore.value?.searchQuery).toBe('');
    });

    it('should update search query', () => {
        const current = sampleDatabaseStore.value;
        expect(current).not.toBeNull();
        sampleDatabaseStore.set({ ...current!, searchQuery: 'kick' });
        expect(sampleDatabaseStore.value?.searchQuery).toBe('kick');
    });

    it('should store a fully-typed sample', () => {
        const sample = createTestSample({ id: 's1', name: 'Kick 01', path: '/path/1' });
        const current = sampleDatabaseStore.value;
        expect(current).not.toBeNull();
        sampleDatabaseStore.set({ ...current!, samples: [sample] });

        expect(sampleDatabaseStore.value?.samples).toHaveLength(1);
        expect(sampleDatabaseStore.value?.samples[0]).toEqual(sample);
    });
});
