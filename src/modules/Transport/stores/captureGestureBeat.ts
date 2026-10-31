/**
 * Where the audible transport stands *right now*, in beats — the beat an event
 * captured at this instant happened at (#3799).
 *
 * This is the one sanctioned door for timestamping a user gesture (a fader
 * sample, a knob turn) against the moving playback clock. Neither of the two
 * positions a consumer could otherwise read is an event-time mapping:
 *
 *  - `transportStore.playheadPosition` is written on discrete transitions only
 *    (start, stop, pause, seek), so during playback it holds the beat playback
 *    *started* at. Stamping gestures from it collapses a whole ride onto the
 *    start beat the moment playback began anywhere but zero.
 *  - `playheadPositionRef` is a latest-value channel: a tick samples
 *    `ctx.currentTime`, advances its position, can await scheduling work, and
 *    only then publishes. Reading it at event time returns whichever later beat
 *    happened to be visible when the handler ran — not the beat under the
 *    event.
 *
 * So while the transport plays, this projects the scheduler's committed anchor
 * (`playheadClockRef`) forward over all of the audio clock's elapsed time since
 * it, exactly as the next tick will advance: through the tempo map, and around
 * the loop, every seam crossed counted (`seamsCrossed`, beyond the wrap count
 * the scheduler has published). The song position is a function of the audio
 * clock: a suspended context does not leap (`suspend()` stops `currentTime`),
 * so a gap longer than a grain is a main thread that was late while the audio
 * kept playing, and a gesture captured just after it happened at the beat the
 * audio clock reached, on the pass it reached it in. When the native engine is
 * the audible transport, it reads the engine's own cursor through the
 * registered clock source, the same integration `runTick` uses for the drawn
 * playhead. A parked transport answers from the store, which is authoritative
 * exactly then.
 *
 * The capture must run on the gesture's own synchronous path. Reading it after
 * queued or awaited work would date the event at the completion's beat, which
 * is the deferred-completion authority #3799 forbids.
 */

import { valuesEqual } from '#/utils/structuralEquality';

import { beatAtSecondsFromAnchor, secondsBetweenBeats, type TempoChange } from '../models/TempoMap';

import { getGestureClockSource } from './gestureClockSource';
import { playheadClockRef } from './playheadClockRef';
import { tempoMapStore } from './tempoMapStore';
import { transportStore } from './transportStore';

type GestureClockCapture = {
    beat: number;
    audioTimeSeconds: number | null;
    pendingLoopSeam: typeof playheadClockRef.pendingLoopSeam;
    /** Loop seams the projection crossed that the scheduler has not counted yet. */
    seamsCrossed: number;
};

type TransportState = NonNullable<typeof transportStore.value>;

function withoutSeam(beat: number): GestureClockCapture {
    return { beat, audioTimeSeconds: null, pendingLoopSeam: null, seamsCrossed: 0 };
}

/**
 * The audio time from the anchor to the next loop seam, or null when the next
 * tick will not wrap: the loop is off, or the anchor is already past loopEnd (a
 * roll started there plays straight through). A seam the scheduler already
 * emitted is dated by its own instant, which the anchor pair clamped at loopEnd
 * cannot give.
 */
function secondsToNextSeam(
    transport: TransportState,
    changes: readonly TempoChange[],
    ownedSeam: typeof playheadClockRef.pendingLoopSeam
): number | null {
    if (ownedSeam) {
        return ownedSeam.audioTimeSeconds - playheadClockRef.audioTimeSeconds;
    }
    if (
        !transport.isLooping ||
        transport.loopEnd <= transport.loopStart ||
        playheadClockRef.beat >= transport.loopEnd
    ) {
        return null;
    }
    return secondsBetweenBeats(changes, playheadClockRef.beat, transport.loopEnd, transport.tempo);
}

