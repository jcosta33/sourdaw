import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { updateSetlistItem } from '../updateSetlistItem';

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
        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items[0]!.name).toBe('New');
    });

    it('recomputes totalDuration when an item estimatedDuration is edited (F7)', () => {
        // The set total is derived from the songs. Editing a song's length has
        // no term to add or subtract, so an incrementally maintained total kept
        // reporting the length the set had before the edit.
        mockSetlistStore.value = {
            name: 'S',
            items: [item('x'), item('y')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 2,
        };

        updateSetlistItem('x', { estimatedDuration: 241 });

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items[0]!.estimatedDuration).toBe(241);
        expect(next.totalDuration).toBe(242);
    });

    it('leaves totalDuration equal to the item sum when a non-duration field is edited', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('x'), item('y')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 2,
        };

        updateSetlistItem('x', { autoStop: false });

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.totalDuration).toBe(2);
    });
});
