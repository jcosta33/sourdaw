import { audioEngine } from '#/modules/AudioEngine/useCases';

import { MAX_CREDIBLE_INPUT_WAIT_SECONDS } from '../../models/InputTiming';

type ResolveInputEventTimeInput = {
    /**
     * `MIDIMessageEvent.timeStamp` — a DOMHighResTimeStamp sharing the time
     * origin of `performance.now()`. `undefined` when the source cannot supply
     * one. The native bridge supplies it too: it maps midir's foreign epoch onto
     * this one before handing the event over, so native input reaches here on
     * the same footing as the browser's.
     */
    timeStamp: number | undefined;
};

/**
 * Instant, on the AudioContext clock, at which a live MIDI event arrived.
 *
 * The browser stamps every `MIDIMessageEvent` with its receipt time, but the
 * handler that consumes it runs whenever the main thread next gets a turn —
 * event-loop, GC and render jitter sit in between. Reading `currentTime`
 * inside the handler therefore measures when we got round to the note, not
 * when it was played (audit MD-1).
 *
 * The two clocks share no epoch, so the arrival instant is recovered from an
 * elapsed interval rather than by translating between origins: both
 * `performance.now()` and `currentTime` are sampled here, and the time already
 * spent waiting is subtracted. That makes the result independent of *when*
 * this runs — a message held behind the serial input tail resolves to the same
 * instant it would have resolved to on arrival.
 *
 * Falls back to "now" whenever no usable timestamp exists, which is the
 * behaviour that predates this.
 */
export function resolveInputEventTime({ timeStamp }: ResolveInputEventTimeInput): number {
    const now = audioEngine.context.currentTime;
    if (timeStamp === undefined || !Number.isFinite(timeStamp)) {
        return now;
    }

    const waitedSeconds = (performance.now() - timeStamp) / 1000;
    if (!Number.isFinite(waitedSeconds) || waitedSeconds <= 0 || waitedSeconds > MAX_CREDIBLE_INPUT_WAIT_SECONDS) {
        return now;
    }

    return now - waitedSeconds;
}
