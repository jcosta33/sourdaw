import { describe, it, expect, vi, beforeEach } from 'vitest';

import { undoRippleDelete } from '../undoRippleDelete';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackState: vi.fn(),
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

describe('undoRippleDelete', () => {
    beforeEach(() => vi.clearAllMocks());

    it('restores removed clips and shifts back shifted clips', () => {
        const shiftedClip = { id: 'c3', startBeat: 6, endBeat: 10 }; // Currently at 6
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [shiftedClip] }],
        });

        undoRippleDelete({
            trackId: 't1',
            removedClips: [{ id: 'c2', startBeat: 4, endBeat: 8 } as any],
            shiftedClips: [{ clipId: 'c3', origStartBeat: 10, origEndBeat: 14 }],
        });

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const newState = mocks.setTrackState.mock.calls[0][0];
        const track = newState.tracks[0];

        expect(track.clips).toHaveLength(2);

        // c3 shifted back to 10
        const c3 = track.clips.find((c: any) => c.id === 'c3');
        expect(c3).toMatchObject({ startBeat: 10, endBeat: 14 });

        // c2 restored
        const c2 = track.clips.find((c: any) => c.id === 'c2');
        expect(c2).toMatchObject({ id: 'c2', startBeat: 4, endBeat: 8 });
    });
});
