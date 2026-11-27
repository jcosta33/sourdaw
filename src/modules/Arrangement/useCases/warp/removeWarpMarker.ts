import { removeWarpMarkers } from './removeWarpMarkers';

export function removeWarpMarker(clipId: string, markerId: string): Promise<void> {
    return removeWarpMarkers(clipId, [markerId]);
}
