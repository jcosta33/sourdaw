import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateClip } from '../handleDuplicateClip';

const mocks = vi.hoisted(() => ({
    duplicateClip: vi.fn(),
    prepareDuplicateClipTargetId: vi.fn(() => 'clip-copy'),
}));

vi.mock('../../../useCases/clip/duplicateClip', () => ({
    duplicateClip: mocks.duplicateClip,
}));

vi.mock('../../../useCases/clip/prepareDuplicateClipTargetId', () => ({
    prepareDuplicateClipTargetId: mocks.prepareDuplicateClipTargetId,
}));

describe('handleDuplicateClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes duplicateClip with the provided payload and target clip id', () => {
        void handleDuplicateClip.execute({
            type: 'duplicateClip',
            payload: { clipId: 'c1', targetClipId: 'clip-provided' },
        });

        expect(mocks.duplicateClip).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-provided' });
        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
    });

    it('should prepare a reversible duplicate action when no target clip id is provided', () => {
        const action = {
            type: 'duplicateClip' as const,
            payload: { clipId: 'c1' },
        };

        const desc = handleDuplicateClip.describe(action);
        void handleDuplicateClip.execute(action);

        expect(desc).toEqual({
            label: 'Duplicate clip',
            inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: 'clip-copy' } },
        });
        expect(mocks.duplicateClip).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-copy' });
    });

    it('provides a description', () => {
        const desc = handleDuplicateClip.describe({
            type: 'duplicateClip',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Duplicate clip');
    });

    it('is undoable', () => {
        expect(handleDuplicateClip.undoable).toBe(true);
    });
});
