import { secondsBetweenBeats, type TempoChange } from '../../models/TempoMap';

/**
 * The beat the tempo map assigns `elapsedSeconds` after `anchorBeat`.
 *
 * Inverts `secondsBetweenBeats` — the map's own exact integrator — around the
 * anchor by bracketed bisection, the same inversion `samplesToBeat` performs
 * from beat 0 for recording. The scheduler advances its position through this
 * instead of charging each tick at the tick-start tempo (#4658): a tick that
 * crosses a tempo change moves the position the map's exact integrated
 * distance, so no per-tick error accumulates and `accumulatedPosition` equals
 * the map's beat at the current audio time at every tick. A flat map
 * degenerates to `anchorBeat + elapsedSeconds * beatsPerSecond`.
 */
export function beatAtSecondsFromAnchor(
    changes: readonly TempoChange[],
    anchorBeat: number,
    elapsedSeconds: number,
    defaultTempo: number
): number {
    if (elapsedSeconds === 0) {
        return anchorBeat;
    }

    // Every legal tempo is positive, so the integrated span is strictly
    // monotone in the target beat and bisection is exact. Negative elapsed —
    // reachable when a scheduled loop seam has not arrived yet — travels the
    // same way backwards; `secondsBetweenBeats` supports negative spans.
    const travelsForward = elapsedSeconds > 0;
    let lowerBeat = travelsForward ? anchorBeat : anchorBeat - 1;
    let upperBeat = travelsForward ? anchorBeat + 1 : anchorBeat;
    if (travelsForward) {
        while (secondsBetweenBeats(changes, anchorBeat, upperBeat, defaultTempo) < elapsedSeconds) {
            upperBeat = anchorBeat + (upperBeat - anchorBeat) * 2;
        }
    } else {
        while (secondsBetweenBeats(changes, anchorBeat, lowerBeat, defaultTempo) > elapsedSeconds) {
            lowerBeat = anchorBeat - (anchorBeat - lowerBeat) * 2;
        }
    }

    for (let iteration = 0; iteration < 64; iteration++) {
        const midpoint = (lowerBeat + upperBeat) / 2;
        const midpointSeconds = secondsBetweenBeats(changes, anchorBeat, midpoint, defaultTempo);
        if (midpointSeconds < elapsedSeconds) {
            lowerBeat = midpoint;
        } else {
            upperBeat = midpoint;
        }
    }
    return (lowerBeat + upperBeat) / 2;
}
