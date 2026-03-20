/**
 * Selection and navigation helpers used by CommandRegistry and
 * keyboard-shortcut handlers.
 */
import { getTrackStoreState } from '#/modules/Track/useCases/trackQueries';
import { getWorkspaceStoreValue } from '#/modules/Workspace/useCases/workspaceQueries';
import { getMarkerState } from '#/modules/Timeline/useCases/timelineQueries';
import { getTransportStoreValue } from '#/modules/Transport/useCases/transportQueries';
import { seekPlayhead } from '#/modules/Transport/useCases/transportControls';

// ── Track / clip selection readers ──────────────────────────────────────

export const getSelectedTrackId = (): string | null => getTrackStoreState()?.selectedTrackId ?? null;

export const getSelectedClipId = (): string | null => {
    const ws = getWorkspaceStoreValue();
    if (!ws) {
        return null;
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds[0] ?? null;
    }
    return ws.selectedClipId;
};

export const getSelectedClipIds = (): string[] => {
    const ws = getWorkspaceStoreValue();
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
};

export const getAllClipIds = (): string[] => {
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
};

export const getLastClipEndBeat = (): number => {
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
};

// ── Marker navigation ───────────────────────────────────────────────────

export const goToNextMarker = (): void => {
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
};

export const goToPreviousMarker = (): void => {
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
};
