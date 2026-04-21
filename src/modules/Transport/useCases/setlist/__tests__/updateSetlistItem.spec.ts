import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { updateSetlistItem } from '../updateSetlistItem';

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
        name: 'Old',
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

describe('updateSetlistItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('merges updates into matching item', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('x')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 1,
        };
        mockSetlistStore.value = state;

        updateSetlistItem('x', { name: 'New' });
        const next = mockSetlistStore.set.mock.calls[0]![0] as SetlistState;
        expect(next.items[0]!.name).toBe('New');
    });
});
