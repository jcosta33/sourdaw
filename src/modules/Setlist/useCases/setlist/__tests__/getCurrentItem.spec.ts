import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistState } from '../../../stores/setlistStore';
import { getCurrentItem } from '../getCurrentItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState | ((prev: SetlistState) => SetlistState)) => void>(),
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
        ...overrides,
    };
}

describe('getCurrentItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when empty', () => {
        mockSetlistStore.value = emptySetlist();
        expect(getCurrentItem()).toBeNull();
    });
});
