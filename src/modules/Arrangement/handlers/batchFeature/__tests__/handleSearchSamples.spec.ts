import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSearchSamples } from '../handleSearchSamples';

const mocks = vi.hoisted(() => ({
    searchSamples: vi.fn(),
}));

vi.mock('#/modules/SoundLibrary/useCases', () => ({
    searchSamples: mocks.searchSamples,
}));

describe('handleSearchSamples', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes searchSamples from SoundLibrary module with query', () => {
        void handleSearchSamples.execute({ type: 'searchSamples', payload: { query: 'kick drum' } });
        expect(mocks.searchSamples).toHaveBeenCalledWith('kick drum');
    });

    it('provides a description', () => {
        const desc = handleSearchSamples.describe({ type: 'searchSamples', payload: { query: '' } });
        expect(desc.label).toBe('Search Samples');
    });

    it('is not undoable', () => {
        expect(handleSearchSamples.undoable).toBe(false);
    });
});
