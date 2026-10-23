import {
    CC_DATA_ENTRY_LSB,
    CC_DATA_ENTRY_MSB,
    CC_NRPN_LSB,
    CC_NRPN_MSB,
    CC_RPN_LSB,
    CC_RPN_MSB,
    PARAMETER_NUMBER_NULL,
    RPN_PITCH_BEND_SENSITIVITY,
    STANDARD_BEND_RANGE_SEMITONES,
    createMidiChannelControllerState,
    getSelectedParameterNumber,
    isDataEntryCc,
    isParameterSelectCc,
    isPitchBendSensitivitySelected,
    type MidiChannelControllerState,
} from '../models/MidiControllerState';

import { applyRegisteredParameterChange } from './applyRegisteredParameterChange';

/** One Control Change that addresses a channel's registered-parameter state machine. */
export type RegisteredParameterMessage = { controller: number; value: number };

export type ChannelRegisteredParameterMessage = RegisteredParameterMessage & { channel: number };

type DataEntryBytes = { msb: number; lsb: number };

/** Both halves of the Null RPN (0x3FFF), the selection that leaves no parameter addressed. */
const NULL_PARAMETER_HALF = PARAMETER_NUMBER_NULL >> 7;

/** Whether a controller number is a message to the RPN/NRPN state machine rather than a lane value. */
export function isRegisteredParameterController(controller: number): boolean {
    return isParameterSelectCc(controller) || isDataEntryCc(controller);
}

/** The state each channel is left in by `messages`, in order, run through the one machine live input shares. */
function replayByChannel(
    messages: readonly ChannelRegisteredParameterMessage[]
): Map<number, MidiChannelControllerState> {
    const stateByChannel = new Map<number, MidiChannelControllerState>();
    for (const { channel, controller, value } of messages) {
        const state = stateByChannel.get(channel) ?? createMidiChannelControllerState();
        stateByChannel.set(channel, state);
        applyRegisteredParameterChange(state, controller, value);
    }
    return stateByChannel;
}

function selectMessages(kind: 'rpn' | 'nrpn', msb: number, lsb: number): RegisteredParameterMessage[] {
    const [msbController, lsbController] = kind === 'rpn' ? [CC_RPN_MSB, CC_RPN_LSB] : [CC_NRPN_MSB, CC_NRPN_LSB];
    return [
        { controller: msbController, value: msb },
        { controller: lsbController, value: lsb },
    ];
}

function dataEntryMessages({ msb, lsb }: DataEntryBytes): RegisteredParameterMessage[] {
    return [
        { controller: CC_DATA_ENTRY_MSB, value: msb },
        { controller: CC_DATA_ENTRY_LSB, value: lsb },
    ];
}

/** The two RPN 0 data bytes a range reads back from: whole semitones, then the cents the machine rounds to. */
function encodeBendRange(semitones: number): DataEntryBytes {
    const whole = Math.trunc(semitones);
    return { msb: whole, lsb: Math.round((semitones - whole) * 100) };
}

function sameBytes(left: DataEntryBytes, right: DataEntryBytes): boolean {
    return left.msb === right.msb && left.lsb === right.lsb;
}

/**
 * The messages that bring a channel to `state`: the bend range, the selected parameter (the Null RPN
 * included) and the data entry bytes it holds are the same afterwards, whatever the channel held before.
 *
 * The range is declared first, through RPN 0, because a range is only ever set while RPN 0 is selected; the
 * selection the channel ended on follows, and with it the data entry bytes. A selection of RPN 0 that a data
 * entry has just written is already what the declaration leaves, so it is not selected again (selecting
 * resets the bytes).
 */
