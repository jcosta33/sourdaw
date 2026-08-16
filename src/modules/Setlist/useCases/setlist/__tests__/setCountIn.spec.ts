import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistState } from '../../../stores/setlistStore';
import { setCountIn } from '../setCountIn';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState) => void>(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

describe('setCountIn', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes countInBars', () => {
        const state: SetlistState = {
            name: 'S',
            items: [],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        };
        mockSetlistStore.value = state;

        setCountIn(4);
        expect(mockSetlistStore.set).toHaveBeenCalledWith(expect.objectContaining({ countInBars: 4 }));
    });
});
