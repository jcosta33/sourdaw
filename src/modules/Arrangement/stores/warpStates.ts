import { createWarpMarker, defaultWarpState, type WarpMarkerOrigin, type WarpState } from '../models/WarpMarker';

/**
 * In-memory warp state per clip. Lives in `stores/` (not `useCases/`) because
 * cross-module mutators (AudioEngine's elastic-audio operations) need a write
 * surface that doesn't pull the full `Arrangement/useCases` graph — that
 * graph closes the AudioEngine ↔ Arrangement cycle through duplicateClip →
 * Automation → AudioEngine.
 */
export const warpStates = new Map<string, WarpState>();

export function getWarpState(clipId: string): WarpState {
    return warpStates.get(clipId) ?? defaultWarpState;
}

export function addWarpMarker(
    clipId: string,
    originalBeat: number,
    warpedBeat: number,
    options?: { origin?: WarpMarkerOrigin; confidence?: number; locked?: boolean }
): void {
    const current = getWarpState(clipId);
    const marker = createWarpMarker(originalBeat, warpedBeat, options);
    warpStates.set(clipId, {
        ...current,
        markers: [...current.markers, marker].sort((alpha, buffer) => alpha.originalBeat - buffer.originalBeat),
    });
}
