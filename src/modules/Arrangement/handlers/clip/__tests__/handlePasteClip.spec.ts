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
    });

    it('executes pasteClip', () => {
        handlePasteClip.execute({ type: 'pasteClip', payload: {} });
        expect(mocks.pasteClip).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handlePasteClip.describe({ type: 'pasteClip', payload: {} });
        expect(desc.label).toBe('Paste clip');
    });

    it('is undoable', () => {
        expect(handlePasteClip.undoable).toBe(true);
    });
});
