export type PlayheadFollowScrollInput = {
    previousPlayheadBeat: number;
    playheadBeat: number;
    isPlaying: boolean;
    /** The `isPlaying` of the frame the loop last rendered. */
    wasPlaying: boolean;
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
 * - Playing: follow (when enabled) re-places the view once the playhead passes
 *   75% of the viewport or leaves its left edge.
 * - The frame playback ends (`wasPlaying`, now stopped) is a stop or pause. The
 *   scheduler publishes ticks off the render frames, so the parked beat is
 *   usually a tick past the last playing frame's and says nothing about intent.
 *   It scrolls only while follow is on and the playhead is out of view (stop with
 *   return to start); a user who scrolled away during playback is left alone.
 * - Steady stopped frames: only a change of the playhead position scrolls. A
 *   locate (Home, marker, ruler click) is an explicit request to go there, so it
 *   ignores `autoScrollEnabled`; a zoom or manual scroll leaves the playhead
 *   where it is and must not pull the view back.
 *
 * Returns the scrollX to request, or null to leave the view alone.
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

    const isInView = playheadPx >= input.scrollX && playheadPx < input.scrollX + input.viewportWidth;
    if (input.wasPlaying) {
        return input.autoScrollEnabled && !isInView ? placement : null;
    }

    if (input.playheadBeat === input.previousPlayheadBeat) {
        return null;
    }
    return isInView ? null : placement;
}
