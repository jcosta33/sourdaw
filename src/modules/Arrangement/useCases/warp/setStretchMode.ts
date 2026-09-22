import { type WarpState } from '../../models/WarpMarker';
import { getWarpState, setWarpState } from '../../stores/warpStates';

export function setStretchMode(clipId: string, mode: WarpState['stretchMode']): void {
    const current = getWarpState(clipId);
    setWarpState(clipId, { ...current, stretchMode: mode });
}
