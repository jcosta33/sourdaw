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

    it('restores a looped clip with its anchor riding the undo delta', () => {
        // The forward insert shifted this clip 16 → 20 and its anchor with it;
        // the undo reverses the relocation, so the anchor rides the same delta
        // back — carried through, the restored placement would read a spurious
        // advance (#4988, the #5198 draw/discard round trip).
        const shiftedClip = ClipDummy.create({
            id: 'clip-shifted',
            trackId: 'track-target',
            startBeat: 20,
            endBeat: 22,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 20,
        });
        const targetTrack = TrackDummy.create({
            id: 'track-target',
            clips: [shiftedClip],
        });
        vi.mocked(getTrackStoreState).mockReturnValue({
            tracks: [targetTrack],
            selectedTrackId: 'track-target',
            ghostClips: [],
        });

        undoRippleInsertClip({
            trackId: 'track-target',
            plan: { shiftedClips: [{ clipId: 'clip-shifted', origStartBeat: 16, origEndBeat: 18 }] },
        });

        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    ...targetTrack,
                    clips: [
                        {
                            ...shiftedClip,
                            startBeat: 16,
                            endBeat: 18,
                            loopOriginBeat: 16,
                        },
                    ],
                },
            ],
            selectedTrackId: 'track-target',
            ghostClips: [],
        });
    });

    it('leaves the anchor key absent on an unanchored clip it restores', () => {
        // The entry-helper law: the key is written only when an anchor exists,
        // never as an explicit undefined.
        const shiftedClip = ClipDummy.create({
            id: 'clip-shifted',
            trackId: 'track-target',
            startBeat: 20,
            endBeat: 22,
        });
        const targetTrack = TrackDummy.create({
            id: 'track-target',
            clips: [shiftedClip],
        });
        vi.mocked(getTrackStoreState).mockReturnValue({
            tracks: [targetTrack],
            selectedTrackId: 'track-target',
            ghostClips: [],
        });

        undoRippleInsertClip({
            trackId: 'track-target',
            plan: { shiftedClips: [{ clipId: 'clip-shifted', origStartBeat: 16, origEndBeat: 18 }] },
        });

        const written = vi.mocked(setTrackState).mock.calls[0]?.[0];
        const restoredClip = written?.tracks[0]?.clips[0];
        if (!restoredClip) {
            throw new Error('Expected the restored clip to be written');
        }
        expect(restoredClip.startBeat).toBe(16);
        expect(Object.hasOwn(restoredClip, 'loopOriginBeat')).toBe(false);
    });

    it('is a no-op when the track store holds no state', () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null);

        undoRippleInsertClip({
            trackId: 'track-target',
            plan: { shiftedClips: [{ clipId: 'clip-shifted', origStartBeat: 2, origEndBeat: 4 }] },
        });

        expect(setTrackState).not.toHaveBeenCalled();
    });
});
