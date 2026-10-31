import { type MidiCC } from '../models/MidiNote';
import {
    projectMidiClipWindow,
    type MidiNoteWindowRow,
    type SourceLocatedMidiPitchBend,
} from '../services/projectMidiClipWindow';
import {
    isRegisteredParameterController,
    reconcileRegisteredParameterMessages,
} from '../services/registeredParameterState';

import { isFrozenMidiTakeSource, type FrozenMidiTakeSource } from './isFrozenMidiTakeSource';
import { selectMidiNotesForRecordingPass } from './selectMidiNotesForRecordingPass';

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
    readonly notes: readonly MidiNoteWindowRow[];
    readonly controlChanges: readonly MidiCC[];
    readonly closingControlChanges: readonly MidiCC[];
    readonly pitchBends: readonly SourceLocatedMidiPitchBend[];
};

function isFiniteBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** Recreate the state at a frozen fragment's head in message order, before its own rows play. */
function registeredStateBeforeWindow(
    source: FrozenMidiTakeSource,
    absoluteOccurrenceIndex: number,
    sourceStartBeat: number,
    timelineStartBeat: number
): MidiCC[] {
    const before = source.rows.controlChanges.value
        .filter((row) => row.beat < sourceStartBeat && isRegisteredParameterController(row.controller))
        .toSorted((first, second) => first.beat - second.beat);
    const messages = reconcileRegisteredParameterMessages({ current: [], target: before });
    return messages.map((message, index) => ({
        ...message,
        id: `frozen-rpn:${JSON.stringify([source.sourceClipId, absoluteOccurrenceIndex, sourceStartBeat, index])}`,
        beat: timelineStartBeat,
    }));
}

/**
 * One original pass occurrence in one timeline window. The MIDI window
 * projection clips notes and expression and carries ordinary controllers;
 * registered-parameter messages before the head are declared as one coherent
 * state, since the last value of each controller cannot reproduce an RPN.
 * This call never writes a second stored row with the same id.
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
    const window: {
        beatOffset: number;
        visibleStartBeat: number;
        visibleEndBeat: number;
        closingLineBeat?: number;
    } = {
        beatOffset: passHeadBeat - source.sourceEntryBeat,
        visibleStartBeat: visibleSourceStartBeat,
        visibleEndBeat: visibleSourceEndBeat,
    };
    const nextPassHeadBeat = passHeadBeat + source.passLengthBeats;
    if (visibleEndBeat === sourcePassEndBeat && (sourcePassEndBeat >= toBeat || sourcePassEndBeat < nextPassHeadBeat)) {
        window.closingLineBeat = sourcePassEndBeat;
    }
    const projected = projectMidiClipWindow({
        notes: selectMidiNotesForRecordingPass(source.rows.notes.value, recordingPassIndex),
        controlChanges: source.rows.controlChanges.value,
        pitchBends: source.rows.pitchBends.value.map((bend) => ({ ...bend, sourceRecordedBeat: bend.beat })),
        window,
        locatesOwnBend: true,
        carriesRegisteredParameterLanes: false,
    });
    return {
        ...empty,
        ...projected,
        controlChanges: [
            ...registeredStateBeforeWindow(source, absoluteOccurrenceIndex, visibleSourceStartBeat, visibleStartBeat),
            ...projected.controlChanges,
        ],
    };
}
