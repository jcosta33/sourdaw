import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { goToItem } from '../goToItem';
import { previousItem } from '../previousItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState) => void>(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

vi.mock('../goToItem', () => ({
    goToItem: vi.fn<(index: number) => void>(),
}));

function oneItem(id: string): SetlistItem {
    return {
        id,
        name: 'A',
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

describe('previousItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls goToItem with currentIndex - 1', () => {
        const state: SetlistState = {
            name: 'S',
            items: [oneItem('a'), oneItem('b')],
            currentIndex: 1,
            autoAdvance: false,
            countInBars: 1,
        };
        mockSetlistStore.value = state;

        previousItem();
        expect(goToItem).toHaveBeenCalledWith(0);
    });

    it('does nothing when the store has no value', () => {
        mockSetlistStore.value = null;

        previousItem();

        expect(goToItem).not.toHaveBeenCalled();
    });
});
