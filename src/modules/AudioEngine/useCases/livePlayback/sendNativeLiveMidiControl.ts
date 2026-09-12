/**
 * Apply one live controller message on an instrument a native live session is
 * carrying (#3998).
 *
 * The pedal twin of `sendNativeLiveMidiNote`, and the only sanctioned renderer
 * route for a controller to a native-carried instrument. The engine's raw
 * `send_plugin_midi` command stays denied to the renderer
 * (`electron/commands.ts`): it addresses an engine plugin id, which is an
 * identity the renderer holds no truthful copy of, so a message sent that way
 * can land on whatever device happens to occupy that slot. This rides
 * `apply_graph_commands`, where a device is named the way every other graph
 * write names one — by strip and device.
 *
 * Queued on the session's own chain rather than sent straight, so the pedal
 * lands behind the batch that built the strip carrying it and behind the stop
 * that tears it down, and behind the note it was pressed before. Whether a
 * session is armed is decided *on* the queue, for the reason
 * `forwardMasterGainToNativeLiveGraphSession` decides it there: a message that
 * raced a start would otherwise be dropped before the start it was meant to
 * follow had published its handle.
 *
 * Answers whether a session backend took the message. Every caller today fires
 * and forgets: the carrier is decided before the send, on the same carried
 * check the note route uses, so nothing branches on this answer. It exists so a
 * spec can observe a refused send without standing up a backend.
 */

import { type AudioGraphSendMidiControlCommand } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type NativeLiveMidiControl = Readonly<{
    trackId: string;
    deviceId: string;
    /** Controller number, as the wire carries it: `0` through `127`. */
    controller: number;
    /** Controller position, as the wire carries it: `0` through `127`. */
    value: number;
    /** MIDI channel, as the engine addresses it: `0` through `15`. */
    channel: number;
}>;

export function sendNativeLiveMidiControl(input: NativeLiveMidiControl): Promise<boolean> {
    return queueOnNativeLiveGraphSession(async (): Promise<boolean> => {
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return false;
        }
        const command: AudioGraphSendMidiControlCommand = {
            kind: 'send-midi-control',
            target: { trackId: input.trackId, deviceId: input.deviceId },
            controller: input.controller,
            value: input.value,
            channel: input.channel,
        };
        await backend.apply({ schemaVersion: 1, commands: [command] });
        return true;
    });
}
