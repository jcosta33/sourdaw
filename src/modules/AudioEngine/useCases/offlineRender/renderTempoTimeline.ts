import { type ResolutionTempoTimeline } from '../livePlayback/liveTempoTimeline';

function readFinitePlacement(secondsAtBeat: (beat: number) => number, beat: number): number {
    if (!Number.isFinite(beat)) {
        throw new RangeError('Render time lies outside finite beat placement');
    }
    const seconds = secondsAtBeat(beat);
    if (!Number.isFinite(seconds)) {
        throw new RangeError('Render tempo placement must be finite');
    }
    return seconds;
}

function beatAtRenderSeconds(secondsAtBeat: (beat: number) => number, seconds: number): number {
    if (!Number.isFinite(seconds)) {
        throw new RangeError('Cannot invert a non-finite render time');
    }
    const origin = readFinitePlacement(secondsAtBeat, 0);
    if (seconds === origin) {
        return 0;
    }
    let lowerBeat = 0;
    let upperBeat = 1;
    if (seconds < origin) {
        lowerBeat = -1;
        upperBeat = 0;
    }
    let lowerSeconds = readFinitePlacement(secondsAtBeat, lowerBeat);
    let upperSeconds = readFinitePlacement(secondsAtBeat, upperBeat);
    if (lowerSeconds > upperSeconds) {
        throw new RangeError('Render tempo placement must be monotone');
    }
    // Doubling either finite edge brackets preroll and arbitrarily long
    // renders. An unbounded/constant reader fails at the finite number limit.
    while (seconds < lowerSeconds) {
        upperBeat = lowerBeat;
        upperSeconds = lowerSeconds;
        lowerBeat *= 2;
        lowerSeconds = readFinitePlacement(secondsAtBeat, lowerBeat);
        if (lowerSeconds > upperSeconds) {
            throw new RangeError('Render tempo placement must be monotone');
        }
    }
    while (seconds > upperSeconds) {
        lowerBeat = upperBeat;
        lowerSeconds = upperSeconds;
        upperBeat *= 2;
        upperSeconds = readFinitePlacement(secondsAtBeat, upperBeat);
        if (lowerSeconds > upperSeconds) {
            throw new RangeError('Render tempo placement must be monotone');
        }
    }
    if (lowerSeconds === seconds) {
        return lowerBeat;
    }
    if (upperSeconds === seconds) {
        return upperBeat;
    }
    while (true) {
        const midpoint = lowerBeat + (upperBeat - lowerBeat) / 2;
        if (midpoint === lowerBeat || midpoint === upperBeat) {
            // Quantized placement need not contain this exact second. At
            // adjacent representable beats, keep the last available sample;
            // rounding up would expose PCM beyond an exclusive source end.
            return lowerBeat;
        }
        const midpointSeconds = readFinitePlacement(secondsAtBeat, midpoint);
        if (midpointSeconds < lowerSeconds || midpointSeconds > upperSeconds) {
            throw new RangeError('Render tempo placement must be monotone');
        }
        if (midpointSeconds === seconds) {
            return midpoint;
        }
        if (midpointSeconds < seconds) {
            lowerBeat = midpoint;
            lowerSeconds = midpointSeconds;
        } else {
            upperBeat = midpoint;
            upperSeconds = midpointSeconds;
        }
    }
}

/**
 * A render's tempo map as comp resolution reads it, from the two reads the
 * render already makes: its beat-to-seconds placement and the flat tempo at a
 * beat. Positive tempos make placement monotone, even across ramps and instant
 * changes. Bracketed bisection also admits the render's whole-sample plateaus:
 * each step shrinks the bracket until it finds the requested placement or no
 * representable beat remains between its two sides.
 */
export function renderTempoTimeline(
    secondsAtBeat: (beat: number) => number,
    tempoAtBeat: (beat: number) => number
): ResolutionTempoTimeline {
    return {
        secondsAtBeat,
        tempoAtBeat,
        beatAtSeconds: (seconds) => beatAtRenderSeconds(secondsAtBeat, seconds),
    };
}
