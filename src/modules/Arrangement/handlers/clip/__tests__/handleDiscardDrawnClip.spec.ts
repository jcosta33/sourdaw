import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDiscardDrawnClip } from '../handleDiscardDrawnClip';

const mocks = vi.hoisted(() => ({
    removeClip: vi.fn(),
    undoRippleInsertClip: vi.fn(),
}));

vi.mock('../../../useCases/clip/removeClip', () => ({ removeClip: mocks.removeClip }));
vi.mock('../../../useCases/rippleInsert/undoRippleInsertClip', () => ({
    undoRippleInsertClip: mocks.undoRippleInsertClip,
}));

describe('handleDiscardDrawnClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes exactly the drawn clip', () => {
        void handleDiscardDrawnClip.execute({
            type: 'discardDrawnClip',
            payload: { clipId: 'clip-drawn', trackId: 't1', ripplePlan: null },
        });

        expect(mocks.removeClip).toHaveBeenCalledWith('clip-drawn');
        expect(mocks.undoRippleInsertClip).not.toHaveBeenCalled();
    });

    it('restores the ripple-shifted neighbors the draw inserted', () => {
        const plan = { shiftedClips: [{ clipId: 'c9', origStartBeat: 5, origEndBeat: 9 }] };
        void handleDiscardDrawnClip.execute({
            type: 'discardDrawnClip',
            payload: { clipId: 'clip-drawn', trackId: 't1', ripplePlan: plan },
        });

        expect(mocks.removeClip).toHaveBeenCalledWith('clip-drawn');
        expect(mocks.undoRippleInsertClip).toHaveBeenCalledWith({ trackId: 't1', plan });
    });

    it('describes without an inverse and is not undoable', () => {
        const desc = handleDiscardDrawnClip.describe({
            type: 'discardDrawnClip',
            payload: { clipId: 'clip-drawn', trackId: 't1', ripplePlan: null },
        });

        expect(desc.label).toBe('Discard drawn clip');
        expect(desc.inverseAction).toBeUndefined();
        expect(handleDiscardDrawnClip.undoable).toBe(false);
    });
});
