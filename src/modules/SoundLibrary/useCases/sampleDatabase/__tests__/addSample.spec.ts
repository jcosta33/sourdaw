import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sampleDatabaseStore } from '../../../stores/sampleDatabaseStore';
import { addSample, type AddSampleInput } from '../addSample';

const baseInput: AddSampleInput = {
    path: '/samples/kick.wav',
    name: 'Big Kick',
    format: 'wav',
    durationSec: 2,
    sampleRate: 48000,
    bitDepth: 24,
    channels: 1,
    fileSize: 2048,
};

function resetStore(): void {
    sampleDatabaseStore.set({
        samples: [],
        searchQuery: '',
        activeFilters: [],
        categoryFilter: null,
        sortBy: 'name',
        sortDirection: 'asc',
        favoritesOnly: false,
    });
}

describe('addSample', () => {
    beforeEach(resetStore);
    afterEach(resetStore);

    it('should append a sample carrying the metadata supplied in the input object', () => {
        const created = addSample(baseInput);

        const stored = sampleDatabaseStore.value?.samples ?? [];
        expect(stored).toHaveLength(1);
        expect(stored[0]).toBe(created);
        expect(created.path).toBe('/samples/kick.wav');
        expect(created.name).toBe('Big Kick');
        expect(created.format).toBe('wav');
        expect(created.durationSec).toBe(2);
        // Fix 4: metadata comes from the input, not silent positional defaults.
        expect(created.sampleRate).toBe(48000);
        expect(created.bitDepth).toBe(24);
        expect(created.channels).toBe(1);
        expect(created.fileSize).toBe(2048);
    });

    it('should auto-tag the sample from its name and path', () => {
        const created = addSample(baseInput);
        expect(created.tags.some((t) => t.name === 'kick')).toBe(true);
        expect(created.tags.every((t) => t.source === 'auto')).toBe(true);
    });

    it('should preserve previously stored samples when adding a new one', () => {
        addSample({ ...baseInput, name: 'First' });
        addSample({ ...baseInput, name: 'Second' });
        expect(sampleDatabaseStore.value?.samples).toHaveLength(2);
    });

    it('should throw when the database is not initialised', () => {
        sampleDatabaseStore.clear();
        expect(() => addSample(baseInput)).toThrowError(/not initialized/i);
    });
});
