import { updateWarpMarkerBeat } from './updateWarpMarkerBeat';

export function moveWarpMarker(clipId: string, markerId: string, newWarpedBeat: number): void {
    updateWarpMarkerBeat({ clipId, markerId, field: 'warpedBeat', beat: newWarpedBeat });
}
