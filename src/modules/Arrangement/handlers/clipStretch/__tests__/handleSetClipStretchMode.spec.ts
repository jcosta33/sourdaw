import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetClipStretchMode } from '../handleSetClipStretchMode';

const mocks = vi.hoisted(() => ({
    setClipStretchMode: vi.fn(),
}));

vi.mock('../../../useCases/clipStretch/setClipStretchMode', () => ({
    setClipStretchMode: mocks.setClipStretchMode,
}));

describe('handleSetClipStretchMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setClipStretchMode with the provided payload', () => {
        handleSetClipStretchMode.execute({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'paulstretch' },
        });

        expect(mocks.setClipStretchMode).toHaveBeenCalledWith('c1', 'paulstretch');
    });

    it('provides a description reflecting the mode', () => {
        const desc = handleSetClipStretchMode.describe({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'paulstretch' },
        });
        expect(desc.label).toBe('Set clip stretch mode to paulstretch');
    });

    it('is undoable', () => {
        expect(handleSetClipStretchMode.undoable).toBe(true);
    });
});
