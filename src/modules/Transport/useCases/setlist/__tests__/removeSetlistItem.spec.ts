import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { removeSetlistItem } from '../removeSetlistItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

const item = (id: string, dur: number): SetlistItem => ({
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
});

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
});
