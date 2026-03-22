import { getTransportState, updateTransportState } from '#/modules/Transport/useCases/transportQueries';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { timelineViewStore } from '../stores/timelineViewStore';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { buildTimelineRenderModel } from './buildTimelineRenderModel';

const getTrackState = () => trackStore.value;
const getAllTracks = () => trackStore.value?.tracks ?? [];
import { moveClip } from '#/modules/Track/useCases/clipUseCases';
import { trimClipStart, trimClipEnd } from '#/modules/Track/useCases/clipEditingUseCases';
import { preferencesStore } from '#/modules/Workspace/stores/preferencesStore';
import { AUTOMATION_SUB_LANE_HEIGHT } from '../models/automationConstants';
import { gridSnapBeats } from '#/modules/Workspace/models/Preferences';

const RULER_HEIGHT = 0;

function getGridSnap(): number {
    const prefs = preferencesStore.value;
    if (!prefs?.snapToGrid) {
        return 0;
    }
    return gridSnapBeats(prefs.gridSubdivision);
}

export function snapToGrid(beat: number): number {
    const snap = getGridSnap();
    if (snap === 0) {
        return beat;
    }
    return Math.round(beat / snap) * snap;
}

export function snapToGridOrClips(beat: number, trackId: string, excludeClipId?: string): number {
    const tracks = getAllTracks();
    const track = tracks.find((t) => t.id === trackId);

    if (track) {
        const SNAP_THRESHOLD = 0.25;
        for (const clip of track.clips) {
            if (clip.id === excludeClipId) {
                continue;
            }
            if (Math.abs(beat - clip.startBeat) < SNAP_THRESHOLD) {
                return clip.startBeat;
            }
            if (Math.abs(beat - clip.endBeat) < SNAP_THRESHOLD) {
                return clip.endBeat;
            }
        }
    }

    return snapToGrid(beat);
}

export function setPlayheadFromClick(canvasX: number): void {
    const viewState = timelineViewStore.value;
    const transport = getTransportState();
    if (!viewState || !transport) {
        return;
    }

    const beat = canvasX / viewState.pixelsPerBeat + viewState.scrollX / viewState.pixelsPerBeat;
    updateTransportState({ playheadPosition: Math.max(0, beat) });
}

export function getTrackAtY(
    tracks: { height: number; id: string }[],
    contentY: number
): { index: number; id: string } | null {
    let offset = 0;
    for (let i = 0; i < tracks.length; i++) {
        const h = tracks[i]!.height ?? 64;
        if (contentY >= offset && contentY < offset + h) {
            return { index: i, id: tracks[i]!.id };
        }
        offset += h;
    }
    return null;
}

export function hitTestClip(canvasX: number, canvasY: number): { clipId: string; trackId: string } | null {
    const viewState = timelineViewStore.value;
    const model = buildTimelineRenderModel();
    if (!viewState || !model) {
        return null;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));
    const hit = getTrackAtY(model.tracks, contentY);
    if (!hit) {
        return null;
    }

    const track = model.tracks[hit.index];
    if (!track) {
        return null;
    }

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

    for (const clip of track.clips) {
        if (beat >= clip.startBeat && beat <= clip.endBeat) {
            return { clipId: clip.id, trackId: track.id };
        }
    }

    return null;
}

export function hitTestTrack(canvasY: number): string | null {
    const viewState = timelineViewStore.value;
    const model = buildTimelineRenderModel();
    if (!model) {
        return null;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState?.scrollY ?? 0));
    const hit = getTrackAtY(model.tracks, contentY);
    return hit?.id ?? null;
}

export type DragState = {
    clipId: string;
    sourceTrackId: string;
    startBeat: number;
    endBeat: number;
    offsetBeat: number;
    mode: 'move' | 'stretch' | 'trim-start';
};

const EDGE_THRESHOLD_PX = 6;

export type ClipEdge = 'left' | 'right' | 'body';

export function hitTestClipEdge(
    canvasX: number,
    canvasY: number
): { clipId: string; trackId: string; edge: ClipEdge } | null {
    const viewState = timelineViewStore.value;
    const model = buildTimelineRenderModel();
    if (!viewState || !model) {
        return null;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));
    const hit = getTrackAtY(model.tracks, contentY);
    if (!hit) {
        return null;
    }

    const track = model.tracks[hit.index];
    if (!track) {
        return null;
    }

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

    for (const clip of track.clips) {
        if (beat >= clip.startBeat && beat <= clip.endBeat) {
            const clipStartPx = (clip.startBeat - viewportStartBeat) * viewState.pixelsPerBeat;
            const clipEndPx = (clip.endBeat - viewportStartBeat) * viewState.pixelsPerBeat;

            if (canvasX - clipStartPx < EDGE_THRESHOLD_PX) {
                return { clipId: clip.id, trackId: track.id, edge: 'left' };
            }
            if (clipEndPx - canvasX < EDGE_THRESHOLD_PX) {
                return { clipId: clip.id, trackId: track.id, edge: 'right' };
            }
            return { clipId: clip.id, trackId: track.id, edge: 'body' };
        }
    }
    return null;
}

