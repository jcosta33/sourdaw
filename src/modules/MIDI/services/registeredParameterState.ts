import {
    CC_DATA_DECREMENT,
    CC_DATA_ENTRY_LSB,
    CC_DATA_ENTRY_MSB,
    CC_DATA_INCREMENT,
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
import { type MidiCC } from '../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../models/SameBeatTolerance';
import { SEQUENCER_TICK_BEATS } from '../models/SequencerTick';

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

/** A bend a cut carries onto the head of the clip it opens, and the beat its row was recorded at on the source. */
export type CarriedBendRecording = { channel: number; recordedBeat: number };

type BeatRegisteredParameterMessage = ChannelRegisteredParameterMessage & { beat: number };

type CarriedBendRangeMessages = {
    /** On the head, after the messages that open it: they bring each channel to the state its carried row was recorded under. */
    onHead: ChannelRegisteredParameterMessage[];
    /** Just after the head (`carriedBendReturnBeat`): they return each channel to the state at the cut. */
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
 * Where the messages that follow a carried bend go: one tick after the head, so a bend placed anywhere after the
 * carried one, now or by a later edit, reads the state at the cut; earlier still when a row of the clip's own plays
 * within that tick, so that row reads it too. Not on the head itself, because the range reader reads every message
 * on the head before the carried bend.
 */
export function carriedBendReturnBeat(head: EditedClipHead): number {
    return [...head.bends, ...head.controlChanges].reduce(
        (returnBeat, { beat }) => (beat > head.beat + SAME_BEAT_TOLERANCE ? Math.min(returnBeat, beat) : returnBeat),
        head.beat + SEQUENCER_TICK_BEATS
    );
}

/** The id key of the rows that return a channel to the state at the cut, which the cut itself derives (`carriedBendReturnBeat`). */
const CARRIED_BEND_RETURN_ID_KEY = 'rpn-after-carried';
const CARRIED_BEND_RETURN_ID = new RegExp(`:${CARRIED_BEND_RETURN_ID_KEY}-\\d+$`);
const CARRIED_BEND_RETURN_ID_INDEX = new RegExp(`:${CARRIED_BEND_RETURN_ID_KEY}-(\\d+)$`);

/** The id key of the `index`th row that returns a channel to the state at the cut. */
export function carriedBendReturnIdKey(index: number): string {
    return `${CARRIED_BEND_RETURN_ID_KEY}-${index}`;
}

type StoredRegisteredParameterRow = { channel: number; beat: number; controller: number; value: number };

/** The controllers that set or step the bend range of an RPN 0 selected when they arrive. */
function isBendRangeDataController(controller: number): boolean {
    return controller === CC_DATA_ENTRY_MSB || controller === CC_DATA_INCREMENT || controller === CC_DATA_DECREMENT;
}

/**
 * Whether `edit`, a point set by hand, changes RPN 0's bend range where it lands: it is a Data Entry MSB, Data
 * Increment or Decrement and RPN 0 is selected when it arrives. A select, the Null RPN and Data Entry LSB (cents)
 * set no range, and a Data Entry the state machine ignores (a Null RPN or an NRPN is selected, which is how a
 * recorded state usually ends) changes nothing, so an edit like those leaves later bends at the state at the cut.
 *
 * The selection is the one `createStoredBendRangeReader` reads there: the channel's `stored` registered-parameter
 * rows up to the edit's beat, in beat order with list order breaking ties, run through the one state machine. The
 * edit goes last on its beat, as `addMidiCC` appends it, and the rows it replaces are left out.
 */
export function editSetsBendRangeWhereItLands(
    stored: readonly StoredRegisteredParameterRow[],
    edit: StoredRegisteredParameterRow
): boolean {
    if (!isBendRangeDataController(edit.controller)) {
        return false;
    }
    const replacedByEdit = (row: StoredRegisteredParameterRow) =>
        row.beat === edit.beat && row.controller === edit.controller;
    const state = replayInReaderOrder(
        stored.filter((row) => row.beat <= edit.beat && !replacedByEdit(row)),
        edit.channel
    );
    return isPitchBendSensitivitySelected(state);
}

/** The state a channel is in after its registered-parameter rows of `rows`, in beat order with list order breaking ties. */
function replayInReaderOrder(
    rows: readonly StoredRegisteredParameterRow[],
    channel: number
): MidiChannelControllerState {
    const state = createMidiChannelControllerState();
    const arrived = rows
        .filter((row) => row.channel === channel && isRegisteredParameterController(row.controller))
        .toSorted((first, second) => first.beat - second.beat);
    for (const { controller, value } of arrived) {
        applyRegisteredParameterChange(state, controller, value);
    }
    return state;
}

/**
 * Whether `row` is a return a split or a glue wrote for a carried bend, from the head `edit` lands on: on the head
 * itself or up to one return tick after it. Such a return re-sends the state at the cut (`landEditOnRows`).
 */
export function isCarriedBendReturnOnEditedHead(
    row: { id: string; channel: number; beat: number },
    edit: { channel: number; beat: number }
): boolean {
    if (row.channel !== edit.channel || !CARRIED_BEND_RETURN_ID.test(row.id)) {
        return false;
    }
    const afterEdit = row.beat - edit.beat;
    return afterEdit >= -SAME_BEAT_TOLERANCE && afterEdit <= SEQUENCER_TICK_BEATS + SAME_BEAT_TOLERANCE;
}

/**
 * The single source family the edit addresses. Timing admits candidates, while the shared writer-id prefix
 * ties a return to its source head. A previous source's return on the next head is never a head witness.
 */
export function getCarriedBendReturnFamily(
    rows: readonly MidiCC[],
    head: { channel: number; beat: number }
): readonly MidiCC[] {
    const candidates = rows.filter((row) => isCarriedBendReturnOnEditedHead(row, head));
    const prefixes = new Set(candidates.map((row) => row.id.replace(CARRIED_BEND_RETURN_ID, '')));
    const headByPrefix = new Map<string, number>();
    const writerId = /:rpn-(?:carried-)?\d+$/;
    for (const row of rows) {
        if (row.channel !== head.channel || !writerId.test(row.id)) {
            continue;
        }
        const prefix = row.id.replace(writerId, '');
        if (!prefixes.has(prefix)) {
            continue;
        }
        headByPrefix.set(prefix, Math.min(headByPrefix.get(prefix) ?? row.beat, row.beat));
    }
    let selectedPrefix: string | undefined;
    let selectedBeat = Number.NEGATIVE_INFINITY;
    for (const [prefix, beat] of headByPrefix) {
        // A future source head must not join this edit, however short the preceding window is.
        // Equal heads follow source/list order, just as the state reader does.
        if (beat <= head.beat && beat >= selectedBeat) {
            selectedPrefix = prefix;
            selectedBeat = beat;
        }
    }
    if (selectedPrefix === undefined && prefixes.size === 1) {
        const [prefix] = prefixes;
        if (prefix !== undefined && !headByPrefix.has(prefix)) {
            selectedPrefix = prefix;
        }
    }
    // Several families without a surviving head witness are ambiguous; leave all of them untouched.
    if (selectedPrefix === undefined) {
        return [];
    }
    return candidates.filter((row) => row.id.replace(CARRIED_BEND_RETURN_ID, '') === selectedPrefix);
}

/** `state` with RPN 0's range replaced by `semitones`; the selection and every other parameter stay as they are. */
function withBendRange(state: MidiChannelControllerState, semitones: number): MidiChannelControllerState {
    const replaced = { ...state, bendRangeSemitones: semitones };
    if (!isPitchBendSensitivitySelected(state)) {
        return replaced;
    }
    const { msb, lsb } = encodeBendRange(semitones);
    return { ...replaced, dataEntryMsb: msb, dataEntryLsb: lsb };
}

/** One past the highest return index the rows hold, whatever the channel, so a new return never takes an id in use. */
function nextCarriedBendReturnIndex(rows: readonly { id: string }[]): number {
    let next = 0;
    for (const { id } of rows) {
        const index = CARRIED_BEND_RETURN_ID_INDEX.exec(id)?.[1];
        if (index !== undefined) {
            next = Math.max(next, Number(index) + 1);
        }
    }
    return next;
}

/**
 * The clip's rows after `edit`, a point set by hand, lands on `stored`: the rows at the edit's key are replaced and
 * the edit goes last, as `addMidiCC` appends it.
 *
 * A split or glue that carries a bend onto its head also writes, just after it, returns that restore the state at
 * the cut: its range, but also the selection (an NRPN, the Null RPN, RPN 0) and the data bytes. An edit that changes
 * RPN 0's range where it lands (`editSetsBendRangeWhereItLands`) must govern every later bend, and a Data Entry LSB
 * beside a coarse one completes the fractional range the returns carry, so both revisit the returns through
 * `reconcileHandEditedReturns`; every other edit leaves them as they are.
 */
export function landEditOnRows(stored: readonly MidiCC[], edit: MidiCC): MidiCC[] {
    const kept = stored.filter(
        (row) => !(row.beat === edit.beat && row.channel === edit.channel && row.controller === edit.controller)
    );
    const setsRange = editSetsBendRangeWhereItLands(stored, edit);
    if (!setsRange && edit.controller !== CC_DATA_ENTRY_LSB) {
        return [...kept, edit];
    }
    const revisited = reconcileHandEditedReturns(
        [...kept, edit],
        { channel: edit.channel, beat: edit.beat },
        {
            fineOnlyEdit: !setsRange,
        }
    );
    if (revisited === null) {
        return [...kept, edit];
    }
    return [...revisited];
}

/**
 * The rows after a hand edit touched the point at a clip's head, with the returns a split or glue wrote just after
 * that head reconciled to what the rows now set there: they keep restoring the cut state with only RPN 0's range
 * replaced by the one the visible rows leave, rewritten in place under the standing family's own ids — reused in
 * order, minted from the next free index only for rows beyond it. A rewrite can reuse or remove ids, so undo
 * captures the actual row transition and restores only its owned changes, never the whole family. The returns are the last word the reader replays at
 * the head, so an edit that leaves them carrying a range neither a visible point nor the cut state sets would
 * govern every later bend wrongly. `fineOnlyEdit` marks an edit of a Data Entry LSB, which sets no coarse range
 * alone: it refines the returns only when a hand coarse stands at the head for it to complete, and is a no-op
 * otherwise. No edit of a writer row (ids carrying `:rpn-`) reaches this function: those rows are what the
 * returns exist to override, not hand edits of the range.
 *
 * A lone Data Entry LSB among the visible rows sets no range either — the coarse it would refine is gone — so the
 * target is then the cut state the returns restore, untouched. The family is never emptied: a revisit that finds
 * the returns gone could never restore them, so a rewrite with nothing to reconcile re-declares the target state.
 *
 * A no-op — signalled by `null` — when the head carries no returns, when a fine-only edit finds no hand coarse
 * at the head to complete, or when the returns already restore
 * exactly the target state.
 */
export function reconcileHandEditedReturns(
    rows: readonly MidiCC[],
    head: { channel: number; beat: number },
    options: { fineOnlyEdit?: boolean } = {}
): readonly MidiCC[] | null {
    const returns = getCarriedBendReturnFamily(rows, head);
    const [firstReturn] = returns;
    if (firstReturn === undefined) {
        return null;
    }
    const kept = rows.filter((row) => !returns.includes(row));
    const visible = kept.filter((row) => row.beat <= head.beat);
    const afterEdit = replayInReaderOrder(visible, head.channel);
    // A hand coarse Data Entry is what sets the range the returns must carry: the writer's
    // declaration and carried coarses (ids carrying `:rpn-`) are the rows the returns exist to
    // override, and a lone Data Entry LSB refines nothing. The range provenance runs through the
    // full replay — a hand coarse only sets the range under the selection the writer rows left —
    // tracking the last valid coarse write, including an explicit write of the value already in force.
    // A later selector changes the destination of future data, not the range this write already set.
    let rangeSourceId: string | undefined;
    const rangeState = createMidiChannelControllerState();
    for (const row of visible
        .filter((row) => row.channel === head.channel)
        .toSorted((first, second) => first.beat - second.beat)) {
        if (isBendRangeDataController(row.controller) && isPitchBendSensitivitySelected(rangeState)) {
            // A coarse write remains authoritative even when its value or a clamped step does not change the number.
            rangeSourceId = row.id;
        }
        applyRegisteredParameterChange(rangeState, row.controller, row.value);
    }
    const coarseStands = rangeSourceId !== undefined && !rangeSourceId.includes(':rpn-');
    if (options.fineOnlyEdit === true && !coarseStands) {
        return null;
    }
    const cut = replayInReaderOrder(
        rows.filter((row) => row.beat <= head.beat + SAME_BEAT_TOLERANCE || returns.includes(row)),
        head.channel
    );
    let target = cut;
    if (coarseStands) {
        target = withBendRange(cut, afterEdit.bendRangeSemitones ?? STANDARD_BEND_RANGE_SEMITONES);
    }
    const targetDeclaration = declareChannelState(target).map((message) => ({ ...message, channel: head.channel }));
    const messages = reconcileRegisteredParameterMessages({
        current: visible
            .filter((row) => row.channel === head.channel)
            .toSorted((first, second) => first.beat - second.beat),
        target: targetDeclaration,
    });
    // The returns are a no-op when they already restore the target state; the family is never
    // emptied, because a revisit that later finds no returns could not restore them.
    const rewrittenSource = messages.length > 0 ? messages : targetDeclaration;

    // The rewritten rows reuse the standing family's ids in order, minting only for rows beyond
    // it. Reusing or shortening a family can change rows without changing their ids, so gesture
    // history captures actual row transitions and restores only owned changes still standing.
    const idPrefix = firstReturn.id.replace(CARRIED_BEND_RETURN_ID, ':');
    const firstIndex = nextCarriedBendReturnIndex(rows);
    const rewritten: MidiCC[] = rewrittenSource.map(({ controller, value, channel }, index) => {
        const standing = returns[index];
        const id = standing !== undefined ? standing.id : `${idPrefix}${carriedBendReturnIdKey(firstIndex + index)}`;
        return { id, controller, value, beat: firstReturn.beat, channel };
    });
    const restoredState = declareChannelState(
        replayInReaderOrder(
            returns.filter((row) => row.channel === head.channel),
            head.channel
        )
    ).map((message) => ({ ...message, channel: head.channel }));
    if (JSON.stringify(restoredState) === JSON.stringify(targetDeclaration)) {
        return null;
    }
    // The rewritten rows take the first return's position and the rest of the family is dropped, so
    // the returns stay contiguous wherever an earlier row pulled the family ahead of the tick.
    const result: MidiCC[] = [];
    let inserted = false;
    for (const row of rows) {
        if (returns.includes(row)) {
            if (!inserted) {
                result.push(...rewritten);
                inserted = true;
            }
            continue;
        }
        result.push(row);
    }
    return result;
}
