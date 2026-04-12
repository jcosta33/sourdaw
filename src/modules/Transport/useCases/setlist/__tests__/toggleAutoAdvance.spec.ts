import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistState } from '../../../stores/setlistStore';
import { toggleAutoAdvance } from '../toggleAutoAdvance';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

function emptySetlist(overrides: Partial<SetlistState> = {}): SetlistState {
    return {
        name: 'Test',
        items: [],
        currentIndex: 0,
        autoAdvance: false,
        countInBars: 1,
        totalDuration: 0,
        ...overrides,
    };
}

describe('toggleAutoAdvance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('flips autoAdvance', () => {
        mockSetlistStore.value = emptySetlist({ autoAdvance: false });
        toggleAutoAdvance();
        expect(mockSetlistStore.set).toHaveBeenCalledWith(expect.objectContaining({ autoAdvance: true }));
    });
});
