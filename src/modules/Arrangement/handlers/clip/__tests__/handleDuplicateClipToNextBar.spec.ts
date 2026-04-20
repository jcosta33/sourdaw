import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateClipToNextBar } from '../handleDuplicateClipToNextBar';

const mocks = vi.hoisted(() => ({
    duplicateClipToNextBar: vi.fn(),
}));

vi.mock('../../../useCases/clip/duplicateClipToNextBar', () => ({
    duplicateClipToNextBar: mocks.duplicateClipToNextBar,
}));

describe('handleDuplicateClipToNextBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes duplicateClipToNextBar with the provided payload', () => {
        handleDuplicateClipToNextBar.execute({
            type: 'duplicateClipToNextBar',
            payload: { clipId: 'c1' },
        });

        expect(mocks.duplicateClipToNextBar).toHaveBeenCalledWith('c1');
    });

    it('provides a description', () => {
        const desc = handleDuplicateClipToNextBar.describe({
            type: 'duplicateClipToNextBar',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Duplicate clip to next bar');
    });

    it('is undoable', () => {
        expect(handleDuplicateClipToNextBar.undoable).toBe(true);
    });
});
