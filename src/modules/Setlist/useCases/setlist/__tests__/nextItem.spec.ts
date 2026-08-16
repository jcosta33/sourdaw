import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistState } from '../../../stores/setlistStore';
import { goToItem } from '../goToItem';
import { nextItem } from '../nextItem';

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

describe('nextItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls goToItem with currentIndex + 1', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [
                {
                    id: 'a',
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
                },
            ],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
        };

        nextItem();
        expect(goToItem).toHaveBeenCalledWith(1);
    });

    it('does nothing when the store has no value', () => {
        mockSetlistStore.value = null;

        nextItem();

        expect(goToItem).not.toHaveBeenCalled();
    });
});
