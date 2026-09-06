/**
 * The one live MIDI writer this process may hold (#3892).
 *
 * ## Why a window, and why the window is wide
 *
 * The engine holds a fixed note store per hosted plugin —
 * [`MIDI_NOTE_STORE_CAPACITY`] entries, a note being two of them — so a take
 * longer than that store cannot be sent whole. What makes this window unlike
 * the automation writer's is that the engine never *consumes* an entry:
 * `enqueue_due_midi_notes` reads by frame window and leaves the entries where
 * they are, so a loop wrap replays a region with no help from this side and the
 * only thing that frees capacity is an explicit `clear-midi`. The window is
 * therefore measured in seconds of lookahead rather than in queue slots, and it
 * is seconds rather than milliseconds because nothing here is racing a
 * parameter's own resolution — a note simply has to be in the store before the
 * playhead reaches its frame, and an entry the playhead has already passed is
 * counted late and never delivered.
 *
 * ## Why the trail is cleared, and only behind
 *
 * Capacity is finite and a pass is not, so what the playhead has left has to go
 * to make room for what it has not reached. The trail is the safety margin on
 * that: a clear that reached the playhead would delete a note the engine is
 * about to deliver, and the echoed position this side windows from is a frame
 * or two behind the engine's own.
 *
 * A looping pass clears nothing behind it, and sends the region whole at arm
 * instead. The entries the wrap replays are exactly the ones a behind-clear
 * would have deleted.
 *
 * ## Why module state, and why the epoch
 *
 * The same reasons the automation writer's are: the engine these notes address
 * is process-wide, and a batch can outlive the pass that issued it. A stop, a
 * seek, a loop edit or a note edit ends a pass while a batch's round trip is
 * still out, and that answer must not advance a cursor into a pass that no
 * longer exists.
 */

import { type Track } from '#/modules/Arrangement/stores';

import {
    type AudioGraphCommand,
    type AudioGraphDeviceTarget,
    type AudioGraphMidiNoteEvent,
} from '../../models/AudioGraphBackend';
import { type EngineLoopRegion } from '../../models/EngineTransportPosition';

/** How far ahead of the engine's own clock one pass keeps its notes. */
export const MIDI_WINDOW_SECONDS = 4;

/** How far behind the echoed playhead a clear may reach. */
export const MIDI_TRAIL_SECONDS = 2;

/** `MIDI_NOTE_STORE_CAPACITY` in `crates/daw-engine/src/midi/note_store.rs`. */
export const MIDI_NOTE_STORE_CAPACITY = 2048;

/** One instrument's share of the pass: its notes, what has been sent, what the store holds. */
export type LiveMidiWriterTarget = {
    target: AudioGraphDeviceTarget;
    /** How the plugin and its track are named to the musician. */
    deviceName: string;
    trackName: string;
    /** This target's events for its span, ascending by time. */
    events: readonly AudioGraphMidiNoteEvent[];
    /** How many of {@link events} the engine has accepted. */
    cursor: number;
    /** Entries this side believes the engine's store still holds: sent minus cleared. */
    held: number;
    /** Whether this pass has already reported this target's store full. */
    saturationReported: boolean;
};

/** One pass over one span. */
export type LiveMidiWriterPass = {
    /**
     * The strips the session's topology built.
     *
     * Held rather than re-read for the reason the automation pass holds its
     * own: a re-arm must not start naming strips a later project edit added,
     * while each strip's *contents* are re-read at every re-arm.
     */
    stripTracks: readonly Track[];
    sampleRate: number;
    /**
     * The seed every `schedule-midi` in this pass states.
     *
     * Carried on the pass because both senders need it and neither may read a
     * fresher one: a seed that moved mid-pass would roll a different chance for
     * the notes still to be sent than for the ones already in the store.
     */
    probabilitySeed: number;
    /** Where this pass began, on the engine clock. */
    entrySeconds: number;
    /** Whether the engine will actually wrap this pass. */
    looping: boolean;
    /** The region being wrapped, or `null` when nothing wraps. */
    loopRegion: EngineLoopRegion | null;
    /**
     * Where the last trail clear reached, on the engine clock. A pass opens by
     * clearing every entry its targets hold, so it opens at the head.
     */
    lastClearedBeforeSeconds: number;
    /** Whether this pass has already reported a refused batch. */
    refusalReported: boolean;
    targets: LiveMidiWriterTarget[];
};

/** What one target's share of a batch does to the pass, once the engine takes it. */
export type MidiAdmission = Readonly<{
    slot: LiveMidiWriterTarget;
    /** How many events past the cursor this batch carried for the target. */
    admitted: number;
    /** What its store holds once the batch's clear and its notes are both taken. */
    heldAfter: number;
}>;

/** One send, and everything accepting it changes. */
export type MidiWriterBatch = Readonly<{
    commands: readonly AudioGraphCommand[];
    admissions: readonly MidiAdmission[];
    /**
     * Where the pass's trail reaches once this batch's clears are taken, when
     * it carries any. Committed with the cursors rather than ahead of them: a
     * refused batch clears nothing, and a trail advanced over entries still in
     * the store would leave them there with nothing left to name them.
     */
    lastClearedBeforeSeconds?: number;
}>;

export const nativeLiveMidiWriter: {
    /**
     * Which pass is current. Bumped by every arm and every disarm, so no two
     * passes ever share a number and a settled batch can always tell whether
     * the pass that issued it is still the live one.
     */
    epoch: number;
    /** The epoch whose batch is unanswered, or `null` when none is. */
    inFlightEpoch: number | null;
    pass: LiveMidiWriterPass | null;
    /**
     * What the previous arm excluded. Every locate, loop edit and note edit
     * re-arms, so a strip the producer cannot carry would otherwise be reported
     * on each of them.
     */
    reportedExclusions: string | null;
    /**
     * Whether the pass owes a re-read, recorded rather than taken.
     *
     * A note edit arrives on a store subscription, at a rate a musician's
     * dragging sets; re-projecting on each of them would put a whole projection
     * on every keystroke. The playhead feed takes the request on its next
     * reading instead, which coalesces a burst into one re-arm and carries a
     * fresher engine position than any subscriber could supply.
     *
     * A boolean rather than a fence: unlike the automation writer's, nothing
     * here dates a reading against a batch — a note store is addressed by
     * absolute frame, so a re-arm taken against a slightly stale position
     * re-sends notes the engine already holds rather than misplacing them.
     */
    pendingRearm: boolean;
    /** Ends the note-edit subscriptions, or `null` when none are running. */
    unwatch: (() => void) | null;
} = {
    epoch: 0,
    inFlightEpoch: null,
    pass: null,
    reportedExclusions: null,
    pendingRearm: false,
    unwatch: null,
};
