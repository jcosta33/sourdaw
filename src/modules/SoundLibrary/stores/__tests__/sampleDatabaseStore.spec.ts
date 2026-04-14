import { describe, it, expect, beforeEach } from 'vitest';
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

    it('should have initial empty state', () => {
        expect(sampleDatabaseStore.value?.samples).toHaveLength(0);
        expect(sampleDatabaseStore.value?.searchQuery).toBe('');
    });

    it('should update search query', () => {
        sampleDatabaseStore.update((s) => ({ ...s!, searchQuery: 'kick' }));
        expect(sampleDatabaseStore.value?.searchQuery).toBe('kick');
    });

    it('should store samples', () => {
        const sample = { id: 's1', name: 'Kick 01', path: '/path/1', category: 'kicks' as const, tags: [], favorite: false };
        sampleDatabaseStore.update((s) => ({ ...s!, samples: [sample] }));
        
        expect(sampleDatabaseStore.value?.samples).toHaveLength(1);
        expect(sampleDatabaseStore.value?.samples[0]).toEqual(sample);
    });
});
