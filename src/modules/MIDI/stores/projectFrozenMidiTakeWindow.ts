import { type MidiCC, type MidiNote } from '../models/MidiNote';
import {
    projectMidiClipWindow,
    type MidiNoteWindowRow,
    type SourceLocatedMidiPitchBend,
} from '../services/projectMidiClipWindow';
import {
    isRegisteredParameterController,
    reconcileRegisteredParameterMessages,
} from '../services/registeredParameterState';

import { frozenMidiTakeRepeat, type FrozenMidiTakeFragment, type FrozenMidiTakeRepeat } from './frozenMidiTakeRepeats';
import { isFrozenMidiTakeSource, type FrozenMidiTakeSource } from './isFrozenMidiTakeSource';
import { selectMidiNotesForRecordingPass } from './selectMidiNotesForRecordingPass';

export { isFrozenMidiTakeSource } from './isFrozenMidiTakeSource';
export type { FrozenMidiTakeSource } from './isFrozenMidiTakeSource';

type ProjectFrozenMidiTakeWindowInput = {
    readonly source: FrozenMidiTakeSource;
    /** The comp fragment the take sounds through. */
    readonly fragment: FrozenMidiTakeFragment;
    /** The selected recorded pass; absent on legacy or manually created takes. */
    readonly recordingPassIndex?: number;
    readonly absoluteOccurrenceIndex: number;
    readonly fromBeat: number;
    readonly toBeat: number;
};

