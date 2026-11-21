/**
 * The track-height range the arrangement stores. The Arrangement writers clamp into it and the
 * agent command schema for track height publishes it, so both read one definition.
 */
export const MIN_TRACK_HEIGHT = 30;
export const MAX_TRACK_HEIGHT = 300;
/** The span a vertical-zoom delta can cover; a larger delta saturates every track at a bound. */
export const MAX_TRACK_ZOOM_DELTA = MAX_TRACK_HEIGHT - MIN_TRACK_HEIGHT;
