import { getRenderedTrackTops } from '../models/TimelineTrackExtent';
import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';

import { buildTimelineRenderModel } from './buildTimelineRenderModel';

function getRevealScrollPosition(
    targetStart: number,
    targetEnd: number,
    scrollStart: number,
    viewportSize: number
): number {
    if (viewportSize <= 0) {
        return targetStart;
    }

    const scrollEnd = scrollStart + viewportSize;
    const targetIsVisible = targetStart >= scrollStart && targetEnd <= scrollEnd;
    const targetCoversViewport = targetStart <= scrollStart && targetEnd >= scrollEnd;
    if (targetIsVisible || targetCoversViewport) {
        return scrollStart;
    }

    if (targetEnd - targetStart > viewportSize) {
        if (targetStart < scrollStart) {
            return targetEnd - viewportSize;
        }
        return targetStart;
    }

    if (targetStart < scrollStart) {
        return targetStart;
    }

    return targetEnd - viewportSize;
}

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
    const nextScrollX = getRevealScrollPosition(clipStartX, clipEndX, view.scrollX, viewportWidth);
    if (nextScrollX !== view.scrollX) {
        setScrollX(nextScrollX);
    }

    const trackTop = getRenderedTrackTops(tracks)[trackIndex]!;
    const trackBottom = trackTop + track.height;
    const viewportHeight = view.viewportHeight ?? 0;
    const nextScrollY = getRevealScrollPosition(trackTop, trackBottom, view.scrollY, viewportHeight);
    if (nextScrollY !== view.scrollY) {
        setScrollY(nextScrollY);
    }
}
