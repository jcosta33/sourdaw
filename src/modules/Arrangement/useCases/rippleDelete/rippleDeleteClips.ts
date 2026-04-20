import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackState } from '../setTrackState';

import { type PlanRippleDeleteOutput, planRippleDelete } from './planRippleDelete';

type RippleDeleteClipsInput = {
    trackId: string;
    clipIds: string[];
};

type RippleDeletePlan = NonNullable<PlanRippleDeleteOutput>;

type RippleDeleteClipsOutput = {
    removedClips: RippleDeletePlan['removedClips'];
    shiftedClips: RippleDeletePlan['shiftedClips'];
} | null;

export function rippleDeleteClips({ trackId, clipIds }: RippleDeleteClipsInput): RippleDeleteClipsOutput {
    const plan = planRippleDelete({ trackId, clipIds });
    if (!plan) {
        return null;
    }

    const state = getTrackStoreState();
    if (!state) {
        return null;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => (track.id === trackId ? { ...track, clips: plan.nextClips } : track)),
    });

    return {
        removedClips: plan.removedClips,
        shiftedClips: plan.shiftedClips,
    };
}
