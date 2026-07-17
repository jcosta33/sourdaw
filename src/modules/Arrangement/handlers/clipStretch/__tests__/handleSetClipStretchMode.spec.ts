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
        void handleSetClipStretchMode.execute({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'timestretch' },
        });

        expect(mocks.setClipStretchMode).toHaveBeenCalledWith('c1', 'timestretch');
    });

    it('provides a description reflecting the mode', () => {
        const desc = handleSetClipStretchMode.describe({
            type: 'setClipStretchMode',
            payload: { clipId: 'c1', mode: 'timestretch' },
        });
        expect(desc.label).toBe('Set clip stretch mode to timestretch');
    });

    it('is undoable', () => {
        expect(handleSetClipStretchMode.undoable).toBe(true);
    });
});
