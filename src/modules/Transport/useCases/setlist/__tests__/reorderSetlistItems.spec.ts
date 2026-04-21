import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { reorderSetlistItems } from '../reorderSetlistItems';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
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
        const next = mockSetlistStore.set.mock.calls[0]![0] as SetlistState;
        expect(next.items.map((index) => index.id)).toEqual(['b', 'a']);
    });
});
