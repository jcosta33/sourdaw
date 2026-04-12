import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTrimClipEnd } from '../handleTrimClipEnd';

const mocks = vi.hoisted(() => ({
    trimClipEnd: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/trimClipEnd', () => ({
    trimClipEnd: mocks.trimClipEnd,
}));

describe('handleTrimClipEnd', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes trimClipEnd with the provided payload', () => {
        handleTrimClipEnd.execute({
            type: 'trimClipEnd',
            payload: { clipId: 'c1', newEndBeat: 8 },
        });

        expect(mocks.trimClipEnd).toHaveBeenCalledWith('c1', 8);
    });

    it('provides a description', () => {
        const desc = handleTrimClipEnd.describe({
            type: 'trimClipEnd',
            payload: { clipId: 'c1', newEndBeat: 8 },
        });
        expect(desc.label).toBe('Trim clip end');
    });

    it('is undoable', () => {
        expect(handleTrimClipEnd.undoable).toBe(true);
    });
});