type SourceWindow = {
    beatOffset: number;
    visibleStartBeat: number;
    visibleEndBeat: number;
    closingLineBeat?: number;
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

function isValidFragment(fragment: FrozenMidiTakeFragment): boolean {
    return isFiniteBeat(fragment.startBeat) && isFiniteBeat(fragment.endBeat) && fragment.startBeat < fragment.endBeat;
}

/**
 * The source beats the timeline span `[startBeat, endBeat)` reads when
 * `anchorBeat` reads `sourceEntryBeat`, kept inside the bounds a Delete Time
 * cut left on the source, if any.
 */
function sourceWindowAt(
    source: FrozenMidiTakeSource,
    anchorBeat: number,
    startBeat: number,
    endBeat: number
): SourceWindow | null {
    const beatOffset = anchorBeat - source.sourceEntryBeat;
    const visibleStartBeat = Math.max(startBeat - beatOffset, source.readStartBeat ?? -Infinity);
    const visibleEndBeat = Math.min(endBeat - beatOffset, source.readEndBeat ?? Infinity);
    if (visibleStartBeat >= visibleEndBeat) {
        return null;
    }
    return { beatOffset, visibleStartBeat, visibleEndBeat };
}

function projectWindowNotes(notes: readonly MidiNote[], window: SourceWindow): MidiNoteWindowRow[] {
    return projectMidiClipWindow({ notes, controlChanges: [], pitchBends: [], window, locatesOwnBend: true }).notes;
}

/** A looping clip holds a note for at most one loop length, wrapping what passes the loop end. */
function capToLoop(note: MidiNote, loopLengthBeats: number): MidiNote {
    if (note.duration <= loopLengthBeats) {
        return note;
    }
    return { ...note, duration: loopLengthBeats };
}

type LoopRead = {
    readonly passHeadBeat: number;
    readonly loopLengthBeats: number;
    /** The source beat the repeat reads at its own start. */
    readonly loopStartSourceBeat: number;
};

/**
 * What else a looping repeat sounds beside its own read, as a looping clip
 * plays its media: every note before the read lands at its phase in the loop,
 * so each earlier loop length of the source is one more window over the
 * repeat, and the tail of a note that crosses the loop end wraps onto the
 * repeat's start. A note at or past the loop end does not sound.
 */
/** What a looping repeat folds into its tail from before its read; a repeat that does not loop folds nothing. */
function repeatFoldedNotes(
    source: FrozenMidiTakeSource,
    notes: readonly MidiNote[],
    repeat: FrozenMidiTakeRepeat,
    startBeat: number,
    endBeat: number
): MidiNoteWindowRow[] {
    if (!repeat.loops) {
        return [];
    }
    const loop = {
        passHeadBeat: repeat.passHeadBeat,
        loopLengthBeats: repeat.strideBeats,
        loopStartSourceBeat: source.sourceEntryBeat + repeat.startBeat - repeat.passHeadBeat,
    };
    return foldedNotes(source, notes, loop, startBeat, endBeat);
}

function withFoldedNotes<Note extends { readonly startBeat: number }>(
    projected: readonly Note[],
    folded: readonly Note[]
): readonly Note[] {
    if (folded.length === 0) {
        return projected;
    }
    return [...projected, ...folded].toSorted((first, second) => first.startBeat - second.startBeat);
}

function foldedNotes(
    source: FrozenMidiTakeSource,
    notes: readonly MidiNote[],
    loop: LoopRead,
    startBeat: number,
    endBeat: number
): MidiNoteWindowRow[] {
    const folded: MidiNoteWindowRow[] = [];
    const loopEndSourceBeat = loop.loopStartSourceBeat + loop.loopLengthBeats;
    const wrapped = sourceWindowAt(source, loop.passHeadBeat - loop.loopLengthBeats, startBeat, endBeat);
    if (wrapped) {
        const crossing = notes.filter((note) => note.startBeat < loopEndSourceBeat);
        folded.push(...projectWindowNotes(crossing, wrapped));
    }
    const floorBeat = Math.max(
        notes.reduce((earliest, note) => Math.min(earliest, note.startBeat), Infinity),
        source.readStartBeat ?? -Infinity
    );
    for (let anchorBeat = loop.passHeadBeat + loop.loopLengthBeats; ; anchorBeat += loop.loopLengthBeats) {
        if (endBeat - (anchorBeat - source.sourceEntryBeat) <= floorBeat) {
            return folded;
        }
        const earlier = sourceWindowAt(source, anchorBeat, startBeat, endBeat);
        if (earlier) {
            folded.push(...projectWindowNotes(notes, earlier));
        }
    }
}

/**
 * One repeat of a frozen take in one timeline window, as a live comp fragment
 * of the same take plays its media (`frozenMidiTakeRepeat`): read from the
 * offset at the fragment start, straight through when the fragment does not
 * loop, and one loop length per repeat when it does, with the notes before
 * the read folded in at their phase. Controllers and bends read only the
 * repeat's own span, as a loop pass reads its lanes. The MIDI window
 * projection clips notes and expression and carries ordinary controllers;
 * registered-parameter messages before the head are declared as one coherent
 * state, since the last value of each controller cannot reproduce an RPN.
 * This call never writes a second stored row with the same id.
 */
export function projectFrozenMidiTakeWindow({
    source,
    fragment,
    recordingPassIndex,
    absoluteOccurrenceIndex,
    fromBeat,
    toBeat,
}: ProjectFrozenMidiTakeWindowInput): FrozenMidiTakeWindow | null {
    if (
        !isFrozenMidiTakeSource(source) ||
        !isValidFragment(fragment) ||
        (recordingPassIndex !== undefined && (!Number.isSafeInteger(recordingPassIndex) || recordingPassIndex < 0)) ||
        !Number.isSafeInteger(absoluteOccurrenceIndex) ||
        absoluteOccurrenceIndex < 0 ||
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
    const repeat = frozenMidiTakeRepeat(source, fragment, absoluteOccurrenceIndex);
    const visibleStartBeat = Math.max(fromBeat, repeat.startBeat);
    const visibleEndBeat = Math.min(toBeat, repeat.endBeat);
    if (visibleStartBeat >= visibleEndBeat) {
        return empty;
    }
    const passNotes = selectMidiNotesForRecordingPass(source.rows.notes.value, recordingPassIndex);
    const notes = repeat.loops ? passNotes.map((note) => capToLoop(note, repeat.strideBeats)) : passNotes;
    const folded = repeatFoldedNotes(source, notes, repeat, visibleStartBeat, visibleEndBeat);
    const window = sourceWindowAt(source, repeat.passHeadBeat, visibleStartBeat, visibleEndBeat);
    if (!window) {
        return { ...empty, notes: folded };
    }
    if (visibleEndBeat === fragment.endBeat && window.visibleEndBeat + window.beatOffset === fragment.endBeat) {
        window.closingLineBeat = fragment.endBeat;
    }
    const projected = projectMidiClipWindow({
        notes,
        controlChanges: source.rows.controlChanges.value,
        pitchBends: source.rows.pitchBends.value.map((bend) => ({ ...bend, sourceRecordedBeat: bend.beat })),
        window,
        locatesOwnBend: true,
        carriesRegisteredParameterLanes: false,
    });
    return {
        ...empty,
        ...projected,
        notes: withFoldedNotes(projected.notes, folded),
        controlChanges: [
            ...registeredStateBeforeWindow(
                source,
                absoluteOccurrenceIndex,
                window.visibleStartBeat,
                window.visibleStartBeat + window.beatOffset
            ),
            ...projected.controlChanges,
        ],
    };
}
