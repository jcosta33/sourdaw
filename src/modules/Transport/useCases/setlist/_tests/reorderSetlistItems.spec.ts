import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { reorderSetlistItems } from '../reorderSetlistItems';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

const item = (id: string): SetlistItem => ({
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
});

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
        expect(next.items.map((i) => i.id)).toEqual(['b', 'a']);
    });
});
