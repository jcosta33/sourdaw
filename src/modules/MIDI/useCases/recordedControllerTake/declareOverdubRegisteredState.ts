import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';
import {
    recordedControllerTakeState,
    type RecordedControllerBuffer,
} from '../../repositories/webMidi/recordedControllerTakeState';
import {
    isRegisteredParameterController,
    reconcileRegisteredParameterMessages,
} from '../../services/registeredParameterState';
import { midiStore } from '../../stores/midiStore';

/**
 * The first beat of the overdub's rows on each channel that read the channel's
 * registered-parameter state: its pitch bends, which a range scales, and its own
 * RPN, NRPN and Data Entry messages, which a selection changes the meaning of.
 */
function readFirstStateBeatByChannel({ cc, pitchBend }: RecordedControllerBuffer): Map<number, number> {
    const firstBeatByChannel = new Map<number, number>();
    const rows = [...pitchBend, ...cc.filter((row) => isRegisteredParameterController(row.controller))];
    for (const { channel, beat } of rows) {
        const first = firstBeatByChannel.get(channel);
        if (first === undefined || beat < first) {
            firstBeatByChannel.set(channel, beat);
        }
    }
    return firstBeatByChannel;
}

/** The clip's stored messages to `channel`'s state machine in force at `beat`, in the order the reader runs them. */
function readStoredStateMessages(storedRows: readonly MidiCC[], channel: number, beat: number): MidiCC[] {
    return storedRows
        .filter(
            (row) =>
                row.channel === channel &&
                isRegisteredParameterController(row.controller) &&
                row.beat <= beat + SAME_BEAT_TOLERANCE
        )
        .sort((left, right) => left.beat - right.beat);
}

/**
 * Lead an overdub's buffered rows with the registered-parameter state the live
 * input held when the take began, wherever the clip it writes into holds another.
 *
 * An overdub into an existing clip opens no clip, so nothing seeded the take. The
 * clip reads one state per channel across its rows (`createStoredBendRangeReader`),
 * and the earlier take's declaration at beat 0 would set the range of every bend
 * the overdub adds even when the keyboard was back at another range. For each
 * channel the overdub gives a bend or a parameter message, the messages that bring
 * the clip's state in force at the channel's first such row (`reconcileRegisteredParameterMessages`)
 * to the live state go into the buffer at that beat, ahead of the overdub's own rows, so
 * the write carries them with their ids. A channel whose states agree, or whose
 * overdub rows read no state, gets nothing, and a bend the earlier take recorded
 * keeps the range it was recorded at.
 */
export function declareOverdubRegisteredState(clipId: string): void {
    const buffer = recordedControllerTakeState.buffers.get(clipId);
    if (!buffer) {
        return;
    }
    const storedRows = midiStore.value?.ccByClipId[clipId] ?? [];
    const liveRows = recordedControllerTakeState.registeredStateAtStart;
    const firstBeatByChannel = readFirstStateBeatByChannel(buffer);
    const declarations = [...firstBeatByChannel]
        .sort(([first], [second]) => first - second)
        .flatMap(([channel, beat]) =>
            reconcileRegisteredParameterMessages({
                current: readStoredStateMessages(storedRows, channel, beat),
                target: liveRows.filter((row) => row.channel === channel),
            }).map(({ controller, value }) => createMidiCC(controller, value, beat, channel))
        );
    buffer.cc.unshift(...declarations);
}
