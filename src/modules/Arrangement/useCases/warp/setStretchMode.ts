import { type WarpState } from '../../models/WarpMarker';
import { getWarpState, warpStates } from '../../stores/warpStates';

export function setStretchMode(clipId: string, mode: WarpState['stretchMode']): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, stretchMode: mode });
}
