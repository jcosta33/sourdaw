import { afterEach, describe, expect, it } from 'vitest';

import { createTestSample, createTestTag } from '../../../__tests__/createTestSample';
import { type SampleEntry } from '../../../models/SampleEntry';
import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { findSimilarSamples } from '../findSimilarSamples';

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

function tagged(id: string, names: string[]): SampleEntry {
    return createTestSample({ id, tags: names.map((n) => createTestTag(n)) });
}

describe('findSimilarSamples', () => {
    afterEach(() => sampleDatabaseStore.clear());

    it('should rank samples by descending tag overlap with the target', () => {
        seed([
            tagged('target', ['kick', 'drum', 'low-end']),
            tagged('close', ['kick', 'drum', 'low-end']),
            tagged('partial', ['kick', 'metallic']),
            tagged('none', ['vocal']),
        ]);

        const result = findSimilarSamples('target');
        expect(result.map((s) => s.id)).toEqual(['close', 'partial', 'none']);
    });

    it('should exclude the target sample itself from the results', () => {
        seed([tagged('target', ['kick']), tagged('other', ['kick'])]);
        const result = findSimilarSamples('target');
        expect(result.some((s) => s.id === 'target')).toBe(false);
    });

    it('should respect the limit argument', () => {
        seed([
            tagged('target', ['kick', 'drum']),
            tagged('a', ['kick', 'drum']),
            tagged('b', ['kick']),
            tagged('c', ['drum']),
        ]);
        const result = findSimilarSamples('target', 2);
        expect(result).toHaveLength(2);
    });

    it('should return an empty array when the target is missing', () => {
        seed([tagged('a', ['kick'])]);
        expect(findSimilarSamples('does-not-exist')).toEqual([]);
    });

    it('should return the same cached array reference while samples are unchanged', () => {
        // Fix 6: identity-keyed memo — a second call for the same selection
        // must short-circuit and return the cached result without recomputing.
        seed([tagged('target', ['kick', 'drum']), tagged('a', ['kick', 'drum'])]);
        const first = findSimilarSamples('target', 5);
        const second = findSimilarSamples('target', 5);
        expect(second).toBe(first);
    });

    it('should recompute after the samples array is replaced', () => {
        seed([tagged('target', ['kick']), tagged('a', ['kick'])]);
        const first = findSimilarSamples('target');
        seed([tagged('target', ['kick']), tagged('b', ['kick'])]);
        const second = findSimilarSamples('target');
        expect(second).not.toBe(first);
        expect(second.map((s) => s.id)).toEqual(['b']);
    });

    it('should recompute when the limit changes even on the same samples', () => {
        seed([tagged('target', ['kick']), tagged('a', ['kick']), tagged('b', ['kick'])]);
        const wide = findSimilarSamples('target', 5);
        const narrow = findSimilarSamples('target', 1);
        expect(wide).toHaveLength(2);
        expect(narrow).toHaveLength(1);
    });

    it('should return an empty array when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(findSimilarSamples('target')).toEqual([]);
    });

    it('should return a frozen array so a caller cannot corrupt the shared cache', () => {
        seed([tagged('target', ['kick', 'drum']), tagged('a', ['kick', 'drum'])]);
        const result = findSimilarSamples('target', 5);
        expect(Object.isFrozen(result)).toBe(true);
        expect(() => result.push(tagged('z', ['kick']))).toThrow(TypeError);
        // The cache the next caller sees is unchanged by the failed mutation.
        expect(findSimilarSamples('target', 5).map((s) => s.id)).toEqual(['a']);
    });
});
