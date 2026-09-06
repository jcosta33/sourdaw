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
 * Answers whether a session backend took the write. Callers decide the carrier
 * before writing, on the same carried check the automation writer uses, so
 * nothing branches on this answer; it exists so a spec can observe a refused
 * write without standing up a backend.
 */

import {
    MAX_IMMEDIATE_DEVICE_PARAMETERS,
    type AudioGraphSetDeviceParametersCommand,
} from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type NativeDeviceParameterWrite = Readonly<{
    trackId: string;
    deviceId: string;
    values: Readonly<Record<string, number>>;
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
        const commands = recordsWithinCeiling(input.values).map((values): AudioGraphSetDeviceParametersCommand => ({
            kind: 'set-device-parameters',
            target,
            values,
        }));
        if (commands.length === 0) {
            return true;
        }
        await backend.apply({ schemaVersion: 1, commands });
        return true;
    });
}
