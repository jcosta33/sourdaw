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
 * A looping pass is not pumped at all. The engine replays the region from the
 * entries it already holds, the arm sent the region whole, and a trail clear
 * inside it would delete exactly what the next wrap is going to play.
 *
 * ── Why the trail is not cleared every tick ───────────────────────────────
 *
 * A clear is a command the engine takes under its fence, and the playhead feed
 * ticks on the animation frame. Clearing a few milliseconds of trail sixty
 * times a second would spend a batch to free almost nothing, so the trail is
 * cut only once it has grown past a second of unclaimed store.
 *
 * ── Why the position may be behind ────────────────────────────────────────
 *
 * The reading is an echo, a frame or two old. That is why the trail keeps its
 * margin: a clear that reached the engine's true playhead would delete a note
 * about to be delivered. Extending ahead has no such hazard — a note already in
 * the store is simply not re-sent, since the cursor never walks back.
 */

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import { admitMidiEvents } from './admitMidiEvents';
import { applyMidiBatch } from './applyMidiBatch';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import {
    MIDI_TRAIL_SECONDS,
    MIDI_WINDOW_SECONDS,
    nativeLiveMidiWriter,
    type LiveMidiWriterPass,
    type LiveMidiWriterTarget,
    type MidiAdmission,
    type MidiWriterBatch,
} from './nativeLiveMidiWriterState';

/** How much trail has to have accumulated before a clear is worth a command. */
const MIN_TRAIL_CLEAR_SECONDS = 1;

export type PumpNativeLiveMidiWriterInput = Readonly<{
    /** Where the engine reported itself, on its own clock. */
    positionSeconds: number;
    /**
     * How many times the engine has wrapped its loop region.
     *
     * Read for nothing here, and deliberately: a looping pass sends nothing, so
     * a wrap changes no window this pump owns. It stays in the signature
     * because the playhead feed hands the same reading to both writers and a
     * caller should not have to know which of them cares.
     */
    loopWraps: number;
    /** The pass the caller read before it took the reading. */
    writerEpoch: number;
}>;

/**
 * How far behind the playhead this tick may clear, or `null` when the trail is
 * not yet worth a command.
 */
function trailClearBefore(pass: LiveMidiWriterPass, positionSeconds: number): number | null {
    const trailEnd = positionSeconds - MIDI_TRAIL_SECONDS;
    if (trailEnd <= pass.lastClearedBeforeSeconds + MIN_TRAIL_CLEAR_SECONDS) {
        return null;
    }
    return trailEnd;
}

/**
 * How many of a target's already-sent events the trail clear takes back.
 *
 * Counted from the events themselves rather than assumed: the clear is
 * half-open on engine time, and only the entries whose note-on falls inside it
 * were ever in the store this side is accounting for.
 */
function clearedByTrail(slot: LiveMidiWriterTarget, fromSeconds: number, toSeconds: number): number {
    let count = 0;
    for (let index = slot.cursor - slot.held; index < slot.cursor; index += 1) {
        const event = slot.events[index];
        if (event && event.time >= fromSeconds && event.time < toSeconds) {
            count += 1;
        }
    }
    return count;
}

/** This tick's batch: the trail dropped, then the window extended. */
function windowBatch(pass: LiveMidiWriterPass, positionSeconds: number): MidiWriterBatch {
    const horizonSeconds = positionSeconds + MIDI_WINDOW_SECONDS;
    const clearBefore = trailClearBefore(pass, positionSeconds);
    const commands: AudioGraphCommand[] = [];
    const admissions: MidiAdmission[] = [];
    for (const slot of pass.targets) {
        const cleared = clearBefore === null ? 0 : clearedByTrail(slot, pass.lastClearedBeforeSeconds, clearBefore);
        // The clear travels whether or not it takes anything from this target:
        // the trail is a property of the pass, and a target left out of one
        // round would keep entries the next round's span no longer covers.
        if (clearBefore !== null) {
            commands.push({
                kind: 'clear-midi',
                target: slot.target,
                fromTime: pass.lastClearedBeforeSeconds,
                toTime: clearBefore,
            });
        }
        const heldAfterClear = slot.held - cleared;
        const admitted = admitMidiEvents(slot, { horizonSeconds, heldAfterClear });
        if (admitted > 0) {
            commands.push({
                kind: 'schedule-midi',
                target: slot.target,
                probabilitySeed: pass.probabilitySeed,
                notes: slot.events.slice(slot.cursor, slot.cursor + admitted),
            });
        }
        if (clearBefore !== null || admitted > 0) {
            admissions.push({ slot, admitted, heldAfter: heldAfterClear + admitted });
        }
    }
    if (commands.length === 0 || clearBefore === null) {
        return { commands, admissions };
    }
    return { commands, admissions, lastClearedBeforeSeconds: clearBefore };
}

export async function pumpNativeLiveMidiWriter(input: PumpNativeLiveMidiWriterInput): Promise<void> {
    const pass = nativeLiveMidiWriter.pass;
    if (!pass || nativeLiveMidiWriter.epoch !== input.writerEpoch) {
        return;
    }
    // A looping pass holds its whole region already; the wrap replays it.
    if (pass.looping) {
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
    const batch = windowBatch(pass, input.positionSeconds);
    if (batch.commands.length === 0) {
        return;
    }
    await applyMidiBatch({ pass, batch, epoch: input.writerEpoch });
}
