import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeScratchPadSection } from '../scratchPadCrud/removeScratchPadSection';

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

describe('removeScratchPadSection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes section and re-indexes remaining sections', () => {
        mocks.scratchPadStoreValue.value = {
            sections: [
                { id: 's1', order: 0 },
                { id: 's2', order: 1 },
                { id: 's3', order: 2 },
            ]
        } as any;

        removeScratchPadSection('s2');

        expect(mocks.scratchPadStoreSet).toHaveBeenCalledWith({
            sections: [
                { id: 's1', order: 0 },
                { id: 's3', order: 1 },
            ]
        });
    });
});