/**
 * Advance the anchor over `elapsedSeconds` exactly as the next tick will:
 * through the tempo map, and around the loop, folding every whole pass past
 * the first seam by the loop's own integrated span.
 */
function projectFromAnchor(
    transport: TransportState,
    changes: readonly TempoChange[],
    elapsedSeconds: number,
    ownedSeam: typeof playheadClockRef.pendingLoopSeam
): { beat: number; seamsCrossed: number } {
    const toSeam = secondsToNextSeam(transport, changes, ownedSeam);
    if (toSeam === null || elapsedSeconds < toSeam) {
        return {
            beat: beatAtSecondsFromAnchor(changes, playheadClockRef.beat, elapsedSeconds, transport.tempo),
            seamsCrossed: 0,
        };
    }
    const passSeconds = secondsBetweenBeats(changes, transport.loopStart, transport.loopEnd, transport.tempo);
    const pastFirstSeam = elapsedSeconds - toSeam;
    const wholePassesPastFirstSeam = Math.floor(pastFirstSeam / passSeconds);
    const intoPass = Math.max(0, pastFirstSeam - wholePassesPastFirstSeam * passSeconds);
    return {
        beat: beatAtSecondsFromAnchor(changes, transport.loopStart, intoPass, transport.tempo),
        seamsCrossed: 1 + wholePassesPastFirstSeam,
    };
}

/** The scalar beat and any scheduled browser boundary share one carrier and clock read. */
export function captureGestureClock(): GestureClockCapture {
    const transport = transportStore.value;
    if (!transport) {
        // Pre-hydration there is no position to stamp; recording gates drop the
        // value anyway (`recordAutomationValue` refuses an unhydrated transport).
        return withoutSeam(0);
    }
    if (!transport.isPlaying) {
        // Discrete transitions (stop, pause, seek) write the store, so while the
        // transport is parked it — not the scheduler's torn-down anchor — is
        // the position in force.
        return withoutSeam(transport.playheadPosition);
    }
    if (playheadClockRef.hold !== null) {
        return withoutSeam(Math.max(0, playheadClockRef.hold.beat));
    }

    const source = getGestureClockSource();
    if (!source) {
        // No bootstrap: answer the scheduler's last committed position rather
        // than the start beat. See `gestureClockSource.ts` for the contract.
        return withoutSeam(Math.max(0, playheadClockRef.beat));
    }

    // The cursor follows the transport that produces the sound (ADR 0039): while
    // the native engine is audible its reported position — loop wraps included —
    // is the beat the event lands on, exactly as `runTick` draws it.
    const nativeCursor = source.readNativeCursorBeats();
    if (nativeCursor !== null) {
        return withoutSeam(nativeCursor);
    }

    const audioTime = source.getAudioTimeSeconds();
    const elapsedSeconds = Math.max(0, audioTime - playheadClockRef.audioTimeSeconds);
    const changes = tempoMapStore.value?.changes ?? [];
    const pending = playheadClockRef.pendingLoopSeam;
    const ownsClock =
        pending !== null &&
        pending.generation === playheadClockRef.generation &&
        pending.anchorBeat === playheadClockRef.beat &&
        pending.anchorAudioTimeSeconds === playheadClockRef.audioTimeSeconds &&
        transport.isLooping &&
        pending.loopStart === transport.loopStart &&
        pending.loopEnd === transport.loopEnd &&
        pending.tempo === transport.tempo &&
        valuesEqual(pending.tempoMapChanges, tempoMapStore.value?.changes ?? null);
    const ownedSeam = ownsClock ? pending : null;
    const projection = projectFromAnchor(transport, changes, elapsedSeconds, ownedSeam);
    return {
        beat: Math.max(0, projection.beat),
        audioTimeSeconds: audioTime,
        pendingLoopSeam: ownedSeam,
        seamsCrossed: projection.seamsCrossed,
    };
}

export function captureGestureBeat(): number {
    return captureGestureClock().beat;
}
