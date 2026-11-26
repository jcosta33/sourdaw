import { getWarpState } from '../../stores/warpStates';

import { commitClipWarpState } from './commitClipWarpState';

/** Removes every named marker in one action, so one Undo restores them all. */
export function removeWarpMarkers(clipId: string, markerIds: readonly string[]): Promise<void> {
    const current = getWarpState(clipId);
    return commitClipWarpState(clipId, {
        ...current,
        markers: current.markers.filter((marker) => !markerIds.includes(marker.id)),
    });
}
