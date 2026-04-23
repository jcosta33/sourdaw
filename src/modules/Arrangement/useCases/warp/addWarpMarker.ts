import { createWarpMarker, type WarpMarkerOrigin } from '../../models/WarpMarker';

import { getWarpState, warpStates } from './helpers';

export function addWarpMarker(
    clipId: string,
    originalBeat: number,
    warpedBeat: number,
    options?: { origin?: WarpMarkerOrigin; confidence?: number; locked?: boolean }
): void {
    const current = getWarpState(clipId);
    const marker = createWarpMarker(originalBeat, warpedBeat, options);
    warpStates.set(clipId, {
        ...current,
        markers: [...current.markers, marker].sort((a, b) => a.originalBeat - b.originalBeat),
    });
}
