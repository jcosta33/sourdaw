import { type MidiCC, type MidiNote, type MidiPitchBend } from '../models/MidiNote';
import { isFrozenMidiTakeSource, type FrozenMidiTakeSource } from './isFrozenMidiTakeSource';

import { projectMidiClipWindow } from '../useCases/midiClipData/projectMidiClipWindow';

export { isFrozenMidiTakeSource } from './isFrozenMidiTakeSource';
export type { FrozenMidiTakeSource } from './isFrozenMidiTakeSource';

type ProjectFrozenMidiTakeWindowInput = {
    readonly source: FrozenMidiTakeSource;
    /** The selected recorded pass; absent on legacy or manually created takes. */
    readonly recordingPassIndex?: number;
    readonly absoluteOccurrenceIndex: number;
    readonly fromBeat: number;
    readonly toBeat: number;
};

export type FrozenMidiTakeWindow = {
    readonly sourceClipId: string;
    readonly absoluteOccurrenceIndex: number;
    readonly notes: readonly MidiNote[];
    readonly controlChanges: readonly MidiCC[];
    readonly closingControlChanges: readonly MidiCC[];
    readonly pitchBends: readonly MidiPitchBend[];
};

function isFiniteBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * One original pass occurrence in one timeline window. The existing MIDI
 * window projection clips notes and expression and carries controllers at a
 * fragment head; this call never makes a second stored row with the same id.
 */
export function projectFrozenMidiTakeWindow({
    source,
    recordingPassIndex,
    absoluteOccurrenceIndex,
    fromBeat,
    toBeat,
}: ProjectFrozenMidiTakeWindowInput): FrozenMidiTakeWindow | null {
    if (
        !isFrozenMidiTakeSource(source) ||
        (recordingPassIndex !== undefined && (!Number.isSafeInteger(recordingPassIndex) || recordingPassIndex < 0)) ||
        !Number.isSafeInteger(absoluteOccurrenceIndex) ||
        !isFiniteBeat(fromBeat) ||
        !isFiniteBeat(toBeat) ||
        fromBeat >= toBeat
    ) {
        return null;
    }
    const empty: FrozenMidiTakeWindow = {
        sourceClipId: source.sourceClipId,
        absoluteOccurrenceIndex,
        notes: [],
        controlChanges: [],
        closingControlChanges: [],
        pitchBends: [],
    };
    const passHeadBeat = source.phaseHeadBeat + absoluteOccurrenceIndex * source.passLengthBeats;
    const sourcePassEndBeat = passHeadBeat + source.sourceEndBeat - source.sourceEntryBeat;
    const visibleStartBeat = Math.max(fromBeat, passHeadBeat);
    const visibleEndBeat = Math.min(toBeat, sourcePassEndBeat);
    if (visibleStartBeat >= visibleEndBeat) {
        return empty;
    }
    const visibleSourceStartBeat = source.sourceEntryBeat + visibleStartBeat - passHeadBeat;
    const visibleSourceEndBeat = source.sourceEntryBeat + visibleEndBeat - passHeadBeat;
    const projected = projectMidiClipWindow({
        notes: source.rows.notes.value.filter(
            (note) =>
                recordingPassIndex === undefined ||
                note.recordingPassIndex === undefined ||
                note.recordingPassIndex === recordingPassIndex
        ),
        controlChanges: source.rows.controlChanges.value,
        pitchBends: source.rows.pitchBends.value,
        window: {
            beatOffset: passHeadBeat - source.sourceEntryBeat,
            visibleStartBeat: visibleSourceStartBeat,
            visibleEndBeat: visibleSourceEndBeat,
            ...(visibleEndBeat === sourcePassEndBeat ? { closingLineBeat: sourcePassEndBeat } : {}),
        },
    });
    return { ...empty, ...projected };
}
