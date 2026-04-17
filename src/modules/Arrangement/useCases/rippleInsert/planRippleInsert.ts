import { getTrackStoreState } from '../getTrackStoreState';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

type RippleInsertShift = {
    clipId: string;
    origStartBeat: number;
    origEndBeat: number;
};

export type RippleInsertPlan = {
    shiftedClips: RippleInsertShift[];
};

type PlanRippleInsertInput = {
    trackId: string;
    /** Beat position where the new clip will be inserted. */
    insertBeat: number;
    /** Duration of the new clip in beats. */
    insertDuration: number;
};

/**
 * Computes which clips need to move when a new clip is inserted in ripple mode (R-B3.1).
 *
 * Returns null when ripple editing is disabled or the track is not found.
 * Clips whose startBeat >= insertBeat are shifted forward by insertDuration.
 */
export function planRippleInsert({ trackId, insertBeat }: PlanRippleInsertInput): RippleInsertPlan | null {
    const rippleEnabled = getWorkspaceState()?.rippleEditing ?? false;
    if (!rippleEnabled) {
        return null;
    }

    const state = getTrackStoreState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return null;
    }

    const shiftedClips: RippleInsertShift[] = [];
    for (const clip of track.clips) {
        if (clip.startBeat >= insertBeat) {
            shiftedClips.push({
                clipId: clip.id,
                origStartBeat: clip.startBeat,
                origEndBeat: clip.endBeat,
            });
        }
    }

    return { shiftedClips };
}
