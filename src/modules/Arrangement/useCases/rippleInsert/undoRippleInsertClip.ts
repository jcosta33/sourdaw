import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackState } from '../setTrackState';

import { type RippleInsertPlan } from './planRippleInsert';

type UndoRippleInsertClipInput = {
    trackId: string;
    plan: RippleInsertPlan;
};

/**
 * Reverts a ripple insert: restores shifted clips to their original positions.
 */
export function undoRippleInsertClip({ trackId, plan }: UndoRippleInsertClipInput): void {
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
                        // The undo reverses the forward insert's relocation:
                        // the anchor rides the same delta back or the restored
                        // placement would read a spurious advance (#4988).
                        ...shiftLoopOriginEntry(clip, orig.origStartBeat - clip.startBeat),
                    };
                }),
            };
        }),
    });
}
