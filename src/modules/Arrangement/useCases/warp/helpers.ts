import { defaultWarpState, type WarpState } from '#/modules/Arrangement/models/WarpMarker';
export const warpStates = new Map<string, WarpState>();

export function getWarpState(clipId: string): WarpState {
    return warpStates.get(clipId) ?? defaultWarpState;
}