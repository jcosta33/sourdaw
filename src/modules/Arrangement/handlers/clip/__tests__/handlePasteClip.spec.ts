import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handlePasteClip } from '../handlePasteClip';

const mocks = vi.hoisted(() => ({
    pasteClip: vi.fn(),
}));

vi.mock('../../../useCases/clipboard/pasteClip', () => ({
    pasteClip: mocks.pasteClip,
}));

describe('handlePasteClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pasteClip.mockReturnValue(true);
    });

    it('returns written only when pasteClip writes', () => {
        expect(handlePasteClip.execute({ type: 'pasteClip' })).toEqual({ status: 'written' });
        expect(mocks.pasteClip).toHaveBeenCalledTimes(1);

        mocks.pasteClip.mockReturnValue(false);
        expect(handlePasteClip.execute({ type: 'pasteClip' })).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handlePasteClip.describe({ type: 'pasteClip' });
        expect(desc.label).toBe('Paste clip');
    });

    it('is undoable', () => {
        expect(handlePasteClip.undoable).toBe(true);
    });
});
