import { timelineViewStore } from '../../../stores/timelineViewStore';
import { buildTimelineRenderModel } from '../../buildTimelineRenderModel';
import { getTrackAtY } from '../getTrackAtY';

import { RULER_HEIGHT } from './helpers';

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
