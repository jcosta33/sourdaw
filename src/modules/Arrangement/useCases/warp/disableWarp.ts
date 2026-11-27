import { getWarpState } from '../../stores/warpStates';

import { commitClipWarpState } from './commitClipWarpState';

export function disableWarp(clipId: string): Promise<void> {
    return commitClipWarpState(clipId, { ...getWarpState(clipId), enabled: false });
}
