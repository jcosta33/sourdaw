import { getWarpState, setWarpState } from '../../stores/warpStates';

export function enableWarp(clipId: string, originalTempo: number | null = null): void {
    const current = getWarpState(clipId);
    setWarpState(clipId, { ...current, enabled: true, originalTempo });
}
