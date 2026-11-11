import { getRenderedTrackTops } from '../models/TimelineTrackExtent';
import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';

import { buildTimelineRenderModel } from './buildTimelineRenderModel';

/** Bring a rendered clip into the real timeline viewport without changing zoom. */
export function revealTimelineClip(clipId: string): void {
    const view = timelineViewStore.value;
    if (!view) {
        return;
    }
    const tracks = buildTimelineRenderModel().tracks;
    const trackIndex = tracks.findIndex((track) => track.clips.some((clip) => clip.id === clipId));
    if (trackIndex < 0) {
        return;
    }
    const track = tracks[trackIndex]!;
    const clip = track.clips.find((item) => item.id === clipId)!;
    const clipStartX = clip.startBeat * view.pixelsPerBeat;
    const clipEndX = clip.endBeat * view.pixelsPerBeat;
    const viewportWidth = view.viewportWidth ?? 0;
    const clipVisibleX = viewportWidth > 0 && clipStartX >= view.scrollX && clipEndX <= view.scrollX + viewportWidth;
    if (!clipVisibleX) {
        const nextScrollX =
            viewportWidth <= 0 || clipEndX - clipStartX > viewportWidth ? clipStartX : clipEndX - viewportWidth;
        setScrollX(nextScrollX);
    }

    const trackTop = getRenderedTrackTops(tracks)[trackIndex]!;
    const trackBottom = trackTop + track.height;
    const viewportHeight = view.viewportHeight ?? 0;
    const clipVisibleY = viewportHeight > 0 && trackTop >= view.scrollY && trackBottom <= view.scrollY + viewportHeight;
    if (!clipVisibleY) {
        const nextScrollY =
            viewportHeight <= 0 || track.height > viewportHeight ? trackTop : trackBottom - viewportHeight;
        setScrollY(nextScrollY);
    }
}
