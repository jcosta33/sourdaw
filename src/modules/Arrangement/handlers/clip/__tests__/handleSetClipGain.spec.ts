import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetClipGain } from '../handleSetClipGain';

const mocks = vi.hoisted(() => ({
    setClipGain: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/setClipGain', () => ({
    setClipGain: mocks.setClipGain,
}));

describe('handleSetClipGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setClipGain with the provided payload', () => {
        handleSetClipGain.execute({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });

        expect(mocks.setClipGain).toHaveBeenCalledWith('c1', 0.5);
    });

    it('provides a description', () => {
        const desc = handleSetClipGain.describe({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });
        expect(desc.label).toBe('Set clip gain');
    });

    it('is undoable', () => {
        expect(handleSetClipGain.undoable).toBe(true);
    });
});
