import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTrimClipStart } from '../handleTrimClipStart';

const mocks = vi.hoisted(() => ({
    trimClipStart: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; clips: { id: string; startBeat: number }[] }[] } | null>(),
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
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 1 }] }],
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

    it('is undoable', () => {
        expect(handleTrimClipStart.undoable).toBe(true);
    });
});
