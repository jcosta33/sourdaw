import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { setCountIn } from '../setCountIn';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/setlistStore', () => ({
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
            totalDuration: 0,
        };
        mockSetlistStore.value = state;
        
        setCountIn(4);
        expect(mockSetlistStore.set).toHaveBeenCalledWith(expect.objectContaining({ countInBars: 4 }));
    });
});
