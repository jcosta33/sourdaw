import { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '#/utils/trackHeightLimits';

export { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT };
export const DEFAULT_TRACK_HEIGHT = 64;

/** The single definition of the vertical-zoom clamp. The `zoomTracksVertical` handler
 *  derives the post-zoom heights its inverse guards against from this function rather
 *  than restating the arithmetic — two copies would drift and silently mis-guard the
 *  restore. */
export function clampTrackHeight(height: number | undefined, delta: number): number {
    return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, (height ?? DEFAULT_TRACK_HEIGHT) + delta));
}
