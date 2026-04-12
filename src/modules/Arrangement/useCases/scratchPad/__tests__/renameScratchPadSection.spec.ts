import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renameScratchPadSection } from '../scratchPadCrud/renameScratchPadSection';

const mocks = vi.hoisted(() => ({
    scratchPadStoreValue: { value: { sections: [] } },
    scratchPadStoreSet: vi.fn(),
}));

vi.mock('../../../stores/scratchPadStore', () => ({
    scratchPadStore: {
        get value() { return mocks.scratchPadStoreValue.value; },
        set: mocks.scratchPadStoreSet,
    }
}));

describe('renameScratchPadSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renames correct section', () => {
        mocks.scratchPadStoreValue.value = {
            sections: [{ id: 's1', name: 'Old' }]
        } as any;

        renameScratchPadSection('s1', 'New');

        expect(mocks.scratchPadStoreSet).toHaveBeenCalledWith({
            sections: [{ id: 's1', name: 'New' }]
        });
    });
});
