import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTrimClipEnd } from '../handleTrimClipEnd';

const mocks = vi.hoisted(() => ({
    trimClipEnd: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; clips: { id: string; endBeat: number }[] }[] } | null>(),
}));

vi.mock('../../../useCases/clipEditing/trimClipEnd', () => ({
    trimClipEnd: mocks.trimClipEnd,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleTrimClipEnd', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes trimClipEnd with the provided payload', () => {
        void handleTrimClipEnd.execute({
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
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse back to the pre-trim end beat', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', endBeat: 12 }] }],
        });

        const desc = handleTrimClipEnd.describe({
            type: 'trimClipEnd',
            payload: { clipId: 'c1', newEndBeat: 8 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'trimClipEnd',
            payload: { clipId: 'c1', newEndBeat: 12 },
        });
    });

    it('is undoable', () => {
        expect(handleTrimClipEnd.undoable).toBe(true);
    });
});
