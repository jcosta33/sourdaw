import { getWarpState, setWarpState } from '../../stores/warpStates';

export function disableWarp(clipId: string): void {
    const current = getWarpState(clipId);
    setWarpState(clipId, { ...current, enabled: false });
}
