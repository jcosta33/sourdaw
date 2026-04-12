import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { renameSetlist } from '../renameSetlist';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/setlistStore', () => ({
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
