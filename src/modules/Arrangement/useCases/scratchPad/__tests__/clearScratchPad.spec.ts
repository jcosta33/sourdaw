import { describe, it, expect, vi } from 'vitest';

import { clearScratchPad } from '../scratchPadCrud/clearScratchPad';

const mocks = vi.hoisted(() => ({
    scratchPadStoreSet: vi.fn(),
}));

vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        set: mocks.scratchPadStoreSet,
    },
}));

describe('clearScratchPad', () => {
    it('empties sections', () => {
        clearScratchPad();
        expect(mocks.scratchPadStoreSet).toHaveBeenCalledWith({ sections: [] });
    });
});
