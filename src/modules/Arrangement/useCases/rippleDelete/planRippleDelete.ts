import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type Clip } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';

type RippleDeleteShift = {
    clipId: string;
    origStartBeat: number;
    origEndBeat: number;
    automationDelta: number;
};

type RippleDeletePlan = {
    removedClips: Clip[];
    shiftedClips: RippleDeleteShift[];
    nextClips: Clip[];
};

type PlanRippleDeleteInput = {
    trackId: string;
    clipIds: string[];
};

export type PlanRippleDeleteOutput = RippleDeletePlan | null;

export function planRippleDelete({ trackId, clipIds }: PlanRippleDeleteInput): PlanRippleDeleteOutput {
    const state = getTrackStoreState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((candidateTrack) => candidateTrack.id === trackId);
    if (!track) {
        return null;
    }

    const clipIdSet = new Set(clipIds);
    const removedClips = track.clips.filter((clip) => clipIdSet.has(clip.id));
    if (removedClips.length === 0) {
        return null;
    }

    let deleteStart = Infinity;
    let deleteEnd = -Infinity;
    for (const clip of removedClips) {
        if (clip.startBeat < deleteStart) {
            deleteStart = clip.startBeat;
        }
        if (clip.endBeat > deleteEnd) {
            deleteEnd = clip.endBeat;
        }
    }
    const gap = deleteEnd - deleteStart;
    const rippleEnabled = workspaceStore.value?.rippleEditing ?? false;
    const shiftedClips: RippleDeleteShift[] = [];

    const nextClips = track.clips.reduce<Clip[]>((accumulator, clip) => {
        if (clipIdSet.has(clip.id)) {
            return accumulator;
        }

        if (rippleEnabled && clip.startBeat >= deleteEnd) {
            shiftedClips.push({
                clipId: clip.id,
                origStartBeat: clip.startBeat,
                origEndBeat: clip.endBeat,
                automationDelta: -gap,
            });
            accumulator.push({
                ...clip,
                startBeat: clip.startBeat - gap,
                endBeat: clip.endBeat - gap,
            });
            return accumulator;
        }

        accumulator.push(clip);
        return accumulator;
    }, []);

    return { removedClips, shiftedClips, nextClips };
}
