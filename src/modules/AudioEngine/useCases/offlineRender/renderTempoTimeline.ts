import { type ResolutionTempoTimeline } from '../livePlayback/liveTempoTimeline';

const MAX_BRACKET_STEPS = 32;
const MAX_INVERSE_STEPS = 64;

/** Invert the render's monotone placement without crossing a retained bracket. */
export function renderTempoTimeline(
    secondsAtBeat: (beat: number) => number,
    tempoAtBeat: (beat: number) => number
): ResolutionTempoTimeline {
    return {
        secondsAtBeat,
        tempoAtBeat,
        beatAtSeconds: (seconds) => {
            if (!Number.isFinite(seconds)) {
                throw new TypeError('Render source time must be finite');
            }
            if (seconds === 0) {
                return 0;
            }
            const estimate = (seconds * tempoAtBeat(0)) / 60;
            let lower = Math.min(0, estimate);
            let upper = Math.max(0, estimate);
            for (let step = 0; step < MAX_BRACKET_STEPS; step++) {
                if (secondsAtBeat(lower) <= seconds && secondsAtBeat(upper) >= seconds) {
                    break;
                }
                lower = lower < 0 ? lower * 2 : lower;
                upper = upper > 0 ? upper * 2 : upper;
            }
            if (secondsAtBeat(lower) > seconds || secondsAtBeat(upper) < seconds || lower === upper) {
                throw new Error('Render source time could not be bracketed');
            }
            let beat = estimate;
            let nearestBeat = beat;
            let nearestError = Infinity;
            for (let step = 0; step < MAX_INVERSE_STEPS; step++) {
                const remainingSeconds = seconds - secondsAtBeat(beat);
                const error = Math.abs(remainingSeconds);
                if (error < nearestError) {
                    nearestError = error;
                    nearestBeat = beat;
                }
                if (error <= Number.EPSILON * Math.max(1, Math.abs(seconds))) {
                    return beat;
                }
                if (remainingSeconds > 0) {
                    lower = beat;
                } else {
                    upper = beat;
                }
                // A local-tempo step is exact within one segment, but can
                // oscillate across a short excursion. Bisect that step instead.
                const proposed = beat + (remainingSeconds * tempoAtBeat(beat)) / 60;
                const next = proposed > lower && proposed < upper ? proposed : lower + (upper - lower) / 2;
                if (next === beat) {
                    break;
                }
                beat = next;
            }
            // Whole-sample placement has plateaus; keep the closest real
            // placement observed rather than return an unobserved extrapolation.
            return nearestBeat;
        },
    };
}
