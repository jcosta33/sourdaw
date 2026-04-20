import { getWarpState, warpStates } from './helpers';

export function disableWarp(clipId: string): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, enabled: false });
}
