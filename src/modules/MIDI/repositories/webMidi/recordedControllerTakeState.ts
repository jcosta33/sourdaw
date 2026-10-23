/**
 * The controller and pitch-bend rows of the take being recorded, held in memory
 * until the take commits.
 *
 * Singleton module alongside `channelControllerState.ts`. The CRDT-backed
 * `midiStore` reconciles a clip's whole row list on every write, so writing each
 * message as it arrives makes every flush slower the longer the take runs; the
 * rows are written once per clip, by `commitRecordedControllers`, instead.
 *
 * Rows are in arrival order and carry the ids they will hold in the store, so
 * the redo snapshot the commit captures before it writes names the very rows the
 * write then lands.
 */
import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';

/** A controller message as the live input reports it, before it is given an id. */
export type RecordedCcRow = Omit<MidiCC, 'id'>;
export type RecordedPitchBendRow = Omit<MidiPitchBend, 'id'>;

export type RecordedControllerBuffer = {
    cc: MidiCC[];
    pitchBend: MidiPitchBend[];
};

type RecordedControllerTakeState = {
    /** Buffered rows, keyed by the clip the take records into. */
    buffers: Map<string, RecordedControllerBuffer>;
    /**
     * Clips a take opened whose commit has not taken their buffer yet. Their
     * commit flushes them; any other clip a take records into flushes when the
     * take ends.
     */
    openedClipIds: Set<string>;
    /**
     * Clips whose commit already took their buffer, so a message arriving after
     * it belongs to no take: the take that opened the clip is the one that ended.
     */
    committedClipIds: Set<string>;
    /**
     * Clips an earlier take opened and a later take is recording into while that
     * earlier commit still waits. Their commit lands inside the later take, which
     * keeps recording into the clip as an overdub, so it closes nothing.
     */
    carriedOverClipIds: Set<string>;
    /**
     * The pedals held on the live input when a take began, owed to the clip that
     * take opened on the input's track, as rows at the clip's beat 0.
     */
    heldPedalSeeds: Map<string, readonly MidiCC[]>;
    /**
     * The RPN 0 declarations of the pitch-bend range the live input held per
     * channel when a take began, owed to the clip that take opened on the input's
     * track, as rows at the clip's beat 0. Kept apart from the pedals because the
     * rows are one ordered message sequence: a take's own row at beat 0 never
     * stands in for part of it.
     */
    bendRangeSeeds: Map<string, readonly MidiCC[]>;
    /**
     * The registered-parameter state the live input held per channel when the
     * take began, as declaration rows at beat 0. An overdub into an existing clip
     * opens no clip, so what the keyboard held is compared with the clip's own
     * state where the overdub starts, when the take ends.
     */
    registeredStateAtStart: readonly MidiCC[];
};

export const recordedControllerTakeState: RecordedControllerTakeState = {
    buffers: new Map(),
    openedClipIds: new Set(),
    committedClipIds: new Set(),
    carriedOverClipIds: new Set(),
    heldPedalSeeds: new Map(),
    bendRangeSeeds: new Map(),
    registeredStateAtStart: [],
};
