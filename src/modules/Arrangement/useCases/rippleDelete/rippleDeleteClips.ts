import { shiftClipAutomation } from '#/modules/Automation/useCases';

import { readClipSatelliteEntry, type ClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackState } from '../setTrackState';
import { readClipScopedAutomationLanes } from '../clip/clipAutomationLaneTransition';
import { removeClipSatelliteData } from '../clip/removeClipSatelliteData';

import { type PlanRippleDeleteOutput, planRippleDelete } from './planRippleDelete';

type RippleDeleteClipsInput = {
    trackId: string;
    clipIds: string[];
};

type RippleDeletePlan = NonNullable<PlanRippleDeleteOutput>;

type RippleDeleteClipsOutput = {
    removedClips: RippleDeletePlan['removedClips'];
    shiftedClips: RippleDeletePlan['shiftedClips'];
    /** Gain envelopes and warp states the removed clips carried, captured
     *  before retirement so undo can restore them verbatim. */
    clipSatellites: readonly ClipSatelliteEntry[];
    /** Clip-scoped automation lanes the removed clips carried, captured
     *  before retirement so undo can restore them verbatim. */
    clipAutomationLanes: readonly ReturnType<typeof readClipScopedAutomationLanes>[number][];
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

    const removedClipIds = plan.removedClips.map((clip) => clip.id);
    // Capture what the removed clips carry before their satellites are
    // retired, so the caller's undo can restore it exactly.
    const clipSatellites = removedClipIds
        .map((clipId) => readClipSatelliteEntry(clipId))
        .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null);
    const clipAutomationLanes = readClipScopedAutomationLanes(removedClipIds);

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

    // Removed clips take their gain envelope, warp state, clip-scoped
    // automation lanes, and any ephemeral per-clip references with them —
    // an orphaned lane pins every later global time operation (ledger #2108).
    removeClipSatelliteData(removedClipIds);

    return {
        removedClips: plan.removedClips,
        shiftedClips: plan.shiftedClips,
        clipSatellites,
        clipAutomationLanes,
    };
}
