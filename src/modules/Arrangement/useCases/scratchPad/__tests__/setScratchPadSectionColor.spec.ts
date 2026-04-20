import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setScratchPadSectionColor } from '../scratchPadCrud/setScratchPadSectionColor';

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

describe('setScratchPadSectionColor', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates color of correct section', () => {
        mocks.scratchPadStoreValue.value = {
            sections: [{ id: 's1', color: '#000' }],
        } as any;

        setScratchPadSectionColor('s1', '#fff');

        expect(mocks.scratchPadStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's1', color: '#fff' }],
        });
    });
});
