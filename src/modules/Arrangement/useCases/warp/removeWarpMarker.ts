import { getWarpState, warpStates } from '../../stores/warpStates';

export function removeWarpMarker(clipId: string, markerId: string): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, {
        ...current,
        markers: current.markers.filter((message) => message.id !== markerId),
    });
}
