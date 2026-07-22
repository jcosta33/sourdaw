import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { getTrackStoreState, type TrackStoreState } from '../../getTrackStoreState';
import { setTrackState } from '../../setTrackState';
import { type RippleInsertPlan } from '../planRippleInsert';
import { rippleInsertClip } from '../rippleInsertClip';

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../setTrackState', () => ({
    setTrackState: vi.fn(),
}));

const { shiftClipAutomation } = vi.hoisted(() => ({
    shiftClipAutomation: vi.fn<(clipId: string, delta: number) => void>(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    shiftClipAutomation,
}));

describe('rippleInsertClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shifts collateral clips automation by the insert duration (regression: ledger M-025)', () => {
        const plannedClip = ClipDummy.create({
            id: 'clip-planned',
            trackId: 'track-target',
            startBeat: 2,
            endBeat: 4,
        });
        const targetTrack = TrackDummy.create({ id: 'track-target', clips: [plannedClip] });
        vi.mocked(getTrackStoreState).mockReturnValue({
            tracks: [targetTrack],
            selectedTrackId: 'track-target',
            ghostClips: [],
        });

        rippleInsertClip({
            trackId: 'track-target',
            insertDuration: 3,
            plan: { shiftedClips: [{ clipId: 'clip-planned', origStartBeat: 2, origEndBeat: 4 }] },
        });

        // Clip-scoped automation is timeline-absolute: it must follow the
        // collateral shift or playback desyncs from the arrangement. MIDI
        // notes are clip-relative and need no work here.
        expect(shiftClipAutomation).toHaveBeenCalledWith('clip-planned', 3);
        expect(shiftClipAutomation).toHaveBeenCalledTimes(1);
    });

    it('should shift only planned clips forward by the insert duration', () => {
        const clipBeforeInsert = ClipDummy.create({
            id: 'clip-before-insert',
            trackId: 'track-target',
            startBeat: 0,
            endBeat: 1,
        });
        const plannedClip = ClipDummy.create({
            id: 'clip-planned',
            trackId: 'track-target',
            startBeat: 2,
            endBeat: 4,
        });
        const unplannedClip = ClipDummy.create({
            id: 'clip-unplanned',
            trackId: 'track-target',
            startBeat: 5,
            endBeat: 6,
        });
        const otherTrackClip = ClipDummy.create({
            id: 'clip-other-track',
            trackId: 'track-other',
            startBeat: 2,
            endBeat: 4,
        });
        const targetTrack = TrackDummy.create({
            id: 'track-target',
            clips: [clipBeforeInsert, plannedClip, unplannedClip],
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
                    clipId: 'clip-planned',
                    origStartBeat: 2,
                    origEndBeat: 4,
                },
            ],
        };

        rippleInsertClip({
            trackId: 'track-target',
            insertDuration: 1.5,
            plan,
        });

        expect(setTrackState).toHaveBeenCalledWith({
            ...initialState,
            tracks: [
                {
                    ...targetTrack,
                    clips: [
                        clipBeforeInsert,
                        {
                            ...plannedClip,
                            startBeat: 3.5,
                            endBeat: 5.5,
                        },
                        unplannedClip,
                    ],
                },
                otherTrack,
            ],
        });
    });
});
