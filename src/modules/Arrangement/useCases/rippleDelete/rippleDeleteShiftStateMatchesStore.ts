import { clipAutomationMoveStateMatches, isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { type AppAction, type ClipAutomationLaneSnapshot, type RippleShiftSnapshot } from '#/utils/handlerContract';

import { projectClipReplayPrefix } from '../clipEditing/projectClipReplayPrefix';

/** Authenticate every collateral owner before any part of the restore writes. */
export function rippleDeleteShiftStateMatchesStore(
    trackId: string,
    shiftedClips: readonly RippleShiftSnapshot[],
    restoredLanes: readonly ClipAutomationLaneSnapshot[] = [],
    priorActions: readonly AppAction[] = []
): boolean {
    const state = projectClipReplayPrefix(priorActions);
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
