/**
 * Write a built-in's parameters now, on a device a native live session is
 * carrying (#3893).
 *
 * The immediate route, not the stamped one: a value applied at the next audio
 * callback queues nothing, while a patch load or a macro drag would overrun a
 * device's stamp queue several times over in one gesture.
 *
 * Queued on the session's own chain rather than sent straight, for the reason
 * `sendNativeLiveMidiNote` queues there: a write that raced a start would be
 * dropped before the batch that built the strip it addresses had published its
 * handle, and the engine would then hold the value the topology carried rather
 * than the one the musician just moved.
 *
 * Split into records of at most {@link MAX_IMMEDIATE_DEVICE_PARAMETERS}, and
 * sent as one batch however many records that is. The engine refuses the whole
 * batch over a record past that ceiling, so a full patch cannot travel as one
 * record on any ceiling smaller than it; and it is one gesture, so its records
 * must land together — a patch delivered as two batches is audibly two sounds,
 * and a batch refused between them leaves the instrument holding half of each
 * patch.
 *
 * A Bacteria modulation-assignment table rides the same batch, as one
 * `set-device-mod-assignments` command appended after every parameter
 * record (#4685 slice 2): the two travel as one gesture for the same reason
 * the parameter records do, and appending it last matches the order
 * `updateDevicePatch` already applies to the Web Audio worklet (parameters,
 * then the table). Present-but-empty (`[]`) is sent — it clears the engine's
 * table — while an absent `modAssignments` appends no command at all, so a
 * plain parameter write never touches routing it was not asked to change.
 *
 * Answers whether a session backend existed to send to, not whether the engine
 * accepted the batch — the write is fire-and-forget once a backend is present.
 * Callers decide the carrier before writing, on the same carried check the
 * automation writer uses, so nothing branches on this answer; it exists so a
 * spec can observe a refused write without standing up a backend.
 */

import {
    MAX_IMMEDIATE_DEVICE_PARAMETERS,
    type AudioGraphCommand,
    type AudioGraphSetDeviceModAssignmentsCommand,
    type AudioGraphSetDeviceParametersCommand,
    type NativeModAssignmentRow,
} from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type NativeDeviceParameterWrite = Readonly<{
    trackId: string;
    deviceId: string;
    values: Readonly<Record<string, number>>;
    /**
     * A Bacteria modulation-assignment table to replace in the same batch, or
     * absent to leave the engine's table untouched. `[]` is a valid table —
     * it clears every row — and is sent, not treated as absent.
     */
    modAssignments?: readonly NativeModAssignmentRow[];
}>;

function recordsWithinCeiling(values: Readonly<Record<string, number>>): Readonly<Record<string, number>>[] {
    const entries = Object.entries(values);
    const records: Readonly<Record<string, number>>[] = [];
    for (let start = 0; start < entries.length; start += MAX_IMMEDIATE_DEVICE_PARAMETERS) {
        records.push(Object.fromEntries(entries.slice(start, start + MAX_IMMEDIATE_DEVICE_PARAMETERS)));
    }
    return records;
}

export function sendNativeDeviceParameters(input: NativeDeviceParameterWrite): Promise<boolean> {
    return queueOnNativeLiveGraphSession(async (): Promise<boolean> => {
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return false;
        }
        const target = { trackId: input.trackId, deviceId: input.deviceId };
        const commands: AudioGraphCommand[] = recordsWithinCeiling(input.values).map(
            (values): AudioGraphSetDeviceParametersCommand => ({
                kind: 'set-device-parameters',
                target,
                values,
            })
        );
        if (input.modAssignments !== undefined) {
            commands.push({
                kind: 'set-device-mod-assignments',
                target,
                assignments: input.modAssignments,
            } satisfies AudioGraphSetDeviceModAssignmentsCommand);
        }
        if (commands.length === 0) {
            return true;
        }
        await backend.apply({ schemaVersion: 1, commands });
        return true;
    });
}
