import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipLoop } from '../handleSetClipLoop';

const mocks = vi.hoisted(() => ({
    setClipLoop: vi.fn(),
}));

vi.mock('../../../useCases/clipLoop/setClipLoop', () => ({
    setClipLoop: mocks.setClipLoop,
}));

describe('handleSetClipLoop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setClipLoop with the provided payload', () => {
        handleSetClipLoop.execute({
            type: 'setClipLoop',
            payload: { clipId: 'c1', enabled: true },
        });

        expect(mocks.setClipLoop).toHaveBeenCalledWith('c1', true);
    });

    it('provides a description reflecting the enabled state', () => {
        const desc1 = handleSetClipLoop.describe({
            type: 'setClipLoop',
            payload: { clipId: 'c1', enabled: true },
        });
        expect(desc1.label).toBe('Enable clip loop');

        const desc2 = handleSetClipLoop.describe({
            type: 'setClipLoop',
            payload: { clipId: 'c1', enabled: false },
        });
        expect(desc2.label).toBe('Disable clip loop');
    });

    it('is undoable', () => {
        expect(handleSetClipLoop.undoable).toBe(true);
    });
});
