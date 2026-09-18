/**
 * Set a built-in's bypass on the engine's own chain, now, on a device a native
 * live session is carrying (#3946).
 *
 * The immediate counterpart of the `bypassed` field the device's topology
 * carries: the engine otherwise learns a mid-roll toggle only at the next strip
 * rebuild, which is the next Play. The chain skips a bypassed body and runs its
 * dry line in place of it, so this is what takes a carried device out of — and
 * back into — the audible path while rolling.
 *
 * Queued on the session's own chain rather than sent straight, for the reason
 * `sendNativeDeviceParameters` queues there: a write that raced a start would be
 * dropped before the batch that built the strip it addresses had published its
 * handle.
 *
 * Additive, never exclusive: the caller keeps writing the Web Audio node, which
 * stays the strip's fallback carrier and has to hold the current bypass for the
 * moment the session's gate reopens at Stop. Answers whether a session backend
 * existed to send to, not whether the engine accepted the write, exactly as
 * {@link sendNativeDeviceParameters} does.
 */

import { type AudioGraphSetDeviceBypassCommand } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type NativeDeviceBypassWrite = Readonly<{
    trackId: string;
    deviceId: string;
    bypassed: boolean;
}>;

export function sendNativeDeviceBypass(input: NativeDeviceBypassWrite): Promise<boolean> {
    return queueOnNativeLiveGraphSession(async (): Promise<boolean> => {
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return false;
        }
        const command: AudioGraphSetDeviceBypassCommand = {
            kind: 'set-device-bypass',
            target: { trackId: input.trackId, deviceId: input.deviceId },
            bypassed: input.bypassed,
        };
        await backend.apply({ schemaVersion: 1, commands: [command] });
        return true;
    });
}
