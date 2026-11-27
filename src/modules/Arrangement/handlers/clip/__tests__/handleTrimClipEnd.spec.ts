import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTrimClipEnd } from '../handleTrimClipEnd';

const mocks = vi.hoisted(() => ({
    trimClipEnd: vi.fn(),
    getTrackStoreState:
        vi.fn<
            () => { tracks: { id: string; clips: { id: string; startBeat?: number; endBeat: number }[] }[] } | null
        >(),
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
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 12 }] }],
        });

        const desc = handleTrimClipEnd.describe({
            type: 'trimClipEnd',
            payload: { clipId: 'c1', newEndBeat: 8 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'trimClipEnd',
            payload: { clipId: 'c1', newEndBeat: 12, expectedEndBeat: 8 },
        });
    });

    it.each([4, 2, Number.NaN])(
        'expects the live end in the inverse when a request of %s is not past the start and nothing is written',
        (newEndBeat) => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 4, endBeat: 12 }] }],
            });

            const desc = handleTrimClipEnd.describe({
                type: 'trimClipEnd',
                payload: { clipId: 'c1', newEndBeat },
            });

            expect(desc.inverseAction).toEqual({
                type: 'trimClipEnd',
                payload: { clipId: 'c1', newEndBeat: 12, expectedEndBeat: 12 },
            });
        }
    );

    it('is undoable', () => {
        expect(handleTrimClipEnd.undoable).toBe(true);
    });
});
