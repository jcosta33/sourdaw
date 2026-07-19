import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { reorderSetlistItems } from '../reorderSetlistItems';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState) => void>(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

function item(id: string): SetlistItem {
    return {
        id,
        name: id,
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: 1,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: true,
        gapSeconds: 0,
        markers: [],
    };
}

describe('reorderSetlistItems', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('moves item from index 0 to 1', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('a'), item('b')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 2,
        };
        mockSetlistStore.value = state;

        reorderSetlistItems(0, 1);
        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items.map((index) => index.id)).toEqual(['b', 'a']);
    });

    it('moves the last item back to the front', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('a'), item('b'), item('c')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 3,
        };
        mockSetlistStore.value = state;

        reorderSetlistItems(2, 0);

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items.map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
    });

    it('does nothing when the store has no value', () => {
        mockSetlistStore.value = null;

        reorderSetlistItems(0, 1);

        expect(mockSetlistStore.set).not.toHaveBeenCalled();
    });

    it('does nothing when fromIndex equals toIndex', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('a'), item('b')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 2,
        };

        reorderSetlistItems(1, 1);

        expect(mockSetlistStore.set).not.toHaveBeenCalled();
    });

    it('does nothing when fromIndex is out of range', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('a'), item('b')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 2,
        };

        reorderSetlistItems(5, 0);

        expect(mockSetlistStore.set).not.toHaveBeenCalled();
    });
});
