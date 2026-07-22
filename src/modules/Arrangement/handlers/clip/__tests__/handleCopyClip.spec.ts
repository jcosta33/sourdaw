import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCopyClip } from '../handleCopyClip';

const mocks = vi.hoisted(() => ({
    copySelectedClip: vi.fn(),
}));

vi.mock('../../../useCases/clipboard/copySelectedClip', () => ({
    copySelectedClip: mocks.copySelectedClip,
}));

describe('handleCopyClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.copySelectedClip.mockReturnValue(true);
    });

    it('returns written only when copySelectedClip writes', () => {
        expect(handleCopyClip.execute({ type: 'copyClip' })).toEqual({ status: 'written' });
        expect(mocks.copySelectedClip).toHaveBeenCalledTimes(1);

        mocks.copySelectedClip.mockReturnValue(false);
        expect(handleCopyClip.execute({ type: 'copyClip' })).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleCopyClip.describe({ type: 'copyClip' });
        expect(desc.label).toBe('Copy clip');
    });

    it('is not undoable', () => {
        expect(handleCopyClip.undoable).toBe(false);
    });
});
