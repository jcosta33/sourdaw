import { getWarpState, setWarpState } from '../../stores/warpStates';

export function removeWarpMarker(clipId: string, markerId: string): void {
    const current = getWarpState(clipId);
    setWarpState(clipId, {
        ...current,
        markers: current.markers.filter((message) => message.id !== markerId),
    });
}
