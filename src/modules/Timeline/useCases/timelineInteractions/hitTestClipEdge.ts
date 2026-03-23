import { timelineViewStore } from '../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';
import { getTrackAtY } from './getTrackAtY';

export type ClipEdge = 'left' | 'right' | 'body';

const RULER_HEIGHT = 0;
const EDGE_THRESHOLD_PX = 6;

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
