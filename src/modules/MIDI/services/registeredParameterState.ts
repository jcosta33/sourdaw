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
import { SAME_BEAT_TOLERANCE } from '../models/SameBeatTolerance';

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
function declareState(state: MidiChannelControllerState): RegisteredParameterMessage[] {
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
 * selected something cannot be returned to never having done so, only to the default and the Null RPN.
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

function withNullSelection(
    current: MidiChannelControllerState,
    target: MidiChannelControllerState
): MidiChannelControllerState {
    if (target.selectedParameterKind === null && current.selectedParameterKind !== null) {
        return {
            ...target,
            selectedParameterKind: 'rpn',
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
        if (JSON.stringify(declareState(currentState)) === JSON.stringify(declareState(reached))) {
            continue;
        }
        reconciled.push(...declareState(reached).map((message) => ({ ...message, channel })));
    }
    return reconciled;
}

/** A bend a cut carries onto the head of the clip it opens, and the beat its row was recorded at on the source. */
export type CarriedBendRecording = { channel: number; recordedBeat: number };

type BeatRegisteredParameterMessage = ChannelRegisteredParameterMessage & { beat: number };

type CarriedBendRangeMessages = {
    /** On the head, after the messages that open it: they bring each channel to the state its carried row was recorded under. */
    onHead: ChannelRegisteredParameterMessage[];
    /** Before the first row the clip plays after its head: they return each channel to the state at the cut. */
    afterHead: ChannelRegisteredParameterMessage[];
};

type PlayedRow = { channel: number; beat: number };

/** Where the edited clip's head plays, and the rows of its own the clip plays from there, its carries excluded. */
export type EditedClipHead = {
    beat: number;
    bends: readonly PlayedRow[];
    controlChanges: readonly (PlayedRow & { controller: number })[];
};

/**
 * The channels whose state a row of the edited clip's own reads or writes on its head: a bend or a
 * registered-parameter message within the same-beat tolerance of it, which `createStoredBendRangeReader` reads
 * with the rows on the head. The carried bend is replaced, or the state it would be read under rewritten, at the
 * instant it starts, so the channel keeps the state at the cut, as a lane starting at the head does.
 */
function channelsAddressedOnHead(head: EditedClipHead): Set<number> {
    const onHead = (row: PlayedRow) => row.beat <= head.beat + SAME_BEAT_TOLERANCE;
    return new Set(
        [
            ...head.bends.filter(onHead),
            ...head.controlChanges.filter((row) => onHead(row) && isRegisteredParameterController(row.controller)),
        ].map(({ channel }) => channel)
    );
}

/**
 * The messages that keep a bend carried onto a cut at the range its row was recorded under. Before the cut the
 * row is a carry, read at the beat it was recorded at (`projectChannelBend`); on the edited clip's head it is an
 * ordinary row, read under the state in force there, which is the state at the cut. A channel whose carried row
 * was recorded under the state at the cut gets nothing, and neither does one the clip's own rows address on its
 * head (`channelsAddressedOnHead`).
 *
 * The recorded state is the one `createStoredBendRangeReader` reads at the recorded beat: every message up to it,
 * within the same-beat tolerance.
 */
export function reconcileCarriedBendRanges({
    opening,
    before,
    carried,
    head,
}: {
    /** The messages the edited clip reads up to and on its head, the declaration that opens it included, in order. */
    opening: readonly ChannelRegisteredParameterMessage[];
    /** The source's messages before the cut, at their beats on the source, in the order the machine reads them. */
    before: readonly BeatRegisteredParameterMessage[];
    carried: readonly CarriedBendRecording[];
    head: EditedClipHead;
}): CarriedBendRangeMessages {
    const messages: CarriedBendRangeMessages = { onHead: [], afterHead: [] };
    const addressedOnHead = channelsAddressedOnHead(head);
    for (const { channel, recordedBeat } of carried) {
        if (addressedOnHead.has(channel)) {
            continue;
        }
        const openingOnChannel = opening.filter((message) => message.channel === channel);
        const beforeOnChannel = before.filter((message) => message.channel === channel);
        const toRecorded = reconcileRegisteredParameterMessages({
            current: openingOnChannel,
            target: beforeOnChannel.filter((message) => message.beat <= recordedBeat + SAME_BEAT_TOLERANCE),
        });
        if (toRecorded.length === 0) {
            continue;
        }
        messages.onHead.push(...toRecorded);
        messages.afterHead.push(
            ...reconcileRegisteredParameterMessages({
                current: [...openingOnChannel, ...toRecorded],
                target: beforeOnChannel,
            })
        );
    }
    return messages;
}

/**
 * Where the messages that follow a carried bend go: the first beat after the head the clip plays a row of its own
 * at, controller or bend, so every such row reads the state at the cut. None when the clip plays nothing after its
 * head, because then no row reads the state they return to.
 */
export function firstBeatAfterHead(head: EditedClipHead): number | undefined {
    let first: number | undefined;
    for (const { beat } of [...head.bends, ...head.controlChanges]) {
        if (beat > head.beat + SAME_BEAT_TOLERANCE && (first === undefined || beat < first)) {
            first = beat;
        }
    }
    return first;
}
