/**
 * How much of a target's remaining part may be sent now (#3892).
 *
 * A prefix of the events, because they ascend by time: any prefix is
 * frame-ordered, which is what `try_extend` requires of a batch, and the
 * longest one that fits is the most notes the store can be given.
 *
 * Two things end the run, and only one of them is worth saying. Reaching the
 * lookahead is the ordinary case. Running out of store while notes inside that
 * lookahead still owe a place is a take that stops at a bar the musician can
 * hear ending — the engine accepts what fitted, so nothing else reports it.
 * Saying so is part of admitting rather than a separate reading: only the walk
 * that stopped knows which of the two stopped it.
 *
 * Said once per target, because the pass offers the same events again on every
 * animation frame for as long as the store stays full.
 */

import { logger } from '#/infra/logger/appLogger';

import { MIDI_NOTE_STORE_CAPACITY, type LiveMidiWriterTarget } from './nativeLiveMidiWriterState';

export type AdmitMidiEventsInput = Readonly<{
    /** The engine time this send does not reach past. */
    horizonSeconds: number;
    /** What the target's store holds once this batch's own clears are taken. */
    heldAfterClear: number;
}>;

function reportSaturation(slot: LiveMidiWriterTarget, admitted: number): void {
    if (slot.saturationReported) {
        return;
    }
    slot.saturationReported = true;
    logger.warn(
        `[AudioEngine] plugin "${slot.deviceName}" on "${slot.trackName}" holds ` +
            `${admitted} of ${slot.events.length} scheduled notes; the engine store is full`
    );
}

export function admitMidiEvents(slot: LiveMidiWriterTarget, input: AdmitMidiEventsInput): number {
    const free = Math.max(0, MIDI_NOTE_STORE_CAPACITY - input.heldAfterClear);
    let count = 0;
    while (count < free) {
        const event = slot.events[slot.cursor + count];
        if (!event || event.time >= input.horizonSeconds) {
            return count;
        }
        count += 1;
    }
    const next = slot.events[slot.cursor + count];
    if (next !== undefined && next.time < input.horizonSeconds) {
        reportSaturation(slot, count);
    }
    return count;
}
