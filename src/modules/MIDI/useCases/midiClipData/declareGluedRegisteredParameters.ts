import { type MidiCC } from '../../models/MidiNote';
import { reconcileRegisteredParameterMessages } from '../../services/registeredParameterState';

type DeclareGluedRegisteredParametersInput = {
    /** The controller rows already placed in the glued clip by the sources before this one, in the order they play. */
    gluedSoFar: readonly MidiCC[];
    /** Every control change of the source, on its own timeline. */
    sourceControlChanges: readonly MidiCC[];
    /** The source's window start on its own timeline: the rows before it are what the window is cut away from. */
    visibleStartBeat: number;
    /** Where the window starts in the glued clip. */
    glueBeat: number;
    createId: (key: string) => string;
};

/** The rows before `beat` in the order the state machine reads them: by beat, source order breaking ties. */
function rowsBefore(rows: readonly MidiCC[], beat: number): MidiCC[] {
    return rows.filter((row) => row.beat < beat).toSorted((first, second) => first.beat - second.beat);
}

/**
 * The rows that open one source's window in a glued clip with the registered-parameter state the source
 * itself was in there: its bend range, and the parameter it had selected. Its own earlier rows are left
 * behind by the window, and the glued clip reads one state per channel across all its sources, so without
 * them a trimmed source would play at the default range and a source that declared none would play at the
 * range the source before it declared.
 */
export function declareGluedRegisteredParameters({
    gluedSoFar,
    sourceControlChanges,
    visibleStartBeat,
    glueBeat,
    createId,
}: DeclareGluedRegisteredParametersInput): MidiCC[] {
    return reconcileRegisteredParameterMessages({
        current: rowsBefore(gluedSoFar, Number.POSITIVE_INFINITY),
        target: rowsBefore(sourceControlChanges, visibleStartBeat),
    }).map(({ channel, controller, value }, index) => ({
        id: createId(`rpn-${index}`),
        controller,
        value,
        beat: glueBeat,
        channel,
    }));
}
