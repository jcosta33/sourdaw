import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { previousItem } from '../previousItem';
import { goToItem } from '../goToItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

vi.mock('../goToItem', () => ({
    goToItem: vi.fn(),
}));

const oneItem = (id: string): SetlistItem => ({
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
});

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
            totalDuration: 2,
        };
        mockSetlistStore.value = state;
        
        previousItem();
        expect(goToItem).toHaveBeenCalledWith(0);
    });
});
