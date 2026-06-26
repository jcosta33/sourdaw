import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    toggleSampleFavorite: vi.fn(),
    persistSamples: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stores/libraryStore', () => ({
    toggleSampleFavorite: mocks.toggleSampleFavorite,
}));

vi.mock('../../repositories/libraryPersistence/persistSamples', () => ({
    persistSamples: mocks.persistSamples,
}));

import { toggleFavorite } from '../toggleFavorite';

describe('toggleFavorite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('flips the favorite flag and persists it so the edit survives a reload', async () => {
        await toggleFavorite('s1');

        expect(mocks.toggleSampleFavorite).toHaveBeenCalledWith('s1');
        // The persist is what makes the favorite durable; without it the edit is
        // lost on reload unless an unrelated scan/disconnect happens to flush.
        expect(mocks.persistSamples).toHaveBeenCalledTimes(1);
    });

    it('persists after toggling, not before', async () => {
        const order: string[] = [];
        mocks.toggleSampleFavorite.mockImplementation(() => order.push('toggle'));
        mocks.persistSamples.mockImplementation(() => {
            order.push('persist');
            return Promise.resolve();
        });

        await toggleFavorite('s1');

        expect(order).toEqual(['toggle', 'persist']);
    });
});
