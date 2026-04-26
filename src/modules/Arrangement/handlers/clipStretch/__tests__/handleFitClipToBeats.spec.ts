import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFitClipToBeats } from '../handleFitClipToBeats';

const mocks = vi.hoisted(() => ({
    fitClipToBeats: vi.fn(),
}));

vi.mock('../../../useCases/clipStretch/fitClipToBeats', () => ({
    fitClipToBeats: mocks.fitClipToBeats,
}));

describe('handleFitClipToBeats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes fitClipToBeats with the provided payload', () => {
        void handleFitClipToBeats.execute({
            type: 'fitClipToBeats',
            payload: { clipId: 'c1', targetBeats: 8 },
        });

        expect(mocks.fitClipToBeats).toHaveBeenCalledWith('c1', 8);
    });

    it('provides a description reflecting the target beats', () => {
        const desc = handleFitClipToBeats.describe({
            type: 'fitClipToBeats',
            payload: { clipId: 'c1', targetBeats: 8 },
        });
        expect(desc.label).toBe('Fit clip to 8 beats');
    });

    it('is undoable', () => {
        expect(handleFitClipToBeats.undoable).toBe(true);
    });
});
