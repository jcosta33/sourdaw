import { getWarpState } from '../../stores/warpStates';

import { commitClipWarpState } from './commitClipWarpState';

export function enableWarp(clipId: string, originalTempo: number | null = null): Promise<void> {
    return commitClipWarpState(clipId, { ...getWarpState(clipId), enabled: true, originalTempo });
}
