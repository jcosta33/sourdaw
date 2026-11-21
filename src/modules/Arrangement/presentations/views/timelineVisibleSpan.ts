const UNMEASURED_VISIBLE_BEATS = 16;

/**
 * Pixel width of one timeline page: the timeline's own measured viewport, or 16 beats until it
 * has measured itself. The minimap's width is unrelated to it.
 */
export function getTimelineVisibleSpanPx(viewportWidth: number, pixelsPerBeat: number): number {
    return viewportWidth > 0 ? viewportWidth : UNMEASURED_VISIBLE_BEATS * pixelsPerBeat;
}

/** Beats the timeline currently shows, which is what the minimap highlight must cover. */
export function getTimelineVisibleBeats(viewportWidth: number, pixelsPerBeat: number): number {
    return getTimelineVisibleSpanPx(viewportWidth, pixelsPerBeat) / pixelsPerBeat;
}
