import { getWarpState, warpStates } from './helpers';

export function moveWarpMarker(clipId: string, markerId: string, newWarpedBeat: number): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, {
        ...current,
        markers: current.markers.map((message) =>
            message.id === markerId ? { ...message, warpedBeat: newWarpedBeat } : message
        ),
    });
}
