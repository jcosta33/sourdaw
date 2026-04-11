import { createWarpMarker } from '#/modules/Arrangement/models/WarpMarker';
import { getWarpState, warpStates } from './helpers';

export function addWarpMarker(clipId: string, originalBeat: number, warpedBeat: number): void {
    const current = getWarpState(clipId);
    const marker = createWarpMarker(originalBeat, warpedBeat);
    warpStates.set(clipId, {
        ...current,
        markers: [...current.markers, marker].sort((a, b) => a.originalBeat - b.originalBeat),
    });
}