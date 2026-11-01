import { audioEngine } from '#/modules/AudioEngine/useCases';
import {
    captureGestureClock,
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
 * Whether the cursor rides the geometry the pass-aware branches integrate:
 * inside the region for either loop state, or — the loop having been
 * disabled mid-roll — anywhere past the last `loopEnd` the roll crossed,
 * where the disable set the cursor on one straight line over the same map
 * from `loopStart` on, the completed passes behind it still counted (#4935
 * review). A looping cursor past the seam does not ride: the capture folds a
 * cursor that crossed a seam back into the region, so one past `loopEnd` is a
 * play-through (a roll that began there, or a region shrunk below the cursor
 * mid-roll, with stale wraps) and keeps the direct bound.
 */
function ridesRollGeometry(beatNow: number, loopStart: number, loopEnd: number, isLooping: boolean): boolean {
    return loopEnd > loopStart && beatNow >= loopStart && (beatNow < loopEnd || !isLooping);
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
 * keeps the now-beat. The now-beat is already folded around the loop on the
 * pass the audio clock is in, with the seams it crossed since the scheduler's
 * last tick reported beside it, so a seam between that tick and the capture,
 * or a main-thread stall that crossed several, names the right pass and
 * dates an event on the incoming pass at its own offset from `loopStart`.
 * Backwards travel is bounded by the roll's ACTUAL
 * traversal — the integrated distance the transport has covered since the
 * rolling epoch (the store position the playing transition wrote) to the
 * cursor, taken around the loop whenever the roll has been wrapping, a loop
 * disabled mid-roll included: the scheduler publishes the
 * wrap count beside the cursor, so a roll that has not wrapped bounds at the
 * direct epoch-to-cursor distance (no seam re-entry exists to charge), and a
 * wrapped roll bounds at the epoch-to-seam span plus every completed pass
 * plus the current line's distance from its loopStart re-entry — a line a
 * loop disabled mid-roll keeps running straight past `loopEnd`, the map
 * continuous across the seam (#4935 review). A stamp older than that traversal
 * predates playback and answers the epoch start instead of beats the
 * transport never traversed (#4668); the same bound holds on earlier passes
 * past any number of wraps, so a looping transport cannot answer a beat the
 * roll never reached (#4875). The same physical event answers the same beat
 * on both sides of the tick that counts a seam, because the folded cursor and
 * its pass are the ones that tick publishes.
 */
export function captureEventPositionAt({ audioTime }: CaptureEventBeatInput): { beat: number; passIndex: number } {
    const transport = transportStore.value;
    if (!transport) {
        return { beat: 0, passIndex: 0 };
    }
    if (!transport.isPlaying) {
        return { beat: transport.playheadPosition, passIndex: 0 };
    }

    const clock = captureGestureClock();
    const beatNow = clock.beat;
    // The registered clock source reads this same AudioContext instant for the
    // sanctioned capture, so it pairs with the beat without a second seam.
    const now = clock.audioTimeSeconds ?? audioEngine.context.currentTime;
    const elapsedSeconds = now - audioTime;
    // The cursor's own pass: the wraps the scheduler has counted plus the seams
    // the capture's projection crossed since its last tick, so a main-thread
    // stall that delayed the counting tick still names the pass the audio is in.
    const wrapsSinceEpoch = playheadWrapCountRef.current + clock.seamsCrossed;
    if (!Number.isFinite(beatNow) || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
        return { beat: beatNow, passIndex: wrapsSinceEpoch };
    }

    // The pass-aware branches key on the cursor riding the region geometry,
    // not on the loop still being enabled. A loop disabled mid-roll leaves the
    // roll's completed passes in the count, and the wrapped cursor below the
    // epoch is on a pass that began at loopStart — the direct epoch bound
    // would read a negative span and clamp every event to the epoch (#4668).
    // A roll whose loop was already off at the epoch carries a zero count, so
    // its `wrapsSinceEpoch <= 0` branch answers the same straight
    // epoch-to-cursor line the direct bound does.
    const ridesRegionGeometry = ridesRollGeometry(beatNow, transport.loopStart, transport.loopEnd, transport.isLooping);

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

    if (!ridesRegionGeometry) {
        return { beat: travelBackBounded(elapsedSeconds, epochStartBeat), passIndex: wrapsSinceEpoch };
    }

    const secondsFromSeam = travelSeconds(transport.loopStart, beatNow);

    if (wrapsSinceEpoch <= 0) {
        // No wrap since the roll began: the epoch's own pass is one straight
        // line from the epoch to the cursor, the traversal is the direct
        // integrated distance, and no seam re-entry exists to charge (#4668).
        // A stamp older than it predates the roll and answers the epoch.
        const traversedSeconds = travelSeconds(epochStartBeat, beatNow);
        if (elapsedSeconds > traversedSeconds) {
            return { beat: epochStartBeat, passIndex: 0 };
        }
        // Same pass when the epoch sits inside the region; a roll started
        // before it inverts through the run-up — both are this one line.
        return { beat: invertTravelBackward(beatNow, elapsedSeconds, epochStartBeat), passIndex: 0 };
    }

    if (elapsedSeconds <= secondsFromSeam) {
        // Young enough for the cursor's own pass. The epoch is not on this
        // pass — it belongs to the pass `wrapsSinceEpoch` wraps ago — so the
        // pass's own start is the only floor; comparing the epoch's BEAT to
        // the cursor's would re-admit it here and clamp young events (#4668).
        return { beat: travelBackBounded(elapsedSeconds, transport.loopStart), passIndex: wrapsSinceEpoch };
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
        return { beat: epochStartBeat, passIndex: 0 };
    }
    const passSeconds = travelSeconds(transport.loopStart, transport.loopEnd);
    const passesBack = Math.ceil((elapsedSeconds - secondsFromSeam) / passSeconds);
    return {
        beat: invertTravelToSeam(elapsedSeconds - secondsFromSeam, transport.loopStart, transport.loopEnd),
        passIndex: Math.max(0, wrapsSinceEpoch - passesBack),
    };
}
