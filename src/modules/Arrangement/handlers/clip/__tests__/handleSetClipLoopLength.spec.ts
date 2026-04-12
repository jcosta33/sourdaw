import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetClipLoopLength } from '../handleSetClipLoopLength';

const mocks = vi.hoisted(() => ({
    setClipLoopLength: vi.fn(),
}));

vi.mock('../../../useCases/clipLoop/setClipLoopLength', () => ({
    setClipLoopLength: mocks.setClipLoopLength,
}));

describe('handleSetClipLoopLength', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setClipLoopLength with the provided payload', () => {
        handleSetClipLoopLength.execute({
            type: 'setClipLoopLength',
            payload: { clipId: 'c1', loopLength: 4 },
        });

        expect(mocks.setClipLoopLength).toHaveBeenCalledWith('c1', 4);
    });

    it('provides a description', () => {
        const desc = handleSetClipLoopLength.describe({
            type: 'setClipLoopLength',
            payload: { clipId: 'c1', loopLength: 4 },
        });
        expect(desc.label).toBe('Set clip loop length');
    });

    it('is undoable', () => {
        expect(handleSetClipLoopLength.undoable).toBe(true);
    });
});
