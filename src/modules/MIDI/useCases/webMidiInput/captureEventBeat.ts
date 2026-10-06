import { audioEngine } from '#/modules/AudioEngine/useCases';
import {
    captureGestureBeat,
    playheadWrapCountRef,
    readSecondsAtBeat,
    transportStore,
} from '#/modules/Transport/stores';

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
 * Find the beat on an earlier pass: `elapsedSeconds` of travel before the
 * seam at `loopEnd`, re-entering the region from `loopStart`. Whole passes
 * cost their integrated span, so whole ones are divided out first — the beat
 * inside a pass is the same whichever pass it sat on.
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
 * keeps the now-beat. Backwards travel is bounded by the roll's ACTUAL
 * traversal — the integrated distance the transport has covered since the
 * rolling epoch (the store position the playing transition wrote) to the
 * cursor, taken around the loop when looping: the scheduler publishes the
 * wrap count beside the cursor, so a roll that has not wrapped bounds at the
 * direct epoch-to-cursor distance (no seam re-entry exists to charge), and a
 * wrapped roll bounds at the epoch-to-seam span plus every completed pass
 * plus the current pass's distance. A stamp older than that traversal
 * predates playback and answers the epoch start instead of beats the
 * transport never traversed (#4668); the same bound holds on earlier passes
 * past any number of wraps, so a looping transport cannot answer a beat the
 * roll never reached (#4875). Between the seam instant and the arrival tick
 * that counts it, the projected cursor runs past `loopEnd` — the publisher
 * clamps the dying-pass pair there but this capture's projection does not —
 * so a counted wrap beside such a cursor routes through the seam-aware bound
 * instead of the direct one, and the same physical event answers the same
 * beat on both sides of the arrival grain.
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
    // How many of the loop's seams this roll has crossed since that origin was
    // written — published by the scheduler beside the very cursor above, so
    // the pair answers which pass the epoch and the cursor each sit on.
    const wrapsSinceEpoch = playheadWrapCountRef.current;
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

    // The seam window: between the seam instant and the arrival tick that
    // increments the count, the publisher clamps the dying-pass pair at
    // `loopEnd` (`startPlayheadScheduler`'s pending-seam publish) but the
    // projection above integrates past it, so `insideLoopRegion` reads false
    // and the direct bound below would charge a multi-wrap roll zero of its
    // completed passes — the same event answering the epoch before the grain
    // and its own dying-pass beat after it. A counted wrap beside a cursor at
    // or past `loopEnd` is that window, never a play-through: a roll past the
    // region end plays straight and the scheduler never counts it a wrap.
    const inSeamWindow =
        transport.isLooping && loopLengthBeats > 0 && wrapsSinceEpoch >= 1 && beatNow >= transport.loopEnd;
    if (inSeamWindow) {
        // The overshoot past the seam stands in for the incoming pass's
        // distance — the same quantity the post-arrival branch reads off the
        // wrapped cursor — so charging it first lands the event where the
        // next grain's capture will.
        const incomingSeconds = travelSeconds(transport.loopEnd, beatNow);
        if (elapsedSeconds <= incomingSeconds) {
            // Younger than the seam: the event sits on the incoming pass
            // within a grain of its origin, which is the seam instant on
            // that pass.
            return transport.loopStart;
        }
        // The dying pass closing here is the roll's `wrapsSinceEpoch + 1`th,
        // so the traversal is the epoch-to-seam span plus every pass the
        // count already covers plus the incoming distance — the post-arrival
        // bound with the count the arrival tick is about to write.
        const traversalSeconds =
            travelSeconds(epochStartBeat, transport.loopEnd) +
            wrapsSinceEpoch * travelSeconds(transport.loopStart, transport.loopEnd) +
            incomingSeconds;
        if (elapsedSeconds > traversalSeconds) {
            return epochStartBeat;
        }
        return invertTravelToSeam(elapsedSeconds - incomingSeconds, transport.loopStart, transport.loopEnd);
    }

    if (!insideLoopRegion) {
        return travelBackBounded(elapsedSeconds, epochStartBeat);
    }

    const secondsFromSeam = travelSeconds(transport.loopStart, beatNow);

    if (wrapsSinceEpoch <= 0) {
        // No wrap since the roll began: the epoch's own pass is one straight
        // line from the epoch to the cursor, the traversal is the direct
        // integrated distance, and no seam re-entry exists to charge (#4668).
        // A stamp older than it predates the roll and answers the epoch.
        const traversedSeconds = travelSeconds(epochStartBeat, beatNow);
        if (elapsedSeconds > traversedSeconds) {
            return epochStartBeat;
        }
        // Same pass when the epoch sits inside the region; a roll started
        // before it inverts through the run-up — both are this one line.
        return invertTravelBackward(beatNow, elapsedSeconds, epochStartBeat);
    }

    if (elapsedSeconds <= secondsFromSeam) {
        // Young enough for the cursor's own pass. The epoch is not on this
        // pass — it belongs to the pass `wrapsSinceEpoch` wraps ago — so the
        // pass's own start is the only floor; comparing the epoch's BEAT to
        // the cursor's would re-admit it here and clamp young events (#4668).
        return travelBackBounded(elapsedSeconds, transport.loopStart);
    }

    // The event predates the cursor's pass: it sits on one of the earlier
    // passes — however many the roll has completed — unless it predates the
    // roll itself. The roll's traversal is the epoch-to-seam span plus every
    // completed pass plus this pass's distance, so the bound covers the whole
    // history instead of one wrap (#4875, #4668); a stamp older than the roll
    // answers the epoch start instead of a beat the transport never traversed.
    const traversalSeconds =
        travelSeconds(epochStartBeat, transport.loopEnd) +
        (wrapsSinceEpoch - 1) * travelSeconds(transport.loopStart, transport.loopEnd) +
        secondsFromSeam;
    if (elapsedSeconds > traversalSeconds) {
        return epochStartBeat;
    }
    return invertTravelToSeam(elapsedSeconds - secondsFromSeam, transport.loopStart, transport.loopEnd);
}
