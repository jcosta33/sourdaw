import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCutClip } from '../handleCutClip';

const mocks = vi.hoisted(() => ({
    cutSelectedClip: vi.fn(),
}));

vi.mock('../../../useCases/clipboard/cutSelectedClip', () => ({
    cutSelectedClip: mocks.cutSelectedClip,
}));

describe('handleCutClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cutSelectedClip.mockReturnValue(true);
    });

    it('returns written only when cutSelectedClip writes', () => {
        expect(handleCutClip.execute({ type: 'cutClip' })).toEqual({ status: 'written' });
        expect(mocks.cutSelectedClip).toHaveBeenCalledTimes(1);

        mocks.cutSelectedClip.mockReturnValue(false);
        expect(handleCutClip.execute({ type: 'cutClip' })).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleCutClip.describe({ type: 'cutClip' });
        expect(desc.label).toBe('Cut clip');
    });

    it('is undoable', () => {
        expect(handleCutClip.undoable).toBe(true);
    });
});
