import { type WarpState } from '../../models/WarpMarker';

import { getWarpState, warpStates } from './helpers';

export function setStretchMode(clipId: string, mode: WarpState['stretchMode']): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, stretchMode: mode });
}
