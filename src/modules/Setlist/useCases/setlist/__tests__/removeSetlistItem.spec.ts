import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { removeSetlistItem } from '../removeSetlistItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState) => void>(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

function item(id: string, dur: number): SetlistItem {
    return {
        id,
        name: 'A',
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: dur,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: true,
        gapSeconds: 0,
        markers: [],
    };
}

describe('removeSetlistItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes item and subtracts duration', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('x', 30)],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 30,
        };
        mockSetlistStore.value = state;

        removeSetlistItem('x');
        expect(mockSetlistStore.set).toHaveBeenCalledWith(expect.objectContaining({ items: [], totalDuration: 0 }));
    });

    it('does nothing when the store has no value', () => {
        mockSetlistStore.value = null;

        removeSetlistItem('x');

        expect(mockSetlistStore.set).not.toHaveBeenCalled();
    });

    it('does nothing when the id does not match any item', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('x', 30)],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 30,
        };
        mockSetlistStore.value = state;

        removeSetlistItem('missing');

        expect(mockSetlistStore.set).not.toHaveBeenCalled();
    });

    it('removes only the matching item, keeping the rest and their order', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('a', 10), item('b', 20), item('c', 5)],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 35,
        };
        mockSetlistStore.value = state;

        removeSetlistItem('b');

        expect(mockSetlistStore.set).toHaveBeenCalledWith(
            expect.objectContaining({
                items: [item('a', 10), item('c', 5)],
                totalDuration: 15,
            })
        );
    });

    // The cursor sits at an interior index with a song still after it, so the
    // out-of-range clamp cannot stand in for the shift and make this pass.
    it('keeps the cursor on the same song when an earlier song is removed', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('a', 10), item('b', 20), item('c', 5), item('d', 5)],
            currentIndex: 2,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 40,
        };

        removeSetlistItem('a');

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items[next.currentIndex]?.id).toBe('c');
        expect(next.currentIndex).toBe(1);
    });

    it('leaves the cursor alone when a later song is removed', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('a', 10), item('b', 20), item('c', 5)],
            currentIndex: 1,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 35,
        };

        removeSetlistItem('c');

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items[next.currentIndex]?.id).toBe('b');
        expect(next.currentIndex).toBe(1);
    });

    it('clamps the cursor back into range when the current last song is removed', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('a', 10), item('b', 20), item('c', 5)],
            currentIndex: 2,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 35,
        };

        removeSetlistItem('c');

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.currentIndex).toBe(1);
        expect(next.items[next.currentIndex]?.id).toBe('b');
    });

    it('derives totalDuration from the surviving items rather than subtracting from the stored total (F7)', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('a', 10), item('b', 20)],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 999,
        };

        removeSetlistItem('a');

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.totalDuration).toBe(20);
    });

    it('resets the cursor to zero when the last remaining song is removed', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [item('a', 10)],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 10,
        };

        removeSetlistItem('a');

        const next = mockSetlistStore.set.mock.calls[0]![0];
        expect(next.items).toEqual([]);
        expect(next.currentIndex).toBe(0);
    });
});
