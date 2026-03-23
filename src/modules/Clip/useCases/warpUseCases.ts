import { createWarpMarker, defaultWarpState, type WarpState } from '#/modules/Clip/models/WarpMarker';

const warpStates = new Map<string, WarpState>();

export function getWarpState(clipId: string): WarpState {
    return warpStates.get(clipId) ?? defaultWarpState;
}

export function enableWarp(clipId: string, originalTempo: number | null = null): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, enabled: true, originalTempo });
}

export function disableWarp(clipId: string): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, enabled: false });
}

export function setStretchMode(clipId: string, mode: WarpState['stretchMode']): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, { ...current, stretchMode: mode });
}

export function addWarpMarker(clipId: string, originalBeat: number, warpedBeat: number): void {
    const current = getWarpState(clipId);
    const marker = createWarpMarker(originalBeat, warpedBeat);
    warpStates.set(clipId, {
        ...current,
        markers: [...current.markers, marker].sort((a, b) => a.originalBeat - b.originalBeat),
    });
}

export function removeWarpMarker(clipId: string, markerId: string): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, {
        ...current,
        markers: current.markers.filter((m) => m.id !== markerId),
    });
}

export function moveWarpMarker(clipId: string, markerId: string, newWarpedBeat: number): void {
    const current = getWarpState(clipId);
    warpStates.set(clipId, {
        ...current,
        markers: current.markers.map((m) => (m.id === markerId ? { ...m, warpedBeat: newWarpedBeat } : m)),
    });
}
