/**
 * Keep every native instrument's note store ahead of the playhead (#3892).
 *
 * ── What the pump owes, and what it does not ──────────────────────────────
 *
 * The store the arm filled covers {@link MIDI_WINDOW_SECONDS} of playing, and
 * the playhead walks out of it. Each reading extends the window to
 * `position + MIDI_WINDOW_SECONDS` and drops the trail behind
 * `position - MIDI_TRAIL_SECONDS`, because the store is finite and the engine
 * never consumes an entry: nothing but an explicit clear frees a slot.
 *
 * Both modes use an adaptive indexed window. Exact resident identities and
 * reserved real releases let a dense part shorten its spent trail before the
 * next notes run out of room. A loop additionally prefetches its head across
 * the seam; a linear pass never revisits entries behind its playhead.
 *
 * The position is an echo, a frame or two old. Upcoming entries already in
 * the store remain resident while new events are admitted before their frames.
 */

import { applyMidiBatch } from './applyMidiBatch';
import { loopMidiWindowBatch } from './loopMidiWindowBatch';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { nativeLiveMidiWriter } from './nativeLiveMidiWriterState';

export type PumpNativeLiveMidiWriterInput = Readonly<{
    /** Where the engine reported itself, on its own clock. */
    positionSeconds: number;
    /** How many times the engine has wrapped, including seams skipped between readings. */
    loopWraps: number;
    /** The pass the caller read before it took the reading. */
    writerEpoch: number;
}>;

export async function pumpNativeLiveMidiWriter(input: PumpNativeLiveMidiWriterInput): Promise<void> {
    const pass = nativeLiveMidiWriter.pass;
    if (!pass || nativeLiveMidiWriter.epoch !== input.writerEpoch) {
        return;
    }
    // One batch in flight at a time. Stacking a second behind an unanswered one
    // would send the same events twice, since the first has not moved a cursor.
    if (nativeLiveMidiWriter.inFlightEpoch === input.writerEpoch) {
        return;
    }
    if (!nativeLiveGraphSession.backend) {
        return;
    }
    const batch = loopMidiWindowBatch(pass, input.positionSeconds, pass.looping ? input.loopWraps : null);
    if (batch.commands.length === 0) {
        return;
    }
    await applyMidiBatch({ pass, batch, epoch: input.writerEpoch });
}
