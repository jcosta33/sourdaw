import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reorderScratchPadSection } from '../scratchPadCrud/reorderScratchPadSection';

const mocks = vi.hoisted(() => ({
    scratchPadStoreValue: { value: { sections: [] } },
    scratchPadStoreSet: vi.fn(),
}));

vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        get value() {
            return mocks.scratchPadStoreValue.value;
        },
        set: mocks.scratchPadStoreSet,
    },
}));

describe('reorderScratchPadSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('swaps two sections and updates their beats/orders', () => {
        mocks.scratchPadStoreValue.value = {
            sections: [
                { id: 's1', order: 0, startBeat: 0, endBeat: 8 }, // Duration 8
                { id: 's2', order: 1, startBeat: 8, endBeat: 24 }, // Duration 16
            ],
        } as any;

        reorderScratchPadSection('s1', 'right');

        expect(mocks.scratchPadStoreSet).toHaveBeenCalledTimes(1);
        const setCall = mocks.scratchPadStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('expected scratchPadStore.set to be called');
        }
        const sections = setCall[0].sections;

        // s2 should now be at 0, duration 16. End at 16.
        expect(sections[0].id).toBe('s2');
        expect(sections[0].startBeat).toBe(0);
        expect(sections[0].endBeat).toBe(16);
        expect(sections[0].order).toBe(0);

        // s1 should now be at 16, duration 8. End at 24.
        expect(sections[1].id).toBe('s1');
        expect(sections[1].startBeat).toBe(16);
        expect(sections[1].endBeat).toBe(24);
        expect(sections[1].order).toBe(1);
    });
});
