import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistState } from '../../../stores/setlistStore';
import { getSetlistProgress } from '../getSetlistProgress';

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

describe('getSetlistProgress', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns zeros for empty list', () => {
        mockSetlistStore.value = emptySetlist();
        expect(getSetlistProgress()).toEqual({ current: 0, total: 0, percent: 0 });
    });
});
