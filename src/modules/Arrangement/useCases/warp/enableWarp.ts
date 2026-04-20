import { getWarpState, warpStates } from './helpers';

export function enableWarp(clipId: string, originalTempo: number | null = null): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, enabled: true, originalTempo });
}
