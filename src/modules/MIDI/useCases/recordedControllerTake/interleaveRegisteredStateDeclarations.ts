import { createMidiChannelControllerState, type MidiChannelControllerState } from '../../models/MidiControllerState';
import { createMidiCC, type MidiCC, type MidiPitchBend } from '../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';
import { applyRegisteredParameterChange } from '../../services/applyRegisteredParameterChange';
import {
    declareChannelState,
    isRegisteredParameterController,
    reconcileRegisteredParameterMessages,
    type RegisteredParameterMessage,
} from '../../services/registeredParameterState';

/** One take's rows in a clip, each list in the order the store keeps it. */
export type TakeRows = { cc: readonly MidiCC[]; pitchBend: readonly MidiPitchBend[] };

type Take = 'earlier' | 'overdub';

/**
 * A row of one channel that reads the channel's registered-parameter state: a bend, which a range scales,
 * or a message to the state machine, which a selection changes the meaning of. `index` is a message's
 * place in its take's controller list.
 */
type StateReadingRow = { beat: number; take: Take; message?: MidiCC; index: number };

/** Declaration rows to place in the overdub's controller list ahead of the row at `beforeIndex`. */
type Declaration = { beforeIndex: number; rows: MidiCC[] };

function readStateReadingRows(rows: TakeRows, take: Take, channel: number): StateReadingRow[] {
    const messages = rows.cc
        .map((message, index) => ({ beat: message.beat, take, message, index }))
        .filter(({ message }) => message.channel === channel && isRegisteredParameterController(message.controller));
    const bends = rows.pitchBend
        .filter((bend) => bend.channel === channel)
        .map((bend) => ({ beat: bend.beat, take, index: -1 }));
    return [...messages, ...bends];
}

type BeatGroup = { beat: number; rows: StateReadingRow[] };

/** Rows one instant apart at most, in the order given: the stored reader runs a beat's messages before its bends read the state. */
function groupByBeat(rows: readonly StateReadingRow[]): BeatGroup[] {
    const groups: BeatGroup[] = [];
    for (const row of rows) {
        const group = groups.at(-1);
        if (group && row.beat <= group.beat + SAME_BEAT_TOLERANCE) {
            group.rows.push(row);
            continue;
        }
        groups.push({ beat: row.beat, rows: [row] });
    }
    return groups;
}

function applyMessages(
    states: readonly MidiChannelControllerState[],
    messages: readonly RegisteredParameterMessage[]
): void {
    for (const { controller, value } of messages) {
        for (const state of states) {
            applyRegisteredParameterChange(state, controller, value);
        }
    }
}

function replayState(messages: readonly RegisteredParameterMessage[]): MidiChannelControllerState {
    const state = createMidiChannelControllerState();
    applyMessages([state], messages);
    return state;
}

function messagesOf(rows: readonly StateReadingRow[]): MidiCC[] {
    return rows.map(({ message }) => message).filter((message) => message !== undefined);
}

/**
 * Walk one channel's rows of both takes in the order the clip will hold them, tracking the state in force
 * and each take's own state machine. A beat belongs to the overdub when it has rows there (they come last,
 * and a bend reads the state its beat ends in), else to the earlier take; where the state in force is not
 * that take's, declare that take's state at the beat. A declaration for the overdub goes ahead of its rows
 * of the beat, so a message it recorded there still follows its own state; one back to the earlier take
 * sits in the overdub's list too, so it can only follow the earlier take's rows of the beat, and declares
 * the state they leave that take in.
 */
function declareChannelChangeovers(
    earlier: TakeRows,
    overdub: TakeRows,
    overdubStartState: readonly MidiCC[],
    channel: number
): Declaration[] {
    // The overdub's rows follow the earlier take's at one beat: the write appends them, and the reader sorts stably.
    const rows = [
        ...readStateReadingRows(earlier, 'earlier', channel),
        ...readStateReadingRows(overdub, 'overdub', channel),
    ];
    rows.sort((left, right) => left.beat - right.beat);

    const inForce = createMidiChannelControllerState();
    const stateOf: Record<Take, MidiChannelControllerState> = {
        earlier: createMidiChannelControllerState(),
        overdub: replayState(overdubStartState.filter((row) => row.channel === channel)),
    };
    const declarations: Declaration[] = [];
    for (const { beat, rows: group } of groupByBeat(rows)) {
        const overdubRows = group.filter((row) => row.take === 'overdub');
        applyMessages([inForce, stateOf.earlier], messagesOf(group.filter((row) => row.take === 'earlier')));

        const take: Take = overdubRows.length > 0 ? 'overdub' : 'earlier';
        const reconciled = reconcileRegisteredParameterMessages({
            current: declareChannelState(inForce).map((message) => ({ ...message, channel })),
            target: declareChannelState(stateOf[take]).map((message) => ({ ...message, channel })),
        });
        applyMessages([inForce], reconciled);
        if (reconciled.length > 0) {
            declarations.push({
                beforeIndex: overdubRows.find((row) => row.message)?.index ?? overdub.cc.length,
                rows: reconciled.map(({ controller, value }) => createMidiCC(controller, value, beat, channel)),
            });
        }

        applyMessages([inForce, stateOf.overdub], messagesOf(overdubRows));
    }
    return declarations;
}

function readOverdubChannels({ cc, pitchBend }: TakeRows): number[] {
    const channels = new Set([
        ...cc.filter((row) => isRegisteredParameterController(row.controller)).map((row) => row.channel),
        ...pitchBend.map((row) => row.channel),
    ]);
    return [...channels].sort((first, second) => first - second);
}

/**
 * The overdub's controller rows with the declarations that keep each take's bends and parameter rows
 * under the registered-parameter state that was live when that take recorded them.
 *
 * A clip reads one state machine per channel across all its rows (`createStoredBendRangeReader`), so
 * without them the earlier take's state would scale the overdub's bends, and once the overdub changed the
 * state, its state would scale the earlier take's later ones. The earlier take's state is the one its own
 * rows replay to; the overdub's is the one the input held when the take first recorded into this clip (`overdubStartState`, as
 * declaration rows), advanced by the overdub's own messages. At every beat where the state in force is
 * not that of the take whose rows sit there, `reconcileRegisteredParameterMessages` brings it there. A
 * channel the overdub gives no bend or parameter message, or where the two states agree at every
 * changeover, gets nothing. The declarations are new rows in the overdub's list, so the write and any
 * snapshot planned from it carry the same ids.
 */
export function interleaveRegisteredStateDeclarations({
    earlier,
    overdub,
    overdubStartState,
}: {
    earlier: TakeRows;
    overdub: TakeRows;
    overdubStartState: readonly MidiCC[];
}): MidiCC[] {
    const declarations = readOverdubChannels(overdub).flatMap((channel) =>
        declareChannelChangeovers(earlier, overdub, overdubStartState, channel)
    );
    const declarationsBefore = Map.groupBy(declarations, ({ beforeIndex }) => beforeIndex);
    const interleaved: MidiCC[] = [];
    const declareBefore = (index: number) => {
        for (const { rows } of declarationsBefore.get(index) ?? []) {
            interleaved.push(...rows);
        }
    };
    for (const [index, row] of overdub.cc.entries()) {
        declareBefore(index);
        interleaved.push(row);
    }
    declareBefore(overdub.cc.length);
    return interleaved;
}
