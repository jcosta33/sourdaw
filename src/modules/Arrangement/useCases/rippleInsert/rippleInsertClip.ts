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
}

/**
 * Reverts a ripple insert: restores shifted clips to their original positions.
 */
export function undoRippleInsertClip({ trackId, plan }: Omit<RippleInsertClipInput, 'insertDuration'>): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    const shiftMap = new Map(plan.shiftedClips.map((state1) => [state1.clipId, state1]));

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== trackId) {
                return track;
            }
            return {
                ...track,
                clips: track.clips.map((clip) => {
                    const orig = shiftMap.get(clip.id);
                    if (!orig) {
                        return clip;
                    }
                    return {
                        ...clip,
                        startBeat: orig.origStartBeat,
                        endBeat: orig.origEndBeat,
                    };
                }),
            };
        }),
    });
}
