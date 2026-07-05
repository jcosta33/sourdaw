import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { getTrackStoreState, type TrackStoreState } from '../../getTrackStoreState';
import { setTrackState } from '../../setTrackState';
import { type RippleInsertPlan } from '../planRippleInsert';
import { undoRippleInsertClip } from '../undoRippleInsertClip';

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../setTrackState', () => ({
    setTrackState: vi.fn(),
}));

describe('undoRippleInsertClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should restore planned clips to their original start and end beats', () => {
        const shiftedClip = ClipDummy.create({
            id: 'clip-shifted',
            trackId: 'track-target',
            startBeat: 3.5,
            endBeat: 5.5,
        });
        const unplannedClip = ClipDummy.create({
            id: 'clip-unplanned',
            trackId: 'track-target',
            startBeat: 7,
            endBeat: 8,
        });
        const otherTrackClip = ClipDummy.create({
            id: 'clip-other-track',
            trackId: 'track-other',
            startBeat: 3.5,
            endBeat: 5.5,
        });
        const targetTrack = TrackDummy.create({
            id: 'track-target',
            clips: [shiftedClip, unplannedClip],
        });
        const otherTrack = TrackDummy.create({
            id: 'track-other',
            clips: [otherTrackClip],
        });
        const initialState: TrackStoreState = {
            tracks: [targetTrack, otherTrack],
            selectedTrackId: 'track-target',
            ghostClips: [],
        };
        vi.mocked(getTrackStoreState).mockReturnValue(initialState);

        const plan: RippleInsertPlan = {
            shiftedClips: [
                {
                    clipId: 'clip-shifted',
                    origStartBeat: 2,
                    origEndBeat: 4,
                },
            ],
        };

        undoRippleInsertClip({
            trackId: 'track-target',
            plan,
        });

        expect(setTrackState).toHaveBeenCalledWith({
            ...initialState,
            tracks: [
                {
                    ...targetTrack,
                    clips: [
                        {
                            ...shiftedClip,
                            startBeat: 2,
                            endBeat: 4,
                        },
                        unplannedClip,
                    ],
                },
                otherTrack,
            ],
        });
    });
});
