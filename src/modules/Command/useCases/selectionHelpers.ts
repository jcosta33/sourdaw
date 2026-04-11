import { getMarkerState, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

export const selectionHelpersDependencies = {
    getTrackStoreState,
    getMarkerState,
    getTransportStoreValue,
    seekPlayhead,
    getWorkspaceState,
} as const;

export function getSelectedTrackId(): string | null {
    return getTrackStoreState()?.selectedTrackId ?? null;
}

export function getSelectedClipId(): string | null {
    const ws = getWorkspaceState();
    if (!ws) {
        return null;
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds[0] ?? null;
    }
    return ws.selectedClipId;
}

export function getSelectedClipIds(): string[] {
    const ws = getWorkspaceState();
    if (!ws) {
        return [];
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds;
    }
    if (ws.selectedClipId) {
        return [ws.selectedClipId];
    }
    return [];
}

export function getAllClipIds(): string[] {
    const state = getTrackStoreState();
    if (!state) {
        return [];
    }
    const ids: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            ids.push(clip.id);
        }
    }
    return ids;
}

export function getLastClipEndBeat(): number {
    const state = getTrackStoreState();
    if (!state) {
        return 0;
    }
    let maxEnd = 0;
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.endBeat > maxEnd) {
                maxEnd = clip.endBeat;
            }
        }
    }
    return maxEnd;
}

export function goToNextMarker(): void {
    const markers = getMarkerState()?.markers;
    const playhead = getTransportStoreValue()?.playheadPosition ?? 0;
    if (!markers || markers.length === 0) {
        return;
    }
    const sorted = [...markers].sort((a, b) => a.beat - b.beat);
    const next = sorted.find((m) => m.beat > playhead);
    if (next) {
        seekPlayhead(next.beat);
    }
}

export function goToPreviousMarker(): void {
    const markers = getMarkerState()?.markers;
    const playhead = getTransportStoreValue()?.playheadPosition ?? 0;
    if (!markers || markers.length === 0) {
        return;
    }
    const sorted = [...markers].sort((a, b) => b.beat - a.beat);
    const prev = sorted.find((m) => m.beat < playhead);
    if (prev) {
        seekPlayhead(prev.beat);
    }
}
