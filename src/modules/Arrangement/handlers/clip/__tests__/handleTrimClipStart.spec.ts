import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTrimClipStart } from '../handleTrimClipStart';

const mocks = vi.hoisted(() => ({
    trimClipStart: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/trimClipStart', () => ({
    trimClipStart: mocks.trimClipStart,
}));

describe('handleTrimClipStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes trimClipStart with the provided payload', () => {
        void handleTrimClipStart.execute({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(mocks.trimClipStart).toHaveBeenCalledWith('c1', 2);
    });

    it('provides a description', () => {
        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });
        expect(desc.label).toBe('Trim clip start');
    });

    it('is undoable', () => {
        expect(handleTrimClipStart.undoable).toBe(true);
    });
});
