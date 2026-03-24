import { timelineViewStore } from '../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../buildTimelineRenderModel';
import { getTrackAtY } from './getTrackAtY';

const RULER_HEIGHT = 0;

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