export function beginClipDrag(
    canvasX: number,
    canvasY: number,
    mode: 'move' | 'stretch' | 'trim-start' = 'move'
): DragState | null {
    const hit = hitTestClip(canvasX, canvasY);
    if (!hit) {
        return null;
    }

    const viewState = timelineViewStore.value;
    if (!viewState) {
        return null;
    }

    const trackState = getTrackState();
    if (!trackState) {
        return null;
    }

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

    const track = trackState.tracks.find((t) => t.id === hit.trackId);
    const clip = track?.clips.find((c) => c.id === hit.clipId);
    if (!clip) {
        return null;
    }

    return {
        clipId: hit.clipId,
        sourceTrackId: hit.trackId,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        offsetBeat: beat - clip.startBeat,
        mode,
    };
}

export function commitClipDrag(drag: DragState, canvasX: number, canvasY: number): void {
    const viewState = timelineViewStore.value;
    const trackState = getTrackState();
    if (!viewState || !trackState) {
        return;
    }

    const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
    const beat = canvasX / viewState.pixelsPerBeat + viewportStartBeat;

    if (drag.mode === 'stretch') {
        const newEndBeat = Math.max(drag.startBeat + (getGridSnap() || 0.25), snapToGrid(beat));
        trimClipEnd(drag.clipId, newEndBeat);
        return;
    }

    if (drag.mode === 'trim-start') {
        const newStartBeat = Math.min(drag.endBeat - (getGridSnap() || 0.25), snapToGrid(beat));
        trimClipStart(drag.clipId, Math.max(0, newStartBeat));
        return;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));
    const model = buildTimelineRenderModel();
    const hit = model ? getTrackAtY(model.tracks, contentY) : null;
    let targetTrackId = hit && model ? model.tracks[hit.index]!.id : drag.sourceTrackId;

    // Prevent moving a clip to an incompatible track kind
    const clip = trackState.tracks.flatMap((t) => t.clips).find((c) => c.id === drag.clipId);
    if (clip) {
        const targetTrack = trackState.tracks.find((t) => t.id === targetTrackId);
        const clipKindIsAudio = clip.type === 'audio';
        const targetIsAudio = targetTrack?.kind === 'audio';
        const targetIsMidi = targetTrack?.kind === 'midi';
        if ((clipKindIsAudio && !targetIsAudio) || (!clipKindIsAudio && !targetIsMidi)) {
            targetTrackId = drag.sourceTrackId;
        }
    }

    const newStartBeat = Math.max(0, snapToGridOrClips(beat - drag.offsetBeat, targetTrackId, drag.clipId));
    moveClip(drag.clipId, targetTrackId, newStartBeat, drag.startBeat);
}

export type AutomationSubLaneHit = {
    laneId: string;
    trackId: string;
    subLaneIndex: number;
    value: number; // normalized 0..1 within the sub-lane
    beat: number;
};

/**
 * Hit-test whether a canvas coordinate falls inside an inline automation sub-lane.
 */
export function hitTestAutomationSubLane(canvasX: number, canvasY: number): AutomationSubLaneHit | null {
    const viewState = timelineViewStore.value;
    const trackState = getTrackState();
    // Import stores at the top-level of the file instead
    const workspace = workspaceStore.value;
    if (!viewState || !trackState || !workspace || workspace.automationVisibility === 'hidden') {
        return null;
    }

    const contentY = Math.max(0, canvasY - RULER_HEIGHT + (viewState.scrollY ?? 0));

    const subLaneMap = workspace.automationSubLanes;
    const model = buildTimelineRenderModel();
    if (!model) {
        return null;
    }

    let trackYOffset = 0;

    for (const track of model.tracks) {
        const paramIds = subLaneMap[track.id] ?? [];
        const totalHeight = track.height; // Already includes sub-lane expansion from build model
        const baseHeight = totalHeight - paramIds.length * AUTOMATION_SUB_LANE_HEIGHT;
        const trackBottom = trackYOffset + totalHeight;

        if (contentY >= trackYOffset && contentY < trackBottom) {
            // Check if Y is in the sub-lane area
            const localY = contentY - trackYOffset;
            if (localY >= baseHeight && paramIds.length > 0) {
                const subLaneLocalY = localY - baseHeight;
                const subLaneIndex = Math.floor(subLaneLocalY / AUTOMATION_SUB_LANE_HEIGHT);
                if (subLaneIndex >= 0 && subLaneIndex < paramIds.length) {
                    const withinLaneY = subLaneLocalY - subLaneIndex * AUTOMATION_SUB_LANE_HEIGHT;
                    const value = Math.max(0, Math.min(1, 1 - (withinLaneY - 2) / (AUTOMATION_SUB_LANE_HEIGHT - 4)));
                    const beat = canvasX / viewState.pixelsPerBeat + viewState.scrollX / viewState.pixelsPerBeat;

                    const autoState = automationStore.value;
                    const lane = autoState?.lanes.find(
                        (l) => l.trackId === track.id && l.parameterId === paramIds[subLaneIndex]
                    );

                    if (lane) {
                        return {
                            laneId: lane.id,
                            trackId: track.id,
                            subLaneIndex,
                            value,
                            beat,
                        };
                    }
                }
            }
        }
        trackYOffset += totalHeight;
    }

    return null;
}
