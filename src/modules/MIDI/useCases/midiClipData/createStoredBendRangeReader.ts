import {
    STANDARD_BEND_RANGE_SEMITONES,
    createMidiChannelControllerState,
    isDataEntryCc,
    isParameterSelectCc,
    type MidiChannelControllerState,
} from '../../models/MidiControllerState';
import { type MidiCC } from '../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';
import { applyRegisteredParameterChange } from '../../repositories/webMidi/applyRegisteredParameterChange';

/** The range a channel's state machine declared as of a row; `undefined` until a data entry set one. */
type BendRangeChange = { beat: number; semitones: number | undefined };

/**
 * Reads the pitch-bend range a clip's own stored controllers declared, in semitones, for a
 * channel at a content beat.
 *
 * A stored bend is the signed 14-bit delta alone; its depth is whatever RPN 0 said when it was
 * played, and recording kept those messages as controller rows. They run through the live
 * input's own RPN state machine (`applyRegisteredParameterChange`), in beat order with arrival
 * order breaking ties, so a Null RPN after the data entry leaves the declared range in force, as
 * it does live. A channel the clip never declared a range for gets the MIDI 1.0 default of ±2, as
 * a live channel does.
 *
 * The range is the clip's own: a declaration made before the take began, or in another clip, is
 * not in these rows.
 */
export function createStoredBendRangeReader(
    controlChanges: readonly MidiCC[]
): (channel: number, contentBeat: number) => number {
    const stateByChannel = new Map<number, MidiChannelControllerState>();
    const changesByChannel = new Map<number, BendRangeChange[]>();

    const parameterRows = controlChanges
        .filter((row) => isParameterSelectCc(row.controller) || isDataEntryCc(row.controller))
        .sort((left, right) => left.beat - right.beat);
    for (const row of parameterRows) {
        const state = stateByChannel.get(row.channel) ?? createMidiChannelControllerState();
        stateByChannel.set(row.channel, state);
        applyRegisteredParameterChange(state, row.controller, row.value);
        const changes = changesByChannel.get(row.channel) ?? [];
        changes.push({ beat: row.beat, semitones: state.bendRangeSemitones });
        changesByChannel.set(row.channel, changes);
    }

    return (channel, contentBeat) => {
        const changes = changesByChannel.get(channel) ?? [];
        let semitones: number | undefined;
        for (const change of changes) {
            if (change.beat > contentBeat + SAME_BEAT_TOLERANCE) {
                break;
            }
            semitones = change.semitones;
        }
        return semitones ?? STANDARD_BEND_RANGE_SEMITONES;
    };
}
