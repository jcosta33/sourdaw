import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistState } from '../../../stores/setlistStore';
import { renameSetlist } from '../renameSetlist';

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

describe('renameSetlist', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates name', () => {
        mockSetlistStore.value = emptySetlist();
        renameSetlist('Foo');
        expect(mockSetlistStore.set).toHaveBeenCalledWith(expect.objectContaining({ name: 'Foo' }));
    });
});
