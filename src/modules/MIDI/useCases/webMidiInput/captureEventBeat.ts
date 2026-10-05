import { audioEngine } from '#/modules/AudioEngine/useCases';
import { captureGestureBeat, readSecondsAtBeat, transportStore } from '#/modules/Transport/stores';

type CaptureEventBeatInput = {
    /**
     * The event's own instant on the AudioContext clock, from
     * `resolveInputEventTime`.
     */
    audioTime: number;
};

/** Bisection precision, matching `beatAtSecondsFromAnchor` in the scheduler. */
const BISECTION_ITERATIONS = 64;

/**
 * Tempo-map travel between two beats, as the scheduler integrates it:
 * `readSecondsAtBeat` is the map's own beat->seconds integral from beat 0, and
 * that integral is additive across change boundaries, so the difference of two
 * readings is exactly the `secondsBetweenBeats` span — negative when `toBeat`
 * sits before `fromBeat`.
 */
function travelSeconds(fromBeat: number, toBeat: number): number {
    return readSecondsAtBeat({ beat: toBeat }) - readSecondsAtBeat({ beat: fromBeat });
}

/**
 * Find the beat `elapsedSeconds` of tempo-map travel before `upperBeat`, by
 * bracketing downward with doubling spans and bisecting the travel integral.
 * `lowerFloor`, when given, is known to satisfy the travel already.
 */
function invertTravelBackward(upperBeat: number, elapsedSeconds: number, lowerFloor?: number): number {
    let lower = lowerFloor ?? upperBeat - 1;
    while (travelSeconds(lower, upperBeat) < elapsedSeconds) {
        lower = upperBeat - (upperBeat - lower) * 2;
    }
    let upper = upperBeat;
    for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration++) {
        const midpoint = (lower + upper) / 2;
        // Travel from `midpoint` to `upperBeat` shrinks as the midpoint rises:
        // too little travel means the midpoint sits too close to `upperBeat`.
        if (travelSeconds(midpoint, upperBeat) < elapsedSeconds) {
            upper = midpoint;
        } else {
            lower = midpoint;
        }
    }
    return (lower + upper) / 2;
}

/**
 * Find the beat on the dying pass: `elapsedSeconds` of travel before the seam
 * at `loopEnd`, re-entering the region from `loopStart`. Full passes cost
 * their integrated span, so a whole number of them is divided out first.
 */
function invertTravelToSeam(elapsedSeconds: number, loopStart: number, loopEnd: number): number {
    const passSeconds = travelSeconds(loopStart, loopEnd);
    let remainder = elapsedSeconds;
    if (passSeconds > 0) {
        remainder -= Math.floor(remainder / passSeconds) * passSeconds;
    }
    let lower = loopStart;
    let upper = loopEnd;
    for (let iteration = 0; iteration < BISECTION_ITERATIONS; iteration++) {
        const midpoint = (lower + upper) / 2;
        if (travelSeconds(midpoint, loopEnd) > remainder) {
            lower = midpoint;
        } else {
            upper = midpoint;
        }
    }
    return (lower + upper) / 2;
}

/**
 * The beat a live event happened at, projected from its own arrival instant
 * instead of from the moment the handler runs (#4875).
 *
 * `captureGestureBeat` answers where the transport stands *now*; a message the
 * event loop delivered late would record the note — and every note-relative
 * expression offset with it — later than it was played. This capture pairs the
 * sanctioned now-beat with the audio instant it was taken at and integrates
 * backwards through the same tempo map the scheduler advances on, so the beat
 * follows the MIDI EVENT time. There is deliberately no blanket delay
 * subtraction: the travel is the map's own integrated distance over this
 * event's own wait, and a loop seam between the event and now places the event
 * on the dying pass it belonged to.
 *
 * A parked transport answers from the store, the same defined fallback
 * `captureGestureBeat` has; an event stamped at or after the capture instant
 * keeps the now-beat. Backwards travel is bounded by the roll's integrated
 * traversal — the seconds from the rolling epoch's start (the store position
 * the playing transition wrote) to the cursor, taken around the loop when
 * looping: the span from a mid-region epoch to the seam plus the current
 * pass's distance. A stamp older than that traversal predates playback and
 * answers the epoch start instead of beats the transport never traversed
 * (#4668); the same bound holds on the dying pass past a wrap, so a looping
 * transport cannot answer a beat the roll never reached (#4875).
 */
export function captureEventBeatAt({ audioTime }: CaptureEventBeatInput): number {
    const transport = transportStore.value;
    if (!transport) {
        return 0;
    }
    if (!transport.isPlaying) {
        return transport.playheadPosition;
    }

    const beatNow = captureGestureBeat();
    // The registered clock source reads this same AudioContext instant for the
    // sanctioned capture, so it pairs with the beat without a second seam.
    const elapsedSeconds = audioEngine.context.currentTime - audioTime;
    if (!Number.isFinite(beatNow) || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
        return beatNow;
    }

    const loopLengthBeats = transport.loopEnd - transport.loopStart;
    const insideLoopRegion =
        transport.isLooping && loopLengthBeats > 0 && beatNow >= transport.loopStart && beatNow < transport.loopEnd;

    // The rolling epoch's own origin: the playing transition (a start, or a
    // seek's scheduler restart) writes the store position exactly at the epoch
    // boundary and nothing writes it while playing, so it is the beat this roll
    // began from — the same position the parked branch above answers from.
    const epochStartBeat = transport.playheadPosition;
    // Travel the event's age back from the cursor, bounded at `floor` (#4668):
    // a stamp older than the span from the floor to the cursor predates that
    // span and answers the floor, exactly as the stop case answers the store.
    // The pre-check also hands `invertTravelBackward` a floor that already
    // spans the event's age, so its doubling phase can never dig past it.
    const travelBackBounded = (elapsed: number, floor: number): number => {
        if (travelSeconds(floor, beatNow) < elapsed) {
            return floor;
        }
        return invertTravelBackward(beatNow, elapsed, floor);
    };

    if (insideLoopRegion) {
        const secondsFromSeam = travelSeconds(transport.loopStart, beatNow);
        if (elapsedSeconds <= secondsFromSeam) {
            // Same pass as the cursor: travel back within the region. The
            // epoch bounds this pass only when it sits inside it — after a
            // wrap the cursor stands behind a mid-region epoch, the direct
            // delta goes negative, and the traversal bound on the dying pass
            // below — never this delta — decides staleness (#4875).
            const epochInThisPass = epochStartBeat >= transport.loopStart && epochStartBeat <= beatNow;
            return travelBackBounded(elapsedSeconds, epochInThisPass ? epochStartBeat : transport.loopStart);
        }
        // The event predates the wrap: it sits on the dying pass, above the
        // seam, and the recorded beat must re-enter the region from loopEnd.
        // The stamp is bounded by the roll's whole traversal — the integrated
        // span from the epoch to the seam plus this pass's distance (#4875,
        // #4668) — so one older than the roll itself answers the epoch start
        // instead of a beat the transport never traversed.
        if (epochStartBeat < transport.loopEnd) {
            const traversalSeconds = travelSeconds(epochStartBeat, transport.loopEnd) + secondsFromSeam;
            if (elapsedSeconds > traversalSeconds) {
                return epochStartBeat;
            }
        }
        return invertTravelToSeam(elapsedSeconds - secondsFromSeam, transport.loopStart, transport.loopEnd);
    }

    return travelBackBounded(elapsedSeconds, epochStartBeat);
}
