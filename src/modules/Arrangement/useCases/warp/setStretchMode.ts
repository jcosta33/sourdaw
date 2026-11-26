import { type WarpState } from '../../models/WarpMarker';
import { getWarpState } from '../../stores/warpStates';

import { commitClipWarpState } from './commitClipWarpState';

export function setStretchMode(clipId: string, mode: WarpState['stretchMode']): Promise<void> {
    return commitClipWarpState(clipId, { ...getWarpState(clipId), stretchMode: mode });
}
