import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDiscardDuplicatedClip } from '../handleDiscardDuplicatedClip';

const mocks = vi.hoisted(() => ({
    removeClip: vi.fn(),
}));

vi.mock('../../../useCases/clip/removeClip', () => ({
    removeClip: mocks.removeClip,
}));

describe('handleDiscardDuplicatedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should remove the duplicated clip directly', () => {
        void handleDiscardDuplicatedClip.execute({
            type: 'discardDuplicatedClip',
            payload: { clipId: 'clip-copy' },
        });

        expect(mocks.removeClip).toHaveBeenCalledWith('clip-copy');
    });

    it('should provide an internal inverse description', () => {
        const desc = handleDiscardDuplicatedClip.describe({
            type: 'discardDuplicatedClip',
            payload: { clipId: 'clip-copy' },
        });

        expect(desc).toEqual({ label: 'Discard duplicated clip' });
    });

    it('should not create a new undo entry', () => {
        expect(handleDiscardDuplicatedClip.undoable).toBe(false);
    });
});
