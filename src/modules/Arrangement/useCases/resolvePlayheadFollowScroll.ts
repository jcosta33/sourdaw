export type PlayheadFollowScrollInput = {
    previousPlayheadBeat: number;
    playheadBeat: number;
    isPlaying: boolean;
    autoScrollEnabled: boolean;
    scrollX: number;
    viewportWidth: number;
    pixelsPerBeat: number;
};

const FOLLOW_RIGHT_THRESHOLD = 0.75;
const FOLLOW_PLACEMENT = 0.25;

/**
 * The one law for scrolling the timeline to the playhead, in CSS pixels.
 *
 * While playing, follow (when enabled) re-places the view once the playhead
 * passes 75% of the viewport or leaves its left edge. While stopped, only a
 * change of the playhead position scrolls: a locate (Home, stop with return to
 * start, marker, ruler click) is an explicit request to go there, so it ignores
 * `autoScrollEnabled`, but a zoom or manual scroll leaves the playhead where it
 * is and must not pull the view back. Returns the scrollX to request, or null
 * to leave the view alone.
 */
export function resolvePlayheadFollowScroll(input: PlayheadFollowScrollInput): number | null {
    const playheadPx = input.playheadBeat * input.pixelsPerBeat;
    const placement = playheadPx - input.viewportWidth * FOLLOW_PLACEMENT;

    if (input.isPlaying) {
        if (!input.autoScrollEnabled) {
            return null;
        }
        const rightThreshold = input.scrollX + input.viewportWidth * FOLLOW_RIGHT_THRESHOLD;
        return playheadPx > rightThreshold || playheadPx < input.scrollX ? placement : null;
    }

    if (input.playheadBeat === input.previousPlayheadBeat) {
        return null;
    }
    const isInView = playheadPx >= input.scrollX && playheadPx < input.scrollX + input.viewportWidth;
    return isInView ? null : placement;
}
