import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTrimClipStart } from '../handleTrimClipStart';

const mocks = vi.hoisted(() => ({
    trimClipStart: vi.fn(),
    getTrackStoreState:
        vi.fn<() => { tracks: { id: string; clips: { id: string; startBeat: number; endBeat: number }[] }[] } | null>(),
    planTrimmedTakeStarts: vi.fn<
        typeof import('../../../useCases/comping/planTrimmedTakeStarts').planTrimmedTakeStarts
    >(() => ({ before: [], after: [] })),
}));

vi.mock('../../../useCases/comping/planTrimmedTakeStarts', () => ({
    planTrimmedTakeStarts: mocks.planTrimmedTakeStarts,
}));

vi.mock('../../../useCases/clipEditing/trimClipStart', () => ({
    trimClipStart: mocks.trimClipStart,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleTrimClipStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.planTrimmedTakeStarts.mockReturnValue({ before: [], after: [] });
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
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse back to the pre-trim start beat', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 1, endBeat: 8 }] }],
        });

        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 1 },
        });
    });

    it('describes the clip and the moved loop passes as one inverse', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 1, endBeat: 8 }] }],
        });
        mocks.planTrimmedTakeStarts.mockReturnValue({
            before: [{ takeId: 'pass-1', startBeat: 1, sourceOffsetBeats: 0 }],
            after: [{ takeId: 'pass-1', startBeat: 2, sourceOffsetBeats: 1 }],
        });

        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(mocks.planTrimmedTakeStarts).toHaveBeenCalledWith({
            clipId: 'c1',
            previousStartBeat: 1,
            newStartBeat: 2,
        });
        expect(desc.inverseAction).toEqual({
            type: 'restoreClipStartTrim',
            payload: {
                clipId: 'c1',
                newStartBeat: 1,
                takes: [{ takeId: 'pass-1', startBeat: 1, sourceOffsetBeats: 0 }],
            },
        });
    });

    it('plans no take moves for a trim that does not apply', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 1, endBeat: 8 }] }],
        });

        handleTrimClipStart.describe({ type: 'trimClipStart', payload: { clipId: 'c1', newStartBeat: 9 } });

        expect(mocks.planTrimmedTakeStarts).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleTrimClipStart.undoable).toBe(true);
    });
});
