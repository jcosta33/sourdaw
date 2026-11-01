import { type FrozenMidiTakeSource } from './isFrozenMidiTakeSource';

export type FrozenMidiTakeRepeat = {
    readonly absoluteOccurrenceIndex: number;
    /** The first beat the repeat sounds: its pass head, or the head of the run-up the first repeat carries. */
    readonly startBeat: number;
    /** Where the repeat reads `sourceEntryBeat`; every source beat maps through it. */
    readonly passHeadBeat: number;
    /** The exclusive beat the repeat reads `sourceEndBeat` at. */
    readonly endBeat: number;
    /** From its start to the next repeat's pass head: the iteration a projection bounds the repeat by. */
    readonly strideBeats: number;
};

/**
 * One repeat of a frozen take on the timeline. Repeats stride by the pass
 * length from the pass head. Live comp playback plays a pass take's media from
 * its clip's start, so the first repeat also sounds the run-up the capture kept
 * before the take's own start; a later repeat begins at its pass head.
 */
export function frozenMidiTakeRepeat(
    source: FrozenMidiTakeSource,
    absoluteOccurrenceIndex: number
): FrozenMidiTakeRepeat {
    const passHeadBeat = source.phaseHeadBeat + absoluteOccurrenceIndex * source.passLengthBeats;
    const runUpBeats = runUpBeatsOf(source, absoluteOccurrenceIndex);
    return {
        absoluteOccurrenceIndex,
        startBeat: passHeadBeat - runUpBeats,
        passHeadBeat,
        endBeat: passHeadBeat + source.sourceEndBeat - source.sourceEntryBeat,
        strideBeats: runUpBeats + source.passLengthBeats,
    };
}

function runUpBeatsOf(source: FrozenMidiTakeSource, absoluteOccurrenceIndex: number): number {
    if (absoluteOccurrenceIndex !== 0 || source.runUpEntryBeat === undefined) {
        return 0;
    }
    return source.sourceEntryBeat - source.runUpEntryBeat;
}

/** Every repeat that ends after `fromBeat` and starts before `toBeat`, in order. */
export function frozenMidiTakeRepeats(
    source: FrozenMidiTakeSource,
    fromBeat: number,
    toBeat: number
): FrozenMidiTakeRepeat[] {
    const span = source.sourceEndBeat - source.sourceEntryBeat;
    const first = Math.max(0, Math.floor((fromBeat - source.phaseHeadBeat - span) / source.passLengthBeats) + 1);
    const firstRepeatStartsBefore = toBeat > frozenMidiTakeRepeat(source, 0).startBeat ? 1 : 0;
    const last = Math.max(firstRepeatStartsBefore, Math.ceil((toBeat - source.phaseHeadBeat) / source.passLengthBeats));
    const repeats: FrozenMidiTakeRepeat[] = [];
    for (let absoluteOccurrenceIndex = first; absoluteOccurrenceIndex < last; absoluteOccurrenceIndex++) {
        repeats.push(frozenMidiTakeRepeat(source, absoluteOccurrenceIndex));
    }
    return repeats;
}

/** The repeat sounding at `beat`, or null where none does. */
export function frozenMidiTakeRepeatAt(source: FrozenMidiTakeSource, beat: number): FrozenMidiTakeRepeat | null {
    const first = frozenMidiTakeRepeat(source, 0);
    if (beat < first.startBeat) {
        return null;
    }
    if (beat < first.passHeadBeat) {
        return first;
    }
    const repeat = frozenMidiTakeRepeat(source, Math.floor((beat - source.phaseHeadBeat) / source.passLengthBeats));
    return beat < repeat.endBeat ? repeat : null;
}
