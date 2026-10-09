import {
    clipAutomationMoveStateMatches,
    getAutomationLanes,
    isExactAutomationLaneSnapshots,
} from '#/modules/Automation/useCases';
import {
    type AppAction,
    type ClipAutomationLaneSnapshot,
    type ClipSnapshot,
    type RippleShiftSnapshot,
} from '#/utils/handlerContract';

import { getTrackStoreState } from '../getTrackStoreState';

type LocatedClip = { owningTrackId: string; clip: ClipSnapshot };
type ShiftedOwnerState = {
    clips: readonly LocatedClip[];
    lanes: ReturnType<typeof getAutomationLanes>;
};

/** Exactly the geometry and automation `undoRippleDelete` writes, in group order.
 * Restored lanes matter even when that earlier removal did not ripple: a later
 * inverse may shift the clip the earlier inverse just brought back. */
function projectPriorRestores(state: ShiftedOwnerState, priorActions: readonly AppAction[]): ShiftedOwnerState | null {
    for (const action of priorActions) {
        if (action.type !== 'restoreClip') {
            continue;
        }
        const { trackId, clipSnapshot, ripplePlan } = action.payload;
        const removedClips = ripplePlan?.removedClips ?? [clipSnapshot];
        const liveClipIds = new Set(state.clips.map((owner) => owner.clip.id));
        if (removedClips.some((clip) => liveClipIds.has(clip.id))) {
            return null;
        }
        if (!ripplePlan) {
            state = { ...state, clips: [...state.clips, { owningTrackId: trackId, clip: clipSnapshot }] };
            continue;
        }
        if (!isExactAutomationLaneSnapshots(ripplePlan.clipAutomationLanes)) {
            return null;
        }
        const shifts = new Map(ripplePlan.shiftedClips.map((shift) => [shift.clipId, shift]));
        const clips = state.clips.map((owner) => {
            const shift = shifts.get(owner.clip.id);
            if (!shift || owner.owningTrackId !== trackId) {
                return owner;
            }
            return { ...owner, clip: { ...owner.clip, startBeat: shift.origStartBeat, endBeat: shift.origEndBeat } };
        });
        const shiftedLanes = state.lanes.map((lane) => {
            const shift = lane.clipId === undefined ? undefined : shifts.get(lane.clipId);
            if (!shift || shift.automationDelta === 0) {
                return lane;
            }
            return {
                ...lane,
                points: lane.points
                    .map((point) => ({ ...point, beat: Math.max(0, point.beat - shift.automationDelta) }))
                    .sort((left, right) => left.beat - right.beat),
            };
        });
        const liveIds = new Set(shiftedLanes.map((lane) => lane.id));
        if (ripplePlan.clipAutomationLanes.some((lane) => liveIds.has(lane.id))) {
            return null;
        }
        state = {
            clips: [...clips, ...ripplePlan.removedClips.map((clip) => ({ owningTrackId: trackId, clip }))],
            lanes: [...shiftedLanes, ...ripplePlan.clipAutomationLanes],
        };
    }
    return state;
}

/** Authenticate every collateral owner before any part of the restore writes. */
export function rippleDeleteShiftStateMatchesStore(
    trackId: string,
    shiftedClips: readonly RippleShiftSnapshot[],
    restoredLanes: readonly ClipAutomationLaneSnapshot[] = [],
    priorActions: readonly AppAction[] = []
): boolean {
    const tracks = getTrackStoreState()?.tracks ?? [];
    const state = projectPriorRestores(
        {
            clips: tracks.flatMap((track) => track.clips.map((clip) => ({ owningTrackId: track.id, clip }))),
            lanes: getAutomationLanes(),
        },
        priorActions
    );
    if (!state) {
        return false;
    }
    // The live transition guard enforces this at execution. Group preflight
    // must also see lane identities an earlier successful restore will occupy.
    const laneIds = new Set(state.lanes.map((lane) => lane.id));
    if (!isExactAutomationLaneSnapshots(restoredLanes) || restoredLanes.some((lane) => laneIds.has(lane.id))) {
        return false;
    }
    const seen = new Set<string>();
    return shiftedClips.every((shift) => {
        if (seen.has(shift.clipId)) {
            return false;
        }
        seen.add(shift.clipId);
        const owners = state.clips.filter((owner) => owner.clip.id === shift.clipId);
        const owner = owners[0];
        return (
            owners.length === 1 &&
            owner?.owningTrackId === trackId &&
            owner.clip.trackId === trackId &&
            Object.is(owner.clip.startBeat, shift.origStartBeat + shift.automationDelta) &&
            Object.is(owner.clip.endBeat, shift.origEndBeat + shift.automationDelta) &&
            // An old capture cannot authenticate lanes it never recorded.
            clipAutomationMoveStateMatches(shift.clipId, shift.expectedAutomationLanes ?? [], state.lanes)
        );
    });
}
