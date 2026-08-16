import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistState } from '../../../stores/setlistStore';
import { toggleAutoAdvance } from '../toggleAutoAdvance';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState) => void>(),
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
