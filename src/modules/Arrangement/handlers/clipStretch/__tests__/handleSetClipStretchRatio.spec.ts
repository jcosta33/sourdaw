import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipStretchRatio } from '../handleSetClipStretchRatio';

const mocks = vi.hoisted(() => ({
    setClipStretchRatio: vi.fn(),
}));

vi.mock('../../../useCases/clipStretch/setClipStretchRatio', () => ({
    setClipStretchRatio: mocks.setClipStretchRatio,
}));

describe('handleSetClipStretchRatio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setClipStretchRatio with the provided payload', () => {
        void handleSetClipStretchRatio.execute({
            type: 'setClipStretchRatio',
            payload: { clipId: 'c1', ratio: 1.5 },
        });

        expect(mocks.setClipStretchRatio).toHaveBeenCalledWith('c1', 1.5);
    });

    it('provides a description reflecting the ratio', () => {
        const desc = handleSetClipStretchRatio.describe({
            type: 'setClipStretchRatio',
            payload: { clipId: 'c1', ratio: 1.5 },
        });
        expect(desc.label).toBe('Set clip stretch ratio to 1.5');
    });

    it('is undoable', () => {
        expect(handleSetClipStretchRatio.undoable).toBe(true);
    });
});
