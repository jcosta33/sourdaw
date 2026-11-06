import { describe, expect, it } from 'vitest';

import { handleSearchSamples } from '../../handlers/sampleSearch/handleSearchSamples';
import { getSampleLibraryHandlers } from '../getSampleLibraryHandlers';

describe('getSampleLibraryHandlers', () => {
    it('registers the library text search as SampleLibrary’s own command', () => {
        const handlers = getSampleLibraryHandlers();

        expect(Object.keys(handlers)).toEqual(['searchSamples']);
        expect(handlers.searchSamples).toBe(handleSearchSamples);
    });
});
