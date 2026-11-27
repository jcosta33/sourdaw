import { type WarpState } from '../models/WarpMarker';
import { addWarpMarker, getWarpState, setWarpState } from '../stores/warpStates';

/**
 * Seeds a clip's warp state through the store's own writer, for specs that exercise another subsystem's reaction to
 * warp state and run without a handler registry. Editor edits dispatch `setClipWarpState` instead.
 */
export function seedStretchMode(clipId: string, mode: WarpState['stretchMode']): void {
    setWarpState(clipId, { ...getWarpState(clipId), stretchMode: mode });
}

export function seedWarpEnabled(clipId: string): void {
    setWarpState(clipId, { ...getWarpState(clipId), enabled: true, originalTempo: null });
}

export function seedWarpMarker(clipId: string, beat: number): void {
    addWarpMarker(clipId, beat, beat, { origin: 'user' });
}
