import { isFrozenMidiTakeSource } from '#/modules/MIDI/stores';

import { type MidiTakeSource } from '../../models/TakeLane';

type DeletedSpanSide = {
    readonly preImageStartBeat: number;
    readonly preImageEndBeat: number;
    readonly deleteStartBeat: number;
    readonly deleteEndBeat: number;
};

/**
 * Keep a fragment of a Delete Time off the source it no longer holds. The rows
 * stay whole, so a fragment left of the span reads no further than the span's
 * start and one right of it no earlier than the span's end; otherwise a
 * looping fragment, which folds every note before its read into the loop,
 * would play the deleted notes again. A bound already set by an earlier cut
 * only narrows.
 */
export function boundMidiTakeSourceAtDeletedSpan(
    source: MidiTakeSource,
    { preImageStartBeat, preImageEndBeat, deleteStartBeat, deleteEndBeat }: DeletedSpanSide
): MidiTakeSource | null {
    if (!isFrozenMidiTakeSource(source) || !(deleteStartBeat < deleteEndBeat)) {
        return null;
    }
    const sourceBeatAt = (beat: number) => source.sourceEntryBeat + beat - source.phaseHeadBeat;
    let bounded: MidiTakeSource = source;
    if (preImageEndBeat <= deleteStartBeat) {
        bounded = { ...bounded, readEndBeat: Math.min(source.readEndBeat ?? Infinity, sourceBeatAt(deleteStartBeat)) };
    }
    if (preImageStartBeat >= deleteEndBeat) {
        bounded = {
            ...bounded,
            readStartBeat: Math.max(source.readStartBeat ?? -Infinity, sourceBeatAt(deleteEndBeat)),
        };
    }
    return isFrozenMidiTakeSource(bounded) ? bounded : null;
}
