import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { getRemainingDuration } from '../getRemainingDuration';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as SetlistState | null,
    set: vi.fn<(state: SetlistState | ((prev: SetlistState) => SetlistState)) => void>(),
}));

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

function item(id: string, dur: number, gap: number): SetlistItem {
    return {
        id,
        name: id,
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: dur,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: true,
        gapSeconds: gap,
        markers: [],
    };
}

describe('getRemainingDuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sums estimatedDuration + gap from currentIndex onward', () => {
        const state: SetlistState = {
            name: 'S',
            items: [item('a', 10, 2), item('b', 20, 1)],
            currentIndex: 1,
            autoAdvance: false,
            countInBars: 1,
        };
        mockSetlistStore.value = state;

        expect(getRemainingDuration()).toBe(21);
    });
});
