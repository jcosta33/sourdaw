import { shiftClipAutomation } from '#/modules/Automation/useCases';

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

    // Clip-scoped automation is timeline-absolute: collateral clips shifted
    // by the ripple must carry their lanes along or playback desyncs from
    // the arrangement (ledger M-025). MIDI notes are clip-relative and
    // follow the rectangle on their own.
    for (const shifted of plan.shiftedClips) {
        if (!plan.nextClips.some((clip) => clip.id === shifted.clipId)) {
            continue;
        }
        if (shifted.automationDelta !== 0) {
            shiftClipAutomation(shifted.clipId, shifted.automationDelta);
        }
    }

    return {
        removedClips: plan.removedClips,
        shiftedClips: plan.shiftedClips,
    };
}
