import { type MidiCC } from '../../models/MidiNote';
import {
    firstBeatAfterHead,
    reconcileCarriedBendRanges,
    reconcileRegisteredParameterMessages,
    type CarriedBendRecording,
    type ChannelRegisteredParameterMessage,
} from '../../services/registeredParameterState';

type DeclareGluedRegisteredParametersInput = {
    /** The controller rows already placed in the glued clip by the sources before this one, in the order they play. */
    gluedSoFar: readonly MidiCC[];
    /** Every control change of the source, on its own timeline. */
    sourceControlChanges: readonly MidiCC[];
    /** The source's window start on its own timeline: the rows before it are what the window is cut away from. */
    visibleStartBeat: number;
    /** Where the window starts in the glued clip. */
    glueBeat: number;
    /** The bends the window carries onto its start, each with the beat its row was recorded at on the source. */
    carriedBends: readonly CarriedBendRecording[];
    /** Where the window's own controller and bend rows play in the glued clip. */
    windowRowBeats: readonly number[];
    createId: (key: string) => string;
};

/** The rows before `beat` in the order the state machine reads them: by beat, source order breaking ties. */
function rowsBefore(rows: readonly MidiCC[], beat: number): MidiCC[] {
    return rows.filter((row) => row.beat < beat).toSorted((first, second) => first.beat - second.beat);
}

function placeMessages(
    messages: readonly ChannelRegisteredParameterMessage[],
    beat: number,
    createId: (index: number) => string
): MidiCC[] {
    return messages.map(({ channel, controller, value }, index) => ({
        id: createId(index),
        controller,
        value,
        beat,
        channel,
    }));
}

/**
 * The rows that open one source's window in a glued clip with the registered-parameter state the source
 * itself was in there: its bend range, and the parameter it had selected. Its own earlier rows are left
 * behind by the window, and the glued clip reads one state per channel across all its sources, so without
 * them a trimmed source would play at the default range and a source that declared none would play at the
 * range the source before it declared.
 *
 * A bend the window carries onto its start was read, in the source, under the state it was recorded in; in the
 * glued clip it is an ordinary row at the window start. Its channel is therefore brought to that state on the
 * window start, after the opening declaration, and back to the opening state before the window's next own row
 * (`reconcileCarriedBendRanges`). In the order returned, which the caller keeps among rows on one beat.
 */
export function declareGluedRegisteredParameters({
    gluedSoFar,
    sourceControlChanges,
    visibleStartBeat,
    glueBeat,
    carriedBends,
    windowRowBeats,
    createId,
}: DeclareGluedRegisteredParametersInput): MidiCC[] {
    const current = rowsBefore(gluedSoFar, Number.POSITIVE_INFINITY);
    const before = rowsBefore(sourceControlChanges, visibleStartBeat);
    const opening = reconcileRegisteredParameterMessages({ current, target: before });
    const carried = reconcileCarriedBendRanges({ opening: [...current, ...opening], before, carried: carriedBends });
    const rows = [
        ...placeMessages(opening, glueBeat, (index) => createId(`rpn-${index}`)),
        ...placeMessages(carried.onHead, glueBeat, (index) => createId(`rpn-carried-${index}`)),
    ];
    const afterHeadBeat = firstBeatAfterHead(glueBeat, windowRowBeats);
    if (afterHeadBeat !== undefined) {
        rows.push(
            ...placeMessages(carried.afterHead, afterHeadBeat, (index) => createId(`rpn-after-carried-${index}`))
        );
    }
    return rows;
}
