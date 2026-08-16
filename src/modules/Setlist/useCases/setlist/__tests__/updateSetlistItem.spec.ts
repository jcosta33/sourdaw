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
        };
        mockSetlistStore.value = state;

        updateSetlistItem('x', { name: 'New' });
        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items[0]!.name).toBe('New');
    });

    it('applies an estimatedDuration edit to the item (F7)', () => {
        // Durations live only on the items now: the stored set total was
        // write-only and went stale on edits, so it was removed rather than
        // maintained. Anything needing a set total sums the items at read time.
        mockSetlistStore.value = {
            name: 'S',
            items: [item('x'), item('y')],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        };

        updateSetlistItem('x', { estimatedDuration: 241 });

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items[0]!.estimatedDuration).toBe(241);
        expect(next.items[1]!.estimatedDuration).toBe(1);
    });
});