export function declareChannelState(state: MidiChannelControllerState): RegisteredParameterMessage[] {
    const messages: RegisteredParameterMessage[] = [];
    const range = state.bendRangeSemitones;
    const rangeBytes = range === undefined ? undefined : encodeBendRange(range);
    if (rangeBytes) {
        messages.push(
            ...selectMessages('rpn', RPN_PITCH_BEND_SENSITIVITY, RPN_PITCH_BEND_SENSITIVITY),
            ...dataEntryMessages(rangeBytes)
        );
    }
    const kind = state.selectedParameterKind;
    if (kind === null) {
        return messages;
    }
    const dataBytes = { msb: state.dataEntryMsb, lsb: state.dataEntryLsb };
    const selectsPitchBend = isPitchBendSensitivitySelected(state);
    if (selectsPitchBend && rangeBytes && sameBytes(dataBytes, rangeBytes)) {
        return messages;
    }
    messages.push(...selectMessages(kind, state.selectedParameterMsb, state.selectedParameterLsb));
    const takesDataEntry = getSelectedParameterNumber(state) !== null;
    if (takesDataEntry && !sameBytes(dataBytes, { msb: 0, lsb: 0 })) {
        // Written to RPN 0, they set the range from the same bytes it was set from.
        messages.push(...dataEntryMessages(dataBytes));
    }
    return messages;
}

/**
 * What `target` asks of a channel that is in the state `current`: a range the channel never declared is the
 * MIDI 1.0 default of ±2 and a selection it never made is no selection, and a channel that has declared or
 * selected something cannot be returned to never having done so, only to the default range and the Null NRPN.
 */
function stateToReach(
    current: MidiChannelControllerState,
    target: MidiChannelControllerState
): MidiChannelControllerState {
    return withNullSelection(current, withDefaultRange(current, target));
}

function withDefaultRange(
    current: MidiChannelControllerState,
    target: MidiChannelControllerState
): MidiChannelControllerState {
    if (target.bendRangeSemitones === undefined && current.bendRangeSemitones !== undefined) {
        return { ...target, bendRangeSemitones: STANDARD_BEND_RANGE_SEMITONES };
    }
    return target;
}

/**
 * No selection is the Null NRPN, not the Null RPN: an RPN select over a channel that already selected
 * from the RPN bank keeps the other half of its number, while one over a channel that selected from the
 * NRPN bank starts the number over, as it does on a channel that never selected anything. A take's lone
 * half-select of RPN 0 therefore lands on RPN 0 afterwards, as it did live, and Data Entry stays an
 * ordinary control until then, as it was on that channel.
 */
function withNullSelection(
    current: MidiChannelControllerState,
    target: MidiChannelControllerState
): MidiChannelControllerState {
    if (target.selectedParameterKind === null && current.selectedParameterKind !== null) {
        return {
            ...target,
            selectedParameterKind: 'nrpn',
            selectedParameterMsb: NULL_PARAMETER_HALF,
            selectedParameterLsb: NULL_PARAMETER_HALF,
        };
    }
    return target;
}

/**
 * The messages, per channel, that leave each channel in the state `target` leaves it in, for a channel
 * that was left in the state `current` leaves it in. A clip cut away from the rows that declared its bend
 * range (a split's right half, a glued source trimmed at its head) starts with these, so a later bend, and a
 * Data Entry that arrives while the range is still selected, mean what they meant before the cut; a glued
 * source that follows another is brought back to its own state, not left in the previous source's.
 *
 * A channel already in the target state gets nothing. Both lists are in the order the machine reads them;
 * a controller it does not take changes nothing, so the lists need not be filtered to the messages it does.
 */
export function reconcileRegisteredParameterMessages({
    current,
    target,
}: {
    current: readonly ChannelRegisteredParameterMessage[];
    target: readonly ChannelRegisteredParameterMessage[];
}): ChannelRegisteredParameterMessage[] {
    const currentByChannel = replayByChannel(current);
    const targetByChannel = replayByChannel(target);
    const reconciled: ChannelRegisteredParameterMessage[] = [];
    for (const channel of new Set([...targetByChannel.keys(), ...currentByChannel.keys()])) {
        const currentState = currentByChannel.get(channel) ?? createMidiChannelControllerState();
        const targetState = targetByChannel.get(channel) ?? createMidiChannelControllerState();
        const reached = stateToReach(currentState, targetState);
        if (JSON.stringify(declareChannelState(currentState)) === JSON.stringify(declareChannelState(reached))) {
            continue;
        }
        reconciled.push(...declareChannelState(reached).map((message) => ({ ...message, channel })));
    }
    return reconciled;
}
