import { type MidiCC } from '../../models/MidiNote';
import {
    carriedBendReturnBeat,
    reconcileCarriedBendRanges,
    reconcileRegisteredParameterMessages,
    type CarriedBendRecording,
    type ChannelRegisteredParameterMessage,
    type EditedClipHead,
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
    /** Where the window's closing line plays in the glued clip: its end, or the next source's head when that comes first. */
    closingLineBeat: number;
    /** The bends the window carries onto its start, each with the beat its row was recorded at on the source. */
    carriedBends: readonly CarriedBendRecording[];
    /** The window's own bends, its carries excluded, where they play in the glued clip. */
    windowBends: EditedClipHead['bends'];
    /** The window's controller rows, where they play in the glued clip. */
    windowControlChanges: readonly MidiCC[];
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
 * window start, after the opening declaration, and back to the opening state just after it
 * (`reconcileCarriedBendRanges`, `carriedBendReturnBeat`), unless a row of the window's own addresses the channel
 * on its start. In the order returned, which the caller keeps among rows on one beat.
 */
export function declareGluedRegisteredParameters({
    gluedSoFar,
    sourceControlChanges,
    visibleStartBeat,
    glueBeat,
    closingLineBeat,
    carriedBends,
    windowBends,
    windowControlChanges,
    createId,
}: DeclareGluedRegisteredParametersInput): MidiCC[] {
    const current = rowsBefore(gluedSoFar, Number.POSITIVE_INFINITY);
    const before = rowsBefore(sourceControlChanges, visibleStartBeat);
    const opening = reconcileRegisteredParameterMessages({ current, target: before });
    const head: EditedClipHead = { beat: glueBeat, bends: windowBends, controlChanges: windowControlChanges };
    const carried = reconcileCarriedBendRanges({
        opening: [...current, ...opening],
        before,
        carried: carriedBends,
        head,
    });
    // Never past the window's closing line, where the next source's own state begins.
    const returnBeat = Math.min(carriedBendReturnBeat(head), closingLineBeat);
    return [
        ...placeMessages(opening, glueBeat, (index) => createId(`rpn-${index}`)),
        ...placeMessages(carried.onHead, glueBeat, (index) => createId(`rpn-carried-${index}`)),
        ...placeMessages(carried.afterHead, returnBeat, (index) => createId(`rpn-after-carried-${index}`)),
    ];
}
