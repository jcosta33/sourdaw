import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addScratchPadSection } from '../scratchPadCrud/addScratchPadSection';

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

describe('addScratchPadSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.scratchPadStoreValue.value = { sections: [] };
    });

    it('adds a section with correct order', () => {
        addScratchPadSection(0, 16, 'Idea 1', '#f00');

        expect(mocks.scratchPadStoreSet).toHaveBeenCalledTimes(1);
        const newState = mocks.scratchPadStoreSet.mock.calls[0][0];
        expect(newState.sections).toHaveLength(1);
        expect(newState.sections[0]).toMatchObject({
            startBeat: 0,
            endBeat: 16,
            name: 'Idea 1',
            color: '#f00',
            order: 0,
        });
    });
});
