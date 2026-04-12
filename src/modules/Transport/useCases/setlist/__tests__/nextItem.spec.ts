import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistState } from '../../../stores/setlistStore';
import { nextItem } from '../nextItem';
import { goToItem } from '../goToItem';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

vi.mock('../goToItem', () => ({
    goToItem: vi.fn(),
}));

describe('nextItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('calls goToItem with currentIndex + 1', () => {
        mockSetlistStore.value = {
            name: 'S',
            items: [{ id: 'a', name: 'A', projectPath: null, bpm: null, timeSignature: null, estimatedDuration: 1, notes: '', programChange: null, color: '#000', autoStop: true, gapSeconds: 0, markers: [] }],
            currentIndex: 0,
            autoAdvance: false,
            countInBars: 1,
            totalDuration: 1,
        } as SetlistState;
        
        nextItem();
        expect(goToItem).toHaveBeenCalledWith(1);
    });
});
