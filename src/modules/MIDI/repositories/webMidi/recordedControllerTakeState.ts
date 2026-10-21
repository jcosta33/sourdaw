/**
 * The controller and pitch-bend rows of the take being recorded, held in memory
 * until the take commits.
 *
 * Singleton module alongside `channelControllerState.ts`. The CRDT-backed
 * `midiStore` reconciles a clip's whole row list on every write, so writing each
 * message as it arrives makes every flush slower the longer the take runs; the
 * rows are written once per clip, by `flushRecordedControllers`, instead.
 *
 * Rows are in arrival order and carry no ids: the store mints them on the one
 * write that lands them.
 */
import { type MidiCC, type MidiPitchBend } from '../../models/MidiNote';

export type RecordedCcRow = Omit<MidiCC, 'id'>;
export type RecordedPitchBendRow = Omit<MidiPitchBend, 'id'>;

export type RecordedControllerBuffer = {
    cc: RecordedCcRow[];
    pitchBend: RecordedPitchBendRow[];
};

/** The pedals held on the live input when a take began, owed to that take's clip on `trackId`. */
export type HeldPedalSeed = {
    trackId: string;
    rows: readonly RecordedCcRow[];
};

type RecordedControllerTakeState = {
    /** Buffered rows, keyed by the clip the take records into. */
    buffers: Map<string, RecordedControllerBuffer>;
    /** Clips the take opened, whose commit will flush their buffer; any other clip flushes when the take ends. */
    openedClipIds: Set<string>;
    /** Clips whose commit already took their buffer, so a message arriving after it belongs to no take. */
    committedClipIds: Set<string>;
    heldPedalSeed: HeldPedalSeed | null;
};

export const recordedControllerTakeState: RecordedControllerTakeState = {
    buffers: new Map(),
    openedClipIds: new Set(),
    committedClipIds: new Set(),
    heldPedalSeed: null,
};
