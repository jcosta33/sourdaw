import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetClipColor } from '../handleSetClipColor';

const mocks = vi.hoisted(() => ({
    setClipColor: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/setClipColor', () => ({
    setClipColor: mocks.setClipColor,
}));

describe('handleSetClipColor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setClipColor with the provided payload', () => {
        handleSetClipColor.execute({
            type: 'setClipColor',
            payload: { clipId: 'c1', color: '#ff0000' },
        });

        expect(mocks.setClipColor).toHaveBeenCalledWith('c1', '#ff0000');
    });

    it('provides a description', () => {
        const desc = handleSetClipColor.describe({
            type: 'setClipColor',
            payload: { clipId: 'c1', color: '#ff0000' },
        });
        expect(desc.label).toBe('Set clip color');
    });

    it('is undoable', () => {
        expect(handleSetClipColor.undoable).toBe(true);
    });
});
