/**
 * Linearly interpolate the playback frame between the two most recent polled
 * positions for a normalised progress `t` in [0, 1].
 *
 * Guards against a backend position reset: when `lastPolledFrame` is below
 * `prevPolledFrame` (e.g. transport stopped/looped back to 0), interpolating
 * between them would scrub the cursor *backwards* for one poll cycle. In that
 * case we treat the new reading as a reset and snap forward to it instead.
 */
export function interpolateFrame(prevPolledFrame: number, lastPolledFrame: number, t: number): number {
    if (lastPolledFrame < prevPolledFrame) {
        return lastPolledFrame;
    }
    return prevPolledFrame + (lastPolledFrame - prevPolledFrame) * t;
}
