import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reorderSection } from '../reorderSection';

const mocks = vi.hoisted(() => ({
    markerStoreValue: { value: { sections: [] } },
    markerStoreSet: vi.fn(),
}));

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.markerStoreValue.value;
        },
        set: mocks.markerStoreSet,
    },
}));

describe('reorderSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('swaps positions when moving right', () => {
        mocks.markerStoreValue.value = {
            sections: [
                { id: 's1', startBeat: 0, endBeat: 16 },
                { id: 's2', startBeat: 16, endBeat: 32 },
            ],
        };

        reorderSection('s1', 'right');

        expect(mocks.markerStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.markerStoreSet.mock.calls[0][0];

        // s2 should now be at 0, s1 should be at 16 (if s2 duration was 16)
        expect(newState.sections[0].id).toBe('s2');
        expect(newState.sections[0].startBeat).toBe(0);
        expect(newState.sections[1].id).toBe('s1');
        expect(newState.sections[1].startBeat).toBe(16);
    });

    it('swaps positions when moving left', () => {
        mocks.markerStoreValue.value = {
            sections: [
                { id: 's1', startBeat: 0, endBeat: 8 },
                { id: 's2', startBeat: 8, endBeat: 32 },
            ],
        };

        reorderSection('s2', 'left');

        expect(mocks.markerStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.markerStoreSet.mock.calls[0][0];

        // s2 moves to 0, duration was 24. End at 24.
        // s1 moves to 24, duration was 8. End at 32.
        expect(newState.sections[0].id).toBe('s2');
        expect(newState.sections[0].startBeat).toBe(0);
        expect(newState.sections[0].endBeat).toBe(24);
        expect(newState.sections[1].id).toBe('s1');
        expect(newState.sections[1].startBeat).toBe(24);
        expect(newState.sections[1].endBeat).toBe(32);
    });
});
