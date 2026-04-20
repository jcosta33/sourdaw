import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistState } from '../../../stores/setlistStore';
import { addSetlistItem } from '../addSetlistItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

vi.mock('../../../repositories/setlistItemIdCounter', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../../../repositories/setlistItemIdCounter')>();
    return {
        ...mod,
        getNextSetlistItemId: () => 'new-id',
    };
});

describe('addSetlistItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('appends item and updates totalDuration', () => {
        const state: SetlistState = {
            name: 'S',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 0,
        };
        mockSetlistStore.value = state;

        addSetlistItem('Song', 60);
        expect(mockSetlistStore.set).toHaveBeenCalledWith(
            expect.objectContaining({
                items: expect.arrayContaining([expect.objectContaining({ id: 'new-id', name: 'Song' })]),
                totalDuration: 60,
            })
        );
    });
});
