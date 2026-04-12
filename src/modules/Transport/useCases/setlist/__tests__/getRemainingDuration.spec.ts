import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type SetlistItem, type SetlistState } from '#/modules/Transport/stores/setlistStore';
import { getRemainingDuration } from '../getRemainingDuration';

const mockSetlistStore = vi.hoisted(() => ({
    value: null as any,
    set: vi.fn(),
}));

vi.mock('#/modules/Transport/stores/setlistStore', () => ({
    setlistStore: mockSetlistStore,
}));

const item = (id: string, dur: number, gap: number): SetlistItem => ({
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
});

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
            totalDuration: 0,
        };
        mockSetlistStore.value = state;
        
        expect(getRemainingDuration()).toBe(21);
    });
});
