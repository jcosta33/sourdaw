import { type ResolutionTempoTimeline } from '../livePlayback/liveTempoTimeline';

/** A sample at the highest rate a render runs at. */
const SECONDS_TOLERANCE = 1 / 192_000;
const MAX_STEPS = 32;

/**
 * A render's tempo map as comp resolution reads it, from the two reads the
 * render already makes: its beat-to-seconds placement and the flat tempo at a
 * beat. The inverse is found by stepping from beat 0 along the local tempo:
 * across one tempo segment a step lands exactly, and each further step crosses
 * into the segment that holds the target, so a map of a few changes settles in
 * as many steps. The render's placement is whole-sample, so the inverse is
 * read to within a sample.
 */
export function renderTempoTimeline(
    secondsAtBeat: (beat: number) => number,
    tempoAtBeat: (beat: number) => number
): ResolutionTempoTimeline {
    return {
        secondsAtBeat,
        tempoAtBeat,
        beatAtSeconds: (seconds) => {
            let beat = 0;
            for (let step = 0; step < MAX_STEPS; step++) {
                const remainingSeconds = seconds - secondsAtBeat(beat);
                if (Math.abs(remainingSeconds) <= SECONDS_TOLERANCE) {
                    break;
                }
                beat += (remainingSeconds * tempoAtBeat(beat)) / 60;
            }
            return beat;
        },
    };
}
