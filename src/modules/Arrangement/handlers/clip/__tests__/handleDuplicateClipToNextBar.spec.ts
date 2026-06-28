import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateClipToNextBar } from '../handleDuplicateClipToNextBar';

const mocks = vi.hoisted(() => ({
    duplicateClipToNextBar: vi.fn(),
    prepareDuplicateClipTargetId: vi.fn(() => 'clip-copy'),
}));

vi.mock('../../../useCases/clip/duplicateClipToNextBar', () => ({
    duplicateClipToNextBar: mocks.duplicateClipToNextBar,
}));

vi.mock('../../../useCases/clip/prepareDuplicateClipTargetId', () => ({
    prepareDuplicateClipTargetId: mocks.prepareDuplicateClipTargetId,
}));

describe('handleDuplicateClipToNextBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes duplicateClipToNextBar with the provided payload and target clip id', () => {
        void handleDuplicateClipToNextBar.execute({
            type: 'duplicateClipToNextBar',
            payload: { clipId: 'c1', targetClipId: 'clip-provided' },
        });

        expect(mocks.duplicateClipToNextBar).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-provided' });
        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
    });

    it('should prepare a reversible duplicate-to-next-bar action when no target clip id is provided', () => {
        const action = {
            type: 'duplicateClipToNextBar' as const,
            payload: { clipId: 'c1' },
        };

        const desc = handleDuplicateClipToNextBar.describe(action);
        void handleDuplicateClipToNextBar.execute(action);

        expect(desc).toEqual({
            label: 'Duplicate clip to next bar',
            inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: 'clip-copy' } },
        });
        expect(mocks.duplicateClipToNextBar).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-copy' });
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
