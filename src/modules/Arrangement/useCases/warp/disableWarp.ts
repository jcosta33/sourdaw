import { getWarpState, warpStates } from '../../stores/warpStates';

export function disableWarp(clipId: string): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, enabled: false });
}
