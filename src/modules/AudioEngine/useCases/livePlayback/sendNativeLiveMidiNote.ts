/**
 * Play one note now on an instrument a native live session is carrying (#3910).
 *
 * The only sanctioned renderer route for a live note to a native-carried
 * instrument. The engine's raw `send_plugin_midi` command stays denied to the
 * renderer (`electron/commands.ts`): it addresses an engine plugin id, which is
 * an identity the renderer holds no truthful copy of, so a note sent that way
 * can land on whatever device happens to occupy that slot. This rides
 * `apply_graph_commands`, where a device is named the way every other graph
 * write names one — by strip and device.
 *
 * Queued on the session's own chain rather than sent straight, so the note
 * lands behind the batch that built the strip carrying it and behind the stop
 * that tears it down. Whether a session is armed is decided *on* the queue, for
 * the reason `forwardMasterGainToNativeLiveGraphSession` decides it there: a
 * note that raced a start would otherwise be dropped before the start it was
 * meant to follow had published its handle.
 *
 * Answers whether the note was sent, because the caller that also voices notes
 * on Web Audio has to know which carrier took this one.
 */

import { type AudioGraphSendMidiNoteCommand } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type NativeLiveMidiNote = Readonly<{
    trackId: string;
    deviceId: string;
    note: number;
    velocity: number;
    /** MIDI channel, as the engine addresses it: `0` through `15`. */
    channel: number;
    isNoteOn: boolean;
}>;

export function sendNativeLiveMidiNote(input: NativeLiveMidiNote): Promise<boolean> {
    return queueOnNativeLiveGraphSession(async (): Promise<boolean> => {
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return false;
        }
        const command: AudioGraphSendMidiNoteCommand = {
            kind: 'send-midi-note',
            target: { trackId: input.trackId, deviceId: input.deviceId },
            note: input.note,
            velocity: input.velocity,
            channel: input.channel,
            isNoteOn: input.isNoteOn,
        };
        await backend.apply({ schemaVersion: 1, commands: [command] });
        return true;
    });
}
