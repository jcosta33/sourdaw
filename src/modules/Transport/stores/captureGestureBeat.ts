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
 * (`playheadClockRef`) forward over the audio clock's elapsed time at the live
 * tempo — the same integration the next tick is about to perform, evaluated at
 * the event instead of at the grain — and when the native engine is the audible
 * transport, it reads the engine's own cursor through the registered clock
 * source, the same integration `runTick` uses for the drawn playhead. A parked
 * transport answers from the store, which is authoritative exactly then.
 *
 * The capture must run on the gesture's own synchronous path. Reading it after
 * queued or awaited work would date the event at the completion's beat, which
 * is the deferred-completion authority #3799 forbids.
 */

import { valuesEqual } from '#/utils/structuralEquality';

import { getTempoAtBeat } from '../models/TempoMap';

import { getGestureClockSource } from './gestureClockSource';
import { playheadClockRef } from './playheadClockRef';
import { tempoMapStore } from './tempoMapStore';
import { transportStore } from './transportStore';

/**
 * Upper bound on the elapsed audio time a capture will integrate past the
 * scheduler's last committed tick: one look-ahead, the most an ordinary tick
 * interval spans. The scheduler itself advances by the whole audio-clock span
 * however late a tick runs, so a capture taken inside a main-thread stall longer
 * than this reads short of the clock until the next tick commits the position.
 */
export const MAX_PROJECTION_SECONDS = 0.1;

type GestureClockCapture = {
    beat: number;
    audioTimeSeconds: number | null;
    pendingLoopSeam: typeof playheadClockRef.pendingLoopSeam;
};

function withoutSeam(beat: number): GestureClockCapture {
    return { beat, audioTimeSeconds: null, pendingLoopSeam: null };
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
    const elapsedSeconds = Math.max(0, Math.min(audioTime - playheadClockRef.audioTimeSeconds, MAX_PROJECTION_SECONDS));
    const tempo = getTempoAtBeat(tempoMapStore.value?.changes ?? [], playheadClockRef.beat, transport.tempo);
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
    return {
        beat: Math.max(0, playheadClockRef.beat + (elapsedSeconds * tempo) / 60),
        audioTimeSeconds: audioTime,
        pendingLoopSeam: ownsClock ? pending : null,
    };
}

export function captureGestureBeat(): number {
    return captureGestureClock().beat;
}
