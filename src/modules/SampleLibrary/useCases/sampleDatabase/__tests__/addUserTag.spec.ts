import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestSample, createTestTag } from '../../../__tests__/createTestSample';
import { type SampleTag } from '../../../models/SampleEntry';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { addUserTag } from '../addUserTag';

function seed(tags: SampleTag[]): void {
    sampleDatabaseStore.set({
        samples: [createTestSample({ id: 's1', tags })],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

function tagsOf(id: string): SampleTag[] {
    return sampleDatabaseStore.value?.samples.find((s) => s.id === id)?.tags ?? [];
}

describe('addUserTag', () => {
    beforeEach(() => seed([]));
    afterEach(() => sampleDatabaseStore.clear());

    it('should append a user tag with source "user" and confidence 1', () => {
        addUserTag('s1', 'favourite');
        const tags = tagsOf('s1');
        expect(tags).toHaveLength(1);
        expect(tags[0]).toEqual({ name: 'favourite', source: 'user', confidence: 1 });
    });

    it('should trim surrounding whitespace from the tag name', () => {
        addUserTag('s1', '  warm  ');
        expect(tagsOf('s1').map((t) => t.name)).toEqual(['warm']);
    });

    it('should reject an empty tag name', () => {
        addUserTag('s1', '');
        expect(tagsOf('s1')).toHaveLength(0);
    });

    it('should reject a whitespace-only tag name', () => {
        addUserTag('s1', '   ');
        expect(tagsOf('s1')).toHaveLength(0);
    });

    it('should not add a duplicate of an existing tag', () => {
        seed([createTestTag('drum', { source: 'auto' })]);
        addUserTag('s1', 'drum');
        expect(tagsOf('s1')).toHaveLength(1);
    });

    it('should dedup case-insensitively against existing tags', () => {
        seed([createTestTag('Bass', { source: 'auto' })]);
        addUserTag('s1', 'bass');
        expect(tagsOf('s1')).toHaveLength(1);
        expect(tagsOf('s1')[0]?.name).toBe('Bass');
    });

    it('should not mutate when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => addUserTag('s1', 'warm')).not.toThrow();
        expect(sampleDatabaseStore.value).toBeNull();
    });
});
