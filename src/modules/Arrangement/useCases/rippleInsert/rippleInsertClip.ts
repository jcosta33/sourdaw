import { shiftClipAutomation } from '#/modules/Automation/useCases';

import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackState } from '../setTrackState';

import { type RippleInsertPlan } from './planRippleInsert';

type RippleInsertClipInput = {
    trackId: string;
    /** Duration used to shift subsequent clips forward. */
    insertDuration: number;
    plan: RippleInsertPlan;
};

/**
 * Executes a ripple insert: shifts clips listed in the plan forward by insertDuration (R-B3.1).
 */
export function rippleInsertClip({ trackId, insertDuration, plan }: RippleInsertClipInput): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const shiftSet = new Set(plan.shiftedClips.map((state1) => state1.clipId));

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }
            return {
                ...track,
                clips: track.clips.map((clip) => {
                    if (!shiftSet.has(clip.id)) {
                        return clip;
                    }
                    return {
                        ...clip,
                        startBeat: clip.startBeat + insertDuration,
                        endBeat: clip.endBeat + insertDuration,
                    };
                }),
            };
        }),
    });

    // Timeline-absolute clip-scoped automation follows the collateral shift
    // (ledger M-025); clip-relative MIDI notes follow on their own.
    for (const shifted of plan.shiftedClips) {
        shiftClipAutomation(shifted.clipId, insertDuration);
    }
}
