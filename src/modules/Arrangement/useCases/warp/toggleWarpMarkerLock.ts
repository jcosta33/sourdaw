import { getStoredWarpState } from '../../stores/warpStates';

import { commitClipWarpState } from './commitClipWarpState';

export async function toggleWarpMarkerLock(clipId: string, markerId: string): Promise<void> {
    const current = getStoredWarpState(clipId);
    if (!current?.markers.some((marker) => marker.id === markerId)) {
        return;
    }
    await commitClipWarpState(clipId, {
        ...current,
        markers: current.markers.map((marker) =>
            marker.id === markerId ? { ...marker, locked: !(marker.locked ?? false) } : marker
        ),
    });
}
